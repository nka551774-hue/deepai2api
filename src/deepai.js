'use strict';

/**
 * Upstream transport for the deepai.org chat API, replicating the browser
 * client's request dialect:
 *
 *   POST https://api.deepai.org/hacking_is_a_serious_crime
 *        multipart/form-data, header `api-key`
 *        chat_style, chatHistory, model, hacker_is_stinky, session_uuid,
 *        tool_activity_support, thinking_image_tool_support, enabled_tools,
 *        web_access_enabled …
 *        -> streamed UTF-8 text with embedded packets (see streamParser)
 *        or {"task_id":…} for async reasoning, or {"status":…} refusals
 *
 * Every request needs a per-account identity (session uuid + device cookie) —
 * the pool in accountPool.js manages those.
 *
 * Account identity on deepai.org is cookie-based, not key-based: the browser
 * always sends a freshly minted single-use tryit key in `api-key` plus the
 * logged-in session cookies via credentials:'include'. The gateway mirrors
 * that: each account stores its cookie jar; `api-key` is a per-request
 * minted tryit key (unless the account carries a real dashboard key).
 */
const { CONFIG } = require('./config');
const { StreamParser } = require('./streamParser');
const { uuid, isTryItKey, mintTryItKey } = require('./islandHash');

class UpstreamError extends Error {
  constructor(message, { code = 'UPSTREAM_ERROR', retryable = false, status = 0, body = null } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.body = body;
  }
}

/** Classify an upstream refusal body/JSON status. */
function classifyRefusal(status, body) {
  const s = String(status || '');
  const b = String(body || '');
  const together = `${s} ${b}`;
  if (/try this model on deepai\.org/i.test(together))
    return new UpstreamError('Upstream refused this client for this model', { code: 'UPSTREAM_REJECTED', retryable: true, status });
  if (/insufficient_credit|out of credit|need more credit|add credit|quota|monthly.*limit|rate.?limit|too many request/i.test(together))
    return new UpstreamError('Upstream account is out of credits / rate limited', { code: 'QUOTA', retryable: true, status });
  if (/only available.*logged.?in|login.*required|please.*log.?in|sign.?up/i.test(together))
    return new UpstreamError('Model requires a logged-in upstream account', { code: 'LOGIN_REQUIRED', retryable: false, status });
  if (/pro member|upgrade|subscription/i.test(together))
    return new UpstreamError('Upstream account plan does not cover this model', { code: 'PLAN_REQUIRED', retryable: false, status });
  if (/invalid.*key|unauthorized|forbidden|not.*permitted/i.test(together))
    return new UpstreamError('Upstream rejected the key', { code: 'BAD_KEY', retryable: false, status });
  return new UpstreamError(`Upstream refusal: ${s || b.slice(0, 200)}`, { code: 'REFUSED', retryable: true, status });
}

/** Detect a short JSON refusal body delivered with HTTP 200. */
function detectJsonStatus(raw) {
  const t = String(raw ?? '').trim();
  if (t.length > 512 || !t.startsWith('{')) return null;
  try {
    const data = JSON.parse(t);
    if (typeof data.status === 'string' && data.status) return data;
  } catch {
    /* not JSON */
  }
  return null;
}

class DeepAIClient {
  /**
   * @param {object} account
   * @param {string} [account.apiKey]    real dashboard key; omitted → per-request tryit key
   * @param {string} [account.cookie]    logged-in session cookie header ("a=b; c=d")
   * @param {string} [account.deviceId]  stable deepai_device_id cookie value
   */
  constructor(account) {
    this.apiKey = account.apiKey || null;
    this.cookie = account.cookie || '';
    this.deviceId = account.deviceId || null;
    this.sessionUuid = uuid();
  }

  /** Full Cookie header: account session cookies + the device id joined in. */
  cookieHeader() {
    const parts = [];
    const c = String(this.cookie || '').trim();
    if (c) parts.push(c);
    if (this.deviceId && !c.includes('deepai_device_id=')) {
      parts.push(`deepai_device_id=${this.deviceId}`);
    }
    const lang = CONFIG.upstream.language;
    if (lang && !c.includes('deepai_lang=')) {
      parts.push(`deepai_lang=${lang}`);
    }
    return parts.join('; ');
  }

