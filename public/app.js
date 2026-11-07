'use strict';

/* deepai2api dashboard SPA — vanilla JS, no build step. */
const $ = (sel) => document.querySelector(sel);
const state = { token: localStorage.getItem('deepai2api_token') || '' };

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['x-admin-token'] = state.token;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/admin/login') { showLogin(); throw new Error('Unauthorized'); }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function fmtTime(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function fmtMs(ms) { return ms === undefined ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function fmtNum(n) { return (n ?? 0).toLocaleString(); }

/* ---------------- auth flow ---------------- */
function showLogin() {
  localStorage.removeItem('deepai2api_token');
  state.token = '';
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  refreshAll();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) });
    state.token = data.token;
    localStorage.setItem('deepai2api_token', data.token);
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message === 'Wrong password' ? '密碼錯誤' : err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  showLogin();
});

/* ---------------- tabs ---------------- */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  if (btn.dataset.tab === 'logs') loadLogs();
  if (btn.dataset.tab === 'settings') loadSettings();
});

/* ---------------- dashboard ---------------- */
async function refreshOverview() {
  const o = await api('/api/admin/overview');
  const s = o.stats;
  const errRate = s.totalRequests ? ((s.totalErrors / s.totalRequests) * 100).toFixed(1) : '0';
  $('#stat-cards').innerHTML = `
    ${card('總請求數', fmtNum(s.totalRequests))}
    ${card('錯誤數', `${fmtNum(s.totalErrors)} <span class="muted small">(${errRate}%)</span>`)}
    ${card('輸出字元', fmtNum(s.totalChars))}
    ${card('可用上游 Key', fmtNum(o.upstream.usable) + ' / ' + fmtNum(o.upstream.total))}
    ${card('已簽發 API Key', fmtNum(o.gateway.enabled) + ' / ' + fmtNum(o.gateway.total))}
    ${card('執行時間', fmtMs(o.uptimeMs))}`;

  const tbody = $('#model-stats tbody');
  const models = Object.entries(s.perModel || {}).sort((a, b) => b[1].requests - a[1].requests);
  tbody.innerHTML = models.length
    ? models.map(([m, v]) => `<tr><td>${esc(m)}</td><td>${fmtNum(v.requests)}</td><td>${fmtNum(v.errors)}</td><td>${fmtNum(v.chars)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">尚無資料</td></tr>';

  $('#upstream-status').innerHTML = `
    ${pill(o.upstream.usable > 0 ? 'ok' : 'warn', o.upstream.usable > 0 ? '上游可用' : '上游池空')}
    ${pill(o.upstream.disabled ? 'err' : 'muted', `${o.upstream.disabled} 停用`)}
    ${pill(o.upstream.exhausted ? 'warn' : 'muted', `${o.upstream.exhausted} 冷卻/耗盡`)}
    ${pill(o.upstream.anonymousFallback ? 'ok' : 'muted', o.upstream.anonymousFallback ? '匿名 fallback 開啟' : '匿名 fallback 關閉')}`;

  $('#uptime').textContent = `已執行 ${fmtMs(o.uptimeMs)}`;
  $('#usage-snippet').textContent = usageSnippet(o);
}
function card(title, value) {
  return `<div class="card"><div class="muted small">${esc(title)}</div><div class="num">${value}</div></div>`;
}
function pill(cls, text) { return `<span class="pill ${cls}">${esc(text)}</span>`; }
function usageSnippet(o) {
  const base = location.origin;
  return [
    '# OpenAI 相容端點',
    `base_url = "${base}/v1"`,
    `api_key  = "<已簽發的 sk-deepai-… 金鑰${o && o.settings ? '' : ''}>"`,
    '',
    '# curl 測試(串流)',
    `curl -N ${base}/v1/chat/completions \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Authorization: Bearer sk-deepai-..." \\',
    '  -d \'{"model":"deepai-standard","messages":[{"role":"user","content":"你好"}],"stream":true}\'',
    '',
    '# Python (openai SDK)',
    'from openai import OpenAI',
    `client = OpenAI(base_url="${base}/v1", api_key="sk-deepai-...")`,
    'r = client.chat.completions.create(',
    '    model="deepai-standard",',
    '    messages=[{"role":"user","content":"你好"}],',
    '    stream=True,',
    ')',
    'for chunk in r:',
    '    print(chunk.choices[0].delta.content or "", end="")',
  ].join('\n');
}

