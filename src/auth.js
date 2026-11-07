'use strict';

/**
 * Gateway authentication: admin sessions (panel) and gateway API keys.
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');

class Auth {
  /**
   * @param {import('./store').Store} store
   */
  constructor(store) {
    this.store = store;
    this.sessions = new Map(); // token -> { expiresAt }
  }

  sha256(v) {
    return crypto.createHash('sha256').update(String(v)).digest('hex');
  }

  // ---- admin panel -----------------------------------------------------------

  login(password) {
    const a = Buffer.from(this.sha256(String(password)));
    const b = Buffer.from(this.sha256(CONFIG.adminPassword));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { expiresAt: Date.now() + CONFIG.adminSessionTtlMs });
    return token;
  }

  logout(token) {
    this.sessions.delete(token);
  }

  isAdmin(token) {
    const s = this.sessions.get(String(token || ''));
    if (!s) return false;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  // ---- gateway API keys --------------------------------------------------------

  /**
   * Resolve the gateway key for a request.
   * @returns {{ entry: object|null, open: boolean }} — entry null + open true
   *   means "no keys issued yet, open mode allowed".
   */
  resolveGatewayKey(provided) {
    const providedStr = String(provided || '').trim();
    // Open mode (no keys issued yet): accept any or no credential, so
    // clients that force a non-empty api key (e.g. the OpenAI SDK) work.
    if (CONFIG.allowOpenWhenNoKeys && this.store.state.gatewayKeys.length === 0) {
      return { entry: null, open: true };
    }
    if (!providedStr) {
      return { entry: null, open: false };
    }
    const hash = this.sha256(providedStr);
    const entry = this.store.state.gatewayKeys.find((k) => k.keyHash === hash);
    if (!entry) return { entry: null, open: false };
    return { entry, open: true };
  }

  createGatewayKey({ name = '', models = [], requestLimit = 0 }) {
    const key = `sk-deepai-${crypto.randomBytes(24).toString('hex')}`;
    const entry = {
      id: crypto.randomUUID(),
      key,
      keyHash: this.sha256(key),
      name: String(name || '').trim(),
      enabled: true,
      models: Array.isArray(models) ? models.map(String) : [],
      requestLimit: Number(requestLimit) || 0,
      uses: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    this.store.state.gatewayKeys.push(entry);
    this.store.save();
    return entry;
  }

  setGatewayKeyEnabled(id, enabled) {
    const e = this.store.state.gatewayKeys.find((k) => k.id === id);
    if (!e) throw new Error('Key not found');
    e.enabled = Boolean(enabled);
    this.store.save();
    return e;
  }

  removeGatewayKey(id) {
    const list = this.store.state.gatewayKeys;
    const idx = list.findIndex((k) => k.id === id);
    if (idx === -1) throw new Error('Key not found');
    const [removed] = list.splice(idx, 1);
    this.store.save();
    return removed;
  }
}

/** Extract the bearer / x-api-key credential from a request headers object. */
function extractCredential(headers) {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (headers['x-api-key']) return String(headers['x-api-key']).trim();
  if (headers['x-goog-api-key']) return String(headers['x-goog-api-key']).trim();
  return '';
}

module.exports = { Auth, extractCredential };
