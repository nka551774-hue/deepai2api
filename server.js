'use strict';

/**
 * deepai2api — deepai.org chat reverse proxy with an OpenAI-compatible API,
 * an upstream account key pool and a web admin dashboard.
 *
 * Zero runtime dependencies: requires Node.js 18+ only.
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

const store = new Store();
const pool = new AccountPool(store);
const auth = new Auth(store);
const openai = createOpenAIRoutes(store, pool);
const admin = createAdminRoutes(store, pool, auth);

// Seed accounts at boot (existing entries are kept).
// UPSTREAM_KEYS: legacy dashboard keys; ACCOUNT_COOKIES: browser session cookies.
for (const seedKey of CONFIG.upstreamSeedKeys) {
  try {
    pool._addAccount({ type: 'apikey', apiKey: seedKey, name: 'env-seed-key' });
  } catch { /* duplicate — ignore */ }
}
for (const seedCookie of CONFIG.accountSeedCookies) {
  try {
    pool.addCookieAccount(seedCookie, 'env-seed-cookie');
  } catch { /* malformed — ignore */ }
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
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  // CORS for API surfaces
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-admin-token',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    // ---- health ----------------------------------------------------------
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, uptime: process.uptime(), version: '1.0.0' }));
    }

    // ---- OpenAI-compatible API -------------------------------------------
    if (pathname === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(openai.modelList()));
    }

    if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && req.method === 'POST') {
      const body = await readJsonBody(req);
      return openai.handleChat(req, res, body);
    }

    if ((pathname === '/v1/images/generations' || pathname === '/images/generations') && req.method === 'POST') {
      const body = await readJsonBody(req);
      return openai.handleImages(req, res, body);
    }

    // ---- admin panel backend ---------------------------------------------
    if (pathname.startsWith('/api/admin/')) {
      return admin.handle(req, res, pathname);
    }

    // ---- dashboard ---------------------------------------------------------
    return serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message, type: 'server_error' } }));
    } else {
      res.end();
    }
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  const anonNote = CONFIG.allowAnonymousFallback ? 'enabled' : 'disabled';
  console.log(`[deepai2api] listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`[deepai2api] dashboard: http://localhost:${CONFIG.port}/  (password from ADMIN_PASSWORD, default "deepai2api")`);
  console.log(`[deepai2api] OpenAI-compatible base URL: http://localhost:${CONFIG.port}/v1`);
  console.log(`[deepai2api] upstream accounts in pool: ${pool.list().length}; anonymous fallback: ${anonNote}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[deepai2api] ${sig} received, flushing state…`);
    store.flushSync();
    process.exit(0);
  });
}
