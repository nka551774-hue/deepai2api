'use strict';

/**
 * Admin panel backend — all under /api/admin/*, guarded by a session token
 * obtained via POST /api/admin/login. Token travels in the Authorization
 * header (Bearer) or the X-Admin-Token header.
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');

/**
 * @param {import('./store').Store} store
 * @param {import('./accountPool').AccountPool} pool
 * @param {import('./auth').Auth} auth
 */
function createAdminRoutes(store, pool, auth) {
  const startedAt = Date.now();

  function tokenOf(req) {
    const h = req.headers['authorization'] || '';
    if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
    return String(req.headers['x-admin-token'] || '').trim();
  }

  function guard(req, res) {
    if (!auth.isAdmin(tokenOf(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return false;
    }
    return true;
  }

  function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2 * 1024 * 1024) throw new Error('Body too large');
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }

  /** Friendly plan/credit summary from the /daily-time-sync/user/ object. */
  function planOf(u) {
    if (!u || typeof u !== 'object') return '';
    if (u.has_active_subscription || u.is_pro || u.subscription_type || u.plan) {
      return String(u.subscription_type || u.plan || 'pro');
    }
    const credits = u.gen_available_credits ?? u.available_credits ?? u.credit ?? u.credits;
    return credits !== undefined ? `credits: ${credits}` : '';
  }

  return {
    async handle(req, res, pathname) {
      const route = `${req.method} ${pathname}`;

      // ---- login/logout (no auth) ------------------------------------------
      if (route === 'POST /api/admin/login') {
        const body = await readBody(req);
        const token = auth.login(body.password ?? '');
        if (!token) return json(res, 401, { error: 'Wrong password' });
        return json(res, 200, { token, ttlMs: CONFIG.adminSessionTtlMs });
      }
      if (route === 'POST /api/admin/logout') {
        auth.logout(tokenOf(req));
        return json(res, 200, { ok: true });
      }
      if (route === 'GET /api/admin/config') {
        return json(res, 200, {
          openMode: CONFIG.allowOpenWhenNoKeys && store.state.gatewayKeys.length === 0,
          anonFallback: CONFIG.allowAnonymousFallback,
        });
      }

      if (!guard(req, res)) return;

      // ---- overview ----------------------------------------------------------
      if (route === 'GET /api/admin/overview') {
        const s = store.state.stats;
        const accounts = pool.list();
        const now = Date.now();
        const gatewayKeys = store.state.gatewayKeys;
        return json(res, 200, {
          version: '1.1.0',
          uptimeMs: Date.now() - startedAt,
          accounts: {
            total: accounts.length,
            usable: pool.usable().length,
            byType: {
              cookie: accounts.filter((a) => a.type === 'cookie').length,
              login: accounts.filter((a) => a.type === 'login').length,
              apikey: accounts.filter((a) => a.type === 'apikey').length,
            },
            cooling: accounts.filter((a) => a.cooldownUntil && a.cooldownUntil > now).length,
            disabled: accounts.filter((a) => a.status === 'disabled').length,
            anonymousFallback: CONFIG.allowAnonymousFallback,
            lastError: accounts.filter((a) => a.lastErrorMessage).slice(0, 5).map((a) => ({
              name: a.name || a.email || 'account',
              error: a.lastErrorMessage,
              at: a.lastErrorAt,
            })),
          },
          gateway: {
            total: gatewayKeys.length,
            enabled: gatewayKeys.filter((k) => k.enabled).length,
            uses: gatewayKeys.reduce((a, k) => a + k.uses, 0),
          },
          stats: {
            totalRequests: s.totalRequests,
            totalErrors: s.totalErrors,
            totalChars: s.totalChars,
            perModel: s.perModel,
            perGatewayKey: s.perGatewayKey,
          },
          settings: store.state.settings,
        });
      }

      // ---- upstream accounts ----------------------------------------------------
      if (route === 'GET /api/admin/accounts') {
        const now = Date.now();
        return json(res, 200, {
          accounts: pool.list().map((a) => ({
            id: a.id,
            type: a.type,
            name: a.name,
            email: a.type === 'login' ? a.email : '',
            cookiePreview: a.cookie ? a.cookie.slice(0, 24) + '…' : '',
            cookieUpdatedAt: a.cookieUpdatedAt,
            apiKeyPreview: a.type === 'apikey' ? a.apiKey.slice(0, 10) + '…' : '',
            status: a.status,
            parked: Boolean(a.cooldownUntil && a.cooldownUntil > now),
            cooldownUntil: a.cooldownUntil && a.cooldownUntil > now ? new Date(a.cooldownUntil).toISOString() : null,
            uses: a.uses,
            errors: a.errors,
            lastUsedAt: a.lastUsedAt,
            lastErrorAt: a.lastErrorAt,
            lastErrorMessage: a.lastErrorMessage,
            userInfo: a.userInfo ? { username: a.userInfo.username, email: a.userInfo.email, plan: planOf(a.userInfo) } : null,
            createdAt: a.createdAt,
          })),
        });
      }
      if (route === 'POST /api/admin/accounts') {
        try {
          const body = await readBody(req);
          if (body.type === 'login') {
            const account = await pool.addLoginAccount(body.email, body.password, body.name);
            return json(res, 200, { added: 1, account: { id: account.id, name: account.name } });
          }
          // default: cookie import (one per line)
          const cookies = String(body.cookie ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (!cookies.length) return json(res, 400, { error: 'Provide a Cookie header (或多行,一行一個帳號)' });
          const added = [];
          const failed = [];
          for (const c of cookies) {
            try {
              const acc = pool.addCookieAccount(c, body.name);
              added.push(acc.id);
            } catch (err) {
              failed.push({ preview: c.slice(0, 20) + '…', error: err.message });
            }
          }
          return json(res, added.length ? 200 : 400, { added: added.length, failed });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/status') {
        try {
          const body = await readBody(req);
          return json(res, 200, { account: pool.setStatus(body.id, body.status) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/reset') {
        try {
          const body = await readBody(req);
          return json(res, 200, { account: pool.resetAccount(body.id) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/refresh') {
        try {
          const body = await readBody(req);
          const entry = pool.get(body.id);
          if (!entry) return json(res, 404, { error: 'Account not found' });
          const result = await pool.refreshLogin(entry);
          return json(res, result.ok ? 200 : 400, result);
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/test') {
        const body = await readBody(req);
        try {
          return json(res, 200, await pool.probe(body.id));
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      const accDel = pathname.match(/^\/api\/admin\/accounts\/([a-f0-9-]+)$/);
      if (accDel && req.method === 'DELETE') {
        try {
          return json(res, 200, { removed: pool.removeAccount(accDel[1]) });
        } catch (err) {
          return json(res, 404, { error: err.message });
        }
      }

      // ---- gateway keys ---------------------------------------------------------
      if (route === 'GET /api/admin/gateway-keys') {
        return json(res, 200, { keys: store.state.gatewayKeys });
      }
      if (route === 'POST /api/admin/gateway-keys') {
        try {
          const body = await readBody(req);
          return json(res, 200, { key: auth.createGatewayKey(body) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/gateway-keys/enable') {
        try {
          const body = await readBody(req);
          return json(res, 200, { key: auth.setGatewayKeyEnabled(body.id, body.enabled) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      const gwDel = pathname.match(/^\/api\/admin\/gateway-keys\/([a-f0-9-]+)$/);
      if (gwDel && req.method === 'DELETE') {
        try {
          return json(res, 200, { removed: auth.removeGatewayKey(gwDel[1]) });
        } catch (err) {
          return json(res, 404, { error: err.message });
        }
      }

      // ---- logs -------------------------------------------------------------------
      if (route === 'GET /api/admin/logs') {
        const limit = Math.min(200, Math.max(1, parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '100', 10) || 100));
        return json(res, 200, { logs: store.state.logs.slice(0, limit) });
      }

      // ---- settings ---------------------------------------------------------------
      if (route === 'GET /api/admin/settings') {
        return json(res, 200, { settings: store.state.settings, editable: ['defaultModel', 'modelMap', 'requestTimeoutMs', 'passThroughModels'] });
      }
      if (route === 'POST /api/admin/settings') {
        const body = await readBody(req);
        const s = store.state.settings;
        if (typeof body.defaultModel === 'string' && body.defaultModel) s.defaultModel = body.defaultModel;
        if (body.modelMap && typeof body.modelMap === 'object') s.modelMap = body.modelMap;
        if (typeof body.passThroughModels === 'boolean') s.passThroughModels = body.passThroughModels;
        if (Number.isFinite(Number(body.requestTimeoutMs)) && Number(body.requestTimeoutMs) >= 5000)
          s.requestTimeoutMs = Number(body.requestTimeoutMs);
        store.save();
        return json(res, 200, { settings: s });
      }

      return json(res, 404, { error: 'Not found' });
    },
  };
}

module.exports = { createAdminRoutes };
