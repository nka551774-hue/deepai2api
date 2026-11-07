'use strict';

/**
 * Global configuration, resolved from environment variables once at boot.
 */
const path = require('path');

function envStr(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envInt(name, fallback, min, max) {
  const v = parseInt(process.env[name], 10);
  if (!Number.isFinite(v)) return fallback;
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}
function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const CONFIG = {
  host: envStr('HOST', '0.0.0.0'),
  port: envInt('PORT', 3737, 1, 65535),
  dataDir: envStr('DATA_DIR', path.join(__dirname, '..', 'data')),
  adminPassword: envStr('ADMIN_PASSWORD', 'deepai2api'),
  adminSessionTtlMs: envInt('ADMIN_SESSION_TTL_HOURS', 12, 1, 24 * 30) * 3600 * 1000,

  upstream: {
    baseUrl: envStr('UPSTREAM_BASE_URL', 'https://api.deepai.org').replace(/\/+$/, ''),
    origin: envStr('UPSTREAM_ORIGIN', 'https://deepai.org'),
    // The UA the upstream validates anonymous tryit-key hashes against.
    userAgent:
      envStr(
        'UPSTREAM_USER_AGENT',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      ),
    chatPath: envStr('UPSTREAM_CHAT_PATH', '/hacking_is_a_serious_crime'),
    taskStatusPath: '/check_chat_task_status',
    uploadPath: '/chat_attachments/upload',
    timeoutMs: envInt('UPSTREAM_TIMEOUT_MS', 180000, 5000, 600000),
    taskPollIntervalMs: envInt('TASK_POLL_INTERVAL_MS', 1500, 250, 15000),
    taskPollTimeoutMs: envInt('TASK_POLL_TIMEOUT_MS', 180000, 5000, 600000),
  },

  // Fall back to single-use anonymous tryit keys when the account pool is
  // empty or fully exhausted.
  allowAnonymousFallback: envBool('ALLOW_ANONYMOUS_FALLBACK', true),
  // When true, the API accepts requests with no gateway key when no gateway
  // keys have been issued yet (first-run convenience).
  allowOpenWhenNoKeys: envBool('ALLOW_OPEN_WHEN_NO_KEYS', true),

  maxLogEntries: envInt('MAX_LOG_ENTRIES', 500, 50, 5000),
  logBodyPreview: 200,

  // Optionally seed the upstream key pool at boot (comma/space separated).
  upstreamSeedKeys: envStr('UPSTREAM_KEYS', '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean),
};

module.exports = { CONFIG };