  /**
   * Browser-identical headers. The upstream chat surface never sees a
   * persistent account key: the browser sends a fresh single-use tryit key
   * per request (hash-validated against this UA) plus session cookies.
   */
  headers() {
    const lang = CONFIG.upstream.language;
    return {
      'api-key': this.apiKey || mintTryItKey(CONFIG.upstream.userAgent),
      Origin: CONFIG.upstream.origin,
      Referer: `${CONFIG.upstream.origin}/`,
      'User-Agent': CONFIG.upstream.userAgent,
      Accept: '*/*',
      ...(lang && lang !== 'en' ? { 'X-DeepAI-Language': lang } : {}),
      ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
    };
  }

  /**
   * Exactly the form the browser posts.
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} opts { model, webAccess, sessionId (stable per conversation) }
   */
  buildChatForm(messages, opts = {}) {
    const form = new FormData();
    form.append('chat_style', 'chat');
    form.append('chatHistory', JSON.stringify(messages));
    form.append('model', opts.model || 'standard');
    form.append('hacker_is_stinky', 'very_stinky');
    form.append('session_uuid', opts.sessionUuid || this.sessionUuid);
    form.append('tool_activity_support', '1');
    form.append('thinking_image_tool_support', '1');
    form.append('enabled_tools', JSON.stringify(['image_generator', 'image_editor']));
    if (opts.webAccess) form.append('web_access_enabled', 'true');
    return form;
  }

  /**
   * Run one chat turn.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} opts
   * @param {string} opts.model                  upstream model id
   * @param {boolean} [opts.webAccess]
   * @param {string} [opts.sessionUuid]          stable conversation uuid
   * @param {boolean} [opts.stream=false]        call onDelta while text arrives
   * @param {(deltaText:string, fullText:string, deltaThinking:string, full Thinking:string)=>void} [opts.onDelta]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{text:string, thinkingText:string, images:string[], model:string}>}
   */
  async chat(messages, opts = {}) {
    const timeoutMs = opts.timeoutMs || CONFIG.upstream.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts.signal
      ? AbortSignal.any ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal
      : controller.signal;

    let response;
    try {
      response = await fetch(`${CONFIG.upstream.baseUrl}${CONFIG.upstream.chatPath}`, {
        method: 'POST',
        body: this.buildChatForm(messages, opts),
        headers: this.headers(),
        signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (opts.signal?.aborted) throw new UpstreamError('Request cancelled', { code: 'ABORTED' });
        throw new UpstreamError(`Upstream timed out after ${timeoutMs}ms`, { code: 'TIMEOUT', retryable: true });
      }
      throw new UpstreamError(`Upstream network error: ${err.message}`, { code: 'NETWORK', retryable: true });
    }

    try {
      if (response.status === 401 || response.status === 403) {
        const body = await response.text();
        throw classifyRefusal(response.status, body);
      }
      if (response.status > 299) {
        const body = await response.text();
        throw new UpstreamError(`Upstream HTTP ${response.status}: ${body.slice(0, 200)}`, {
          code: 'UPSTREAM_ERROR',
          retryable: response.status >= 500 || response.status === 429,
          status: response.status,
        });
      }

      // Async reasoning path: {"task_id": "..."} answered by polling.
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await response.text();
        const task = safeJson(body);
        if (task?.task_id) {
          const finished = await this.waitForTask(task.task_id, opts.signal);
          const raw = taskText(finished);
          const status = detectJsonStatus(raw);
          if (status) throw classifyRefusal(200, raw);
          return finishParse(raw, opts);
        }
        if (task?.status) throw classifyRefusal(200, body);
        // Some refusals keep the content-type but hold plain text.
        return finishParse(body, opts);
      }

      const raw = await this.readStream(response, opts);
      const status = detectJsonStatus(raw);
      if (status) throw classifyRefusal(200, raw);
      return finishParse(raw, opts);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Streamed read with incremental packet-free deltas.
   * Feeds onDelta(textDelta, fullText, thinkingDelta, fullThinking).
   */
  async readStream(response, opts = {}) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const txt = await response.text();
      if (opts.onDelta) emitParsed(txt, '', opts); // single shot for bodyless fetch impls
      return txt;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let full = '';
    let emittedText = '';
    let emittedThinking = '';
    let thinkingDirty = false;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      const p = StreamParser.parse(full);
      if (opts.onDelta) {
        if (p.thinkingText.length > 0 || thinkingDirty) {
          if (p.thinkingText !== emittedThinking) {
            const delta = p.thinkingText.startsWith(emittedThinking)
              ? p.thinkingText.slice(emittedThinking.length)
              : p.thinkingText;
            thinkingDirty = true;
            emittedThinking = p.thinkingText;
            try {
              opts.onDelta(delta, emittedText, p.thinkingText);
            } catch {
              /* broken consumer must not kill the stream */
            }
          }
        }
        if (p.text.length > emittedText.length) {
          const delta = p.text.slice(emittedText.length);
          emittedText = p.text;
          try {
            opts.onDelta(delta, emittedText, emittedThinking);
          } catch {
            /* ignore */
          }
        }
      }
    }
    full += decoder.decode();
    // Final pass so trailing payload/images are visible to the caller.
    if (opts.onDelta) emitParsed(full, emittedText, opts);
    return full;
  }

