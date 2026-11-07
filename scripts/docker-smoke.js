'use strict';

// Uses isolated Docker resources and mock credentials; never calls DeepAI.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const image = process.argv[2] || 'deepai2api:verify';
const name = `deepai2api-smoke-${process.pid}-${Date.now()}`;
const volume = `${name}-data`;
const password = randomBytes(24).toString('hex');
const distro = process.env.DOCKER_WSL_DISTRO;
const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

function docker(args) {
  const command = distro ? 'wsl.exe' : 'docker';
  const commandArgs = distro ? ['-d', distro, '--exec', 'sh', '-c', ['docker', ...args].map(quote).join(' ')] : args;
  return execFileSync(command, commandArgs, {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function address() { return `http://${docker(['port', name, '3737/tcp']).split(/\r?\n/)[0]}`; }

async function healthy() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', name]));
    if (!state.Running) throw new Error(`Container stopped with exit code ${state.ExitCode}`);
    if (state.Health?.Status === 'healthy') return;
    await pause(500);
  }
  throw new Error('Container did not become healthy');
}

async function request(base, endpoint, body, token) {
  const response = await fetch(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Panel-Token': token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `Unexpected status for ${endpoint}`);
  return result;
}

function verifyBrowserRuntime() {
  const script = String.raw`
    'use strict';
    const assert = require('node:assert/strict');
    const { chromium } = require('playwright-core');

    (async () => {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.BROWSER_EXECUTABLE_PATH,
      });
      try {
        const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
        const page = await context.newPage();
        await page.setContent('<!doctype html><title>Browser smoke</title><main id="fixture">browser-login-ready</main>');
        assert.equal(await page.locator('#fixture').textContent(), 'browser-login-ready');
        const screenshot = await page.screenshot({
          path: '/tmp/deepai-browser-smoke.jpg',
          type: 'jpeg',
          quality: 70,
        });
        assert.ok(screenshot.length > 1000, 'Chromium returned an empty screenshot');
        assert.deepEqual([...screenshot.subarray(0, 3)], [0xff, 0xd8, 0xff]);
        process.stdout.write(JSON.stringify({
          title: await page.title(),
          screenshotBytes: screenshot.length,
          uid: process.getuid?.(),
        }));
      } finally {
        await browser.close();
      }
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const result = JSON.parse(docker(['exec', '--user', 'app', name, 'node', '-e', script]));
  assert.equal(result.title, 'Browser smoke');
  assert.ok(result.screenshotBytes > 1000);
  assert.notEqual(result.uid, 0, 'Chromium must launch as the non-root app user');
  docker(['exec', '--user', 'app', name, 'test', '-s', '/tmp/deepai-browser-smoke.jpg']);
}

async function main() {
  try {
    docker(['volume', 'create', volume]);
    docker(['run', '--detach', '--init', '--name', name,
      '--publish', '127.0.0.1::3737',
      '--shm-size', '256m',
      '--mount', `type=volume,source=${volume},target=/app/data,volume-nocopy`,
      '--health-interval', '1s', '--health-start-period', '1s', '--health-retries', '10',
      '--env', `ADMIN_PASSWORD=${password}`, '--env', 'ALLOW_ANONYMOUS_FALLBACK=false',
      '--env', 'ALLOW_OPEN_WHEN_NO_KEYS=false', '--env', 'TZ=Asia/Taipei', image]);
    await healthy();
    let base = address();
    assert.equal((await request(base, '/healthz')).ok, true);
    for (const file of ['/', '/app.js', '/console-core.js', '/style.css', '/login.html', '/login.js', '/login.css']) {
      assert.equal((await fetch(base + file)).status, 200, `Missing console asset: ${file}`);
    }
    const uid = docker(['exec', name, 'node', '-e',
      "const fs=require('fs');const pid=fs.readFileSync('/proc/1/task/1/children','utf8').trim().split(' ')[0]||'1';console.log(fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^Uid:\\s+(\\d+)/m)[1])"]);
    assert.notEqual(uid, '0', 'The application must run as a non-root user');
    verifyBrowserRuntime();
    assert.equal(docker(['exec', name, 'node', '-p', "new Date('2026-11-07T00:00:00Z').getTimezoneOffset()"]), '-480');
    docker(['exec', name, 'test', '-f', '/app/THIRD_PARTY_NOTICES.md']);

    let token = (await request(base, '/panel/login', { password })).token;
    assert.ok(token);
    await request(base, '/api/admin/accounts', {
      type: 'apikey', apiKey: 'docker-smoke-fake-key', name: 'Container fixture', group: 'offline', weight: 3,
    }, token);
    const account = (await request(base, '/api/admin/accounts', undefined, token)).accounts[0];
    assert.equal(account.weight, 3);
    await request(base, '/api/admin/gateway-keys', {
      name: 'Container fixture', models: ['deepai-*'], accountIds: [account.id], requestLimit: 5,
    }, token);
    await request(base, '/api/admin/settings', { theme: 'dark', uiLanguage: 'zh-TW', maxLogEntries: 250 }, token);
    docker(['stop', '--time', '15', name]);
    assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', name]), '0');
    docker(['start', name]);
    await healthy();
    base = address();
    token = (await request(base, '/panel/login', { password })).token;
    const settings = (await request(base, '/api/admin/settings', undefined, token)).settings;
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.uiLanguage, 'zh-TW');
    assert.equal(settings.maxLogEntries, 250);
    const accounts = (await request(base, '/api/admin/accounts', undefined, token)).accounts;
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, account.id);
    assert.equal(accounts[0].group, 'offline');
    const keys = (await request(base, '/api/admin/gateway-keys', undefined, token)).keys;
    assert.deepEqual(keys[0].accountIds, [account.id]);
    assert.equal(keys[0].requestLimit, 5);
    console.log('Docker smoke passed: health, assets, non-root process and Chromium, timezone, account/key/settings persistence, graceful restart.');
  } finally {
    try { docker(['rm', '--force', name]); } catch { /* may not have started */ }
    try { docker(['volume', 'rm', volume]); } catch { /* may not have been created */ }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
