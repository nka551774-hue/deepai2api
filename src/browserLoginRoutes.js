'use strict';

const ADMIN_PREFIX = '/api/admin/accounts/login/';
const VIEWER_PREFIX = '/api/account-login/';

function createBrowserLoginRoutes(manager, auth) {
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  }
  return {
    async handle(req, res, url) {
      const admin = url.pathname.startsWith(ADMIN_PREFIX);
      if (!admin && !url.pathname.startsWith(VIEWER_PREFIX)) return false;
      try {
        // These routes have no CORS surface. In particular, viewer tokens never
        // travel in URLs, and cannot authorize any administrative action.
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw error(403, 'Cross-origin login request rejected'); }
          if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw error(403, 'Cross-origin login request rejected');
          if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw error(403, 'Browser login requires HTTPS or localhost');
        }
        const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        const token = admin
          ? bearer || String(req.headers['x-admin-token'] || req.headers['x-panel-token'] || '')
          : String(req.headers['x-login-token'] || '');
        if (!token || (admin && !auth.isAdmin(token))) throw error(401, 'Unauthorized');
        const action = url.pathname.slice((admin ? ADMIN_PREFIX : VIEWER_PREFIX).length);
        const kind = admin ? 'owner' : 'viewer';
        if (admin && action === 'start' && req.method === 'POST') {
          const body = await readBody(req);
          const metadata = {};
          for (const key of ['name', 'group']) {
            if (!Object.hasOwn(body, key)) continue;
            if (typeof body[key] !== 'string' || body[key].length > 200) throw error(400, `${key} must be a string up to 200 characters`);
            metadata[key] = body[key].trim();
          }
          if (Object.hasOwn(body, 'weight')) {
            if (!Number.isInteger(body.weight) || body.weight < 1 || body.weight > 100) throw error(400, 'weight must be an integer from 1 to 100');
            metadata.weight = body.weight;
          }
          json(res, 200, await manager.start(token, metadata));
        } else if (action === 'status' && req.method === 'GET') {
          json(res, 200, await manager.getStatus(stateOf(url.searchParams.get('state')), token, kind));
        } else if (action === 'cancel' && req.method === 'POST') {
          const body = await readBody(req);
          json(res, 200, await manager.cancel(stateOf(body.state), token, kind));
        } else if (!admin && action === 'frame' && req.method === 'GET') {
          const frame = await manager.frame(stateOf(url.searchParams.get('state')), token);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
          res.end(frame);
        } else if (!admin && action === 'input' && req.method === 'POST') {
          const body = await readBody(req);
          await manager.input(stateOf(body.state), token, body.event);
          json(res, 200, { ok: true });
        } else {
          json(res, 404, { error: 'Unknown login endpoint' });
        }
      } catch (err) {
        const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
        json(res, status, { error: status === 500 ? 'Login session failed' : err.message });
      }
      return true;
    },
  };
}

function error(status, message) { return Object.assign(new Error(message), { status }); }
function stateOf(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw error(400, 'Invalid login state');
  return value;
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw error(413, 'Login request too large');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw error(400, 'Malformed JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'JSON object required');
  return body;
}

module.exports = { createBrowserLoginRoutes };
