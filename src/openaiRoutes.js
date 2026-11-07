'use strict';

/**
 * OpenAI-compatible API surface.
 *
 *   GET  /v1/models
 *   POST /v1/chat/completions      (stream & non-stream)
 *   POST /v1/images/generations    (upstream /api/text2img)
 */
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { extractCredential, Auth, modelAllowed } = require('./auth');

/**
 * @param {import('./store').Store} store
 * @param {import('./accountPool').AccountPool} pool
 */
function createOpenAIRoutes(store, pool) {
  const settings = () => store.state.settings;
  const auth = new Auth(store);

  function modelList() {
    const map = settings().modelMap || {};
    const ids = Object.keys(map);
    const now = Math.floor(Date.now() / 1000);
    return {
      object: 'list',
      data: ids.map((id) => ({
        id,
        object: 'model',
        created: now,
        owned_by: 'deepai2api',
      })),
    };
  }

  /** Map a client-facing model name to the upstream model id. */
  function resolveModel(name) {
    const map = settings().modelMap || {};
    if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
    if (settings().passThroughModels && name && !name.startsWith('deepai-')) return name; // pass-through
    return map['deepai-standard'] || 'standard';
  }

  /** Convert OpenAI messages to the upstream chatHistory dialect. */
  function toChatHistory(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter((m) => m && typeof m.content !== 'undefined')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' || m.role === 'developer' ? 'system' : 'user',
        content: typeof m.content === 'string' ? m.content : flattenContent(m.content),
      }))
      .filter((m) => m.content.trim() !== '');
  }

  function flattenContent(content) {
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return typeof part.text === 'string' ? part.text : '';
          if (part?.type === 'image_url') return '[image attached — not supported by this gateway]';
          return '';
        })
        .join('\n')
        .trim();
    }
    if (content && typeof content === 'object') return typeof content.text === 'string' ? content.text : '';
    return String(content ?? '');
  }

  function estimateTokens(chars) {
    return Math.max(1, Math.ceil((chars || 0) / 4));
  }

  function authError(res, message, status = 401, code = 'invalid_api_key') {
    return jsonError(res, status, message, code);
  }

  /** Shared gateway-key gate. Returns the gateway entry (or null for open mode). */
  function gate(req, res, model, consume = true) {
    const credential = extractCredential(req.headers);
    const { entry, open } = auth.resolveGatewayKey(credential);
    if (!open) return authError(res, 'Invalid API key', 401), null;
    if (!entry) return { id: null, name: 'open-mode', models: [], accountIds: [] };
    if (!entry.enabled) return authError(res, 'API key has been disabled', 403), null;
    if (model && !modelAllowed(entry.models || [], model)) {
      return authError(res, `Model ${model} is not allowed for this API key`, 403, 'model_not_allowed'), null;
    }
    if (consume && entry.requestLimit > 0 && entry.uses >= entry.requestLimit) {
      return authError(res, 'Request limit reached for this API key', 429, 'rate_limit_exceeded'), null;
    }
    if (consume) {
      // Reserve synchronously so concurrent requests cannot exceed the limit.
      entry.uses = (entry.uses || 0) + 1;
      entry.lastUsedAt = new Date().toISOString();
      store.save();
    }
    return entry;
  }

  function recordUse(entry, model, ok, chars) {
    const statsKey = entry?.id || 'open-mode';
    store.bumpStats({ model, gatewayKey: statsKey, ok, chars });
  }

  function handleModels(req, res, panelAuth) {
    const panelToken = req.headers['x-panel-token'] || req.headers['x-admin-token'] || extractCredential(req.headers);
    let entry;
    if (!panelAuth?.isAdmin(panelToken)) {
      entry = gate(req, res, null, false);
      if (!entry) return;
    }
    const models = modelList();
    if (entry?.models?.length) models.data = models.data.filter((m) => modelAllowed(entry.models, m.id));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(models));
  }

  // ---------------------------------------------------------------- chat

  async function handleChat(req, res, body) {
    const payload = typeof body === 'object' ? body : safeJson(body);
    if (!payload || !Array.isArray(payload.messages) || !payload.messages.length) {
      return jsonError(res, 400, '`messages` must be a non-empty array');
    }
    if (payload.model !== undefined && typeof payload.model !== 'string') return jsonError(res, 400, '`model` must be a string');
    if (payload.session_key !== undefined && typeof payload.session_key !== 'string') return jsonError(res, 400, '`session_key` must be a string');
    if (payload.stream !== undefined && typeof payload.stream !== 'boolean') return jsonError(res, 400, '`stream` must be a boolean');
    const history = toChatHistory(payload.messages);
    if (!history.length) return jsonError(res, 400, '`messages` must contain non-empty content');
    const clientModel = String(payload.model || settings().defaultModel || 'deepai-standard');
    const entry = gate(req, res, clientModel);
    if (entry === null) return;

    // model allowlist on gateway key uses the client-facing name
    const upstreamModel = resolveModel(clientModel);
    const stream = Boolean(payload.stream);
    const webAccess = Boolean(payload.web_access || payload.webSearch || false);

    // stable upstream identity per conversation
    const firstUser = history.findIndex((m) => m.role === 'user');
    const anchor = history.slice(0, firstUser < 0 ? 1 : firstUser + 1);
    const identity = payload.session_key ? ['explicit', payload.session_key] : ['history', anchor];
    const sessionKey = hashOf([entry.id || 'open-mode', identity], clientModel);

    const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const created = Math.floor(Date.now() / 1000);
    const startedAt = Date.now();

    const logCtx = {
      kind: '/v1/chat/completions',
      model: clientModel,
      upstreamModel,
      gatewayKey: entry.name || entry.key?.slice(0, 12) || entry.id || 'open-mode',
      stream,
      messages: history.length,
      preview: history[history.length - 1].content.slice(0, CONFIG.logBodyPreview),
      status: 'pending',
    };
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);

    try {
      if (!stream) {
        try {
          const result = await pool.chat(history, { model: upstreamModel, webAccess, sessionKey, accountIds: entry.accountIds || [], signal: controller.signal, timeoutMs: settings().requestTimeoutMs });
          let content = result.text;
          if (result.images && result.images.length) {
            content += '\n\n' + result.images.map((u) => `![generated image](${u})`).join('\n');
          }
          const promptTokens = estimateTokens(JSON.stringify(history).length);
          const completionTokens = estimateTokens(content.length);
          const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
          recordUse(entry, clientModel, true, content.length);
          logCtx.status = 'ok';
          logCtx.latencyMs = Date.now() - startedAt;
          logCtx.upstream = result.upstreamAnonymous ? 'anonymous' : result.upstreamKeyId;
          logCtx.chars = content.length;
          store.addLog(logCtx);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(
            JSON.stringify({
              id,
              object: 'chat.completion',
              created,
              model: clientModel,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content, ...(result.thinkingText ? { reasoning_content: result.thinkingText } : {}) },
                  finish_reason: 'stop',
                },
              ],
              usage,
            })
          );
        } catch (err) {
          recordUse(entry, clientModel, false, 0);
          logCtx.status = 'error';
          logCtx.error = String(err.message || err.code || err);
          logCtx.latencyMs = Date.now() - startedAt;
          store.addLog(logCtx);
          jsonError(res, 502, `Upstream error: ${err.message}`, err.code || 'upstream_error');
        }
        return;
      }

      // ---- streaming ---------------------------------------------------------
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const baseChunk = (delta, finish = null) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model: clientModel,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });

      try {
        send(baseChunk({ role: 'assistant', content: '' }));

        const result = await pool.chat(history, {
          model: upstreamModel,
          webAccess,
          sessionKey,
          accountIds: entry.accountIds || [],
          signal: controller.signal,
          stream: true,
          timeoutMs: settings().requestTimeoutMs,
          onDelta: (textDelta, _fullText, thinkingDelta) => {
            const out = {};
            if (thinkingDelta) out.reasoning_content = thinkingDelta;
            if (textDelta) out.content = textDelta;
            if (out.reasoning_content || out.content) {
              send(baseChunk(out));
            }
          },
        });

        // flush anything parsed only at completion (images etc.)
        if (result.images && result.images.length) {
          send(baseChunk({ content: '\n\n' + result.images.map((u) => `![generated image](${u})`).join('\n') }));
        }
        send(baseChunk({}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
        recordUse(entry, clientModel, true, result.text.length + (result.thinkingText || '').length);
        logCtx.status = 'ok';
        logCtx.latencyMs = Date.now() - startedAt;
        logCtx.upstream = result.upstreamAnonymous ? 'anonymous' : result.upstreamKeyId;
        logCtx.chars = result.text.length;
        store.addLog(logCtx);
      } catch (err) {
        recordUse(entry, clientModel, false, 0);
        logCtx.status = 'error';
        logCtx.error = String(err.message || err.code || err);
        logCtx.latencyMs = Date.now() - startedAt;
        if (!res.destroyed) {
          send({ error: { message: `Upstream error: ${err.message}`, type: 'upstream_error', code: err.code } });
          res.write('data: [DONE]\n\n');
          res.end();
        }
        store.addLog(logCtx);
      }
    } finally {
      res.off('close', onClose);
    }
  }

  // ---------------------------------------------------------------- images

  async function handleImages(req, res, body) {
    const payload = typeof body === 'object' ? body : safeJson(body);
    if (!payload || typeof payload.prompt !== 'string' || !payload.prompt.trim()) return jsonError(res, 400, '`prompt` must be a non-empty string');
    const entry = gate(req, res, 'deepai-text2img');
    if (entry === null) return;

    const startedAt = Date.now();
    const logCtx = {
      kind: '/v1/images/generations',
      model: 'deepai-text2img',
      gatewayKey: entry.name || entry.key?.slice(0, 12) || entry.id || 'open-mode',
      stream: false,
      preview: String(payload.prompt).slice(0, CONFIG.logBodyPreview),
      status: 'pending',
    };
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      // Primary: the classic /api/text2img route (with pool failover and a
      // curl transport cascade inside the client). Secondary: the in-chat
      // image tool, which some account plans answer with a generated_image
      // payload.
      let url = null;
      try {
        const api = await pool.runApi('text2img', {
          text: String(payload.prompt),
          image_generator_version: 'delta',
          generation_source: 'chat',
        }, { accountIds: entry.accountIds || [], timeoutMs: settings().requestTimeoutMs, signal: controller.signal });
        url = api.output_url || api.share_url || null;
      } catch (err) {
        if (controller.signal.aborted || err.code === 'ABORTED') throw err;
        // Other upstream failures may use the in-chat image tool.
      }
      if (!url) {
        const result = await pool.chat(
          [{ role: 'user', content: `Generate an image: ${payload.prompt}` }],
          {
            model: resolveModel('deepai-standard'),
            sessionKey: crypto.randomUUID(),
            accountIds: entry.accountIds || [],
            timeoutMs: settings().requestTimeoutMs,
            signal: controller.signal,
          }
        );
        url = (result.images && result.images[0]) || null;
      }
      if (!url) throw new Error('Upstream produced no image');
      recordUse(entry, 'deepai-text2img', true, 0);
      logCtx.status = 'ok';
      logCtx.latencyMs = Date.now() - startedAt;
      logCtx.url = url;
      store.addLog(logCtx);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(
        JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [{ url, revised_prompt: String(payload.prompt) }],
        })
      );
    } catch (err) {
      recordUse(entry, 'deepai-text2img', false, 0);
      logCtx.status = 'error';
      logCtx.error = String(err.message || err);
      logCtx.latencyMs = Date.now() - startedAt;
      store.addLog(logCtx);
      jsonError(res, 502, `Upstream error: ${err.message}`, err.code || 'upstream_error');
    } finally {
      res.off('close', onClose);
    }
  }

  function hashOf(messages, model) {
    const h = crypto.createHash('sha256');
    h.update(JSON.stringify(messages) + '|' + model);
    return h.digest('hex').slice(0, 32);
  }

  return { modelList, handleModels, handleChat, handleImages, resolveModel };
}

function safeJson(t) {
  try {
    return JSON.parse(String(t ?? ''));
  } catch {
    return null;
  }
}

function jsonError(res, status, message, code) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(
    JSON.stringify({
      error: { message, type: status < 500 ? 'invalid_request_error' : 'upstream_error', code: code || null },
    })
  );
}

module.exports = { createOpenAIRoutes, jsonError };