/* ---------------- upstream keys ---------------- */
async function loadKeys() {
  const { keys } = await api('/api/admin/keys');
  $('#keys-body').innerHTML = keys.length
    ? keys.map((k) => keyRow(k)).join('')
    : '<tr><td colspan="8" class="muted">尚無上游 Key。池為空時若啟用匿名 fallback,閘道會自動使用單次 tryit key。</td></tr>';
  bindKeyActions(keys);
}
function keyRow(k) {
  const parked = k.parked;
  const status = k.status === 'disabled' ? ['err', '停用'] : parked ? ['warn', '冷卻/耗盡'] : ['ok', '啟用'];
  return `<tr>
    <td>${esc(k.name || '(未命名)')}</td>
    <td><code title="點擊複製" style="cursor:pointer" onclick="copyText('${esc(k.key)}')">${esc(k.masked)}</code></td>
    <td>${pill(status[0], status[1])}</td>
    <td>${fmtNum(k.uses)}</td>
    <td>${fmtNum(k.errors)}</td>
    <td class="muted small">${fmtTime(k.lastUsedAt)}</td>
    <td class="muted small" title="${esc(k.lastErrorMessage)}">${esc(k.lastErrorMessage ? k.lastErrorMessage.slice(0, 60) : '—')}</td>
    <td style="white-space:nowrap">
      <button class="btn small" data-act="toggle" data-id="${k.id}" data-status="${k.status === 'disabled' ? 'active' : 'disabled'}">${k.status === 'disabled' ? '啟用' : '停用'}</button>
      <button class="btn small" data-act="reset" data-id="${k.id}">重置</button>
      <button class="btn small" data-act="test" data-id="${k.id}">測試</button>
      <button class="btn small danger" data-act="delete" data-id="${k.id}">刪除</button>
    </td>
  </tr>`;
}
function bindKeyActions(keys) {
  document.querySelectorAll('#keys-body button').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      const act = b.dataset.act;
      try {
        if (act === 'toggle') await api('/api/admin/keys/status', { method: 'POST', body: JSON.stringify({ id, status: b.dataset.status }) });
        if (act === 'reset') await api('/api/admin/keys/reset', { method: 'POST', body: JSON.stringify({ id }) });
        if (act === 'delete') {
          if (!confirm('確定刪除這把 Key?')) return;
          await api(`/api/admin/keys/${id}`, { method: 'DELETE' });
        }
        if (act === 'test') {
          b.disabled = true; b.textContent = '測試中…';
          const r = await api('/api/admin/keys/test', { method: 'POST', body: JSON.stringify({ id }) });
          toast(r.ok ? `測試成功:${r.text.slice(0, 40)}` : `測試失敗:[${r.code}] ${r.message}`, !r.ok);
        }
        await loadKeys();
        await refreshOverview();
      } catch (err) {
        toast(err.message, true);
      }
    };
  });
}
window.copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast('已複製'); } catch { /* ignore */ } };

$('#add-key-btn').addEventListener('click', async () => {
  const key = $('#new-key').value.trim();
  if (!key) return toast('請填入 Key', true);
  try {
    const r = await api('/api/admin/keys', { method: 'POST', body: JSON.stringify({ key, name: $('#new-key-name').value }) });
    toast(`已加入 ${r.added} 把${r.failed.length ? `,${r.failed.length} 把失敗` : ''}`, r.failed.length > 0);
    $('#new-key').value = ''; $('#new-key-name').value = '';
    await loadKeys();
    await refreshOverview();
  } catch (err) { toast(err.message, true); }
});