  /** GET /check_chat_task_status?type=&task_id= — one poll. */
  async taskStatus(taskId, type = 'thinking-task') {
    const url = `${CONFIG.upstream.baseUrl}${CONFIG.upstream.taskStatusPath}?type=${encodeURIComponent(type)}&task_id=${encodeURIComponent(taskId)}`;
    const res = await fetch(url, { method: 'GET', headers: this.headers(), signal: this.abortSignal });
    const body = await res.text();
    const data = safeJson(body);
    if (!data) throw new UpstreamError(`Task status not JSON: ${body.slice(0, 120)}`, { code: 'UPSTREAM_ERROR', retryable: true });
    return data;
  }

  /** Poll a background task until it completes or times out. */
  async waitForTask(taskId, signal) {
    const deadline = Date.now() + CONFIG.upstream.taskPollTimeoutMs;
    let last = null;
    this.abortSignal = signal || null;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new UpstreamError('Task polling cancelled', { code: 'ABORTED' });
      try {
        last = await this.taskStatus(taskId);
      } catch (err) {
        if (err.code === 'QUOTA' || err.code === 'BAD_KEY') throw err;
        last = null;
      }
      const status = String(last?.status || '').toUpperCase();
      if (status === 'COMPLETED' || status === 'COMPLETE' || status === 'SUCCESS') return last;
      if (status === 'FAILED' || status === 'ERROR')
        throw new UpstreamError(`Upstream task failed: ${last?.error || status}`, { code: 'TASK_FAILED' });
      await sleep(CONFIG.upstream.taskPollIntervalMs);
    }
    throw new UpstreamError('Upstream task timed out', { code: 'TASK_TIMEOUT', retryable: true });
  }

  /**
   * Classic public API family: /api/<name> (e.g. text2img).
   * Buffers upload as file fields, everything else as form fields.
   */
  async runApi(name, fields = {}) {
    const url = `${CONFIG.upstream.baseUrl}/api/${String(name).replace(/^\/+/, '')}`;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields || {})) {
      if (v == null) continue;
      if (typeof v === 'object' && !(v instanceof Blob)) {
        form.append(k, JSON.stringify(v));
      } else {
        form.append(k, v);
      }
    }
    const res = await fetch(url, { method: 'POST', body: form, headers: this.headers() });
    let body = await res.text();
    // The /api/* family refuses non-browser TLS stacks ("try this model on
    // deepai.org"); retrying the same call through system curl usually
    // passes, so cascade transports instead of failing.
    let data = safeJson(body);
    if (res.status > 299 || data === null || /try this model on deepai\.org/i.test(body)) {
      const curlBody = await this.runApiViaCurl(url, fields);
      if (curlBody !== null) {
        body = curlBody;
        data = safeJson(body);
      }
    }
    if (res.status > 299 && data === null && body === null) throw classifyRefusal(res.status, body ?? '');
    if (data === null) throw classifyRefusal(res.status, String(body ?? ''));
    if (data.err) throw classifyRefusal(200, JSON.stringify(data));
    if (typeof data.status === 'string' && !data.share_url && !data.output_url && !data.output && !data.id)
      throw classifyRefusal(200, body);
    return data;
  }

  /** POST a multipart /api/* call through the system curl binary. */
  async runApiViaCurl(url, fields) {
    const { spawn } = require('child_process');
    // The fetch attempt already consumed the single-use tryit key: mint a
    // fresh one unless this client carries a real dashboard key.
    const h = this.headers();
    if (!this.apiKey) h['api-key'] = mintTryItKey(CONFIG.upstream.userAgent);
    const args = ['-s', '--max-time', '120', '-X', 'POST', url];
    for (const [k, v] of Object.entries(h)) args.push('-H', `${k}: ${v}`);
    for (const [k, v] of Object.entries(fields || {})) {
      if (v == null) continue;
      args.push('-F', `${k}=${String(typeof v === 'object' && !(v instanceof Blob) ? JSON.stringify(v) : v)}`);
    }
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      try {
        const p = spawn('curl', args);
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (err += d));
        p.on('error', () => resolve(null));
        p.on('close', () => resolve(out.trim() || null));
      } catch {
        resolve(null);
      }
    });
  }
}

