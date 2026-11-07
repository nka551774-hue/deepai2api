'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountPool } = require('../src/accountPool');
const { DeepAIClient, UpstreamError } = require('../src/deepai');
const { StreamParser } = require('../src/streamParser');
const { CONFIG } = require('../src/config');

function makeAccount(id, overrides = {}) {
  return {
    id,
    name: id,
    group: '',
    weight: 1,
    type: 'cookie',
    cookie: `${id.toLowerCase()}=1`,
    email: '',
    password: '',
    apiKey: '',
    status: 'active',
    deviceId: `device-${id}`,
    uses: 0,
    errors: 0,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorMessage: '',
    cooldownUntil: null,
    ...overrides,
  };
}

function makeStore(accounts = [], settings = {}) {
  return {
    state: { accounts, settings },
    saves: 0,
    save() {
      this.saves += 1;
    },
  };
}

function fakeStream(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
        };
      },
    },
  };
}

test('StreamParser withholds partial thinking markers at every chunk boundary', () => {
  const raw = 'prefix\u001DTHINKING_START12s\u001Ethought\u001DTHINKING_ENDanswer';
  const final = StreamParser.parse(raw);

  for (let split = 0; split <= raw.length; split += 1) {
    const partial = StreamParser.parse(raw.slice(0, split));
    assert.ok(final.text.startsWith(partial.text), `visible text leaked at split ${split}: ${JSON.stringify(partial.text)}`);
    assert.ok(
      final.thinkingText.startsWith(partial.thinkingText),
      `thinking text leaked at split ${split}: ${JSON.stringify(partial.thinkingText)}`
    );
  }
});

test('readStream emits separate text and thinking deltas using the four-argument contract', async () => {
  const raw = '\u001DTHINKING_START12s\u001Ethought\u001DTHINKING_ENDanswer';
  const events = [];

  await new DeepAIClient({}).readStream(fakeStream([raw]), {
    onDelta(textDelta, fullText, thinkingDelta, fullThinking) {
      events.push({ textDelta, fullText, thinkingDelta, fullThinking });
    },
  });

  assert.deepEqual(events, [
    { textDelta: '', fullText: '', thinkingDelta: 'thought', fullThinking: 'thought' },
    { textDelta: 'answer', fullText: 'answer', thinkingDelta: '', fullThinking: 'thought' },
  ]);
});

test('readStream reconstructs text and thinking when both control markers cross chunk boundaries', async () => {
  const chunks = ['prefix\u001DTHINKING_STA', 'RT12s\u001Ethought\u001DTHINKING_EN', 'Danswer'];
  let text = '';
  let thinking = '';

  await new DeepAIClient({}).readStream(fakeStream(chunks), {
    onDelta(textDelta, _fullText, thinkingDelta) {
      text += textDelta;
      thinking += thinkingDelta;
    },
  });

  assert.equal(text, 'prefixanswer');
  assert.equal(thinking, 'thought');
});

test('readStream reconstructs UTF-8 characters split across byte chunks', async () => {
  const bytes = new TextEncoder().encode('A你好B');
  let index = 0;
  const response = {
    body: {
      getReader() {
        return {
          async read() {
            if (index >= bytes.length) return { done: true, value: undefined };
            return { done: false, value: bytes.slice(index, ++index) };
          },
        };
      },
    },
  };
  let text = '';

  await new DeepAIClient({}).readStream(response, { onDelta: (delta) => (text += delta) });

  assert.equal(text, 'A你好B');
});

test('readStream bodyless fallback keeps the four-argument delta contract', async () => {
  const events = [];
  const response = {
    body: null,
    async text() {
      return '\u001DTHINKING_START1s\u001Ethought\u001DTHINKING_ENDanswer';
    },
  };

  const raw = await new DeepAIClient({}).readStream(response, {
    onDelta(textDelta, fullText, thinkingDelta, fullThinking) {
      events.push({ textDelta, fullText, thinkingDelta, fullThinking });
    },
  });

  assert.match(raw, /answer$/);
  assert.deepEqual(events, [
    { textDelta: '', fullText: '', thinkingDelta: 'thought', fullThinking: 'thought' },
    { textDelta: 'answer', fullText: 'answer', thinkingDelta: '', fullThinking: 'thought' },
  ]);
});

