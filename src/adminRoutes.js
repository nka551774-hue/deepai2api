'use strict';

/**
 * Admin panel backend — all under /api/admin/*, guarded by a session token
 * obtained via POST /api/admin/login. Token travels in the Authorization
 * header (Bearer) or the X-Admin-Token header.
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { publicSettings, validateSettingsPatch } = require('./settings');

const EDITABLE_SETTINGS = [
  'defaultModel',
  'modelMap',
  'passThroughModels',
  'requestTimeoutMs',
  'allowAnonymousFallback',
  'allowOpenWhenNoKeys',
  'maxLogEntries',
  'pollIntervalMs',
  'theme',
  'uiLanguage',
  'visiblePages',
  'windowMaxHeight',
];

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
    return String(req.headers['x-admin-token'] || req.headers['x-panel-token'] || '').trim();
  }

  function guard(req, res) {
    if (!auth.isAdmin(tokenOf(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return false;
    }
    return true;
  }

  function json(res, status, obj) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        const error = new Error('Body too large');
        error.status = 413;
        throw error;
      }
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      const error = new Error('Malformed JSON body');
      error.status = 400;
      throw error;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      const error = new Error('JSON body must be an object');
      error.status = 400;
      throw error;
    }
    return body;
  }

  function clientError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
  }

  function validateAccountMetadata(body, { requireId = false } = {}) {
    if (requireId && (typeof body.id !== 'string' || !body.id.trim())) throw clientError('id is required');
    const patch = {};
    if (Object.hasOwn(body, 'name')) {
      if (typeof body.name !== 'string') throw clientError('name must be a string');
      patch.name = body.name.trim();
    }
    if (Object.hasOwn(body, 'group')) {
      if (typeof body.group !== 'string') throw clientError('group must be a string');
      patch.group = body.group.trim();
    }
    if (Object.hasOwn(body, 'weight')) {
      if (!Number.isInteger(body.weight) || body.weight < 1 || body.weight > 100) {
        throw clientError('weight must be an integer from 1 to 100');
      }
      patch.weight = body.weight;
    }
    return patch;
  }

  function accountView(account) {
    const now = Date.now();
    return {
      id: account.id,
      type: account.type,
      name: account.name || '',
      email: account.type === 'login' ? account.email || '' : '',
      cookiePreview: account.cookie ? 'Cookie ••••' : '',
      cookieUpdatedAt: account.cookieUpdatedAt || null,
      apiKeyPreview: account.type === 'apikey' && account.apiKey ? 'API Key ••••' : '',
      group: account.group || '',
      weight: Number.isInteger(account.weight) ? account.weight : 1,
      status: account.status,
      parked: Boolean(account.cooldownUntil && account.cooldownUntil > now),
      cooldownUntil: account.cooldownUntil && account.cooldownUntil > now ? new Date(account.cooldownUntil).toISOString() : null,
      uses: account.uses || 0,
      errors: account.errors || 0,
      lastUsedAt: account.lastUsedAt || null,
      lastErrorAt: account.lastErrorAt || null,
      lastErrorMessage: account.lastErrorMessage || '',
      userInfo: account.userInfo
        ? { username: account.userInfo.username, email: account.userInfo.email, plan: planOf(account.userInfo) }
        : null,
      createdAt: account.createdAt || null,
    };
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
      try {
      const route = `${req.method} ${pathname}`;

      // ---- panel session (workbuddy-compatible contract) --------------------
      if (route === 'GET /panel/status') {
        return json(res, 200, {
          panel_password_required: true,
          panel_password_is_default: auth.panelPasswordIsDefault(),
          authenticated: auth.isAdmin(tokenOf(req)),
          crypto_ok: true,
          api_key_set: store.state.gatewayKeys.some((k) => k.enabled),
        });
      }
      if (route === 'POST /panel/login') {
        const body = await readBody(req);
        const token = auth.login(body.password ?? '', Boolean(body.remember));
        if (!token) return json(res, 401, { ok: false, error: 'wrong password' });
        return json(res, 200, { ok: true, token });
      }
      if (route === 'POST /panel/logout') {
        auth.logout(tokenOf(req));
        return json(res, 200, { ok: true });
      }
      if (route === 'POST /panel/password') {
        const currentToken = tokenOf(req);
        if (!auth.isAdmin(currentToken)) return json(res, 401, { ok: false, error: 'unauthorized' });
        const body = await readBody(req);
        if (!auth.verifyPanelPassword(body.current ?? '')) {
          return json(res, 400, { ok: false, error: 'current password incorrect' });
        }
        const next = String(body.next ?? '');
        if (next.length < 1) return json(res, 400, { ok: false, error: 'new password required' });
        auth.setPanelPassword(next, currentToken);
        return json(res, 200, { ok: true });
      }

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
        const settings = store.state.settings || {};
        return json(res, 200, {
          openMode: (settings.allowOpenWhenNoKeys ?? CONFIG.allowOpenWhenNoKeys) && store.state.gatewayKeys.length === 0,
          anonFallback: settings.allowAnonymousFallback ?? CONFIG.allowAnonymousFallback,
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
            anonymousFallback: store.state.settings.allowAnonymousFallback ?? CONFIG.allowAnonymousFallback,
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
          settings: publicSettings(store.state.settings),
        });
      }

      // ---- upstream accounts ----------------------------------------------------
      if (route === 'GET /api/admin/accounts') {
        return json(res, 200, {
          accounts: pool.list().map(accountView),
        });
      }
      if (route === 'POST /api/admin/accounts') {
        try {
          const body = await readBody(req);
          const metadata = validateAccountMetadata(body);
          if (body.type === 'login') {
            const account = await pool.addLoginAccount(body.email, body.password, body.name);
            if (Object.hasOwn(metadata, 'group') || Object.hasOwn(metadata, 'weight')) pool.updateAccount(account.id, metadata);
            return json(res, 200, { added: 1, account: { id: account.id, name: account.name } });
          }
          if (body.type === 'apikey') {
            if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) throw clientError('apiKey is required');
            const account = pool.addApiKeyAccount(body.apiKey.trim(), metadata.name || '');
            if (Object.keys(metadata).length) pool.updateAccount(account.id, metadata);
            return json(res, 200, { added: 1, account: { id: account.id, name: account.name } });
          }
          if (body.type !== undefined && body.type !== 'cookie') throw clientError('type must be cookie, login or apikey');
          // default: cookie import (one per line)
          const cookies = String(body.cookie ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (!cookies.length) return json(res, 400, { error: 'Provide a Cookie header (或多行,一行一個帳號)' });
          const added = [];
          const failed = [];
          for (const [index, c] of cookies.entries()) {
            try {
              const acc = pool.addCookieAccount(c, body.name);
              if (Object.keys(metadata).length) pool.updateAccount(acc.id, metadata);
              added.push(acc.id);
            } catch (err) {
              failed.push({ index, error: err.message });
            }
          }
          return json(res, added.length ? 200 : 400, { added: added.length, failed });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/update') {
        try {
          const body = await readBody(req);
          const patch = validateAccountMetadata(body, { requireId: true });
          if (!Object.keys(patch).length) throw clientError('No editable account fields were provided');
          const account = pool.updateAccount(body.id.trim(), patch);
          return json(res, 200, { account: accountView(account) });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/batch') {
        try {
          const body = await readBody(req);
          if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string' || !id.trim())) {
            throw clientError('ids must be an array of account IDs');
          }
          const action = body.action;
          if (!['enable', 'disable', 'reset', 'test', 'refresh', 'delete'].includes(action)) {
            throw clientError('Invalid batch action');
          }
          const results = [];
          for (const id of [...new Set(body.ids.map((value) => value.trim()))]) {
            try {
              if (action === 'enable') pool.setStatus(id, 'active');
              else if (action === 'disable') pool.setStatus(id, 'disabled');
              else if (action === 'reset') pool.resetAccount(id);
              else if (action === 'test') {
                const result = await pool.probe(id);
                if (result && result.ok === false) throw new Error(result.message || 'Account test failed');
              } else if (action === 'refresh') {
                const account = pool.get(id);
                if (!account) throw new Error('Account not found');
                if (account.type !== 'login') throw new Error('Refresh is only available for login accounts');
                const result = await pool.refreshLogin(account);
                if (!result || result.ok === false) throw new Error(result?.message || 'Account refresh failed');
              } else if (action === 'delete') pool.removeAccount(id);
              results.push({ id, ok: true });
            } catch (err) {
              results.push({ id, ok: false, message: err.message });
            }
          }
          const succeeded = results.filter((result) => result.ok).length;
          return json(res, 200, { results, succeeded, failed: results.length - succeeded });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/import') {
        try {
          const body = await readBody(req);
          if (!Array.isArray(body.accounts)) throw clientError('accounts must be an array');
          let added = 0;
          const failed = [];
          for (let index = 0; index < body.accounts.length; index += 1) {
            try {
              const record = body.accounts[index];
              if (!record || typeof record !== 'object' || Array.isArray(record)) throw clientError('Account record must be an object');
              await pool.importAccount({ ...record });
              added += 1;
            } catch (err) {
              failed.push({ index, error: err.message });
            }
          }
          return json(res, 200, { added, failed });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/export') {
        try {
          const body = await readBody(req);
          if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string' || !id.trim()))) {
            throw clientError('ids must be an array of account IDs');
          }
          const ids = body.ids === undefined ? undefined : [...new Set(body.ids.map((id) => id.trim()))];
          return json(res, 200, { version: 1, accounts: pool.exportAccounts(ids) });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/status') {
        try {
          const body = await readBody(req);
          if (!['active', 'disabled'].includes(body.status)) throw clientError('status must be active or disabled');
          return json(res, 200, { account: accountView(pool.setStatus(body.id, body.status)) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (route === 'POST /api/admin/accounts/reset') {
        try {
          const body = await readBody(req);
          return json(res, 200, { account: accountView(pool.resetAccount(body.id)) });
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
          return json(res, 200, { removed: accountView(pool.removeAccount(accDel[1])) });
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
      if (route === 'POST /api/admin/gateway-keys/update') {
        try {
          const body = await readBody(req);
          if (typeof body.id !== 'string' || !body.id.trim()) throw clientError('id is required');
          const { id, ...patch } = body;
          return json(res, 200, { key: auth.updateGatewayKey(id.trim(), patch) });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
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
      if (route === 'POST /api/admin/logs/clear') {
        store.state.logs = [];
        store.save();
        return json(res, 200, { ok: true });
      }

      // ---- analytics (bucketed from the request-log ring) -------------------------
      if (route === 'GET /api/admin/analytics') {
        const range = new URL(req.url, 'http://x').searchParams.get('range') || '7d';
        const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
        const now = new Date();
        const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
        const sinceMs = since.getTime();
        const nowMs = now.getTime();
        const logs = store.state.logs.filter((l) => l.ts && l.kind);
        const byDay = new Map();
        const byHour = new Map();
        const perModel = new Map();
        const perKey = new Map();
        let total = 0;
        let errors = 0;
        let chars = 0;
        let latencySum = 0;
        let latencyN = 0;
        for (const l of logs) {
          const t = Date.parse(l.ts);
          if (!Number.isFinite(t)) continue;
          if (t < sinceMs || t > nowMs) continue;
          const localTime = new Date(t);
          const ok = l.status === 'ok';
          total += 1;
          if (!ok) errors += 1;
          if (l.chars) chars += l.chars || 0;
          if (l.latencyMs) {
            latencySum += l.latencyMs;
            latencyN += 1;
          }
          const d = localDateKey(localTime);
          const day = (byDay.get(d) || { date: d, requests: 0, errors: 0, chars: 0 });
          day.requests += 1;
          if (!ok) day.errors += 1;
          day.chars += l.chars || 0;
          byDay.set(d, day);
          const h = String(localTime.getHours()).padStart(2, '0');
          const hour = (byHour.get(h) || { hour: h, requests: 0, errors: 0 });
          hour.requests += 1;
          if (!ok) hour.errors += 1;
          byHour.set(h, hour);
          const m = (perModel.get(l.model || 'unknown') || { model: l.model || 'unknown', requests: 0, errors: 0, chars: 0, latencyMs: 0, latencyN: 0 });
          m.requests += 1;
          if (!ok) m.errors += 1;
          m.chars += l.chars || 0;
          if (l.latencyMs) {
            m.latencyMs += l.latencyMs;
            m.latencyN += 1;
          }
          perModel.set(m.model, m);
          const g = (perKey.get(l.gatewayKey || 'open-mode') || { key: l.gatewayKey || 'open-mode', requests: 0, errors: 0 });
          g.requests += 1;
          if (!ok) g.errors += 1;
          perKey.set(g.key, g);
        }
        const dayList = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
          dayList.push(byDay.get(d) || { date: d, requests: 0, errors: 0, chars: 0 });
        }
        const hourList = [];
        for (let h = 0; h < 24; h++) {
          const key = String(h).padStart(2, '0');
          hourList.push(byHour.get(key) || { hour: key, requests: 0, errors: 0 });
        }
        return json(res, 200, {
          range,
          kpis: {
            requests: total,
            errors,
            errorRate: total ? +(errors / total * 100).toFixed(1) : 0,
            chars,
            avgLatencyMs: latencyN ? Math.round(latencySum / latencyN) : 0,
          },
          days: dayList,
          hours: hourList,
          perModel: [...perModel.values()]
            .map((m) => ({ ...m, latencyMs: m.latencyN ? Math.round(m.latencyMs / m.latencyN) : 0 }))
            .sort((a, b) => b.requests - a.requests),
          perGatewayKey: [...perKey.values()].sort((a, b) => b.requests - a.requests),
        });
      }

      // ---- settings ---------------------------------------------------------------
      if (route === 'GET /api/admin/settings') {
        return json(res, 200, { settings: publicSettings(store.state.settings), editable: EDITABLE_SETTINGS });
      }
      if (route === 'POST /api/admin/settings') {
        try {
          const patch = validateSettingsPatch(await readBody(req));
          store.state.settings = { ...store.state.settings, ...patch };
          store.save();
          return json(res, 200, { settings: publicSettings(store.state.settings) });
        } catch (err) {
          return json(res, err.status || 400, { error: err.message });
        }
      }

      return json(res, 404, { error: 'Not found' });
      } catch (err) {
        if (res.writableEnded) return;
        return json(res, err.status || 500, { error: err.message || 'Internal server error' });
      }
    },
  };
}

module.exports = { createAdminRoutes };
