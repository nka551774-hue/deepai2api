'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { BrowserLogin } = require('../src/browserLogin');

async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(10); }
  assert.fail('Timed out waiting for login state');
}

function fixture(t, options = {}) {
  const calls = { cookies: [], imports: [], input: [], close: 0, checks: [] };
  const page = Object.assign(new EventEmitter(), {
    url: () => 'https://deepai.org/?password=do-not-expose', goto: async () => {}, evaluate: async () => {},
    screenshot: async () => Buffer.from('jpeg'),
    keyboard: { insertText: async (text) => calls.input.push(text) },
  });
  const context = Object.assign(new EventEmitter(), {
    setDefaultTimeout() {}, route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page,
    cookies: async () => calls.cookies,
  });
  const browser = Object.assign(new EventEmitter(), { newContext: async () => context, close: async () => { calls.close++; } });
  const admins = new Set(['owner', 'other']);
  const service = new BrowserLogin({
    config: { enabled: true, ttlMs: 10000, maxSessions: 1 },
    upstream: { origin: 'https://deepai.org', baseUrl: 'https://api.deepai.org' },
    auth: { isAdmin: (token) => admins.has(token) },
    pool: { captureBrowserAccount: (...args) => { calls.imports.push(args); return { id: 'account', name: 'Alice', cookie: 'never-return' }; } },
    verifyUser: async (cookie) => { calls.checks.push(cookie); return { ok: true, status: 200, user: { id: 42 } }; },
    launch: async () => browser, checkIntervalMs: 10, ...options,
  });
  t.after(() => service.close());
  const start = async () => {
    const { authUrl, state } = await service.start('owner', { group: 'fixture' });
    const token = new URLSearchParams(authUrl.split('#')[1]).get('token');
    await waitFor(() => service.getStatus(state, 'owner').status === 'waiting');
    return { state, token };
  };
  return { calls, service, admins, start };
}

test('a browser link imports only the verified DeepAI session and closes the browser', async (t) => {
  const { calls, service, start } = fixture(t);
  const { state, token } = await start();
  assert.throws(() => service.getStatus(state, 'other'), /invalid/);
  assert.throws(() => service.getStatus(state, token), /invalid/);
  assert.equal(service.getStatus(state, token, 'viewer').url, 'https://deepai.org');
  assert.equal((await service.frame(state, token)).toString(), 'jpeg');
  await service.input(state, token, { type: 'text', text: 'example' });
  assert.deepEqual(calls.input, ['example']);
  assert.throws(() => service.input(state, token, { type: 'press', key: 'Control+l' }), /Invalid browser input/);
  await assert.rejects(service.start('other'), { status: 429 });
  calls.cookies = [{ name: 'csrftoken', value: 'test-csrf' }, { name: 'sessionid', value: 'secret-session' }, { name: 'provider-secret', value: 'never-send' }];
  await waitFor(() => service.getStatus(state, 'owner').status === 'completed');
  assert.deepEqual(calls.checks, ['sessionid=secret-session; csrftoken=test-csrf']);
  assert.deepEqual(calls.imports, [['sessionid=secret-session; csrftoken=test-csrf', { id: 42 }, { group: 'fixture' }]]);
  assert.deepEqual(service.getStatus(state, 'owner').account, { id: 'account', name: 'Alice' });
  await assert.rejects(service.frame(state, token), { status: 410 });
  assert.equal(calls.close, 1);
});

test('revoking the owner prevents a pending verification from importing an account', async (t) => {
  let release;
  const { calls, admins, service, start } = fixture(t, { verifyUser: () => new Promise((resolve) => { release = resolve; }) });
  const { state, token } = await start();
  calls.cookies = [{ name: 'sessionid', value: 'secret-session' }];
  await waitFor(() => Boolean(release));
  admins.delete('owner');
  release({ ok: true, status: 200, user: { id: 42 } });
  await waitFor(() => calls.close === 1);
  assert.throws(() => service.getStatus(state, token, 'viewer'), /invalid/);
  assert.deepEqual(calls.imports, []);
});

test('an expired login link closes its isolated browser and rejects control', async (t) => {
  const { calls, service, start } = fixture(t, { config: { enabled: true, ttlMs: 200, maxSessions: 1 } });
  const { state, token } = await start();
  await waitFor(() => service.getStatus(state, 'owner').status === 'expired');
  await assert.rejects(service.frame(state, token), { status: 410 });
  assert.equal(calls.close, 1);
  assert.equal(calls.imports.length, 0);
});