test('chat timeout also aborts asynchronous task polling', async () => {
  const originalFetch = global.fetch;
  const oldInterval = CONFIG.upstream.taskPollIntervalMs;
  const oldTimeout = CONFIG.upstream.taskPollTimeoutMs;
  let calls = 0;
  CONFIG.upstream.taskPollIntervalMs = 10;
  CONFIG.upstream.taskPollTimeoutMs = 100;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('{"task_id":"task-1"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"status":"PENDING"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await assert.rejects(
      new DeepAIClient({ apiKey: 'dummy' }).chat([{ role: 'user', content: 'hello' }], { timeoutMs: 5 }),
      (err) => err && err.code === 'TIMEOUT'
    );
  } finally {
    global.fetch = originalFetch;
    CONFIG.upstream.taskPollIntervalMs = oldInterval;
    CONFIG.upstream.taskPollTimeoutMs = oldTimeout;
  }
});

test('completed asynchronous chat tasks emit thinking and answer exactly once', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const raw = '\u001DTHINKING_START1s\u001Ethought\u001DTHINKING_ENDanswer';
  let calls = 0;
  global.fetch = async () => new Response(JSON.stringify(++calls === 1
    ? { task_id: 'offline-task' }
    : { status: 'COMPLETED', result: raw }), { headers: { 'Content-Type': 'application/json' } });
  const events = [];
  const result = await new DeepAIClient({ apiKey: 'fixture' }).chat([{ role: 'user', content: 'test' }], {
    stream: true,
    onDelta: (...args) => events.push(args),
  });
  assert.equal(result.text, 'answer');
  assert.equal(result.thinkingText, 'thought');
  assert.deepEqual(events, [
    ['', '', 'thought', 'thought'],
    ['answer', 'answer', '', 'thought'],
  ]);
});

test('ordinary chat streams do not repeat their final buffered answer', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('answer', { headers: { 'Content-Type': 'text/plain' } });
  let text = '';
  await new DeepAIClient({ apiKey: 'fixture' }).chat([{ role: 'user', content: 'test' }], {
    stream: true,
    onDelta: (delta) => { text += delta; },
  });
  assert.equal(text, 'answer');
});

test('runApi rejects a non-2xx JSON body when curl fallback is unavailable', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response('{"message":"server exploded"}', { status: 500, headers: { 'content-type': 'application/json' } });
  const client = new DeepAIClient({ apiKey: 'dummy' });
  client.runApiViaCurl = async () => null;

  try {
    await assert.rejects(client.runApi('text2img', {}), (err) => err && err.code === 'UPSTREAM_ERROR' && err.status === 500);
  } finally {
    global.fetch = originalFetch;
  }
});

test('runApi never lets curl JSON mask a generic upstream HTTP failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response('{"message":"server exploded"}', { status: 500, headers: { 'content-type': 'application/json' } });
  const client = new DeepAIClient({ apiKey: 'dummy' });
  client.runApiViaCurl = async () => '{"message":"server exploded"}';

  try {
    await assert.rejects(client.runApi('text2img', {}), (err) => err && err.code === 'UPSTREAM_ERROR' && err.status === 500);
  } finally {
    global.fetch = originalFetch;
  }
});

