'use strict';

/**
 * Upstream ACCOUNT pool — the workbuddy2api-style account rotor.
 *
 * deepai.org accounts are cookie sessions, not persistent API keys: the
 * browser always sends a fresh single-use tryit key in `api-key` plus its
 * session cookies via credentials:'include'. The pool therefore manages
 * three account kinds:
 *
 *   cookie  — session cookies imported from the browser (paste the whole
 *             Cookie header from DevTools after logging in)
 *   login   — email + password; the gateway performs the site's own
 *             POST /daily-time-sync/login/ and keeps the cookie jar,
 *             re-logging in automatically when a session expires
 *   apikey  — a real dashboard key (pay-per-call MART-style), legacy mode
 *
 * Rotation: least-recently-used first, sticky per conversation; quota
 * refusals park a key with a long cooldown; soft errors get a short one;
 * chat/runApi fail over across accounts and finally to anonymous tryit
 * fallback (when enabled).
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { DeepAIClient, UpstreamError, loginAccount, fetchUser } = require('./deepai');
const { mintTryItKey, randomDeviceId } = require('./islandHash');

const COOLDOWN_MS = 90 * 1000; // soft errors → short park
const EXHAUSTED_RECHECK_MS = 6 * 3600 * 1000; // quota → long park, panel can reset

class AccountPool {
  /**
   * @param {import('./store').Store} store
   */
  constructor(store) {
    this.store = store;
    // conversation key -> account id, so multi-turn chats keep one identity
    this.sessionAccountMap = new Map();
  }

  list() {
    return this.store.state.accounts;
  }

  get(id) {
    return this.list().find((a) => a.id === id);
  }

  // ---------------------------------------------------------------- CRUD

  addCookieAccount(cookie, name = '') {
    cookie = sanitizeCookieHeader(cookie);
    if (!cookie) throw new Error('Cookie is required ("name=value; name2=value2")');
    return this._addAccount({ type: 'cookie', cookie, name });
  }

  /**
   * Add an account with email + password: performs the upstream login now
   * so bad credentials fail immediately.
   */
  async addLoginAccount(email, password, name = '') {
    email = String(email || '').trim();
    if (!email || !password) throw new Error('Email and password are required');
    const result = await loginAccount(email, password);
    if (!result.ok) {
      const detail =
        result.status === 400
          ? 'Email 或密碼不正確'
          : result.status === 429
            ? '上游限流,請稍後再試'
            : `Upstream HTTP ${result.status}`;
      throw new Error(`Login failed: ${detail}`);
    }
    if (!result.cookie || !/session/i.test(result.cookie)) {
      throw new Error('Login succeeded but no session cookie was returned');
    }
    return this._addAccount({ type: 'login', email, password, cookie: result.cookie, name: name || email, cookieUpdatedAt: new Date().toISOString() });
  }

  _addAccount(fields) {
    const entry = {
      id: crypto.randomUUID(),
      name: '',
      type: 'cookie',
      cookie: '',
      email: '',
      password: '',
      apiKey: '',
      status: 'active',
      deviceId: randomDeviceId(),
      uses: 0,
      errors: 0,
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorMessage: '',
      cooldownUntil: null,
      sessionUuid: null,
      userInfo: null,
      cookieUpdatedAt: null,
      createdAt: new Date().toISOString(),
      ...fields,
    };
    this.list().push(entry);
    this.store.save();
    return entry;
  }

  removeAccount(id) {
    const list = this.list();
    const idx = list.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error('Account not found');
    const [removed] = list.splice(idx, 1);
    for (const [sid, accId] of this.sessionAccountMap) if (accId === id) this.sessionAccountMap.delete(sid);
    this.store.save();
    return removed;
  }

  setStatus(id, status) {
    const entry = this.get(id);
    if (!entry) throw new Error('Account not found');
    entry.status = status === 'active' ? 'active' : 'disabled';
    if (entry.status === 'active') {
      entry.cooldownUntil = null;
      entry.lastErrorMessage = '';
    }
    this.store.save();
    return entry;
  }

  resetAccount(id) {
    const entry = this.get(id);
    if (!entry) throw new Error('Account not found');
    entry.errors = 0;
    entry.lastErrorMessage = '';
    entry.cooldownUntil = null;
    if (entry.status !== 'disabled') entry.status = 'active';
    this.store.save();
    return entry;
  }

  usable() {
    const now = Date.now();
    return this.list().filter((a) => a.status === 'active' && (!a.cooldownUntil || a.cooldownUntil <= now));
  }

  // ---------------------------------------------------------------- health

  /** Probe an account: session valid? plan/credits pulled from /user/. */
  async probe(id) {
    const entry = this.get(id);
    if (!entry) throw new Error('Account not found');
    if (entry.type === 'apikey') {
      try {
        const client = new DeepAIClient({ apiKey: entry.apiKey, deviceId: entry.deviceId });
        const res = await client.chat([{ role: 'user', content: 'Reply with the word OK.' }], { model: 'standard', timeoutMs: 60000 });
        entry.lastErrorMessage = '';
        entry.cooldownUntil = null;
        this.store.save();
        return { ok: true, text: res.text.slice(0, 120) };
      } catch (err) {
        this._recordFailure(entry, err);
        return { ok: false, code: err.code, message: err.message };
      }
    }
    const info = await fetchUser(entry.cookie, entry.deviceId);
    if (info.ok) {
      entry.userInfo = info.user;
      entry.lastErrorMessage = '';
      entry.cooldownUntil = null;
      this.store.save();
      return { ok: true, user: info.user };
    }
    // Session expired → try to re-login automatically.
    const relogged = await this.refreshLogin(entry);
    if (relogged.ok) {
      return { ok: true, user: relogged.user, relogged: true };
    }
    this._recordFailure(entry, new UpstreamError('Session expired or invalid', { code: 'SESSION_EXPIRED' }));
    return { ok: false, code: 'SESSION_EXPIRED', message: 'Cookie 已失效;請重新匯入 Cookie 或檢查帳密' };
  }

  /** Re-run the upstream login for a `login`-type account. */
  async refreshLogin(entry) {
    if (entry.type !== 'login') return { ok: false, message: 'Not an email/password account' };
    const result = await loginAccount(entry.email, entry.password);
    if (!result.ok) {
      entry.lastErrorMessage = `Auto re-login failed (HTTP ${result.status})`;
      this.store.save();
      return { ok: false, message: entry.lastErrorMessage };
    }
    if (!result.cookie) return { ok: false, message: 'Re-login returned no session cookie' };
    entry.cookie = result.cookie;
    entry.cookieUpdatedAt = new Date().toISOString();
    const info = await fetchUser(entry.cookie, entry.deviceId);
    if (info.ok) entry.userInfo = info.user;
    entry.lastErrorMessage = '';
    entry.cooldownUntil = null;
    this.store.save();
    return { ok: true, user: info.user };
  }

  // ---------------------------------------------------------------- chat

  /**
   * Run a chat with account failover.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} opts — DeepAIClient.chat opts plus sessionKey
   */
  async chat(messages, opts) {
    const sessionAccount = opts.sessionKey ? this.sessionAccountMap.get(opts.sessionKey) : null;
    const usable = this.usable();
    const ordered = [];
    if (sessionAccount) {
      const sticky = usable.find((a) => a.id === sessionAccount);
      if (sticky) ordered.push(sticky);
    }
    for (const a of usable) if (!ordered.includes(a)) ordered.push(a);

    let lastErr = null;
    for (const entry of ordered) {
      try {
        const result = await this._chatWithAccount(entry, messages, opts);
        result.upstreamKeyId = entry.id;
        result.upstreamAnonymous = false;
        result.upstreamAccount = accountLabel(entry);
        return result;
      } catch (err) {
        lastErr = err;
        this._recordFailure(entry, err);
        // A dead session is worth one automatic re-login before moving on.
        if (err.code === 'LOGIN_REQUIRED' || err.code === 'SESSION_EXPIRED') {
          const re = await this.refreshLogin(entry);
          if (re.ok) {
            try {
              const result = await this._chatWithAccount(entry, messages, opts);
              result.upstreamKeyId = entry.id;
              result.upstreamAnonymous = false;
              result.upstreamAccount = accountLabel(entry);
              return result;
            } catch (err2) {
              this._recordFailure(entry, err2);
            }
          }
          continue;
        }
        if (err.code === 'BAD_KEY' || err.code === 'PLAN_REQUIRED') continue;
        if (err.code === 'TASK_FAILED' || err.code === 'ABORTED') throw err;
        // QUOTA / TIMEOUT / NETWORK / UPSTREAM_REJECTED / 5xx → fail over
      }
    }

    // Anonymous single-use fallback.
    if (CONFIG.allowAnonymousFallback) {
      const anon = { cookie: '', deviceId: randomDeviceId() };
      const result = await this._chatWithAccount(anon, messages, opts, true);
      result.upstreamKeyId = 'anonymous';
      result.upstreamAnonymous = true;
      result.upstreamAccount = 'anonymous-tryit';
      return result;
    }

    if (!lastErr) throw new UpstreamError('No usable upstream accounts in the pool', { code: 'NO_ACCOUNTS', retryable: false });
    throw lastErr;
  }

  async _chatWithAccount(entry, messages, opts, isAnon = false) {
    let client;
    if (isAnon) {
      client = new DeepAIClient({ cookie: '', deviceId: entry.deviceId });
    } else if (entry.type === 'apikey') {
      client = new DeepAIClient({ apiKey: entry.apiKey, deviceId: entry.deviceId });
    } else {
      client = new DeepAIClient({ cookie: entry.cookie, deviceId: entry.deviceId });
    }
    // conversation continuity: stable upstream session uuid per (chat, account)
    const sessionUuid = opts.sessionKey && !isAnon ? stableUuidFor(opts.sessionKey, entry.id) : client.sessionUuid;

    if (!isAnon) {
      entry.uses += 1;
      entry.lastUsedAt = new Date().toISOString();
      this.store.save();
    }
    const result = await client.chat(messages, { ...opts, sessionUuid });
    if (opts.sessionKey && !isAnon) this.sessionAccountMap.set(opts.sessionKey, entry.id);
    return result;
  }

  // ---------------------------------------------------------------- runApi

  /** Classic /api/<name> (text2img …) with the same failover order. */
  async runApi(name, fields) {
    for (const entry of this.usable()) {
      try {
        const out = await this._clientFor(entry).runApi(name, fields);
        entry.uses += 1;
        entry.lastUsedAt = new Date().toISOString();
        this.store.save();
        return { ...out, upstreamAccountId: entry.id, upstreamAnonymous: false };
      } catch (err) {
        this._recordFailure(entry, err);
        if (err.code === 'BAD_KEY' || err.code === 'PLAN_REQUIRED' || err.code === 'LOGIN_REQUIRED') continue;
        if (!err.retryable && err.code !== 'QUOTA' && err.code !== 'UPSTREAM_REJECTED') throw err;
      }
    }
    if (CONFIG.allowAnonymousFallback) {
      const client = new DeepAIClient({ cookie: '', deviceId: randomDeviceId() });
      const out = await client.runApi(name, fields);
      return { ...out, upstreamAccountId: 'anonymous', upstreamAnonymous: true };
    }
    throw new UpstreamError('No usable upstream accounts in the pool', { code: 'NO_ACCOUNTS', retryable: false });
  }

  _clientFor(entry) {
    if (entry.type === 'apikey') return new DeepAIClient({ apiKey: entry.apiKey, deviceId: entry.deviceId });
    return new DeepAIClient({ cookie: entry.cookie, deviceId: entry.deviceId });
  }

  // ---------------------------------------------------------------- misc

  _recordFailure(entry, err) {
    if (!entry || !entry.id) return; // anonymous throwaway
    entry.errors += 1;
    entry.lastErrorAt = new Date().toISOString();
    entry.lastErrorMessage = String(err.message || err.code).slice(0, 300);
    if (err.code === 'QUOTA') entry.cooldownUntil = Date.now() + EXHAUSTED_RECHECK_MS;
    else if (err.code === 'TIMEOUT' || err.code === 'NETWORK' || err.code === 'UPSTREAM_ERROR')
      entry.cooldownUntil = Date.now() + COOLDOWN_MS;
    if (err.code === 'BAD_KEY') entry.status = 'disabled';
    this.store.save();
  }
}

function sanitizeCookieHeader(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^cookie:\s*/i, ''))
    .filter(Boolean)
    .join('; ')
    .replace(/;\s*$/g, '');
}

function accountLabel(entry) {
  if (!entry || !entry.id) return 'anonymous-tryit';
  if (entry.name) return entry.name;
  if (entry.email) return entry.email;
  if (entry.apiKey) return `key:${entry.apiKey.slice(0, 8)}`;
  return entry.type;
}

/** Deterministic per-(conversation, account) upstream session uuid. */
function stableUuidFor(sessionKey, accountId) {
  return crypto
    .createHash('sha256')
    .update(`${sessionKey}|${accountId}`)
    .digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

module.exports = { AccountPool };