function safeJson(t) {
  try {
    return JSON.parse(String(t ?? '').trim());
  } catch {
    return null;
  }
}

function taskText(task) {
  if (typeof task?.result === 'string') return task.result;
  if (typeof task?.text === 'string') return task.text;
  if (typeof task?.output === 'string') return task.output;
  if (typeof task?.response === 'string') return task.response;
  return JSON.stringify(task ?? '');
}

/** Parse a completed body into the gateway result shape. */
function finishParse(raw, opts) {
  const p = StreamParser.parse(raw);
  return { text: p.text, thinkingText: p.thinkingText, images: p.images, raw };
}

function emitParsed(full, emittedText, opts) {
  const p = StreamParser.parse(full);
  if (p.text.length > emittedText.length) {
    opts.onDelta(p.text.slice(emittedText.length), p.text, p.thinkingText);
  } else if (p.text !== emittedText && emittedText === '') {
    opts.onDelta(p.text, p.text, p.thinkingText);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
//  Account auth (deepai.org session is cookie-based)
// ============================================================================

/** Collect Set-Cookie pairs from a response as "a=b; c=d". */
function cookieFromResponse(res, prior = '') {
  const pairs = new Map();
  for (const c of String(prior || '').split(/;\s*/)) {
    const i = c.indexOf('=');
    if (i > 0) pairs.set(c.slice(0, i).trim(), c.slice(i + 1).trim());
  }
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) pairs.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return [...pairs.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Log in to deepai.org with email + password (the site's own login dialect:
 * POST /daily-time-sync/login/ with FormData username/password).
 *
 * @returns {Promise<{ok:boolean, status:number, cookie:string, body:string}>}
 */
async function loginAccount(email, password) {
  const base = { Origin: CONFIG.upstream.origin, Referer: `${CONFIG.upstream.origin}/`, 'User-Agent': CONFIG.upstream.userAgent };

  // Bootstrap: preflight the auth surface so the csrftoken cookie exists,
  // exactly like any page load before the login modal does.
  let priorCookie = '';
  try {
    const pre = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/user/`, {
      method: 'GET',
      headers: { ...base, 'api-key': mintTryItKey(CONFIG.upstream.userAgent), Accept: '*/*' },
    });
    priorCookie = cookieFromResponse(pre);
  } catch {
    /* proceed without preflight */
  }

  const form = new FormData();
  form.append('username', String(email || ''));
  form.append('password', String(password || ''));
  const res = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/login/`, {
    method: 'POST',
    body: form,
    headers: { ...base, Accept: '*/*', ...(priorCookie ? { Cookie: priorCookie } : {}) },
  });
  const body = await res.text().catch(() => '');
  const cookie = cookieFromResponse(res, priorCookie);
  if (!res.ok) {
    return { ok: false, status: res.status, cookie, body: body.slice(0, 300) };
  }
  return { ok: true, status: res.status, cookie, body: body.slice(0, 300) };
}

/**
 * Query the logged-in user object (GET /daily-time-sync/user/).
 * @returns {Promise<{ok:boolean, user:object|null, status:number}>}
 */
async function fetchUser(cookie, deviceId) {
  const client = new DeepAIClient({ cookie, deviceId });
  const res = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/user/`, {
    method: 'GET',
    headers: client.headers(),
  });
  const body = await res.text().catch(() => '');
  let user = null;
  try {
    user = JSON.parse(body);
  } catch {
    /* not JSON */
  }
  return { ok: res.ok && Boolean(user), user, status: res.status };
}

module.exports = { DeepAIClient, UpstreamError, classifyRefusal, detectJsonStatus, loginAccount, fetchUser, cookieFromResponse };