test('runApi enforces its timeout through an abort signal', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    assert.ok(init.signal, 'fetch must receive an abort signal');
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };

  try {
    await assert.rejects(
      new DeepAIClient({ apiKey: 'dummy' }).runApi('text2img', {}, { timeoutMs: 5 }),
      (err) => err && err.code === 'TIMEOUT'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('usable orders accounts by uses per weight and then oldest use', () => {
  const accounts = [
    makeAccount('A', { uses: 4, weight: 2, lastUsedAt: '2026-11-07T12:00:00.000Z' }),
    makeAccount('B', { uses: 2, weight: 1, lastUsedAt: '2026-11-01T12:00:00.000Z' }),
    makeAccount('C', { uses: 0, weight: 1, lastUsedAt: null }),
  ];
  const pool = new AccountPool(makeStore(accounts));

  assert.deepEqual(pool.usable().map((account) => account.id), ['C', 'B', 'A']);
});

test('account CRUD validates metadata and deduplicates API keys and cookies', () => {
  const pool = new AccountPool(makeStore());
  const api = pool.addApiKeyAccount('  upstream-key  ', ' Primary ');
  const cookie = pool.addCookieAccount('foo=1; session=abc', 'Cookie');

  assert.equal(api.apiKey, 'upstream-key');
  assert.equal(api.group, '');
  assert.equal(api.weight, 1);
  assert.throws(() => pool.addApiKeyAccount('upstream-key'), /already exists/i);
  assert.throws(() => pool.addCookieAccount('session=abc; foo=1'), /already exists/i);

  const updated = pool.updateAccount(api.id, { name: ' Renamed ', group: ' Team ', weight: 25 });
  assert.deepEqual({ name: updated.name, group: updated.group, weight: updated.weight }, { name: 'Renamed', group: 'Team', weight: 25 });
  assert.throws(() => pool.updateAccount(api.id, { weight: 0 }), /weight/i);
  assert.throws(() => pool.updateAccount(api.id, { weight: 1.5 }), /weight/i);
  assert.equal(cookie.type, 'cookie');
});

test('_addAccount also deduplicates environment-style API key seeding', () => {
  const pool = new AccountPool(makeStore());
  pool._addAccount({ type: 'apikey', apiKey: 'seed-key', name: 'seed' });

  assert.throws(() => pool._addAccount({ type: 'apikey', apiKey: 'seed-key', name: 'duplicate' }), /already exists/i);
});

test('login deduplication happens before any upstream login request', async () => {
  const originalFetch = global.fetch;
  const store = makeStore([makeAccount('L', { type: 'login', email: 'user@example.com', password: 'old' })]);
  const pool = new AccountPool(store);
  global.fetch = async () => {
    throw new Error('fetch should not run for a duplicate login');
  };

  try {
    await assert.rejects(pool.addLoginAccount(' USER@example.com ', 'new'), /already exists/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('import and export preserve portable credentials and metadata without logging in when a cookie exists', async () => {
  const originalFetch = global.fetch;
  const pool = new AccountPool(makeStore());
  global.fetch = async () => {
    throw new Error('import with an existing cookie must not log in');
  };

  try {
    const account = await pool.importAccount({
      type: 'login',
      email: 'user@example.com',
      password: 'secret',
      cookie: 'sessionid=portable',
      name: 'Portable',
      group: 'Imported',
      weight: 7,
      status: 'disabled',
    });
    assert.deepEqual(pool.exportAccounts([account.id]), [
      {
        type: 'login',
        email: 'user@example.com',
        password: 'secret',
        cookie: 'sessionid=portable',
        name: 'Portable',
        group: 'Imported',
        weight: 7,
        status: 'disabled',
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('login import with an existing cookie may omit the password', async () => {
  const originalFetch = global.fetch;
  const pool = new AccountPool(makeStore());
  global.fetch = async () => {
    throw new Error('portable cookie import must not log in');
  };

  try {
    const account = await pool.importAccount({
      type: 'login',
      email: 'cookie-only@example.com',
      cookie: 'sessionid=portable',
    });
    assert.equal(account.email, 'cookie-only@example.com');
    assert.equal(account.password, '');
    assert.equal(account.cookie, 'sessionid=portable');
  } finally {
    global.fetch = originalFetch;
  }
});

test('exportAccounts omits default metadata for portable backwards-compatible records', () => {
  const pool = new AccountPool(makeStore());
  const account = pool.addApiKeyAccount('portable-key', 'portable');

  assert.deepEqual(pool.exportAccounts([account.id]), [
    { type: 'apikey', apiKey: 'portable-key', name: 'portable', status: 'active' },
  ]);
});

test('chat restricts the pool to accountIds and never falls back anonymously for a nonempty restriction', async () => {
  const oldFallback = CONFIG.allowAnonymousFallback;
  CONFIG.allowAnonymousFallback = true;
  const pool = new AccountPool(makeStore([makeAccount('A'), makeAccount('B')], { allowAnonymousFallback: true }));
  const calls = [];
  pool._chatWithAccount = async (entry, _messages, _opts, isAnon) => {
    calls.push(isAnon ? 'anonymous' : entry.id);
    return { text: entry.id || 'anonymous', thinkingText: '', images: [], raw: '' };
  };

  try {
    const result = await pool.chat([{ role: 'user', content: 'hello' }], { accountIds: ['B'] });
    assert.equal(result.upstreamKeyId, 'B');
    assert.deepEqual(calls, ['B']);

    await assert.rejects(
      pool.chat([{ role: 'user', content: 'hello' }], { accountIds: ['missing'] }),
      (err) => err && err.code === 'NO_ACCOUNTS'
    );
    assert.deepEqual(calls, ['B']);
  } finally {
    CONFIG.allowAnonymousFallback = oldFallback;
  }
});

test('persisted anonymous fallback setting overrides the environment default', async () => {
  const oldFallback = CONFIG.allowAnonymousFallback;
  CONFIG.allowAnonymousFallback = true;
  const pool = new AccountPool(makeStore([], { allowAnonymousFallback: false }));
  pool._chatWithAccount = async () => {
    throw new Error('anonymous fallback should be disabled');
  };

  try {
    await assert.rejects(pool.chat([{ role: 'user', content: 'hello' }], {}), (err) => err && err.code === 'NO_ACCOUNTS');
  } finally {
    CONFIG.allowAnonymousFallback = oldFallback;
  }
});

test('streaming failover stops after the first account emits content', async () => {
  const pool = new AccountPool(makeStore([makeAccount('A'), makeAccount('B')], { allowAnonymousFallback: false }));
  const calls = [];
  const deltas = [];
  pool._chatWithAccount = async (entry, _messages, opts) => {
    calls.push(entry.id);
    if (entry.id === 'A') {
      opts.onDelta('partial-A', 'partial-A', '', '');
      throw new UpstreamError('socket reset', { code: 'NETWORK', retryable: true });
    }
    return { text: 'answer-B', thinkingText: '', images: [], raw: '' };
  };

  await assert.rejects(
    pool.chat([{ role: 'user', content: 'hello' }], { stream: true, onDelta: (text) => deltas.push(text) }),
    (err) => err && err.code === 'NETWORK'
  );
  assert.deepEqual(calls, ['A']);
  assert.deepEqual(deltas, ['partial-A']);
});

test('an aborted retry after re-login is terminal and does not move to another account', async () => {
  const pool = new AccountPool(
    makeStore([makeAccount('A', { type: 'login', email: 'a@example.com' }), makeAccount('B')], { allowAnonymousFallback: false })
  );
  const calls = [];
  let attempts = 0;
  pool.refreshLogin = async () => ({ ok: true });
  pool._chatWithAccount = async (entry) => {
    calls.push(entry.id);
    if (entry.id === 'A' && attempts++ === 0) throw new UpstreamError('expired', { code: 'LOGIN_REQUIRED' });
    if (entry.id === 'A') throw new UpstreamError('cancelled', { code: 'ABORTED' });
    return { text: 'answer-B', thinkingText: '', images: [], raw: '' };
  };

  await assert.rejects(pool.chat([{ role: 'user', content: 'hello' }], {}), (err) => err && err.code === 'ABORTED');
  assert.deepEqual(calls, ['A', 'A']);
});

test('automatic re-login preserves caller cancellation and timeout', async (t) => {
  const oldFetch = global.fetch;
  const oldTimeout = CONFIG.upstream.timeoutMs;
  t.after(() => { global.fetch = oldFetch; CONFIG.upstream.timeoutMs = oldTimeout; });
  CONFIG.upstream.timeoutMs = 80;
  for (const phase of ['login', 'user', 'timeout']) {
    await t.test(phase, async () => {
      const controller = new AbortController();
      let userRequests = 0;
      global.fetch = async (url, opts) => {
        if (url.endsWith(CONFIG.upstream.chatPath)) return new Response('login required', { status: 401 });
        if (url.endsWith('/user/') && ++userRequests === 1) return new Response('{}');
        if (url.endsWith('/login/') && phase === 'user') {
          return new Response('{}', { headers: { 'Set-Cookie': 'sessionid=renewed' } });
        }
        if (phase !== 'timeout') queueMicrotask(() => controller.abort());
        return new Promise((_, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (opts.signal.aborted) abort();
          else opts.signal.addEventListener('abort', abort, { once: true });
        });
      };
      const pool = new AccountPool(makeStore([makeAccount('A', {
        type: 'login', email: 'a@example.invalid', password: 'fixture',
      })], { allowAnonymousFallback: false }));
      await assert.rejects(pool.chat([{ role: 'user', content: 'test' }], {
        signal: controller.signal, timeoutMs: 15,
      }), (err) => phase === 'timeout'
        ? err.code === 'TIMEOUT' && /after 15ms/.test(err.message)
        : err.code === 'ABORTED');
    });
  }
});

test('login and user lookup do not treat a timed-out response body as success', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const { loginAccount, fetchUser } = require('../src/deepai');
  for (const mode of ['login', 'user']) {
    await t.test(mode, async () => {
      global.fetch = async (url, opts) => {
        if (mode === 'login' && url.endsWith('/user/')) return new Response('{}');
        return {
          ok: true, status: 200, headers: new Headers({ 'Set-Cookie': 'sessionid=fixture' }),
          text: () => new Promise((_, reject) => {
            const abort = () => reject(new DOMException('Body read aborted', 'AbortError'));
            if (opts.signal.aborted) abort();
            else opts.signal.addEventListener('abort', abort, { once: true });
          }),
        };
      };
      await assert.rejects(mode === 'login'
        ? loginAccount('test@example.invalid', 'fixture', { timeoutMs: 5 })
        : fetchUser('sessionid=fixture', 'device', { timeoutMs: 5 }),
      (err) => err.code === 'TIMEOUT');
    });
  }
});

test('a re-login network failure can fail over to another allowed account', async () => {
  const pool = new AccountPool(makeStore([
    makeAccount('A', { type: 'login', email: 'a@example.invalid' }), makeAccount('B'),
  ], { allowAnonymousFallback: false }));
  const attempted = [];
  pool._chatWithAccount = async (entry) => {
    attempted.push(entry.id);
    if (entry.id === 'A') throw new UpstreamError('Session expired', { code: 'LOGIN_REQUIRED' });
    return { text: 'healthy answer', thinkingText: '', images: [] };
  };
  pool.refreshLogin = async () => { throw new UpstreamError('Network failure', { code: 'NETWORK', retryable: true }); };
  const result = await pool.chat([{ role: 'user', content: 'test' }], {});
  assert.equal(result.text, 'healthy answer');
  assert.deepEqual(attempted, ['A', 'B']);
});

test('runApi applies accountIds and forwards timeoutMs to the selected client', async () => {
  const pool = new AccountPool(makeStore([makeAccount('A'), makeAccount('B')], { allowAnonymousFallback: true }));
  const calls = [];
  pool._clientFor = (entry) => ({
    async runApi(name, fields, opts) {
      calls.push({ id: entry.id, name, fields, opts });
      return { output_url: 'https://example.test/image.png' };
    },
  });

  const result = await pool.runApi('text2img', { text: 'cat' }, { accountIds: ['B'], timeoutMs: 4321 });
  assert.equal(result.upstreamAccountId, 'B');
  assert.deepEqual(calls, [
    { id: 'B', name: 'text2img', fields: { text: 'cat' }, opts: { timeoutMs: 4321, signal: undefined } },
  ]);
});

test('stable conversation UUID is a deterministic RFC 4122 UUID with version and variant bits', async () => {
  const originalChat = DeepAIClient.prototype.chat;
  const pool = new AccountPool(makeStore([makeAccount('A')]));
  const seen = [];
  DeepAIClient.prototype.chat = async function (_messages, opts) {
    seen.push(opts.sessionUuid);
    return { text: 'ok', thinkingText: '', images: [], raw: '' };
  };

  try {
    await pool.chat([{ role: 'user', content: 'hello' }], { sessionKey: 'conversation' });
    await pool.chat([{ role: 'user', content: 'again' }], { sessionKey: 'conversation' });
  } finally {
    DeepAIClient.prototype.chat = originalChat;
  }

  assert.equal(seen[0], seen[1]);
  assert.match(seen[0], /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('sticky account memo is bounded and refreshes recently successful conversations', async () => {
  const pool = new AccountPool(makeStore([makeAccount('A')]));
  const originalChat = DeepAIClient.prototype.chat;
  DeepAIClient.prototype.chat = async () => ({ text: 'ok', thinkingText: '', images: [], raw: '' });

  try {
    for (let index = 0; index < 4097; index += 1) {
      await pool.chat([{ role: 'user', content: String(index) }], { sessionKey: `session-${index}` });
    }
    assert.equal(pool.sessionAccountMap.size, 4096);
    assert.equal(pool.sessionAccountMap.has('session-0'), false);
    assert.equal(pool.sessionAccountMap.has('session-4096'), true);

    await pool.chat([{ role: 'user', content: 'touch' }], { sessionKey: 'session-1' });
    await pool.chat([{ role: 'user', content: 'new' }], { sessionKey: 'session-new' });
    assert.equal(pool.sessionAccountMap.has('session-1'), true);
    assert.equal(pool.sessionAccountMap.has('session-2'), false);
  } finally {
    DeepAIClient.prototype.chat = originalChat;
  }
});

test('cookieFromResponse falls back to a combined set-cookie header without splitting Expires commas', () => {
  const { cookieFromResponse } = require('../src/deepai');
  const response = {
    headers: {
      get(name) {
        assert.equal(name, 'set-cookie');
        return 'csrftoken=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, sessionid=xyz; HttpOnly; Path=/';
      },
    },
  };

  assert.equal(cookieFromResponse(response, 'theme=dark'), 'theme=dark; csrftoken=abc; sessionid=xyz');
});

test('loginAccount and fetchUser reject redirects and enforce timeouts', async () => {
  const { loginAccount, fetchUser } = require('../src/deepai');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal, 'request must receive a timeout signal');
    if (String(url).endsWith('/daily-time-sync/user/') && calls.length === 1) {
      return new Response('', { status: 200 });
    }
    if (String(url).endsWith('/daily-time-sync/login/')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'sessionid=logged-in; HttpOnly; Path=/' } });
    }
    return new Response('{"username":"user"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const login = await loginAccount('user@example.com', 'secret', { timeoutMs: 50 });
    assert.equal(login.cookie, 'sessionid=logged-in');
    const user = await fetchUser('sessionid=logged-in', 'device', { timeoutMs: 50 });
    assert.equal(user.user.username, 'user');
  } finally {
    global.fetch = originalFetch;
  }
});

test('credential-bearing chat, task and API requests reject redirects', async () => {
  const originalFetch = global.fetch;
  const redirects = [];
  let call = 0;
  global.fetch = async (_url, init) => {
    redirects.push(init.redirect);
    call += 1;
    if (call === 1) return new Response('answer', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (call === 2) return new Response('{"status":"PENDING"}', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{"output_url":"https://example.test/image.png"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new DeepAIClient({ cookie: 'sessionid=secret', deviceId: 'device' });

  try {
    await client.chat([{ role: 'user', content: 'hello' }], { timeoutMs: 100 });
    await client.taskStatus('task-1');
    await client.runApi('text2img', {}, { timeoutMs: 100 });
    assert.deepEqual(redirects, ['error', 'error', 'error']);
  } finally {
    global.fetch = originalFetch;
  }
});
