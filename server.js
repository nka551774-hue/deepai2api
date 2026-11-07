'use strict';

/**
 * deepai2api — deepai.org chat reverse proxy with an OpenAI-compatible API,
 * an upstream account key pool and a web admin dashboard.
 *
 * Requires Node.js 22+. Chromium is used for interactive account login.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./src/config');
const { Store } = require('./src/store');
const { AccountPool } = require('./src/accountPool');
const { Auth } = require('./src/auth');
const { createOpenAIRoutes } = require('./src/openaiRoutes');
const { createAdminRoutes } = require('./src/adminRoutes');
const { BrowserLogin } = require('./src/browserLogin');
const { createBrowserLoginRoutes } = require('./src/browserLoginRoutes');
const { version } = require('./package.json');

function createServer(options = {}) {
  const store = options.store || new Store();
  const pool = options.pool || new AccountPool(store);
  const auth = options.auth || new Auth(store);
  const openai = createOpenAIRoutes(store, pool);
  const admin = createAdminRoutes(store, pool, auth);
  const browserLogin = options.browserLogin || new BrowserLogin({ pool, auth, config: CONFIG.browserLogin, upstream: CONFIG.upstream });
  const loginRoutes = createBrowserLoginRoutes(browserLogin, auth);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;

      if (await loginRoutes.handle(req, res, url)) return;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, x-admin-token, x-panel-token',
          'Access-Control-Max-Age': '86400',
        });
        return res.end();
      }

      if (pathname === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, uptime: process.uptime(), version }));
      }
      if (pathname === '/v1/models' && req.method === 'GET') {
        return openai.handleModels(req, res, auth);
      }
      if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && req.method === 'POST') {
        return await openai.handleChat(req, res, await readJsonBody(req));
      }
      if ((pathname === '/v1/images/generations' || pathname === '/images/generations') && req.method === 'POST') {
        return await openai.handleImages(req, res, await readJsonBody(req));
      }
      if (pathname.startsWith('/api/admin/') || pathname.startsWith('/panel/')) {
        return await admin.handle(req, res, pathname);
      }
      return serveStatic(req, res, pathname);
    } catch (err) {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        const status = err.status || (err instanceof URIError || err instanceof SyntaxError ? 400 : 500);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: status === 500 ? 'Internal server error' : err.message, type: status < 500 ? 'invalid_request_error' : 'server_error' } }));
        if (status === 500) console.error('[server] request failed:', err.message);
      } else {
        res.end();
      }
    }
  });
  server.closeBrowserLogin = () => browserLogin.close();
  server.on('close', () => { void server.closeBrowserLogin(); });
  return server;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readJsonBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        if (chunks.length) chunks.length = 0;
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { status: 400 })));
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  const decoded = decodeURIComponent(pathname);
  const rel = decoded === '/' ? '/index.html' : decoded;
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  const relative = path.relative(PUBLIC_DIR, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const loginHeaders = rel === '/login.html' ? {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    } : {};
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...loginHeaders });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function start() {
  const store = new Store();
  const pool = new AccountPool(store);
  // Environment seeding runs once per process, not when creating a test server.
  for (const seedKey of CONFIG.upstreamSeedKeys) {
    try { pool.addApiKeyAccount(seedKey, 'env-seed-key'); } catch { /* invalid or already present */ }
  }
  for (const seedCookie of CONFIG.accountSeedCookies) {
    try { pool.addCookieAccount(seedCookie, 'env-seed-cookie'); } catch { /* invalid or already present */ }
  }
  const server = createServer({ store, pool });
  server.listen(CONFIG.port, CONFIG.host, () => {
    const anonNote = (store.state.settings.allowAnonymousFallback ?? CONFIG.allowAnonymousFallback) ? 'enabled' : 'disabled';
    console.log(`[deepai2api] listening on http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`[deepai2api] dashboard: http://localhost:${CONFIG.port}/  (password from ADMIN_PASSWORD, default "deepai2api")`);
    console.log(`[deepai2api] OpenAI-compatible base URL: http://localhost:${CONFIG.port}/v1`);
    console.log(`[deepai2api] upstream accounts in pool: ${pool.list().length}; anonymous fallback: ${anonNote}`);
  });

  let closing = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      if (closing) return;
      closing = true;
      console.log(`[deepai2api] ${sig} received, flushing state…`);
      const stopBrowser = server.closeBrowserLogin();
      const finish = async () => { await stopBrowser; process.exit(store.flushSync() ? 0 : 1); };
      server.close(finish);
      server.closeIdleConnections?.();
      setTimeout(() => process.exit(store.flushSync() ? 0 : 1), 10000).unref();
    });
  }
}

if (require.main === module) start();

module.exports = { createServer, readJsonBody };
