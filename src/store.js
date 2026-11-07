'use strict';

/**
 * JSON-file persistence. One state file holds everything: settings, upstream
 * account keys, gateway API keys, aggregate stats and the request ring buffer.
 * Writes are atomic (tmp + rename) and debounced so a burst of requests is
 * coalesced into a single disk write.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { getDefaultSettings } = require('./settings');

const DEFAULTS = () => ({
  settings: getDefaultSettings(),
  accounts: [],     // { id, name, type: cookie|login|apikey, cookie, email, password, apiKey, status, deviceId, uses, errors, … }
  gatewayKeys: [],  // { id, key, name, enabled, models: [] (empty = all), requestLimit: 0 (0 = unlimited), uses, tokens, createdAt, lastUsedAt }
  stats: {
    totalRequests: 0,
    totalErrors: 0,
    totalChars: 0,
    perModel: {},   // model -> { requests, errors, chars }
    perGatewayKey: {}, // key -> { requests, errors }
    startedAt: new Date().toISOString(),
  },
  logs: [], // ring buffer, newest first
});

class Store {
  constructor() {
    this.file = path.join(CONFIG.dataDir, 'state.json');
    this.state = DEFAULTS();
    this._saveTimer = null;
    this._dirty = false;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('State must be a JSON object');
      if (data.accounts !== undefined && !Array.isArray(data.accounts)) throw new Error('Invalid accounts in state');
      if (data.gatewayKeys !== undefined && !Array.isArray(data.gatewayKeys)) throw new Error('Invalid gateway keys in state');
      // Merge so newly added fields keep working on old state files.
      const dflt = DEFAULTS();
      const accounts = migrateOldKeys(data, dflt);
      this.state = {
        settings: { ...dflt.settings, ...(data.settings || {}) },
        accounts: accounts.map((a) => ({ group: '', weight: 1, ...a })),
        gatewayKeys: (data.gatewayKeys || []).map((k) => ({
          models: [], accountIds: [], enabled: true, requestLimit: 0, uses: 0, ...k,
          keyHash: k.keyHash || crypto.createHash('sha256').update(String(k.key || '')).digest('hex'),
        })),
        stats: { ...dflt.stats, ...(data.stats || {}), perModel: data.stats?.perModel || {}, perGatewayKey: data.stats?.perGatewayKey || {} },
        logs: Array.isArray(data.logs) ? data.logs : [],
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new Error(`Unable to load state file ${this.file}: ${err.message}`);
      }
    }
  }

  save() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (!this._dirty) return;
      this._dirty = !this._flush();
    }, 400);
  }

  _flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return true;
    } catch (err) {
      console.warn(`[store] save failed: ${err.message}`);
      return false;
    }
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const ok = this._flush();
    this._dirty = !ok;
    return ok;
  }

  // ---- request log ---------------------------------------------------------

  addLog(entry) {
    const logs = this.state.logs;
    logs.unshift({
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ts: new Date().toISOString(),
      ...entry,
    });
    const limit = this.state.settings.maxLogEntries || CONFIG.maxLogEntries;
    if (logs.length > limit) logs.length = limit;
    this.save();
  }

  // ---- stats ---------------------------------------------------------------

  bumpStats({ model, gatewayKey, ok, chars }) {
    const s = this.state.stats;
    s.totalRequests += 1;
    if (!ok) s.totalErrors += 1;
    if (chars) s.totalChars += chars;
    const m = ownCounter(s.perModel, model, { requests: 0, errors: 0, chars: 0 });
    m.requests += 1;
    if (!ok) m.errors += 1;
    if (chars) m.chars += chars;
    if (gatewayKey) {
      const g = ownCounter(s.perGatewayKey, gatewayKey, { requests: 0, errors: 0 });
      g.requests += 1;
      if (!ok) g.errors += 1;
    }
    this.save();
  }
}

function ownCounter(map, key, defaults) {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    Object.defineProperty(map, key, { value: defaults, enumerable: true, writable: true, configurable: true });
  }
  return map[key];
}

/** v1 state (`upstreamKeys`) → v2 accounts (type 'apikey'), plus accountId fixups. */
function migrateOldKeys(data, dflt) {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const legacy = Array.isArray(data.upstreamKeys) ? data.upstreamKeys : [];
  for (const old of legacy) {
    if (accounts.some((a) => a.id === old.id || a.apiKey === old.key)) continue;
    accounts.push({
      id: old.id,
      name: old.name || 'legacy-key',
      type: 'apikey',
      cookie: '',
      email: '',
      password: '',
      apiKey: old.key,
      status: old.status || 'active',
      deviceId: old.deviceId,
      uses: old.uses || 0,
      errors: old.errors || 0,
      lastUsedAt: old.lastUsedAt || null,
      lastErrorAt: old.lastErrorAt || null,
      lastErrorMessage: old.lastErrorMessage || '',
      cooldownUntil: old.cooldownUntil || null,
      sessionUuid: null,
      userInfo: null,
      cookieUpdatedAt: null,
      createdAt: old.createdAt || new Date().toISOString(),
    });
  }
  return accounts;
}

module.exports = { Store };
