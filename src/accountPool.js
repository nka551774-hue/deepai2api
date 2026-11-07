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
const MAX_STICKY_SESSIONS = 4096;

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
    this._assertUniqueIdentity({ type: 'cookie', cookie });
    return this._addAccount({ type: 'cookie', cookie, name: cleanLabel(name) });
  }

  addApiKeyAccount(apiKey, name = '') {
    apiKey = String(apiKey || '').trim();
    if (!apiKey) throw new Error('API key is required');
    this._assertUniqueIdentity({ type: 'apikey', apiKey });
    return this._addAccount({ type: 'apikey', apiKey, name: cleanLabel(name) });
  }

  /**
   * Add an account with email + password: performs the upstream login now
   * so bad credentials fail immediately.
   */
  async addLoginAccount(email, password, name = '') {
    email = normalizeEmail(email);
    if (!email || !password) throw new Error('Email and password are required');
    this._assertUniqueIdentity({ type: 'login', email });
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
    return this._addAccount({
      type: 'login',
      email,
      password: String(password),
      cookie: sanitizeCookieHeader(result.cookie),
      name: cleanLabel(name) || email,
      cookieUpdatedAt: new Date().toISOString(),
    });
  }

  _addAccount(fields) {
    const weight = validateWeight(fields.weight ?? 1);
    const entry = {
      id: crypto.randomUUID(),
      name: '',
      group: '',
      weight: 1,
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
      name: cleanLabel(fields.name),
      group: cleanLabel(fields.group),
      weight,
    };
    this._assertUniqueIdentity(entry);
    this.list().push(entry);
    this.store.save();
    return entry;
  }

  updateAccount(id, patch = {}) {
    const entry = this.get(id);
    if (!entry) throw new Error('Account not found');
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) entry.name = cleanLabel(patch.name);
    if (Object.prototype.hasOwnProperty.call(patch, 'group')) entry.group = cleanLabel(patch.group);
    if (Object.prototype.hasOwnProperty.call(patch, 'weight')) entry.weight = validateWeight(patch.weight);
    this.store.save();
    return entry;
  }

  async importAccount(record = {}) {
    const type = String(record.type || '').toLowerCase();
    const common = {
      name: cleanLabel(record.name),
      group: cleanLabel(record.group),
      weight: validateWeight(record.weight ?? 1),
      status: record.status === 'disabled' ? 'disabled' : 'active',
    };

    if (type === 'apikey') {
      const apiKey = String(record.apiKey || '').trim();
      if (!apiKey) throw new Error('API key is required');
      this._assertUniqueIdentity({ type, apiKey });
      return this._addAccount({ ...common, type, apiKey });
    }
    if (type === 'cookie') {
      const cookie = sanitizeCookieHeader(record.cookie);
      if (!cookie) throw new Error('Cookie is required');
      this._assertUniqueIdentity({ type, cookie });
      return this._addAccount({ ...common, type, cookie });
    }
    if (type === 'login') {
      const email = normalizeEmail(record.email);
      const password = String(record.password || '');
      const cookie = sanitizeCookieHeader(record.cookie);
      if (!email) throw new Error('Email is required');
      if (!cookie && !password) throw new Error('Password is required when no session cookie is provided');
      this._assertUniqueIdentity({ type, email });
      if (cookie) {
        return this._addAccount({
          ...common,
          type,
          email,
          password,
          cookie,
          name: common.name || email,
          cookieUpdatedAt: new Date().toISOString(),
        });
      }
      const account = await this.addLoginAccount(email, password, common.name || email);
      account.group = common.group;
      account.weight = common.weight;
      account.status = common.status;
      this.store.save();
      return account;
    }
    throw new Error('Account type must be cookie, login, or apikey');
  }

  exportAccounts(ids) {
    const selected = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    return this.list()
      .filter((entry) => !selected || selected.has(entry.id))
      .map((entry) => portableAccount(entry));
  }

  _assertUniqueIdentity(candidate) {
    const identity = accountIdentity(candidate);
    if (!identity) return;
    if (this.list().some((entry) => entry !== candidate && accountIdentity(entry) === identity)) {
      throw new Error('Account already exists');
    }
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
    return this.list()
      .filter((a) => a.status === 'active' && (!a.cooldownUntil || a.cooldownUntil <= now))
      .sort((a, b) => {
        const score = accountScore(a) - accountScore(b);
        if (score) return score;
        const used = timeValue(a.lastUsedAt) - timeValue(b.lastUsedAt);
        if (used) return used;
        const created = timeValue(a.createdAt) - timeValue(b.createdAt);
        if (created) return created;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
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
  async refreshLogin(entry, opts = {}) {
    if (entry.type !== 'login') return { ok: false, message: 'Not an email/password account' };
    const result = await loginAccount(entry.email, entry.password, opts);
    if (!result.ok) {
      entry.lastErrorMessage = `Auto re-login failed (HTTP ${result.status})`;
      this.store.save();
      return { ok: false, message: entry.lastErrorMessage };
    }
    if (!result.cookie) return { ok: false, message: 'Re-login returned no session cookie' };
    entry.cookie = result.cookie;
    entry.cookieUpdatedAt = new Date().toISOString();
    const info = await fetchUser(entry.cookie, entry.deviceId, opts);
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
    opts = opts || {};
    const sessionAccount = opts.sessionKey ? this._stickyAccount(opts.sessionKey) : null;
    const restriction = requestedAccountIds(opts.accountIds);
    const usable = this.usable().filter((entry) => !restriction || restriction.has(entry.id));
    const ordered = [];
    if (sessionAccount) {
      const sticky = usable.find((a) => a.id === sessionAccount);
      if (sticky) ordered.push(sticky);
    }
    for (const a of usable) if (!ordered.includes(a)) ordered.push(a);

    let lastErr = null;
    for (const entry of ordered) {
      let emitted = false;
      const attemptOpts = opts.onDelta
        ? {
            ...opts,
            onDelta: (...args) => {
              if (args[0] || args[2]) emitted = true;
              opts.onDelta(...args);
            },
          }
        : opts;
      try {
        const result = await this._chatWithAccount(entry, messages, attemptOpts);
        result.upstreamKeyId = entry.id;
        result.upstreamAnonymous = false;
        result.upstreamAccount = accountLabel(entry);
        return result;
      } catch (err) {
        lastErr = err;
        this._recordFailure(entry, err);
        if (emitted) throw err;
        // A dead session is worth one automatic re-login before moving on.
        if (err.code === 'LOGIN_REQUIRED' || err.code === 'SESSION_EXPIRED') {
          let re;
          try {
            re = await this.refreshLogin(entry, opts);
          } catch (refreshError) {
            lastErr = refreshError;
            this._recordFailure(entry, refreshError);
            if (opts.signal?.aborted || isTerminalError(refreshError)) throw refreshError;
            continue;
          }
          if (re.ok) {
            try {
              const result = await this._chatWithAccount(entry, messages, attemptOpts);
              result.upstreamKeyId = entry.id;
              result.upstreamAnonymous = false;
              result.upstreamAccount = accountLabel(entry);
              return result;
            } catch (err2) {
              this._recordFailure(entry, err2);
              lastErr = err2;
              if (emitted || isTerminalError(err2)) throw err2;
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
    if (!restriction && this._allowAnonymousFallback()) {
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
    if (opts.sessionKey && !isAnon) this._rememberStickyAccount(opts.sessionKey, entry.id);
    return result;
  }

  _stickyAccount(sessionKey) {
    const accountId = this.sessionAccountMap.get(sessionKey);
    if (!accountId) return null;
    this.sessionAccountMap.delete(sessionKey);
    this.sessionAccountMap.set(sessionKey, accountId);
    return accountId;
  }

  _rememberStickyAccount(sessionKey, accountId) {
    this.sessionAccountMap.delete(sessionKey);
    this.sessionAccountMap.set(sessionKey, accountId);
    while (this.sessionAccountMap.size > MAX_STICKY_SESSIONS) {
      this.sessionAccountMap.delete(this.sessionAccountMap.keys().next().value);
    }
  }

  // ---------------------------------------------------------------- runApi

  /** Classic /api/<name> (text2img …) with the same failover order. */
  async runApi(name, fields, opts = {}) {
    const restriction = requestedAccountIds(opts.accountIds);
    let lastErr = null;
    for (const entry of this.usable().filter((account) => !restriction || restriction.has(account.id))) {
      try {
        const out = await this._clientFor(entry).runApi(name, fields, { timeoutMs: opts.timeoutMs, signal: opts.signal });
        entry.uses += 1;
        entry.lastUsedAt = new Date().toISOString();
        this.store.save();
        return { ...out, upstreamAccountId: entry.id, upstreamAnonymous: false };
      } catch (err) {
        lastErr = err;
        this._recordFailure(entry, err);
        if (err.code === 'BAD_KEY' || err.code === 'PLAN_REQUIRED' || err.code === 'LOGIN_REQUIRED') continue;
        if (!err.retryable && err.code !== 'QUOTA' && err.code !== 'UPSTREAM_REJECTED') throw err;
      }
    }
    if (!restriction && this._allowAnonymousFallback()) {
      const client = new DeepAIClient({ cookie: '', deviceId: randomDeviceId() });
      const out = await client.runApi(name, fields, { timeoutMs: opts.timeoutMs, signal: opts.signal });
      return { ...out, upstreamAccountId: 'anonymous', upstreamAnonymous: true };
    }
    if (lastErr) throw lastErr;
    throw new UpstreamError('No usable upstream accounts in the pool', { code: 'NO_ACCOUNTS', retryable: false });
  }

  _allowAnonymousFallback() {
    return this.store.state.settings?.allowAnonymousFallback ?? CONFIG.allowAnonymousFallback;
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
  const pairs = new Map();
  for (const segment of String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^cookie:\s*/i, ''))
    .filter(Boolean)
    .join('; ')
    .replace(/;\s*$/g, '')
    .split(/;\s*/)) {
    const index = segment.indexOf('=');
    if (index <= 0) continue;
    const name = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (name) pairs.set(name, value);
  }
  return [...pairs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function cleanLabel(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateWeight(value) {
  const weight = Number(value);
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    throw new Error('Account weight must be an integer from 1 to 100');
  }
  return weight;
}

function accountIdentity(entry) {
  if (!entry) return '';
  if (entry.type === 'apikey') {
    const apiKey = String(entry.apiKey || '').trim();
    return apiKey ? `apikey:${apiKey}` : '';
  }
  if (entry.type === 'login') {
    const email = normalizeEmail(entry.email);
    return email ? `login:${email}` : '';
  }
  if (entry.type === 'cookie') {
    const cookie = sanitizeCookieHeader(entry.cookie);
    return cookie ? `cookie:${cookie}` : '';
  }
  return '';
}

function portableAccount(entry) {
  const common = { type: entry.type, name: cleanLabel(entry.name) };
  if (cleanLabel(entry.group)) common.group = cleanLabel(entry.group);
  if (validateWeight(entry.weight ?? 1) !== 1) common.weight = validateWeight(entry.weight);
  common.status = entry.status === 'disabled' ? 'disabled' : 'active';
  if (entry.type === 'apikey') return { type: 'apikey', apiKey: entry.apiKey, ...common };
  if (entry.type === 'login') {
    return { type: 'login', email: entry.email, password: entry.password, cookie: entry.cookie, ...common };
  }
  return { type: 'cookie', cookie: entry.cookie, ...common };
}

function accountScore(entry) {
  const uses = Number.isFinite(Number(entry.uses)) ? Number(entry.uses) : 0;
  const weight = Number.isInteger(Number(entry.weight)) && Number(entry.weight) >= 1 ? Number(entry.weight) : 1;
  return uses / weight;
}

function timeValue(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function requestedAccountIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return new Set(ids.map(String));
}

function isTerminalError(err) {
  return err?.code === 'TASK_FAILED' || err?.code === 'ABORTED';
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
  const hex = crypto
    .createHash('sha256')
    .update(`${sessionKey}|${accountId}`)
    .digest('hex')
    .slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13)}`;
  const variant = ((parseInt(versioned[16], 16) & 0x3) | 0x8).toString(16);
  const uuidHex = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`;
}

module.exports = { AccountPool };
