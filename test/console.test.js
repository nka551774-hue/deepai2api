'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterAccounts,
  normalizeSettings,
  paginate,
  parseCsv,
  updateSelection,
} = require('../public/console-core');

test('account filters combine search, type, group and status without reordering source data', () => {
  const accounts = [
    { id: 'cookie-1', name: 'Gamma', type: 'cookie', group: 'backup', weight: 2, status: 'active', uses: 4 },
    { id: 'login-1', name: 'Alpha', email: 'alpha@example.test', type: 'login', group: 'core', weight: 5, status: 'disabled', uses: 9 },
    { id: 'key-1', name: 'Beta', type: 'apikey', group: 'core', weight: 1, status: 'active', parked: true, uses: 1 },
  ];

  const filtered = filterAccounts(accounts, {
    query: 'core',
    type: 'login',
    group: 'core',
    status: 'disabled',
    sort: 'weight-desc',
  });

  assert.deepEqual(filtered.map((account) => account.id), ['login-1']);
  assert.deepEqual(accounts.map((account) => account.id), ['cookie-1', 'login-1', 'key-1']);
});

test('account sorting and pagination clamp a stale page after filters shrink the result set', () => {
  const accounts = [
    { id: 'a', name: 'Alpha', type: 'cookie', group: 'core', weight: 3, status: 'active' },
    { id: 'b', name: 'Beta', type: 'cookie', group: 'core', weight: 1, status: 'active' },
    { id: 'c', name: 'Gamma', type: 'cookie', group: 'other', weight: 2, status: 'active' },
  ];

  const filtered = filterAccounts(accounts, { group: 'core', sort: 'weight-desc' });
  const page = paginate(filtered, 99, 1);

  assert.deepEqual(filtered.map((account) => account.id), ['a', 'b']);
  assert.equal(page.page, 2);
  assert.equal(page.pages, 2);
  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((account) => account.id), ['b']);
});

test('gateway account restrictions survive filtering and clearing only changes visible accounts', () => {
  const accounts = [
    { id: 'hidden-account', name: 'Hidden', type: 'cookie', group: 'hidden', status: 'active' },
    { id: 'visible-account', name: 'Visible', type: 'cookie', group: 'visible', status: 'active' },
    { id: 'other-visible', name: 'Other visible', type: 'cookie', group: 'visible', status: 'active' },
  ];
  const selected = new Set(['hidden-account', 'visible-account']);
  const visibleIds = filterAccounts(accounts, { group: 'visible' }).map((account) => account.id);

  updateSelection(selected, visibleIds, false);
  assert.deepEqual([...selected], ['hidden-account']);

  updateSelection(selected, ['other-visible'], true);
  assert.deepEqual([...selected].sort(), ['hidden-account', 'other-visible']);
});

test('gateway model permissions trim and deduplicate comma-separated patterns', () => {
  assert.deepEqual(
    parseCsv(' deepai-*, gpt-4o-mini,deepai-*, , custom-model '),
    ['deepai-*', 'gpt-4o-mini', 'custom-model']
  );
});

test('visible-page settings discard unknown pages and always retain settings access', () => {
  const settings = normalizeSettings({ visiblePages: ['overview', 'logs', 'unknown', 'overview'] });

  assert.deepEqual(settings.visiblePages, ['overview', 'logs', 'settings']);
});
