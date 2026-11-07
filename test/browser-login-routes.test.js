'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBrowserLoginRoutes } = require('../src/browserLoginRoutes');

async function harness(t) {
  const calls = [];
  const manager = {
    async start(token, metadata) { calls.push({ token, metadata }); return { state: 'fixture', authUrl: '/login.html#state=fixture&token=secret', status: 'waiting' }; },
    getStatus(state, token, kind) { calls.push({ state, token, kind }); return { state, status: 'waiting' }; },
    async cancel(state, token, kind) { calls.push({ state, token, kind }); return { state, status: 'cancelled' }; },
    async frame(state, token) { calls.push({ state, token }); return Buffer.from([0xff, 0xd8, 0xff]); },
    async input(state, token, event) { calls.push({ state, token, event }); },
  };
  const routes = createBrowserLoginRoutes(manager, { isAdmin: (token) => token === 'owner' });
  const server = http.createServer(async (req, res) => {
    if (!(await routes.handle(req, res, new URL(req.url, 'http://localhost')))) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(base + path, options);
  return { calls, request, base };
}

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
