/*
 * DeepAI console shared helpers.
 * UI structure and naming follow workbuddy2api-hub (MIT), adapted for DeepAI.
 */
'use strict';

(function attachConsoleCore(root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (root) root.DeepAIConsoleCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConsoleCore() {
  const PAGE_IDS = ['overview', 'gateway', 'accounts', 'analytics', 'logs', 'settings'];
  const DEFAULT_SETTINGS = Object.freeze({
    defaultModel: 'deepai-standard',
    modelMap: {},
    passThroughModels: true,
    requestTimeoutMs: 180000,
    allowAnonymousFallback: true,
    allowOpenWhenNoKeys: true,
    maxLogEntries: 500,
    pollIntervalMs: 8000,
    theme: 'system',
    uiLanguage: 'zh-CN',
    visiblePages: PAGE_IDS.slice(),
    windowMaxHeight: 640,
  });

  function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSettings(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const theme = ['light', 'dark', 'system'].includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
    const uiLanguage = ['zh-CN', 'zh-TW', 'en'].includes(raw.uiLanguage)
      ? raw.uiLanguage
      : DEFAULT_SETTINGS.uiLanguage;
    const requestedPages = Array.isArray(raw.visiblePages) ? raw.visiblePages : DEFAULT_SETTINGS.visiblePages;
    const visiblePages = [];
    for (const page of requestedPages) {
      if (PAGE_IDS.includes(page) && !visiblePages.includes(page)) visiblePages.push(page);
    }
    if (!visiblePages.includes('settings')) visiblePages.push('settings');

    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      modelMap: raw.modelMap && typeof raw.modelMap === 'object' && !Array.isArray(raw.modelMap)
        ? { ...raw.modelMap }
        : {},
      passThroughModels: raw.passThroughModels !== false,
      allowAnonymousFallback: raw.allowAnonymousFallback !== false,
      allowOpenWhenNoKeys: raw.allowOpenWhenNoKeys !== false,
      requestTimeoutMs: clampInt(raw.requestTimeoutMs, 5000, 600000, DEFAULT_SETTINGS.requestTimeoutMs),
      maxLogEntries: clampInt(raw.maxLogEntries, 50, 5000, DEFAULT_SETTINGS.maxLogEntries),
      pollIntervalMs: clampInt(raw.pollIntervalMs, 2000, 60000, DEFAULT_SETTINGS.pollIntervalMs),
      windowMaxHeight: clampInt(raw.windowMaxHeight, 0, 4000, DEFAULT_SETTINGS.windowMaxHeight),
      theme,
      uiLanguage,
      visiblePages,
    };
  }

  function accountSearchText(account) {
    return [
      account.id,
      account.name,
      account.email,
      account.group,
      account.cookiePreview,
      account.apiKeyPreview,
      account.userInfo && account.userInfo.username,
      account.userInfo && account.userInfo.plan,
      account.lastErrorMessage,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function accountStatus(account) {
    if (account.status === 'disabled') return 'disabled';
    if (account.parked) return 'cooling';
    return 'active';
  }

  function compareAccounts(sort) {
    const numeric = (field, direction) => (left, right) =>
      direction * ((Number(left[field]) || 0) - (Number(right[field]) || 0));
    if (sort === 'weight-desc') return numeric('weight', -1);
    if (sort === 'weight-asc') return numeric('weight', 1);
    if (sort === 'uses-desc') return numeric('uses', -1);
    if (sort === 'uses-asc') return numeric('uses', 1);
    if (sort === 'created-desc') return (left, right) =>
      String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    if (sort === 'name-desc') return (left, right) =>
      String(right.name || right.email || '').localeCompare(String(left.name || left.email || ''), undefined, { sensitivity: 'base' });
    return (left, right) =>
      String(left.name || left.email || '').localeCompare(String(right.name || right.email || ''), undefined, { sensitivity: 'base' });
  }

  function filterAccounts(accounts, filters) {
    const list = Array.isArray(accounts) ? accounts.slice() : [];
    const options = filters || {};
    const query = String(options.query || '').trim().toLowerCase();
    const type = options.type || 'all';
    const group = options.group || 'all';
    const status = options.status || 'all';
    return list
      .filter((account) => !query || accountSearchText(account).includes(query))
      .filter((account) => type === 'all' || account.type === type)
      .filter((account) => group === 'all' || String(account.group || '') === group)
      .filter((account) => status === 'all' || accountStatus(account) === status)
      .sort(compareAccounts(options.sort || 'name-asc'));
  }

  function paginate(items, page, pageSize) {
    const list = Array.isArray(items) ? items : [];
    const size = Math.max(1, Number.parseInt(pageSize, 10) || 10);
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(pages, Math.max(1, Number.parseInt(page, 10) || 1));
    return {
      page: current,
      pages,
      pageSize: size,
      total: list.length,
      items: list.slice((current - 1) * size, current * size),
    };
  }

  function parseCsv(value) {
    return Array.from(new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean)));
  }

  function updateSelection(selection, visibleIds, selected) {
    const target = selection instanceof Set ? selection : new Set(selection || []);
    for (const id of visibleIds || []) {
      if (selected) target.add(id);
      else target.delete(id);
    }
    return target;
  }

  function parseModelMap(value) {
    let parsed;
    try {
      parsed = JSON.parse(String(value || '{}'));
    } catch (error) {
      throw new Error('Model map must be valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Model map must be a plain object');
    }
    for (const [key, mapped] of Object.entries(parsed)) {
      if (!key.trim() || typeof mapped !== 'string' || !mapped.trim()) {
        throw new Error('Model map keys and values must be non-empty strings');
      }
    }
    return parsed;
  }

  function translate(messages, language, key) {
    return messages?.[language]?.[key] ?? messages?.['zh-CN']?.[key] ?? key;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  return {
    PAGE_IDS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    filterAccounts,
    paginate,
    parseCsv,
    updateSelection,
    parseModelMap,
    translate,
    escapeHtml,
    accountStatus,
  };
});
