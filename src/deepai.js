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
    const combined = combineAbortSignals(controller, opts.signal);
    const signal = combined.signal;

    let response;
    try {
      response = await fetch(`${CONFIG.upstream.baseUrl}${CONFIG.upstream.chatPath}`, {
        method: 'POST',
        body: this.buildChatForm(messages, opts),
        headers: this.headers(),
        signal,
        redirect: 'error',
      });
    } catch (err) {
      clearTimeout(timer);
      combined.cleanup();
      const aborted = translateAbort(err, opts.signal, timeoutMs);
      if (aborted) throw aborted;
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
          const finished = await this.waitForTask(task.task_id, signal);
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
      return finishParse(raw);
    } catch (err) {
      const aborted = translateAbort(err, opts.signal, timeoutMs);
      if (aborted) throw aborted;
      throw err;
    } finally {
      clearTimeout(timer);
      combined.cleanup();
    }
  }

  /**
   * Streamed read with incremental packet-free deltas.
   * Feeds onDelta(textDelta, fullText, thinkingDelta, fullThinking).
   */
  async readStream(response, opts = {}) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const txt = await response.text();
      if (opts.onDelta) {
        const parsed = StreamParser.parse(txt);
        if (parsed.thinkingText) safeOnDelta(opts.onDelta, '', '', parsed.thinkingText, parsed.thinkingText);
        if (parsed.text) safeOnDelta(opts.onDelta, parsed.text, parsed.text, '', parsed.thinkingText);
      }
      return txt;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let full = '';
    let emittedText = '';
    let emittedThinking = '';

    const emitCurrent = () => {
      if (!opts.onDelta) return;
      const p = StreamParser.parse(full);
      if (p.thinkingText.startsWith(emittedThinking) && p.thinkingText.length > emittedThinking.length) {
        const delta = p.thinkingText.slice(emittedThinking.length);
        emittedThinking = p.thinkingText;
        safeOnDelta(opts.onDelta, '', emittedText, delta, emittedThinking);
      }
      if (p.text.startsWith(emittedText) && p.text.length > emittedText.length) {
        const delta = p.text.slice(emittedText.length);
        emittedText = p.text;
        safeOnDelta(opts.onDelta, delta, emittedText, '', emittedThinking);
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      emitCurrent();
    }
    full += decoder.decode();
    // Final pass so trailing payload/images are visible to the caller.
    emitCurrent();
    return full;
  }

  /** GET /check_chat_task_status?type=&task_id= — one poll. */
  async taskStatus(taskId, type = 'thinking-task', signal = null) {
    const url = `${CONFIG.upstream.baseUrl}${CONFIG.upstream.taskStatusPath}?type=${encodeURIComponent(type)}&task_id=${encodeURIComponent(taskId)}`;
    const res = await fetch(url, { method: 'GET', headers: this.headers(), signal, redirect: 'error' });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) throw classifyRefusal(res.status, body);
    if (res.status > 299) throw httpUpstreamError(res.status, body);
    const data = safeJson(body);
    if (!data) throw new UpstreamError(`Task status not JSON: ${body.slice(0, 120)}`, { code: 'UPSTREAM_ERROR', retryable: true });
    return data;
  }

  /** Poll a background task until it completes or times out. */
  async waitForTask(taskId, signal) {
    const deadline = Date.now() + CONFIG.upstream.taskPollTimeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        last = await this.taskStatus(taskId, 'thinking-task', signal);
      } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') throw err;
        if (['QUOTA', 'BAD_KEY', 'LOGIN_REQUIRED', 'PLAN_REQUIRED', 'ABORTED'].includes(err.code)) throw err;
        last = null;
      }
      const status = String(last?.status || '').toUpperCase();
      if (status === 'COMPLETED' || status === 'COMPLETE' || status === 'SUCCESS') return last;
      if (status === 'FAILED' || status === 'ERROR')
        throw new UpstreamError(`Upstream task failed: ${last?.error || status}`, { code: 'TASK_FAILED' });
      await sleep(CONFIG.upstream.taskPollIntervalMs, signal);
    }
    throw new UpstreamError('Upstream task timed out', { code: 'TASK_TIMEOUT', retryable: true });
  }

  /**
   * Classic public API family: /api/<name> (e.g. text2img).
   * Buffers upload as file fields, everything else as form fields.
   */
  async runApi(name, fields = {}, opts = {}) {
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
    const timeoutMs = opts.timeoutMs || CONFIG.upstream.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combined = combineAbortSignals(controller, opts.signal);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        body: form,
        headers: this.headers(),
        signal: combined.signal,
        redirect: 'error',
      });
      let body = await res.text();
      let data = safeJson(body);

      // The /api/* family can refuse non-browser TLS stacks. Cascade to curl
      // only for transport-looking responses; curl must then produce valid
      // successful JSON before it replaces the original response.
      const tlsRefusal = /try this model on deepai\.org/i.test(body);
      if (tlsRefusal || (res.status <= 299 && data === null)) {
        const curlBody = await this.runApiViaCurl(url, fields, { timeoutMs, signal: combined.signal });
        if (curlBody !== null) {
          const curlData = safeJson(curlBody);
          if (curlData !== null) {
            body = curlBody;
            data = curlData;
            res = { status: 200 };
          }
        }
      }
      if (res.status === 401 || res.status === 403) throw classifyRefusal(res.status, body);
      if (res.status > 299) throw httpUpstreamError(res.status, body);
      if (data === null) throw classifyRefusal(res.status, String(body ?? ''));
      if (data.err) throw classifyRefusal(200, JSON.stringify(data));
      if (typeof data.status === 'string' && !data.share_url && !data.output_url && !data.output && !data.id)
        throw classifyRefusal(200, body);
      return data;
    } catch (err) {
      const aborted = translateAbort(err, opts.signal, timeoutMs);
      if (aborted) throw aborted;
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Upstream network error: ${err.message}`, { code: 'NETWORK', retryable: true });
    } finally {
      clearTimeout(timer);
      combined.cleanup();
    }
  }

  /** POST a multipart /api/* call through the system curl binary. */
  async runApiViaCurl(url, fields, opts = {}) {
    const { spawn } = require('child_process');
    // The fetch attempt already consumed the single-use tryit key: mint a
    // fresh one unless this client carries a real dashboard key.
    const h = this.headers();
    if (!this.apiKey) h['api-key'] = mintTryItKey(CONFIG.upstream.userAgent);
    const timeoutSeconds = Math.max(1, Math.ceil((opts.timeoutMs || CONFIG.upstream.timeoutMs) / 1000));
    const args = ['-s', '--max-time', String(timeoutSeconds), '-X', 'POST', url];
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
        const abort = () => {
          try {
            p.kill();
          } catch {
            /* process already ended */
          }
          resolve(null);
        };
        if (opts.signal?.aborted) return abort();
        opts.signal?.addEventListener('abort', abort, { once: true });
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (err += d));
        p.on('error', () => {
          opts.signal?.removeEventListener('abort', abort);
          resolve(null);
        });
        p.on('close', () => {
          opts.signal?.removeEventListener('abort', abort);
          resolve(out.trim() || null);
        });
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
function finishParse(raw, opts = {}) {
  const p = StreamParser.parse(raw);
  // JSON task results arrive as a complete body rather than through readStream.
  if (opts.onDelta) {
    if (p.thinkingText) safeOnDelta(opts.onDelta, '', '', p.thinkingText, p.thinkingText);
    if (p.text) safeOnDelta(opts.onDelta, p.text, p.text, '', p.thinkingText);
  }
  return { text: p.text, thinkingText: p.thinkingText, images: p.images, raw };
}

function safeOnDelta(onDelta, textDelta, fullText, thinkingDelta, fullThinking) {
  try {
    onDelta(textDelta, fullText, thinkingDelta, fullThinking);
  } catch {
    /* a broken consumer must not cancel or corrupt the upstream stream */
  }
}

function httpUpstreamError(status, body) {
  return new UpstreamError(`Upstream HTTP ${status}: ${String(body || '').slice(0, 200)}`, {
    code: 'UPSTREAM_ERROR',
    retryable: status >= 500 || status === 429,
    status,
    body,
  });
}

function combineAbortSignals(controller, externalSignal) {
  if (!externalSignal) return { signal: controller.signal, cleanup() {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([controller.signal, externalSignal]), cleanup() {} };
  }
  const forward = () => controller.abort();
  if (externalSignal.aborted) controller.abort();
  else externalSignal.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      externalSignal.removeEventListener('abort', forward);
    },
  };
}

function translateAbort(err, externalSignal, timeoutMs) {
  if (err?.name !== 'AbortError' && err?.code !== 'ABORTED') return null;
  if (externalSignal?.aborted) return new UpstreamError('Request cancelled', { code: 'ABORTED' });
  return new UpstreamError(`Upstream timed out after ${timeoutMs}ms`, { code: 'TIMEOUT', retryable: true });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
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
  let setCookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    setCookies = res.headers.getSetCookie();
  } else {
    const combined = res.headers.get?.('set-cookie');
    if (combined) setCookies = splitSetCookieHeader(combined);
  }
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) pairs.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return [...pairs.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function splitSetCookieHeader(value) {
  return String(value || '').split(/,(?=\s*[^=;,\s]+\s*=)/);
}

/**
 * Log in to deepai.org with email + password (the site's own login dialect:
 * POST /daily-time-sync/login/ with FormData username/password).
 *
 * @returns {Promise<{ok:boolean, status:number, cookie:string, body:string}>}
 */
async function loginAccount(email, password, opts = {}) {
  const base = { Origin: CONFIG.upstream.origin, Referer: `${CONFIG.upstream.origin}/`, 'User-Agent': CONFIG.upstream.userAgent };
  const timeoutMs = opts.timeoutMs || CONFIG.upstream.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = combineAbortSignals(controller, opts.signal);

  try {
    // Bootstrap: preflight the auth surface so the csrftoken cookie exists,
    // exactly like any page load before the login modal does.
    let priorCookie = '';
    try {
      const pre = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/user/`, {
        method: 'GET',
        headers: { ...base, 'api-key': mintTryItKey(CONFIG.upstream.userAgent), Accept: '*/*' },
        signal: combined.signal,
        redirect: 'error',
      });
      priorCookie = cookieFromResponse(pre);
    } catch (err) {
      if (combined.signal.aborted) throw err;
      /* proceed without preflight */
    }

    const form = new FormData();
    form.append('username', String(email || ''));
    form.append('password', String(password || ''));
    const res = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/login/`, {
      method: 'POST',
      body: form,
      headers: { ...base, Accept: '*/*', ...(priorCookie ? { Cookie: priorCookie } : {}) },
      signal: combined.signal,
      redirect: 'error',
    });
    const body = await res.text();
    const cookie = cookieFromResponse(res, priorCookie);
    if (!res.ok) {
      return { ok: false, status: res.status, cookie, body: body.slice(0, 300) };
    }
    return { ok: true, status: res.status, cookie, body: body.slice(0, 300) };
  } catch (err) {
    const aborted = translateAbort(err, opts.signal, timeoutMs);
    if (aborted) throw aborted;
    throw err;
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
}

/**
 * Query the logged-in user object (GET /daily-time-sync/user/).
 * @returns {Promise<{ok:boolean, user:object|null, status:number}>}
 */
async function fetchUser(cookie, deviceId, opts = {}) {
  const client = new DeepAIClient({ cookie, deviceId });
  const timeoutMs = opts.timeoutMs || CONFIG.upstream.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = combineAbortSignals(controller, opts.signal);
  try {
    const res = await fetch(`${CONFIG.upstream.baseUrl}/daily-time-sync/user/`, {
      method: 'GET',
      headers: client.headers(),
      signal: combined.signal,
      redirect: 'error',
    });
    const body = await res.text();
    let user = null;
    try {
      user = JSON.parse(body);
    } catch {
      /* not JSON */
    }
    return { ok: res.ok && Boolean(user), user, status: res.status };
  } catch (err) {
    const aborted = translateAbort(err, opts.signal, timeoutMs);
    if (aborted) throw aborted;
    throw err;
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
}

module.exports = { DeepAIClient, UpstreamError, classifyRefusal, detectJsonStatus, loginAccount, fetchUser, cookieFromResponse };
