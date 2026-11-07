'use strict';

/**
 * Gateway authentication: admin sessions (panel) and gateway API keys.
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizedStringArray(name, value) {
  if (!Array.isArray(value)) throw validationError(`${name} must be an array of strings`);
  const normalized = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw validationError(`${name} must contain only non-empty strings`);
    }
    return item.trim();
  });
  return [...new Set(normalized)];
}

function validateGatewayKeyPatch(input, { withDefaults = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Gateway key body must be a JSON object');
  }
  const patch = {};
  if (Object.hasOwn(input, 'name') || withDefaults) {
    const value = Object.hasOwn(input, 'name') ? input.name : '';
    if (typeof value !== 'string') throw validationError('name must be a string');
    patch.name = value.trim();
  }
  if (Object.hasOwn(input, 'models') || withDefaults) {
    patch.models = normalizedStringArray('models', Object.hasOwn(input, 'models') ? input.models : []);
  }
  if (Object.hasOwn(input, 'accountIds') || withDefaults) {
    patch.accountIds = normalizedStringArray('accountIds', Object.hasOwn(input, 'accountIds') ? input.accountIds : []);
  }
  if (Object.hasOwn(input, 'requestLimit') || withDefaults) {
    const value = Object.hasOwn(input, 'requestLimit') ? input.requestLimit : 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw validationError('requestLimit must be a nonnegative integer');
    }
    patch.requestLimit = value;
  }
  return patch;
}

/** Match a full client model name against exact or `*` wildcard patterns. */
function modelAllowed(patterns, model) {
  if (!Array.isArray(patterns)) return false;
  if (patterns.length === 0) return true;
  const modelName = String(model || '');
  return patterns.some((pattern) => {
    if (typeof pattern !== 'string') return false;
    if (!pattern.includes('*')) return pattern === modelName;
    const parts = pattern.split('*');
    let position = 0;
    const first = parts[0];
    if (first) {
      if (!modelName.startsWith(first)) return false;
      position = first.length;
    }
    const lastIndex = parts.length - 1;
    const last = parts[lastIndex];
    const lastStart = last ? modelName.length - last.length : modelName.length;
    if (last && (!modelName.endsWith(last) || lastStart < position)) return false;
    for (let index = 1; index < lastIndex; index += 1) {
      const part = parts[index];
      if (!part) continue;
      const found = modelName.indexOf(part, position);
      if (found < 0 || found + part.length > lastStart) return false;
      position = found + part.length;
    }
    return true;
  });
}

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

  /** Effective panel password: a password changed from the panel is stored
   *  (hashed) in state.json and wins over the ADMIN_PASSWORD env default. */
  panelPasswordHash() {
    const s = this.store.state.settings;
    return s.panelPasswordHash || this.sha256(CONFIG.adminPassword);
  }

  panelPasswordIsDefault() {
    return !this.store.state.settings.panelPasswordHash && CONFIG.adminPassword === 'deepai2api';
  }

  verifyPanelPassword(password) {
    const candidate = Buffer.from(this.sha256(String(password)));
    const expected = Buffer.from(this.panelPasswordHash());
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  setPanelPassword(next, retainToken = '') {
    this.store.state.settings.panelPasswordHash = this.sha256(String(next));
    const retained = String(retainToken || '');
    for (const token of this.sessions.keys()) {
      if (token !== retained) this.sessions.delete(token);
    }
    this.store.save();
  }

  login(password, remember = false) {
    if (!this.verifyPanelPassword(password)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = remember ? 30 * 24 * 3600 * 1000 : CONFIG.adminSessionTtlMs;
    this.sessions.set(token, { expiresAt: Date.now() + ttl });
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
    const allowOpenWhenNoKeys = this.store.state.settings?.allowOpenWhenNoKeys ?? CONFIG.allowOpenWhenNoKeys;
    if (allowOpenWhenNoKeys && this.store.state.gatewayKeys.length === 0) {
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

  createGatewayKey(input = {}) {
    const patch = validateGatewayKeyPatch(input, { withDefaults: true });
    const key = `sk-deepai-${crypto.randomBytes(24).toString('hex')}`;
    const entry = {
      id: crypto.randomUUID(),
      key,
      keyHash: this.sha256(key),
      enabled: true,
      ...patch,
      uses: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    this.store.state.gatewayKeys.push(entry);
    this.store.save();
    return entry;
  }

  updateGatewayKey(id, input) {
    const entry = this.store.state.gatewayKeys.find((key) => key.id === id);
    if (!entry) throw new Error('Key not found');
    const patch = validateGatewayKeyPatch(input);
    Object.assign(entry, patch);
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

module.exports = { Auth, extractCredential, modelAllowed };
