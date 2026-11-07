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
 * @param {import('./keyPool').KeyPool} pool
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

  function maskKey(key) {
    const k = String(key || '');
    if (k.startsWith('tryit-')) return k.slice(0, 14) + '…';
    return k.length > 10 ? k.slice(0, 6) + '…' + k.slice(-4) : '…';
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
        const keys = pool.list();
        const usable = pool.usableKeys().length;
        const gatewayKeys = store.state.gatewayKeys;
        return json(res, 200, {
          version: '1.0.0',
          uptimeMs: Date.now() - startedAt,
          upstream: {
            total: keys.length,
            usable,
            exhausted: keys.filter((k) => k.cooldownUntil && k.cooldownUntil > Date.now()).length,
            disabled: keys.filter((k) => k.status === 'disabled').length,
            anonymousFallback: CONFIG.allowAnonymousFallback,
            lastError: keys.filter((k) => k.lastErrorMessage).slice(0, 5).map((k) => ({
              name: k.name || maskKey(k.key),
              error: k.lastErrorMessage,
              at: k.lastErrorAt,
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

      // ---- upstream keys -------------------------------------------------------
      if (route === 'GET /api/admin/keys') {
        return json(res, 200, {
          keys: pool.list().map((k) => ({
            id: k.id,
            key: k.key,
            masked: maskKey(k.key),
            name: k.name,
            status: k.status,
            cooldownUntil: k.cooldownUntil && k.cooldownUntil > Date.now() ? new Date(k.cooldownUntil).toISOString() : null,
            parked: Boolean(k.cooldownUntil && k.cooldownUntil > Date.now()),
            uses: k.uses,
            errors: k.errors,
            lastUsedAt: k.lastUsedAt,
            lastErrorAt: k.lastErrorAt,
            lastErrorMessage: k.lastErrorMessage,
          })),
        });
      }
      if (route === 'POST /api/admin/keys') {
        try {
          const body = await readBody(req);
          const keys = String(body.key ?? '')
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (!keys.length) return json(res, 400, { error: 'Provide one or more keys' });
          const added = [];
          const failed = [];
          for (const k of keys) {
            try {
              added.push(pool.addKey(k, body.name));
            } catch (err) {
              failed.push({ key: maskKey(k), error: err.message });
            }
          }
          return json(res, added.length ? 200 : 400, { added: added.length, failed });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/keys/status') {
        try {
          const body = await readBody(req);
          return json(res, 200, { key: pool.setKeyStatus(body.id, body.status) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/keys/reset') {
        try {
          const body = await readBody(req);
          const entry = pool.list().find((k) => k.id === body.id);
          if (!entry) return json(res, 404, { error: 'Key not found' });
          entry.errors = 0;
          entry.lastErrorMessage = '';
          entry.cooldownUntil = null;
          if (entry.status !== 'disabled') entry.status = 'active';
          store.save();
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/keys/test') {
        const body = await readBody(req);
        const result = await pool.testKey(body.id);
        return json(res, 200, result);
      }
      const keyDel = pathname.match(/^\/api\/admin\/keys\/([a-f0-9-]+)$/);
      if (keyDel && req.method === 'DELETE') {
        try {
          return json(res, 200, { removed: pool.removeKey(keyDel[1]) });
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
