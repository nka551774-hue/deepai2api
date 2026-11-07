'use strict';

/**
 * JSON-file persistence. One state file holds everything: settings, upstream
 * account keys, gateway API keys, aggregate stats and the request ring buffer.
 * Writes are atomic (tmp + rename) and debounced so a burst of requests is
 * coalesced into a single disk write.
 */
const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');

const DEFAULTS = () => ({
  settings: {
    defaultModel: 'deepai-standard',
    modelMap: {
      'deepai-standard': 'standard',
      'deepai-genius': 'genius',
      'deepai-super-genius': 'super_genius',
      'gpt-4o-mini': 'standard',
    },
    passThroughModels: true,
    requestTimeoutMs: CONFIG.upstream.timeoutMs,
  },
  upstreamKeys: [], // { id, key, name, status: active|disabled|exhausted, deviceId, uses, errors, lastUsedAt, lastErrorAt, lastErrorMessage, cooldownUntil }
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
      // Merge so newly added fields keep working on old state files.
      const dflt = DEFAULTS();
      this.state = {
        settings: { ...dflt.settings, ...(data.settings || {}) },
        upstreamKeys: Array.isArray(data.upstreamKeys) ? data.upstreamKeys : [],
        gatewayKeys: Array.isArray(data.gatewayKeys) ? data.gatewayKeys : [],
        stats: { ...dflt.stats, ...(data.stats || {}), perModel: data.stats?.perModel || {}, perGatewayKey: data.stats?.perGatewayKey || {} },
        logs: Array.isArray(data.logs) ? data.logs : [],
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[store] failed to load ${this.file}: ${err.message}; starting fresh`);
      }
    }
  }

  save() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (!this._dirty) return;
      this._dirty = false;
      this._flush();
    }, 400);
  }

  _flush() {
    try {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[store] save failed: ${err.message}`);
    }
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._dirty = false;
    this._flush();
  }

  // ---- request log ---------------------------------------------------------

  addLog(entry) {
    const logs = this.state.logs;
    logs.unshift({
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ts: new Date().toISOString(),
      ...entry,
    });
    if (logs.length > CONFIG.maxLogEntries) logs.length = CONFIG.maxLogEntries;
    this.save();
  }

  // ---- stats ---------------------------------------------------------------

  bumpStats({ model, gatewayKey, ok, chars }) {
    const s = this.state.stats;
    s.totalRequests += 1;
    if (!ok) s.totalErrors += 1;
    if (chars) s.totalChars += chars;
    const m = (s.perModel[model] = s.perModel[model] || { requests: 0, errors: 0, chars: 0 });
    m.requests += 1;
    if (!ok) m.errors += 1;
    if (chars) m.chars += chars;
    if (gatewayKey) {
      const g = (s.perGatewayKey[gatewayKey] = s.perGatewayKey[gatewayKey] || { requests: 0, errors: 0 });
      g.requests += 1;
      if (!ok) g.errors += 1;
    }
    this.save();
  }
}

module.exports = { Store };
