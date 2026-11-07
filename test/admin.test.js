'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, describe, test } = require('node:test');

process.env.TZ = 'Asia/Taipei';

const { CONFIG } = require('../src/config');
const { createAdminRoutes } = require('../src/adminRoutes');
const { Auth, modelAllowed } = require('../src/auth');
const { getDefaultSettings, publicSettings, validateSettingsPatch } = require('../src/settings');

function freshState(overrides = {}) {
  const settings = { ...getDefaultSettings(), panelPasswordHash: '', ...(overrides.settings || {}) };
  return {
    settings,
    accounts: [],
    gatewayKeys: [],
    stats: {
      totalRequests: 0,
      totalErrors: 0,
      totalChars: 0,
      perModel: {},
      perGatewayKey: {},
    },
    logs: [],
    ...overrides,
    settings,
  };
}

function fakeStore(state = freshState()) {
  return {
    state,
    saveCalls: 0,
    save() {
      this.saveCalls += 1;
    },
  };
}

function fakePool(store, overrides = {}) {
  const pool = {
    list: () => store.state.accounts,
    usable: () => store.state.accounts.filter((account) => account.status === 'active'),
    get: (id) => store.state.accounts.find((account) => account.id === id),
    addCookieAccount(cookie, name = '') {
      const account = { id: `cookie-${store.state.accounts.length + 1}`, type: 'cookie', cookie, name, status: 'active' };
      store.state.accounts.push(account);
      return account;
    },
    async addLoginAccount(email, password, name = '') {
      const account = { id: `login-${store.state.accounts.length + 1}`, type: 'login', email, password, name, status: 'active' };
      store.state.accounts.push(account);
      return account;
    },
    addApiKeyAccount(apiKey, name = '') {
      const account = { id: `key-${store.state.accounts.length + 1}`, type: 'apikey', apiKey, name, status: 'active' };
      store.state.accounts.push(account);
      return account;
    },
    updateAccount(id, patch) {
      const account = this.get(id);
      if (!account) throw new Error('Account not found');
      Object.assign(account, patch);
      return account;
    },
    setStatus(id, status) {
      const account = this.get(id);
      if (!account) throw new Error('Account not found');
      account.status = status;
      return account;
    },
    resetAccount(id) {
      const account = this.get(id);
      if (!account) throw new Error('Account not found');
      account.errors = 0;
      return account;
    },
    async probe(id) {
      if (!this.get(id)) throw new Error('Account not found');
      return { ok: true };
    },
    async refreshLogin(account) {
      if (!account || account.type !== 'login') return { ok: false, message: 'Not an email/password account' };
      return { ok: true };
    },
    removeAccount(id) {
      const index = store.state.accounts.findIndex((account) => account.id === id);
      if (index < 0) throw new Error('Account not found');
      return store.state.accounts.splice(index, 1)[0];
    },
    async importAccount(record) {
      const account = { id: `import-${store.state.accounts.length + 1}`, status: 'active', ...record };
      store.state.accounts.push(account);
      return account;
    },
    exportAccounts(ids) {
      const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
      return store.state.accounts.filter((account) => !wanted || wanted.has(account.id)).map(({ id, ...account }) => account);
    },
  };
  return Object.assign(pool, overrides);
}

