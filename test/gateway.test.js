'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG } = require('../src/config');
const { Store } = require('../src/store');
const { Auth } = require('../src/auth');
const { createOpenAIRoutes } = require('../src/openaiRoutes');
const { EventEmitter } = require('node:events');

function fixture(t, pool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepai-gateway-'));
  const previous = CONFIG.dataDir;
  CONFIG.dataDir = dir;
  const store = new Store();
  CONFIG.dataDir = previous;
  // Keep writes in this fixture even after restoring process configuration.
  store.file = path.join(dir, 'state.json');
  t.after(() => {
    if (store._saveTimer) clearTimeout(store._saveTimer);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, auth: new Auth(store), routes: createOpenAIRoutes(store, pool) };
}

function response() {
  return {
    statusCode: 0, headersSent: false, writableEnded: false, chunks: [],
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end(chunk = '') { this.chunks.push(chunk); this.writableEnded = true; },
    once() {}, off() {},
    json() { return JSON.parse(this.chunks.join('')); },
  };
}

const chatResult = () => ({ text: 'Hello', thinkingText: '', images: [], upstreamAnonymous: true });
const request = (key = '') => ({ headers: key ? { authorization: `Bearer ${key}` } : {} });
const payload = (content = 'First question') => ({ messages: [{ role: 'user', content }] });

test('discarded or empty message content returns 400 before upstream use', async (t) => {
  let called = false;
  const { routes } = fixture(t, { chat: async () => { called = true; return chatResult(); } });
  for (const messages of [[null], [{ role: 'user', content: '' }], [{ role: 'user', content: [] }]]) {
    const res = response();
    await routes.handleChat(request(), res, { messages });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(called, false);
});

test('open-mode calls are counted under open-mode without corrupt counters', async (t) => {
  const { routes, store } = fixture(t, { chat: async () => chatResult() });
  const res = response();
  await routes.handleChat(request(), res, payload());
  assert.equal(res.statusCode, 200);
  assert.equal(store.state.stats.totalRequests, 1);
  assert.deepEqual(store.state.stats.perGatewayKey['open-mode'], { requests: 1, errors: 0 });
  assert.equal(Object.hasOwn(store.state.stats.perGatewayKey, 'undefined'), false);
});

test('a request limit reserves use before concurrent upstream work', async (t) => {
  const completions = [];
  let calls = 0;
  const { routes, auth } = fixture(t, { chat: () => { calls++; return new Promise((r) => completions.push(r)); } });
  const key = auth.createGatewayKey({ requestLimit: 1 });
  const first = response();
  const second = response();
  const pending = routes.handleChat(request(key.key), first, payload());
  const concurrent = routes.handleChat(request(key.key), second, payload());
  for (const complete of completions) complete(chatResult());
  await Promise.all([pending, concurrent]);
  assert.equal(calls, 1, 'two upstream calls passed a one-request limit');
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(key.uses, 1);
});

test('conversation identity follows the first user turn and isolates gateway keys', async (t) => {
  const sessions = [];
  const { routes, auth } = fixture(t, { chat: async (_messages, opts) => { sessions.push(opts.sessionKey); return chatResult(); } });
  const a = auth.createGatewayKey({ name: 'a' });
  const b = auth.createGatewayKey({ name: 'b' });
  await routes.handleChat(request(a.key), response(), payload('Question A'));
  await routes.handleChat(request(a.key), response(), payload('Question B'));
  await routes.handleChat(request(a.key), response(), {
    messages: [
      { role: 'user', content: 'Question A' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Follow-up' },
    ],
  });
  await routes.handleChat(request(b.key), response(), payload('Question A'));
  assert.notEqual(sessions[0], sessions[1]);
  assert.equal(sessions[0], sessions[2]);
  assert.notEqual(sessions[0], sessions[3]);
});

test('explicit session identifiers are also scoped to the gateway key', async (t) => {
  const sessions = [];
  const { routes, auth } = fixture(t, { chat: async (_messages, opts) => { sessions.push(opts.sessionKey); return chatResult(); } });
  const a = auth.createGatewayKey({});
  const b = auth.createGatewayKey({});
  for (const key of [a, b]) {
    await routes.handleChat(request(key.key), response(), { ...payload(), session_key: 'shared-client-id' });
  }
  assert.notEqual(sessions[0], sessions[1]);
});

test('model mapping does not inherit Object prototype properties', (t) => {
  const { routes } = fixture(t, {});
  assert.equal(routes.resolveModel('constructor'), 'constructor');
});

test('disconnecting an image request cancels the active upstream and skips fallback', async (t) => {
  const events = new EventEmitter();
  const res = response();
  res.once = events.once.bind(events);
  res.off = events.off.bind(events);
  let signal;
  let fallbackCalls = 0;
  const { routes } = fixture(t, {
    runApi: async (_name, _fields, opts) => {
      signal = opts.signal;
      res.destroyed = true;
      events.emit('close');
      throw Object.assign(new Error('Request cancelled'), { code: 'ABORTED' });
    },
    chat: async () => { fallbackCalls++; return { ...chatResult(), images: ['https://example.invalid/image'] }; },
  });
  await routes.handleImages(request(), res, { prompt: 'test' });
  assert.equal(signal?.aborted, true);
  assert.equal(fallbackCalls, 0);
  assert.equal(events.listenerCount('close'), 0);
});

test('image chat fallback receives the same disconnect cancellation', async (t) => {
  const events = new EventEmitter();
  const res = response();
  res.once = events.once.bind(events);
  res.off = events.off.bind(events);
  let primarySignal;
  let fallbackSignal;
  const { routes } = fixture(t, {
    runApi: async (_name, _fields, opts) => { primarySignal = opts.signal; throw new Error('primary unavailable'); },
    chat: async (_messages, opts) => {
      fallbackSignal = opts.signal;
      res.destroyed = true;
      events.emit('close');
      throw Object.assign(new Error('Request cancelled'), { code: 'ABORTED' });
    },
  });
  await routes.handleImages(request(), res, { prompt: 'test' });
  assert.equal(fallbackSignal?.aborted, true);
  assert.equal(primarySignal, fallbackSignal);
  assert.equal(events.listenerCount('close'), 0);
});

test('stream failures after partial output remain observable as errors', async (t) => {
  const { routes, store } = fixture(t, { chat: async (_messages, opts) => {
    opts.onDelta('partial', 'partial', '', '');
    throw new Error('connection interrupted');
  } });
  const res = response();
  await routes.handleChat(request(), res, { ...payload(), stream: true });
  const frames = res.chunks.join('');
  assert.match(frames, /connection interrupted/);
  assert.doesNotMatch(frames, /"finish_reason":"stop"/);
  assert.equal(store.state.stats.totalErrors, 1);
});

test('key restrictions filter the model list and scope chat and image accounts', async (t) => {
  const seen = [];
  const { routes, auth } = fixture(t, {
    chat: async (_messages, opts) => { seen.push(opts.accountIds); return chatResult(); },
    runApi: async (_name, _fields, opts) => { seen.push(opts?.accountIds); return { output_url: 'https://example.invalid/image.png' }; },
  });
  const key = auth.createGatewayKey({ models: ['deepai-*'], accountIds: ['account-a'] });
  const res = response();
  routes.handleModels(request(key.key), res);
  assert.deepEqual(res.json().data.map((m) => m.id), ['deepai-standard', 'deepai-genius', 'deepai-super-genius']);
  await routes.handleChat(request(key.key), response(), payload());
  await routes.handleImages(request(key.key), response(), { prompt: 'test image' });
  assert.deepEqual(seen, [['account-a'], ['account-a']]);
});

test('invalid API credentials cannot list models after the first key is issued', (t) => {
  const { routes, auth } = fixture(t, {});
  auth.createGatewayKey({});
  const res = response();
  routes.handleModels(request(), res);
  assert.equal(res.statusCode, 401);
});

test('malformed HTTP bodies return errors and leave the server healthy', async (t) => {
  const { createServer } = require('../server');
  const { store } = fixture(t, {});
  const server = createServer({ store, pool: { list: () => [], chat: async () => chatResult() } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const endpoint of ['/v1/chat/completions', '/panel/login']) {
    const res = await fetch(base + endpoint, { method: 'POST', body: '{broken' });
    assert.equal(res.status, 400);
    assert.equal((await fetch(base + '/healthz')).status, 200);
  }
  const empty = await fetch(base + '/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [null] }) });
  assert.equal(empty.status, 400);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});
