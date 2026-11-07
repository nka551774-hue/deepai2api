'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountPool } = require('../src/accountPool');

function fixture() {
  const store = { state: { accounts: [] }, save() {} };
  return { store, pool: new AccountPool(store) };
}

test('browser login imports a verified account with metadata and no password', () => {
  const { pool } = fixture();
  const user = { id: 42, email: 'alice@example.test', username: 'alice' };
  const account = pool.captureBrowserAccount('sessionid=first; csrftoken=csrf', user, { group: 'pro', weight: 3 });
  assert.equal(account.type, 'cookie');
  assert.equal(account.source, 'browser');
  assert.equal(account.name, user.email);
  assert.equal(account.group, 'pro');
  assert.equal(account.weight, 3);
  assert.equal(account.password, '');
  assert.equal(account.userInfo.id, 42);
  assert.ok(account.cookieUpdatedAt);
});

test('another login renews the same identity without changing its id or disabled status', () => {
  const { pool } = fixture();
  const first = pool.captureBrowserAccount('sessionid=first', { id: 42, username: 'alice' }, { name: 'Alice', group: 'pro', weight: 3 });
  pool.setStatus(first.id, 'disabled');
  first.uses = 9;
  const renewed = pool.captureBrowserAccount('sessionid=second', { id: 42, username: 'new-name' });
  assert.equal(renewed.id, first.id);
  assert.equal(pool.list().length, 1);
  assert.equal(renewed.cookie, 'sessionid=second');
  assert.equal(renewed.name, 'Alice');
  assert.equal(renewed.group, 'pro');
  assert.equal(renewed.weight, 3);
  assert.equal(renewed.status, 'disabled');
  assert.equal(renewed.uses, 9);
});

test('browser login renews an existing email login without duplicating gateway account permissions', () => {
  const { pool } = fixture();
  const first = pool._addAccount({ type: 'login', email: 'ALICE@example.test', password: 'existing-password', cookie: 'sessionid=old' });
  const renewed = pool.captureBrowserAccount('sessionid=new', { id: 42, email: 'alice@example.test' });
  assert.equal(renewed.id, first.id);
  assert.equal(renewed.type, 'login');
  assert.equal(renewed.password, 'existing-password');
  assert.equal(pool.list().length, 1);
});

test('unverified or missing sessions cannot enter the account pool', () => {
  const { pool } = fixture();
  for (const [cookie, user] of [['csrftoken=only', { id: 42 }], ['sessionid=abc', {}], ['sessionid=abc', { username: 'alice', is_authenticated: false }]]) {
    assert.throws(() => pool.captureBrowserAccount(cookie, user));
  }
  assert.equal(pool.list().length, 0);
});
