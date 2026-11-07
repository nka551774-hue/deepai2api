'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { existsSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns/promises');
const { fetchUser } = require('./deepai');
const { randomDeviceId } = require('./islandHash');

const WIDTH = 1000;
const HEIGHT = 760;
const TERMINAL = new Set(['completed', 'cancelled', 'expired', 'failed']);
const KEYS = new Set(['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Control+a', 'Meta+a']);
// Keep the remote browser on DeepAI and the providers used by its login page.
// This browser cannot be used as a general URL fetcher from the gateway host.
const HOSTS = new Set(['deepai.org', 'www.deepai.org', 'api.deepai.org', 'accounts.google.com', 'appleid.apple.com', 'appleid.cdn-apple.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'ssl.gstatic.com', 'www.gstatic.com', 'apis.google.com', 'www.google.com', 'www.recaptcha.net', 'challenges.cloudflare.com']);
const LOGIN_HOSTS = new Set(['deepai.org', 'www.deepai.org', 'api.deepai.org', 'accounts.google.com', 'appleid.apple.com']);
const PRIVATE_IPV4 = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) PRIVATE_IPV4.addSubnet(address, prefix);

function problem(status, message) { return Object.assign(new Error(message), { status }); }

function sameToken(expected, supplied) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  const actual = Buffer.from(supplied);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function browserPath(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : '';
  const candidates = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((dir) => [`${dir}/Google/Chrome/Application/chrome.exe`, `${dir}/Microsoft/Edge/Application/msedge.exe`])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
  return candidates.find(existsSync) || '';
}

function validateEvent(event) {
  if (event && typeof event === 'object') {
    switch (event.type) {
      case 'click':
        if (Number.isFinite(event.x) && event.x >= 0 && event.x < WIDTH && Number.isFinite(event.y) && event.y >= 0 && event.y < HEIGHT) return;
        break;
      case 'press': if (KEYS.has(event.key)) return; break;
      case 'text': if (typeof event.text === 'string' && event.text.length > 0 && event.text.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.text)) return; break;
      case 'scroll': if (Number.isFinite(event.deltaY) && Math.abs(event.deltaY) <= 2000) return; break;
      case 'back': case 'reload': return;
    }
  }
  throw problem(400, 'Invalid browser input');
}

