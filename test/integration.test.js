'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { CONFIG } = require('../src/config');
const { Store } = require('../src/store');
const { createServer } = require('../server');

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('panel, account restrictions and streamed chat work over real HTTP', async (t) => {
  const priorBase = CONFIG.upstream.baseUrl;
  const priorData = CONFIG.dataDir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepai-integration-'));
  let store;
  t.after(() => {
    CONFIG.upstream.baseUrl = priorBase;
    CONFIG.dataDir = priorData;
    if (store?._saveTimer) clearTimeout(store._saveTimer);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const received = [];
  CONFIG.upstream.baseUrl = await listen(t, http.createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    received.push({ url: req.url, cookie: req.headers.cookie, apiKey: req.headers['api-key'], body: Buffer.concat(parts).toString('utf8') });
    if (req.url === CONFIG.upstream.chatPath) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.write('\x1dTHINKING_STA');
      setTimeout(() => res.end('RT2s\x1e分析\x1dTHINKING_END回答'), 20);
    } else if (req.url === '/api/text2img') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output_url: 'https://example.invalid/generated.png' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  }));
  CONFIG.dataDir = dir;
  store = new Store();
  const base = await listen(t, createServer({ store }));
  const post = (endpoint, body, headers = {}) => fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const login = await post('/panel/login', { password: CONFIG.adminPassword });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const panel = { 'X-Panel-Token': token };
  for (const [type, name, credential] of [
    ['apikey', 'legacy', { apiKey: 'local-fixture-key' }],
    ['cookie', 'selected', { cookie: 'sessionid=fixture-selected' }],
  ]) {
    const response = await post('/api/admin/accounts', { type, name, ...credential }, panel);
    assert.equal(response.status, 200, await response.text());
  }
  const accountResponse = await fetch(base + '/api/admin/accounts', { headers: panel });
  const { accounts } = await accountResponse.json();
  const selected = accounts.find((a) => a.name === 'selected');
  assert.ok(selected);
  assert.equal(Object.hasOwn(selected, 'cookie'), false);
  assert.doesNotMatch(JSON.stringify(accounts), /fixture-selected|local-fixture-key/);
  const keyResponse = await post('/api/admin/gateway-keys', { name: 'integration', models: ['deepai-*'], accountIds: [selected.id] }, panel);
  assert.equal(keyResponse.status, 200);
  const { key } = await keyResponse.json();
  const client = { Authorization: `Bearer ${key.key}` };
  const stream = await post('/v1/chat/completions', {
    model: 'deepai-standard', stream: true, messages: [{ role: 'user', content: 'Test input' }],
  }, client);
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const wire = await stream.text();
  const frames = wire.split('\n\n').filter((row) => row.startsWith('data: {')).map((row) => JSON.parse(row.slice(6)));
  assert.equal(frames.map((frame) => frame.choices[0].delta.reasoning_content || '').join(''), '分析');
  assert.equal(frames.map((frame) => frame.choices[0].delta.content || '').join(''), '回答');
  assert.match(wire, /data: \[DONE\]/);
  assert.match(received[0].cookie, /sessionid=fixture-selected/);
  assert.match(received[0].apiKey, /^tryit-/);
  assert.match(received[0].body, /Test input/);

  const image = await post('/v1/images/generations', { prompt: 'image request' }, client);
  assert.equal(image.status, 200);
  assert.equal((await image.json()).data[0].url, 'https://example.invalid/generated.png');
  assert.match(received[1].cookie, /sessionid=fixture-selected/);

  const disable = await post('/api/admin/accounts/status', { id: selected.id, status: 'disabled' }, panel);
  assert.equal(disable.status, 200);
  assert.doesNotMatch(await disable.text(), /fixture-selected/);
  const denied = await post('/v1/chat/completions', { messages: [{ role: 'user', content: 'Cannot use another account' }] }, client);
  assert.equal(denied.status, 502);
  assert.equal(received.length, 2, 'a key limited to a disabled account must not fail over to a different account');
  assert.equal(store.flushSync(), true);
  const reloaded = new Store();
  assert.deepEqual(reloaded.state.gatewayKeys[0].accountIds, [selected.id]);
  assert.equal(reloaded.state.gatewayKeys[0].uses, 3);
  assert.equal(reloaded.state.stats.totalErrors, 1);
});
