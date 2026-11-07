'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG } = require('../src/config');
const { Store } = require('../src/store');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepai-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function load(dir) {
  const before = CONFIG.dataDir;
  CONFIG.dataDir = dir;
  try { return new Store(); } finally { CONFIG.dataDir = before; }
}

test('a corrupt existing state file is never replaced with an open empty instance', (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'state.json'), '{"gatewayKeys":');
  assert.throws(() => load(dir), /state|load|JSON/i);
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), '{"gatewayKeys":');
});

test('state reload fills new settings and preserves old accounts and credentials', (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    settings: { defaultModel: 'legacy-model' },
    upstreamKeys: [{ id: 'old-account', key: 'fixture-upstream-key' }],
    gatewayKeys: [{ id: 'gateway', key: 'fixture-gateway-key', uses: 2 }],
  }));
  const store = load(dir);
  assert.equal(store.state.settings.defaultModel, 'legacy-model');
  assert.equal(store.state.settings.pollIntervalMs, 8000);
  assert.equal(store.state.settings.allowAnonymousFallback, CONFIG.allowAnonymousFallback);
  assert.equal(store.state.accounts[0].apiKey, 'fixture-upstream-key');
  assert.equal(store.state.accounts[0].weight, 1);
  assert.deepEqual(store.state.gatewayKeys[0].accountIds, []);
  assert.equal(store.state.gatewayKeys[0].uses, 2);
});

test('model names that resemble prototype properties get independent valid stats', (t) => {
  const store = load(directory(t));
  t.after(() => { if (store._saveTimer) clearTimeout(store._saveTimer); });
  for (const model of ['constructor', '__proto__']) {
    store.bumpStats({ model, gatewayKey: 'open-mode', ok: true, chars: 5 });
    assert.equal(store.state.stats.perModel[model].requests, 1);
    assert.equal(store.state.stats.perModel[model].chars, 5);
  }
});

test('flush creates the state file own directory even when config changes', (t) => {
  const dir = path.join(directory(t), 'instance');
  const store = load(dir);
  assert.equal(store.flushSync(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).settings.defaultModel, 'deepai-standard');
});

test('failed disk writes leave the store dirty for a later retry', (t) => {
  const dir = directory(t);
  const store = load(dir);
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'fixture');
  store.file = path.join(blocker, 'state.json');
  store._dirty = true;
  assert.equal(store.flushSync(), false);
  assert.equal(store._dirty, true);
  store.file = path.join(dir, 'state.json');
  assert.equal(store.flushSync(), true);
  assert.equal(store._dirty, false);
});