// Chromium routes do not see every redirect. Enforce the egress policy at
// the CONNECT tunnel as well, pinning the public address returned by DNS.
async function openLoginProxy() {
  const sockets = new Set();
  const track = (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const proxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  proxy.on('connection', track);
  proxy.on('connect', async (req, client, head) => {
    client.on('error', () => {});
    const host = /^([a-z0-9.-]+):443$/.exec(req.url)?.[1];
    if (!HOSTS.has(host)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    try {
      const { address } = await dns.lookup(host, { family: 4 });
      if (client.destroyed) return;
      if (PRIVATE_IPV4.check(address)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const upstream = net.connect({ host: address, port: 443 });
      track(upstream);
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      upstream.once('close', () => client.destroy());
      client.once('close', () => upstream.destroy());
      upstream.once('connect', () => {
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
    } catch { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  return {
    server: `http://127.0.0.1:${proxy.address().port}`,
    close() { for (const socket of sockets) socket.destroy(); proxy.close(); },
  };
}

class BrowserLogin {
  constructor({ pool, auth, config, upstream, verifyUser = fetchUser, launch, allowLocal = false, checkIntervalMs = 1500 }) {
    Object.assign(this, { pool, auth, config, upstream, verifyUser, launch, allowLocal, checkIntervalMs });
    this.sessions = new Map();
    this.closed = false;
    this.sweep = setInterval(() => this._sweep(), checkIntervalMs);
    this.sweep.unref();
  }

  _allowed(raw) {
    try {
      const url = new URL(raw);
      if (this.allowLocal && [this.upstream.origin, this.upstream.baseUrl].map((value) => new URL(value).origin).includes(url.origin)) return true;
      return url.protocol === 'https:' && !url.port && !url.username && !url.password && HOSTS.has(url.hostname);
    } catch { return false; }
  }

  _alive(session) {
    if (TERMINAL.has(session.status)) return false;
    if (this.closed || !this.auth.isAdmin(session.owner)) this._finish(session, 'cancelled');
    else if (Date.now() >= session.expiresAt) this._finish(session, 'expired');
    return !TERMINAL.has(session.status);
  }

  _sweep() {
    for (const [state, session] of this.sessions) {
      this._alive(session);
      if (session.endedAt && Date.now() - session.endedAt >= 300000) this.sessions.delete(state);
    }
  }

  _finish(session, status, extra = {}) {
    if (TERMINAL.has(session.status)) return session.cleanup;
    Object.assign(session, extra, { status, endedAt: Date.now(), url: undefined });
    session.abort.abort();
    clearInterval(session.poll);
    const browser = session.browser;
    session.proxy?.close();
    session.proxy = undefined;
    session.browser = session.context = session.page = undefined;
    session.cleanup = browser ? browser.close().catch(() => {}) : Promise.resolve();
    return session.cleanup;
  }

  _view(session) {
    const { state, status, expiresAt, account, error, url } = session;
    return { state, status, expiresAt, ...(account ? { account } : {}), ...(error ? { error } : {}), ...(url ? { url } : {}) };
  }

  _find(state, token, kind) {
    const session = this.sessions.get(state);
    if (!session || !sameToken(kind === 'owner' ? session.owner : session.viewer, token)) throw problem(404, 'Login link is invalid or expired');
    this._alive(session);
    if (!this.auth.isAdmin(session.owner)) throw problem(404, 'Login link is invalid or expired');
    return session;
  }

  async start(owner, metadata = {}) {
    if (!this.auth.isAdmin(owner)) throw problem(401, 'Unauthorized');
    if (!this.config.enabled || this.closed) throw problem(503, 'Browser login is disabled');
    if (!this.allowLocal && (new URL(this.upstream.origin).origin !== 'https://deepai.org' || this.upstream.baseUrl !== 'https://api.deepai.org')) {
      throw problem(503, 'Browser login requires the official DeepAI site');
    }
    this._sweep();
    if ([...this.sessions.values()].filter((session) => !TERMINAL.has(session.status) || session.launching).length >= this.config.maxSessions || this.sessions.size >= 80) {
      throw problem(429, 'Too many login sessions; cancel an open login or try again later');
    }
    const executablePath = browserPath(this.config.executablePath);
    if (!executablePath && !this.launch) throw problem(503, 'Chrome, Edge or Chromium was not found. Set BROWSER_EXECUTABLE_PATH.');
    const state = randomBytes(24).toString('base64url');
    const viewer = randomBytes(32).toString('base64url');
    const session = { state, viewer, owner, metadata, status: 'starting', expiresAt: Date.now() + this.config.ttlMs, abort: new AbortController(), deviceId: randomDeviceId(), launching: true };
    this.sessions.set(state, session);
    session.startup = this._open(session, executablePath).finally(() => { session.launching = false; });
    return { ...this._view(session), authUrl: `/login.html#state=${state}&token=${viewer}` };
  }

  async _open(session, executablePath) {
    try {
      const launch = this.launch || ((options) => require('playwright-core').chromium.launch(options));
      const proxy = this.allowLocal || this.launch ? null : await openLoginProxy();
      if (!this._alive(session)) { proxy?.close(); return; }
      session.proxy = proxy;
      const browser = await launch({ executablePath, headless: true, timeout: 20000,
        ...(proxy ? { proxy: { server: proxy.server } } : {}),
        args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
      if (!this._alive(session)) { await browser.close(); return; }
      session.browser = browser;
      browser.on('disconnected', () => this._finish(session, 'failed', { error: 'The isolated browser closed. Generate another login link.' }));
      const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, acceptDownloads: false, serviceWorkers: 'block' });
      if (!this._alive(session)) return;
      session.context = context;
      context.setDefaultTimeout(5000);
      await context.route('**/*', (route) => (this._allowed(route.request().url()) ? route.continue() : route.abort()).catch(() => {}));
      await context.routeWebSocket('**/*', (socket) => socket.close());
      context.on('page', (page) => {
        session.page = page;
        page.on('close', () => { if (session.page === page) session.page = context.pages().filter((candidate) => candidate !== page && !candidate.isClosed()).at(-1); });
      });
      const page = await context.newPage();
      if (!this._alive(session)) return;
      session.page = page;
      await page.goto(new URL('/', this.upstream.origin).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!this._alive(session)) return;
      if (this._allowed(page.url())) await page.evaluate(() => { if (typeof openLogin === 'function') openLogin(); }).catch(() => {});
      if (!this._alive(session)) return;
      session.status = 'waiting';
      session.poll = setInterval(() => { void this._poll(session); }, this.checkIntervalMs);
      session.poll.unref();
    } catch {
      this._finish(session, 'failed', { error: 'Could not open DeepAI in the isolated browser. Check Chromium and the gateway network, then retry.' });
    }
  }

  async _poll(session) {
    if (!this._alive(session) || session.status !== 'waiting' || session.checking) return;
    session.checking = true;
    try {
      // Only send cookies applicable to the API URL, and only the Django
      // session and CSRF pairs. Provider and tracking cookies stay in Chromium.
      const cookies = await session.context.cookies(`${this.upstream.baseUrl}/daily-time-sync/user/`);
      const primary = cookies.find(({ name, value }) => name === 'sessionid' && value);
      if (!primary || !this._alive(session)) return;
      const csrf = cookies.find(({ name, value }) => name === 'csrftoken' && value);
      const cookie = `sessionid=${primary.value}${csrf ? `; csrftoken=${csrf.value}` : ''}`;
      session.status = 'verifying';
      const result = await this.verifyUser(cookie, session.deviceId, { timeoutMs: 8000, signal: session.abort.signal });
      if (!this._alive(session)) return;
      const user = result.user;
      if (!result.ok || result.status !== 200 || !user || user.is_authenticated === false || !(user.id || user.pk || user.username || user.email)) return;
      try {
        const account = this.pool.captureBrowserAccount(cookie, user, session.metadata);
        this._finish(session, 'completed', { account: { id: account.id, name: account.name } });
      } catch {
        this._finish(session, 'failed', { error: 'DeepAI signed in, but the gateway could not save the account.' });
      }
    } catch {
      // An interrupted or temporarily rejected verification can retry while
      // the one-time login link is still valid.
    } finally {
      session.checking = false;
      if (session.status === 'verifying') session.status = 'waiting';
    }
  }

  getStatus(state, token, kind = 'owner') {
    const session = this._find(state, token, kind);
    const url = session.page?.url();
    session.url = this._allowed(url) ? new URL(url).origin : undefined;
    return this._view(session);
  }

  async _use(state, token, task, mode, allowBack = false) {
    const session = this._find(state, token, 'viewer');
    if (TERMINAL.has(session.status)) throw problem(410, 'Login session is closed');
    if (!session.page || session.status === 'starting') throw problem(409, 'The isolated browser is still starting');
    const url = session.page.url();
    if (!allowBack && (!this._allowed(url) || (!this.allowLocal && !LOGIN_HOSTS.has(new URL(url).hostname)))) throw problem(409, 'The browser is waiting for the DeepAI login page');
    if (session[mode]) throw problem(429, 'Another browser operation is still running');
    session[mode] = true;
    try { return await task(session.page); }
    catch { throw problem(409, 'The login page is changing; try again'); }
    finally { session[mode] = false; }
  }

  frame(state, token) {
    return this._use(state, token, (page) => page.screenshot({ type: 'jpeg', quality: 65, timeout: 3500 }), 'framing');
  }

  input(state, token, event) {
    validateEvent(event);
    return this._use(state, token, async (page) => {
      if (event.type === 'click') await page.mouse.click(event.x, event.y);
      if (event.type === 'press') await page.keyboard.press(event.key);
      if (event.type === 'text') await page.keyboard.insertText(event.text);
      if (event.type === 'scroll') await page.mouse.wheel(0, event.deltaY);
      if (event.type === 'back') {
        if (page.context().pages().length > 1) await page.close();
        else await page.goBack({ waitUntil: 'commit', timeout: 5000 });
      }
      if (event.type === 'reload') await page.reload({ waitUntil: 'commit', timeout: 5000 });
    }, 'inputting', event.type === 'back');
  }

  async cancel(state, token, kind = 'owner') {
    const session = this._find(state, token, kind);
    await this._finish(session, 'cancelled');
    return this._view(session);
  }

  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    await Promise.allSettled([...this.sessions.values()].flatMap((session) => [this._finish(session, 'cancelled'), session.startup]));
    this.sessions.clear();
  }
}

module.exports = { BrowserLogin };
