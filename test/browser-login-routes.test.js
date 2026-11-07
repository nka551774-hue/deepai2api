'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBrowserLoginRoutes } = require('../src/browserLoginRoutes');

async function harness(t, policy, peerAddress) {
  const calls = [];
  const manager = {
    async start(token, metadata) { calls.push({ token, metadata }); return { state: 'fixture', authUrl: '/login.html#state=fixture&token=secret', status: 'waiting' }; },
    getStatus(state, token, kind) { calls.push({ state, token, kind }); return { state, status: 'waiting' }; },
    async cancel(state, token, kind) { calls.push({ state, token, kind }); return { state, status: 'cancelled' }; },
    async frame(state, token) { calls.push({ state, token }); return Buffer.from([0xff, 0xd8, 0xff]); },
    async input(state, token, event) { calls.push({ state, token, event }); },
  };
  const routes = createBrowserLoginRoutes(manager, { isAdmin: (token) => token === 'owner' }, policy);
  const server = http.createServer(async (req, res) => {
    if (peerAddress) Object.defineProperty(req.socket, 'remoteAddress', { value: peerAddress, configurable: true });
    if (!(await routes.handle(req, res, new URL(req.url, 'http://localhost')))) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Keep the supplied Host so the tests can emulate a LAN or public address.
  const request = (path, { body, headers, method } = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject);
    req.end(body);
  });
  return { calls, request, base };
}

test('private HTTP panels can generate a link and forward browser input', async (t) => {
  const { request, calls } = await harness(t);
  for (const host of ['192.168.20.5:3737', '100.100.21.3:3737', '[fd42::10]:3737', 'gateway.demo.ts.net:3737']) {
    const headers = { Host: host, Origin: `http://${host}`, 'X-Panel-Token': 'owner' };
    const response = await request('/api/admin/accounts/login/start', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 200, host);
    const login = await response.json();
    const link = new URL(login.authUrl, headers.Origin);
    assert.equal(link.origin, headers.Origin);
    assert.equal(new URLSearchParams(link.hash.slice(1)).get('privateHttp'), '1');
    const input = await request('/api/account-login/input', { method: 'POST', headers: { Host: host, Origin: headers.Origin, 'X-Login-Token': 'secret' }, body: '{"state":"fixture","event":{"type":"press","key":"Enter"}}' });
    assert.equal(input.status, 200, host);
  }
  assert.equal(calls.length, 8);
});

test('public or mismatched HTTP origins cannot start login or send credentials', async (t) => {
  const { request, calls } = await harness(t);
  for (const [host, origin] of [['gateway.example.com:3737', 'http://gateway.example.com:3737'], ['100.128.0.2', 'http://100.128.0.2'], ['192.168.20.5', 'http://192.168.20.6']]) {
    const headers = { Host: host, Origin: origin, 'X-Panel-Token': 'owner', 'X-Login-Token': 'secret' };
    assert.equal((await request('/api/admin/accounts/login/start', { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await request('/api/account-login/input', { method: 'POST', headers, body: '{}' })).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('public peers and forwarded headers cannot opt into private HTTP login', async (t) => {
  const publicPeer = await harness(t, undefined, '203.0.113.8');
  const localPeer = await harness(t);
  const start = (request, headers) => request('/api/admin/accounts/login/start', {
    method: 'POST', headers: { 'X-Panel-Token': 'owner', ...headers }, body: '{}',
  });
  assert.equal((await start(publicPeer.request, { Host: '192.168.20.5:3737', Origin: 'http://192.168.20.5:3737', 'X-Forwarded-For': '192.168.20.6' })).status, 403);
  assert.equal((await start(localPeer.request, { Host: 'public.example:3737', 'X-Forwarded-Proto': 'https' })).status, 403);
  assert.equal(publicPeer.calls.length + localPeer.calls.length, 0);
});

test('operators can disable private HTTP or configure a single internal DNS origin', async (t) => {
  const disabled = await harness(t, { allowPrivateHttp: false });
  const configured = await harness(t, { privateHttpOrigin: 'http://ai.lan:3737' });
  const start = (request, host) => request('/api/admin/accounts/login/start', { method: 'POST', headers: { Host: host, Origin: `http://${host}`, 'X-Panel-Token': 'owner' }, body: '{}' });
  assert.equal((await start(disabled.request, '192.168.20.5:3737')).status, 403);
  assert.equal((await start(configured.request, 'ai.lan:3737')).status, 200);
  assert.equal((await start(configured.request, 'ai.lan:1234')).status, 403);
});

test('only administrators can generate login links; metadata is validated before launch', async (t) => {
  const { request, calls } = await harness(t);
  const path = '/api/admin/accounts/login/start';
  assert.equal((await request(path, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request(path, { method: 'POST', headers: { 'X-Panel-Token': 'owner' }, body: '{"weight":0}' })).status, 400);
  assert.equal(calls.length, 0);
  const response = await request(path, { method: 'POST', headers: { 'X-Panel-Token': 'owner' }, body: '{"name":" Alice ","weight":2}' });
  assert.equal(response.status, 200);
  assert.match((await response.json()).authUrl, /^\/login.html#/);
  assert.deepEqual(calls[0], { token: 'owner', metadata: { name: 'Alice', weight: 2 } });
});

test('viewer requests use only a scoped token header; cross origin and query tokens are rejected', async (t) => {
  const { request, calls } = await harness(t);
  assert.equal((await request('/api/account-login/status?state=fixture&token=secret')).status, 401);
  const denied = await request('/api/account-login/status?state=fixture', { headers: { 'X-Login-Token': 'secret', Origin: 'https://untrusted.invalid' } });
  assert.equal(denied.status, 403);
  assert.equal(calls.length, 0);
  const response = await request('/api/account-login/status?state=fixture', { headers: { 'X-Login-Token': 'secret' } });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { state: 'fixture', token: 'secret', kind: 'viewer' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('frames are private binary responses and input passes through a bounded JSON request', async (t) => {
  const { request, calls, base } = await harness(t);
  const frame = await request('/api/account-login/frame?state=fixture', { headers: { 'X-Login-Token': 'secret', Origin: base } });
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.equal(frame.headers.get('cache-control'), 'no-store');
  assert.equal((await frame.arrayBuffer()).byteLength, 3);
  const sent = await request('/api/account-login/input', { method: 'POST', headers: { 'X-Login-Token': 'secret' }, body: JSON.stringify({ state: 'fixture', event: { type: 'press', key: 'Tab' } }) });
  assert.equal(sent.status, 200);
  assert.equal(calls[1].event.key, 'Tab');
  const tooLarge = await request('/api/account-login/input', { method: 'POST', headers: { 'X-Login-Token': 'secret' }, body: JSON.stringify({ state: 'fixture', text: 'x'.repeat(70000) }) });
  assert.equal(tooLarge.status, 413);
  assert.equal(calls.length, 2);
});
