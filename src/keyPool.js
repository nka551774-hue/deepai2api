'use strict';

/**
 * Upstream account pool.
 *
 * - Round-robin over `active` keys (least-recently-used first, sticky session
 *   concurrency guard per conversation).
 * - On a quota refusal the key is parked `exhausted`; a cooldown parks it
 *   temporarily. The request transparently failsovers to the next key.
 * - When the pool has no usable key and anonymous fallback is enabled, a
 *   fresh single-use `tryit-` key is minted per attempt.
 * - Each account keeps a stable session uuid per conversation plus a stable
 *   device id, matching how the browser client identifies itself.
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { DeepAIClient, UpstreamError } = require('./deepai');
const { mintTryItKey, isTryItKey, randomDeviceId } = require('./islandHash');

const COOLDOWN_MS = 90 * 1000;      // soft errors → short park
const EXHAUSTED_RECHECK_MS = 6 * 3600 * 1000; // quota → long park, panel can re-enable

class KeyPool {
  /**
   * @param {import('./store').Store} store
   */
  constructor(store) {
    this.store = store;
    // conversation id -> account id, so multi-turn requests keep one identity
    this.sessionAccountMap = new Map();
  }

  list() {
    return this.store.state.upstreamKeys;
  }

  addKey(key, name = '') {
    key = String(key || '').trim();
    if (!key) throw new Error('Key is required');
    if (this.list().some((k) => k.key === key)) throw new Error('Key already exists');
    const entry = {
      id: crypto.randomUUID(),
      key,
      name: String(name || '').trim(),
      status: 'active',
      deviceId: randomDeviceId(),
      uses: 0,
      errors: 0,
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorMessage: '',
      cooldownUntil: null,
      createdAt: new Date().toISOString(),
    };
    this.list().push(entry);
    this.store.save();
    return entry;
  }

  removeKey(id) {
    const list = this.list();
    const idx = list.findIndex((k) => k.id === id);
    if (idx === -1) throw new Error('Key not found');
    const [removed] = list.splice(idx, 1);
    for (const [sid, accId] of this.sessionAccountMap) if (accId === id) this.sessionAccountMap.delete(sid);
    this.store.save();
    return removed;
  }

  setKeyStatus(id, status) {
    const entry = this.list().find((k) => k.id === id);
    if (!entry) throw new Error('Key not found');
    entry.status = status === 'active' ? 'active' : 'disabled';
    if (entry.status === 'active') {
      entry.cooldownUntil = null;
      entry.lastErrorMessage = '';
    }
    this.store.save();
    return entry;
  }

  usableKeys() {
    const now = Date.now();
    return this.list().filter(
      (k) => k.status === 'active' && !isTryItKey(k.key) && (!k.cooldownUntil || k.cooldownUntil <= now)
    );
  }

  /**
   * Execute a chat with failover across the pool.
   *
   * @param {object} opts — same as DeepAIClient.chat plus:
   *   sessionKey: stable conversation key (keeps one upstream identity)
   */
  async chat(messages, opts) {
    const attempts = [];
    const sessionAccount = opts.sessionKey ? this.sessionAccountMap.get(opts.sessionKey) : null;

    // Ordered candidate list: session-sticky account first, then LRU.
    const usable = this.usableKeys();
    const ordered = [];
    if (sessionAccount) {
      const sticky = usable.find((k) => k.id === sessionAccount);
      if (sticky) ordered.push(sticky);
    }
    for (const k of usable) if (!ordered.includes(k)) ordered.push(k);

    let lastErr = null;
    for (const entry of ordered) {
      try {
        const result = await this._chatWithAccount(entry, messages, opts);
        attempts.push({ keyId: entry.id, anon: false, ok: true });
        return { ...result, upstreamKeyId: entry.id, upstreamAnonymous: false, attempts };
      } catch (err) {
        lastErr = err;
        attempts.push({ keyId: entry.id, anon: false, ok: false, code: err.code });
        this._recordFailure(entry, err);
        if (err.code === 'TASK_FAILED' || err.code === 'ABORTED' || !err.retryable) {
          // hard failure — do not retry on other keys unless model-related
          if (err.code === 'BAD_KEY' || err.code === 'PLAN_REQUIRED' || err.code === 'LOGIN_REQUIRED') continue;
          throw err;
        }
        // QUOTA / TIMEOUT / NETWORK / UPSTREAM_REJECTED / UPSTREAM_ERROR(5xx) → failover
      }
    }

    // Anonymous single-use fallback (fresh key per attempt).
    if (CONFIG.allowAnonymousFallback) {
      try {
        const anon = { key: mintTryItKey(CONFIG.upstream.userAgent), deviceId: randomDeviceId() };
        const result = await this._chatWithAccount(anon, messages, opts, true);
        attempts.push({ keyId: 'anonymous', anon: true, ok: true });
        return { ...result, upstreamKeyId: 'anonymous', upstreamAnonymous: true, attempts };
      } catch (err) {
        lastErr = err;
        attempts.push({ keyId: 'anonymous', anon: true, ok: false, code: err.code });
        if (!err.retryable && err.code !== 'QUOTA') throw err;
      }
    }

    if (!lastErr)
      throw new UpstreamError('No usable upstream keys in the pool', { code: 'NO_KEYS', retryable: false });
    throw lastErr;
  }

  async _chatWithAccount(entry, messages, opts, isAnon = false) {
    const client = new DeepAIClient({ key: entry.key, deviceId: entry.deviceId });
    // conversation continuity: same session uuid across turns of one chat
    const sessionUuid = opts.sessionKey
      ? stableUuidFor(opts.sessionKey, entry.id)
      : client.sessionUuid;

    if (!isAnon) {
      entry.uses += 1;
      entry.lastUsedAt = new Date().toISOString();
    }

    const result = await client.chat(messages, {
      ...opts,
      sessionUuid,
    });

    if (opts.sessionKey && !isAnon) this.sessionAccountMap.set(opts.sessionKey, entry.id);
    if (!isAnon) this.store.save();
    return result;
  }

  _recordFailure(entry, err) {
    if (entry === null || !entry.id) return; // anonymous
    entry.errors += 1;
    entry.lastErrorAt = new Date().toISOString();
    entry.lastErrorMessage = String(err.message || err.code).slice(0, 300);
    if (err.code === 'QUOTA') {
      entry.cooldownUntil = Date.now() + EXHAUSTED_RECHECK_MS;
    } else if (err.code === 'TIMEOUT' || err.code === 'NETWORK' || err.code === 'UPSTREAM_ERROR') {
      entry.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    if (err.code === 'BAD_KEY') entry.status = 'disabled';
    this.store.save();
  }

  /** Quick health probe: 1-token-ish chat on the standard model. */
  async testKey(id) {
    const entry = this.list().find((k) => k.id === id);
    if (!entry) throw new Error('Key not found');
    try {
      const client = new DeepAIClient({ key: entry.key, deviceId: entry.deviceId });
      const res = await client.chat([{ role: 'user', content: 'Reply with the word OK.' }], {
        model: 'standard',
        timeoutMs: 60000,
      });
      entry.lastErrorAt = null;
      entry.lastErrorMessage = '';
      entry.cooldownUntil = null;
      this.store.save();
      return { ok: true, text: res.text.slice(0, 200) };
    } catch (err) {
      this._recordFailure(entry, err);
      return { ok: false, code: err.code, message: err.message };
    }
  }

  /**
   * Call a classic /api/<name> route (text2img …) with pool failover,
   * mirroring chat(): account keys first, then anonymous fallback.
   */
  async runApi(name, fields) {
    for (const entry of this.usableKeys()) {
      try {
        const client = new DeepAIClient({ key: entry.key, deviceId: entry.deviceId });
        const out = await client.runApi(name, fields);
        entry.uses += 1;
        entry.lastUsedAt = new Date().toISOString();
        this.store.save();
        return { ...out, upstreamKeyId: entry.id, upstreamAnonymous: false };
      } catch (err) {
        this._recordFailure(entry, err);
        if (err.code === 'BAD_KEY' || err.code === 'PLAN_REQUIRED' || err.code === 'LOGIN_REQUIRED') continue;
        if (!err.retryable && err.code !== 'QUOTA' && err.code !== 'UPSTREAM_REJECTED') throw err;
      }
    }
    if (CONFIG.allowAnonymousFallback) {
      const client = new DeepAIClient({ key: mintTryItKey(CONFIG.upstream.userAgent), deviceId: randomDeviceId() });
      const out = await client.runApi(name, fields);
      return { ...out, upstreamKeyId: 'anonymous', upstreamAnonymous: true };
    }
    throw new UpstreamError('No usable upstream keys in the pool', { code: 'NO_KEYS', retryable: false });
  }
}

/** Deterministic per-(conversation, account) upstream session uuid. */
function stableUuidFor(sessionKey, accountId) {
  return crypto.createHash('sha256').update(`${sessionKey}|${accountId}`).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

module.exports = { KeyPool };