async function startHarness({ state = freshState(), pool: suppliedPool } = {}) {
  const store = fakeStore(state);
  const auth = new Auth(store);
  store.state.settings.panelPasswordHash = auth.sha256('admin-secret');
  const pool = suppliedPool || fakePool(store);
  const routes = createAdminRoutes(store, pool, auth);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    Promise.resolve(routes.handle(req, res, pathname)).catch((error) => {
      if (!res.writableEnded) {
        res.writeHead(599, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const token = auth.login('admin-secret');

  async function request(path, { method = 'GET', body, token: requestToken = token, rawBody } = {}) {
    const headers = {};
    if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  return {
    store,
    auth,
    pool,
    token,
    request,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('settings validation', () => {
  test('defaults include the complete console settings contract', () => {
    const defaults = getDefaultSettings();
    assert.equal(defaults.defaultModel, 'deepai-standard');
    assert.equal(defaults.passThroughModels, true);
    assert.equal(defaults.requestTimeoutMs, CONFIG.upstream.timeoutMs);
    assert.equal(defaults.allowAnonymousFallback, CONFIG.allowAnonymousFallback);
    assert.equal(defaults.allowOpenWhenNoKeys, CONFIG.allowOpenWhenNoKeys);
    assert.equal(defaults.maxLogEntries, CONFIG.maxLogEntries);
    assert.equal(defaults.pollIntervalMs, 8000);
    assert.equal(defaults.theme, 'system');
    assert.equal(defaults.uiLanguage, 'zh-CN');
    assert.deepEqual(defaults.visiblePages, ['overview', 'gateway', 'accounts', 'analytics', 'logs', 'settings']);
    assert.equal(defaults.windowMaxHeight, 640);
  });

  test('a valid partial patch is normalized without retaining caller-owned arrays or objects', () => {
    const body = {
      modelMap: { client: 'standard' },
      visiblePages: ['overview'],
      theme: 'dark',
      requestTimeoutMs: 5000,
    };
    const patch = validateSettingsPatch(body);
    assert.deepEqual(patch, {
      modelMap: { client: 'standard' },
      visiblePages: ['overview', 'settings'],
      theme: 'dark',
      requestTimeoutMs: 5000,
    });
    body.modelMap.client = 'changed';
    body.visiblePages.push('logs');
    assert.deepEqual(patch.modelMap, { client: 'standard' });
    assert.deepEqual(patch.visiblePages, ['overview', 'settings']);
  });

  test('modelMap preserves special client model names as own data properties', () => {
    const body = JSON.parse('{"modelMap":{"__proto__":"standard","client":"genius"}}');
    const patch = validateSettingsPatch(body);
    assert.equal(Object.hasOwn(patch.modelMap, '__proto__'), true);
    assert.equal(patch.modelMap.__proto__, 'standard');
    assert.equal(patch.modelMap.client, 'genius');
  });

  test('invalid settings are rejected as 400-class errors', () => {
    const invalid = [
      null,
      [],
      { unknown: true },
      { defaultModel: '' },
      { modelMap: [] },
      { modelMap: { client: '' } },
      { passThroughModels: 'true' },
      { requestTimeoutMs: 4999 },
      { requestTimeoutMs: 600001 },
      { allowAnonymousFallback: 1 },
      { allowOpenWhenNoKeys: 1 },
      { maxLogEntries: 49 },
      { pollIntervalMs: 1999 },
      { theme: 'midnight' },
      { uiLanguage: 'fr' },
      { visiblePages: ['unknown'] },
      { windowMaxHeight: 4001 },
    ];
    for (const body of invalid) {
      assert.throws(() => validateSettingsPatch(body), (error) => error.status === 400, JSON.stringify(body));
    }
  });

  test('public settings never expose password hashes or unrelated private values', () => {
    const settings = {
      ...getDefaultSettings(),
      panelPasswordHash: 'secret-hash',
      passwordHash: 'another-secret',
      internalFlag: true,
    };
    const output = publicSettings(settings);
    assert.equal(output.panelPasswordHash, undefined);
    assert.equal(output.passwordHash, undefined);
    assert.equal(output.internalFlag, undefined);
    assert.equal(output.defaultModel, 'deepai-standard');
  });
});

describe('gateway key authentication', () => {
  test('model patterns use full-name wildcard matching', () => {
    assert.equal(modelAllowed([], 'anything'), true);
    assert.equal(modelAllowed(['deepai-standard'], 'deepai-standard'), true);
    assert.equal(modelAllowed(['deepai-*'], 'deepai-super-genius'), true);
    assert.equal(modelAllowed(['deepai-*'], 'prefix-deepai-standard'), false);
    assert.equal(modelAllowed(['model.+'], 'model.+'), true);
    assert.equal(modelAllowed(['model.+'], 'modelXX'), false);
  });

  test('create and update validate restrictions before mutating state', () => {
    const store = fakeStore(freshState());
    const auth = new Auth(store);
    assert.throws(() => auth.createGatewayKey({ models: [7] }), /models/i);
    assert.throws(() => auth.createGatewayKey({ accountIds: 'all' }), /accountIds/i);
    assert.throws(() => auth.createGatewayKey({ requestLimit: -1 }), /requestLimit/i);
    assert.throws(() => auth.createGatewayKey({ requestLimit: Number.MAX_SAFE_INTEGER + 1 }), /requestLimit/i);
    assert.equal(store.state.gatewayKeys.length, 0);
    assert.equal(store.saveCalls, 0);

    const created = auth.createGatewayKey({
      name: 'limited',
      models: ['deepai-*'],
      accountIds: ['account-a'],
      requestLimit: 5,
    });
    assert.deepEqual(created.models, ['deepai-*']);
    assert.deepEqual(created.accountIds, ['account-a']);
    assert.equal(created.requestLimit, 5);

    const before = structuredClone(created);
    assert.throws(() => auth.updateGatewayKey(created.id, { name: 'changed', requestLimit: 1.5 }), /requestLimit/i);
    assert.deepEqual(created, before);

    const updated = auth.updateGatewayKey(created.id, {
      name: 'updated',
      models: ['deepai-standard'],
      accountIds: [],
      requestLimit: 0,
    });
    assert.equal(updated.name, 'updated');
    assert.deepEqual(updated.models, ['deepai-standard']);
    assert.deepEqual(updated.accountIds, []);
    assert.equal(updated.requestLimit, 0);
  });

  test('custom environment passwords are not reported as the built-in default', () => {
    const previous = CONFIG.adminPassword;
    CONFIG.adminPassword = 'custom-environment-password';
    try {
      const auth = new Auth(fakeStore(freshState({ settings: { panelPasswordHash: '' } })));
      assert.equal(auth.panelPasswordIsDefault(), false);
    } finally {
      CONFIG.adminPassword = previous;
    }
  });

  test('open mode follows the persisted setting when no gateway keys exist', () => {
    const state = freshState({ settings: { allowOpenWhenNoKeys: false } });
    const auth = new Auth(fakeStore(state));
    assert.deepEqual(auth.resolveGatewayKey(''), { entry: null, open: false });
    state.settings.allowOpenWhenNoKeys = true;
    assert.deepEqual(auth.resolveGatewayKey(''), { entry: null, open: true });
  });

  test('changing the panel password retains only the current session', () => {
    const store = fakeStore(freshState());
    const auth = new Auth(store);
    store.state.settings.panelPasswordHash = auth.sha256('old-password');
    const current = auth.login('old-password');
    const other = auth.login('old-password');
    assert.ok(current && other);

    auth.setPanelPassword('new-password', current);
    assert.equal(auth.isAdmin(current), true);
    assert.equal(auth.isAdmin(other), false);
    assert.equal(auth.login('old-password'), null);
    assert.ok(auth.login('new-password'));
  });
});

describe('admin HTTP routes', () => {
  test('malformed, null and array JSON bodies return 400 without escaping the handler', async (t) => {
    const app = await startHarness();
    t.after(app.close);

    for (const request of [
      () => app.request('/api/admin/settings', { method: 'POST', rawBody: '{' }),
      () => app.request('/api/admin/settings', { method: 'POST', body: null }),
      () => app.request('/api/admin/settings', { method: 'POST', body: [] }),
    ]) {
      const response = await request();
      assert.equal(response.status, 400);
      assert.equal(typeof response.body.error, 'string');
    }
  });

  test('settings patches are atomic and expose only public values', async (t) => {
    const state = freshState({ settings: { panelPasswordHash: 'hidden' } });
    const app = await startHarness({ state });
    t.after(app.close);
    const before = structuredClone(app.store.state.settings);

    const invalid = await app.request('/api/admin/settings', {
      method: 'POST',
      body: { defaultModel: 'changed-too-early', requestTimeoutMs: 4999 },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(app.store.state.settings, before);
    assert.equal(app.store.saveCalls, 0);

    const valid = await app.request('/api/admin/settings', {
      method: 'POST',
      body: { theme: 'dark', visiblePages: ['analytics'], requestTimeoutMs: 5000 },
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.settings.theme, 'dark');
    assert.deepEqual(valid.body.settings.visiblePages, ['analytics', 'settings']);
    assert.equal(valid.body.settings.panelPasswordHash, undefined);
    assert.equal(app.store.state.settings.panelPasswordHash, before.panelPasswordHash);
    assert.equal(app.store.saveCalls, 1);

    const fetched = await app.request('/api/admin/settings');
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.settings.panelPasswordHash, undefined);
    assert.deepEqual(fetched.body.editable, [
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
    ]);
  });

  test('password changes always verify the current password and invalidate other sessions', async (t) => {
    const app = await startHarness();
    t.after(app.close);
    const other = app.auth.login('admin-secret');

    const rejected = await app.request('/panel/password', {
      method: 'POST',
      body: { current: 'wrong', next: 'new-secret' },
    });
    assert.equal(rejected.status, 400);
    assert.ok(app.auth.login('admin-secret'));

    const changed = await app.request('/panel/password', {
      method: 'POST',
      body: { current: 'admin-secret', next: 'new-secret' },
    });
    assert.equal(changed.status, 200);
    assert.equal(app.auth.isAdmin(app.token), true);
    assert.equal(app.auth.isAdmin(other), false);
    assert.equal(app.auth.login('admin-secret'), null);
    assert.ok(app.auth.login('new-secret'));
  });

  test('account list and API-key create/update keep credentials private and metadata editable', async (t) => {
    const state = freshState({
      accounts: [{
        id: 'existing',
        type: 'login',
        name: 'Existing',
        email: 'user@example.test',
        password: 'secret',
        cookie: 'session=secret',
        apiKey: 'upstream-secret',
        group: 'primary',
        weight: 7,
        status: 'active',
        uses: 0,
        errors: 0,
      }],
    });
    const app = await startHarness({ state });
    t.after(app.close);

    const listed = await app.request('/api/admin/accounts');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.accounts[0].group, 'primary');
    assert.equal(listed.body.accounts[0].weight, 7);
    assert.equal(listed.body.accounts[0].password, undefined);
    assert.equal(listed.body.accounts[0].cookie, undefined);
    assert.equal(listed.body.accounts[0].apiKey, undefined);

    const added = await app.request('/api/admin/accounts', {
      method: 'POST',
      body: { type: 'apikey', apiKey: 'key-value', name: 'API account', group: 'paid', weight: 9 },
    });
    assert.equal(added.status, 200);
    const addedAccount = app.store.state.accounts.find((account) => account.id === added.body.account.id);
    assert.equal(addedAccount.apiKey, 'key-value');
    assert.equal(addedAccount.group, 'paid');
    assert.equal(addedAccount.weight, 9);

    const updated = await app.request('/api/admin/accounts/update', {
      method: 'POST',
      body: { id: addedAccount.id, name: 'Renamed', group: 'backup', weight: 3 },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.account.name, 'Renamed');
    assert.equal(updated.body.account.group, 'backup');
    assert.equal(updated.body.account.weight, 3);
  });

  test('batch account actions run sequentially and report failures per account', async (t) => {
    const state = freshState({
      accounts: [
        { id: 'login-a', type: 'login', status: 'active' },
        { id: 'login-b', type: 'login', status: 'active' },
        { id: 'cookie-c', type: 'cookie', status: 'active' },
      ],
    });
    const calls = [];
    const appStore = fakeStore(state);
    const pool = fakePool(appStore, {
      async refreshLogin(account) {
        calls.push(`start:${account.id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push(`end:${account.id}`);
        return { ok: true };
      },
    });
    const app = await startHarness({ state, pool });
    t.after(app.close);

    const response = await app.request('/api/admin/accounts/batch', {
      method: 'POST',
      body: { ids: ['login-a', 'login-b', 'cookie-c'], action: 'refresh' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.succeeded, 2);
    assert.equal(response.body.failed, 1);
    assert.deepEqual(response.body.results.map(({ id, ok }) => ({ id, ok })), [
      { id: 'login-a', ok: true },
      { id: 'login-b', ok: true },
      { id: 'cookie-c', ok: false },
    ]);
    assert.deepEqual(calls, ['start:login-a', 'end:login-a', 'start:login-b', 'end:login-b']);
  });

  test('account import/export returns portable records and isolates row failures', async (t) => {
    const state = freshState();
    const appStore = fakeStore(state);
    const pool = fakePool(appStore, {
      async importAccount(record) {
        if (record.email === 'duplicate@example.test') throw new Error('Account already exists');
        const account = { id: `import-${state.accounts.length + 1}`, status: 'active', ...record };
        state.accounts.push(account);
        return account;
      },
    });
    const app = await startHarness({ state, pool });
    t.after(app.close);

    const imported = await app.request('/api/admin/accounts/import', {
      method: 'POST',
      body: {
        accounts: [
          { type: 'apikey', apiKey: 'portable-key', name: 'portable' },
          { type: 'login', email: 'duplicate@example.test', password: 'secret' },
        ],
      },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.added, 1);
    assert.deepEqual(imported.body.failed, [{ index: 1, error: 'Account already exists' }]);

    const exported = await app.request('/api/admin/accounts/export', {
      method: 'POST',
      body: {},
    });
    assert.equal(exported.status, 200);
    assert.equal(exported.body.version, 1);
    assert.deepEqual(exported.body.accounts, [{ type: 'apikey', apiKey: 'portable-key', name: 'portable', status: 'active' }]);
  });

  test('new mutation endpoints require a panel session', async (t) => {
    const app = await startHarness();
    t.after(app.close);
    for (const path of [
      '/api/admin/accounts/update',
      '/api/admin/accounts/batch',
      '/api/admin/accounts/import',
      '/api/admin/accounts/export',
      '/api/admin/gateway-keys/update',
    ]) {
      const response = await app.request(path, { method: 'POST', body: {}, token: '' });
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
    }
  });

  test('gateway key update route applies validated editable restrictions', async (t) => {
    const app = await startHarness();
    t.after(app.close);
    const created = app.auth.createGatewayKey({ name: 'original' });
    const response = await app.request('/api/admin/gateway-keys/update', {
      method: 'POST',
      body: {
        id: created.id,
        name: 'restricted',
        models: ['deepai-*'],
        accountIds: ['account-a'],
        requestLimit: 12,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.key.name, 'restricted');
    assert.deepEqual(response.body.key.models, ['deepai-*']);
    assert.deepEqual(response.body.key.accountIds, ['account-a']);
    assert.equal(response.body.key.requestLimit, 12);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test('analytics ranges start at local calendar midnights', async (t) => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const withinToday = new Date(midnight.getTime() + Math.max(1, Math.floor((now.getTime() - midnight.getTime()) / 2)));
    const start7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const start30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const logs = [
      { ts: withinToday.toISOString(), kind: 'request', status: 'ok', chars: 1, model: 'm' },
      { ts: new Date(start7.getTime() + 60_000).toISOString(), kind: 'request', status: 'ok', chars: 1, model: 'm' },
      { ts: new Date(start7.getTime() - 60_000).toISOString(), kind: 'request', status: 'ok', chars: 1, model: 'm' },
      { ts: new Date(start30.getTime() + 60_000).toISOString(), kind: 'request', status: 'ok', chars: 1, model: 'm' },
      { ts: new Date(start30.getTime() - 60_000).toISOString(), kind: 'request', status: 'ok', chars: 1, model: 'm' },
    ];
    const app = await startHarness({ state: freshState({ logs }) });
    t.after(app.close);

    const today = await app.request('/api/admin/analytics?range=today');
    const seven = await app.request('/api/admin/analytics?range=7d');
    const thirty = await app.request('/api/admin/analytics?range=30d');
    assert.equal(today.body.kpis.requests, 1);
    assert.equal(seven.body.kpis.requests, 2);
    assert.equal(thirty.body.kpis.requests, 4);
    assert.equal(today.body.days[0].date, localDateKey(now));
    assert.equal(seven.body.days[0].date, localDateKey(start7));
    assert.equal(thirty.body.days[0].date, localDateKey(start30));
  });
});
