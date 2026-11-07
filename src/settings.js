'use strict';

const { CONFIG } = require('./config');

const VISIBLE_PAGES = ['overview', 'gateway', 'accounts', 'analytics', 'logs', 'settings'];
const PUBLIC_FIELDS = [
  'defaultModel',
  'modelMap',
  'passThroughModels',
  'requestTimeoutMs',
  'allowAnonymousFallback',
  'allowOpenWhenNoKeys',
  'maxLogEntries',
  'pollIntervalMs',
  'theme',
  'uiLanguage',
  'visiblePages',
  'windowMaxHeight',
];

function getDefaultSettings() {
  return {
    defaultModel: 'deepai-standard',
    modelMap: {
      'deepai-standard': 'standard',
      'deepai-genius': 'genius',
      'deepai-super-genius': 'super_genius',
      'gpt-4o-mini': 'standard',
    },
    passThroughModels: true,
    requestTimeoutMs: CONFIG.upstream.timeoutMs,
    allowAnonymousFallback: CONFIG.allowAnonymousFallback,
    allowOpenWhenNoKeys: CONFIG.allowOpenWhenNoKeys,
    maxLogEntries: CONFIG.maxLogEntries,
    pollIntervalMs: 8000,
    theme: 'system',
    uiLanguage: 'zh-CN',
    visiblePages: [...VISIBLE_PAGES],
    windowMaxHeight: 640,
  };
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireInteger(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function validateSettingsPatch(body) {
  if (!isPlainObject(body)) throw validationError('Settings body must be a JSON object');

  const unknown = Object.keys(body).filter((key) => !PUBLIC_FIELDS.includes(key));
  if (unknown.length) throw validationError(`Unknown setting: ${unknown[0]}`);

  const patch = {};
  if (Object.hasOwn(body, 'defaultModel')) {
    if (typeof body.defaultModel !== 'string' || !body.defaultModel.trim()) {
      throw validationError('defaultModel must be a non-empty string');
    }
    patch.defaultModel = body.defaultModel.trim();
  }

  if (Object.hasOwn(body, 'modelMap')) {
    if (!isPlainObject(body.modelMap)) throw validationError('modelMap must be a plain object');
    const entries = [];
    for (const [clientModel, upstreamModel] of Object.entries(body.modelMap)) {
      if (!clientModel.trim()) throw validationError('modelMap keys must be non-empty strings');
      if (typeof upstreamModel !== 'string' || !upstreamModel.trim()) {
        throw validationError('modelMap values must be non-empty strings');
      }
      entries.push([clientModel, upstreamModel.trim()]);
    }
    patch.modelMap = Object.fromEntries(entries);
  }

  for (const name of ['passThroughModels', 'allowAnonymousFallback', 'allowOpenWhenNoKeys']) {
    if (!Object.hasOwn(body, name)) continue;
    if (typeof body[name] !== 'boolean') throw validationError(`${name} must be a boolean`);
    patch[name] = body[name];
  }

  if (Object.hasOwn(body, 'requestTimeoutMs')) {
    patch.requestTimeoutMs = requireInteger('requestTimeoutMs', body.requestTimeoutMs, 5000, 600000);
  }
  if (Object.hasOwn(body, 'maxLogEntries')) {
    patch.maxLogEntries = requireInteger('maxLogEntries', body.maxLogEntries, 50, 5000);
  }
  if (Object.hasOwn(body, 'pollIntervalMs')) {
    patch.pollIntervalMs = requireInteger('pollIntervalMs', body.pollIntervalMs, 2000, 60000);
  }
  if (Object.hasOwn(body, 'windowMaxHeight')) {
    patch.windowMaxHeight = requireInteger('windowMaxHeight', body.windowMaxHeight, 0, 4000);
  }

  if (Object.hasOwn(body, 'theme')) {
    if (!['light', 'dark', 'system'].includes(body.theme)) {
      throw validationError('theme must be light, dark or system');
    }
    patch.theme = body.theme;
  }

  if (Object.hasOwn(body, 'uiLanguage')) {
    if (!['zh-CN', 'zh-TW', 'en'].includes(body.uiLanguage)) {
      throw validationError('uiLanguage must be zh-CN, zh-TW or en');
    }
    patch.uiLanguage = body.uiLanguage;
  }

  if (Object.hasOwn(body, 'visiblePages')) {
    if (!Array.isArray(body.visiblePages) || body.visiblePages.some((page) => typeof page !== 'string' || !VISIBLE_PAGES.includes(page))) {
      throw validationError(`visiblePages entries must be one of: ${VISIBLE_PAGES.join(', ')}`);
    }
    patch.visiblePages = [...new Set(body.visiblePages)];
    if (!patch.visiblePages.includes('settings')) patch.visiblePages.push('settings');
  }

  return patch;
}

function publicSettings(settings) {
  const source = { ...getDefaultSettings(), ...(isPlainObject(settings) ? settings : {}) };
  const output = {};
  for (const field of PUBLIC_FIELDS) {
    const value = source[field];
    if (field === 'modelMap' && isPlainObject(value)) output[field] = { ...value };
    else if (field === 'visiblePages' && Array.isArray(value)) output[field] = [...value];
    else output[field] = value;
  }
  return output;
}

module.exports = {
  getDefaultSettings,
  validateSettingsPatch,
  publicSettings,
};