/* ---------------- gateway keys ---------------- */
async function loadGatewayKeys() {
  const { keys } = await api('/api/admin/gateway-keys');
  $('#gw-body').innerHTML = keys.length
    ? keys.map(gwRow).join('')
    : '<tr><td colspan="7" class="muted">尚未簽發金鑰。未簽發時閘道處於開放模式(任何請求都可用)。簽發後所有請求都需帶金鑰。</td></tr>';
  document.querySelectorAll('#gw-body button').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      try {
        if (b.dataset.act === 'toggle') await api('/api/admin/gateway-keys/enable', { method: 'POST', body: JSON.stringify({ id, enabled: b.dataset.enabled === '1' }) });
        if (b.dataset.act === 'delete') {
          if (!confirm('確定刪除這把金鑰?使用它的用戶端將立即失效。')) return;
          await api(`/api/admin/gateway-keys/${id}`, { method: 'DELETE' });
        }
        await loadGatewayKeys();
        await refreshOverview();
      } catch (err) { toast(err.message, true); }
    };
  });
}
function gwRow(k) {
  return `<tr>
    <td>${esc(k.name || '(未命名)')}</td>
    <td><code title="點擊複製" style="cursor:pointer" onclick="copyText('${esc(k.key)}')">${esc(k.key.slice(0, 18))}…</code></td>
    <td>${pill(k.enabled ? 'ok' : 'err', k.enabled ? '啟用' : '停用')}</td>
    <td>${fmtNum(k.uses)}${k.requestLimit ? ' / ' + fmtNum(k.requestLimit) : ''}</td>
    <td class="small">${esc(k.models.length ? k.models.join(', ') : '全部')}</td>
    <td class="muted small">${fmtTime(k.createdAt)}</td>
    <td style="white-space:nowrap">
      <button class="btn small" data-act="toggle" data-id="${k.id}" data-enabled="${k.enabled ? '0' : '1'}">${k.enabled ? '停用' : '啟用'}</button>
      <button class="btn small danger" data-act="delete" data-id="${k.id}">刪除</button>
    </td>
  </tr>`;
}
$('#gw-create-btn').addEventListener('click', async () => {
  const models = $('#gw-models').value.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const r = await api('/api/admin/gateway-keys', {
      method: 'POST',
      body: JSON.stringify({ name: $('#gw-name').value, models, requestLimit: parseInt($('#gw-limit').value || '0', 10) || 0 }),
    });
    await navigator.clipboard.writeText(r.key.key).catch(() => {});
    toast(`金鑰已簽發並複製:${r.key.key.slice(0, 24)}…`);
    $('#gw-name').value = ''; $('#gw-models').value = ''; $('#gw-limit').value = '';
    await loadGatewayKeys();
    await refreshOverview();
  } catch (err) { toast(err.message, true); }
});

/* ---------------- logs ---------------- */
async function loadLogs() {
  const { logs } = await api('/api/admin/logs?limit=100');
  $('#logs-body').innerHTML = logs.length
    ? logs.map((l) => `<tr>
        <td class="muted small">${fmtTime(l.ts)}</td>
        <td><code>${esc((l.kind || '').replace('/v1', ''))}</code></td>
        <td>${esc(l.model || '')}</td>
        <td class="small">${esc(l.gatewayKey || '')}</td>
        <td>${pill(l.status === 'ok' ? 'ok' : l.status === 'pending' ? 'warn' : 'err', l.status === 'ok' ? '成功' : l.status === 'pending' ? '進行中' : '失敗')}</td>
        <td class="small">${fmtMs(l.latencyMs)}</td>
        <td class="small muted" title="${esc(l.error || l.preview || '')}">${esc((l.error || l.preview || '').slice(0, 80))}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="muted">尚無日誌</td></tr>';
}
$('#refresh-logs').addEventListener('click', loadLogs);

/* ---------------- settings ---------------- */
async function loadSettings() {
  const { settings } = await api('/api/admin/settings');
  $('#set-default-model').value = settings.defaultModel || 'deepai-standard';
  $('#set-passthrough').checked = Boolean(settings.passThroughModels);
  $('#set-timeout').value = settings.requestTimeoutMs || 180000;
  $('#set-model-map').value = JSON.stringify(settings.modelMap || {}, null, 2);
  $('#settings-msg').textContent = '';
}
$('#save-settings').addEventListener('click', async () => {
  let modelMap;
  try { modelMap = JSON.parse($('#set-model-map').value); } catch { return toast('模型映射不是合法 JSON', true); }
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        defaultModel: $('#set-default-model').value.trim(),
        passThroughModels: $('#set-passthrough').checked,
        requestTimeoutMs: parseInt($('#set-timeout').value, 10),
        modelMap,
      }),
    });
    toast('設定已儲存');
  } catch (err) { toast(err.message, true); }
});

/* ---------------- boot ---------------- */
async function refreshAll() {
  await Promise.allSettled([refreshOverview(), loadKeys(), loadGatewayKeys()]);
}
(async () => {
  if (state.token) {
    try {
      await api('/api/admin/overview');
      showApp();
    } catch {
      showLogin();
    }
  } else {
    showLogin();
  }
})();
setInterval(() => { if (state.token) refreshOverview().catch(() => {}); }, 15000);
