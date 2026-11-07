'use strict';

/* deepai2api 控制台
 * UI 模式沿用 workbuddy2api-hub（面板闸门 / X-Panel-Token / nextNav）。
 * 数据层为本网关 /panel/* 与 /api/admin/* 端点。
 */
const PANEL_STORE = window.PANEL_STORE || 'wb-proxy-panel-token';
const PANEL_REMEMBER_KEY = window.PANEL_REMEMBER_KEY || 'wb-proxy-panel-remember';
let PANEL_TOKEN = '';
let CURRENT_TAB = 'overview';
let LOGS = [];
let LOG_POLL = true;
let AN_RANGE = '7d';

try {
  PANEL_TOKEN = sessionStorage.getItem(PANEL_STORE) || localStorage.getItem(PANEL_STORE) || '';
} catch (e) { /* private mode */ }

/* ---------------- 基础工具 ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function esc(v) {
  const d = document.createElement('div');
  d.textContent = String(v ?? '');
  return d.innerHTML;
}
function fmtNum(n) { return (n || 0).toLocaleString('zh-CN'); }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function fmtMs(ms) {
  if (ms === undefined || ms === null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function toast(msg, kind) {
  const box = $('#toastBox');
  const el = document.createElement('div');
  el.style.cssText = 'background:var(--panel);border:1px solid ' +
    (kind === 'bad' ? 'var(--bad)' : 'var(--accent)') +
    ';color:var(--fg);padding:10px 16px;border-radius:10px;box-shadow:var(--shadow-md);font-size:13px;max-width:360px';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 450); }, 3200);
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (PANEL_TOKEN) headers['X-Panel-Token'] = PANEL_TOKEN;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { panelNeedsLogin(); throw new Error('未登录或会话过期'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

/* ---------------- 面板会话 ---------------- */
function panelHideGate() {
  document.documentElement.classList.add('wb-panel-session');
  const gate = $('#panelGate');
  if (gate) gate.style.display = 'none';
}
function panelNeedsLogin() {
  document.documentElement.classList.remove('wb-panel-session');
  const gate = $('#panelGate');
  if (gate) gate.style.display = 'flex';
  stopDashboard();
  const input = $('#panelPwdInput');
  if (input) input.focus();
}
function panelSyncRemember() {
  try {
    const checked = $('#panelRemember') && $('#panelRemember').checked;
    if (checked) localStorage.setItem(PANEL_REMEMBER_KEY, '1');
    else localStorage.removeItem(PANEL_REMEMBER_KEY);
  } catch (e) { /* ignore */ }
}
function panelRememberChanged(cb) {
  panelSyncRemember();
  if (!cb.checked) {
    try { localStorage.removeItem(PANEL_STORE); } catch (e) { /* ignore */ }
  }
}
async function submitPanelLogin() {
  const pwd = $('#panelPwdInput').value;
  $('#panelLoginMsg').textContent = '';
  try {
    const r = await fetch('/panel/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd, remember: $('#panelRemember').checked }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.token) {
      $('#panelLoginMsg').textContent = '密码不正确';
      return;
    }
    PANEL_TOKEN = data.token;
    try {
      sessionStorage.setItem(PANEL_STORE, PANEL_TOKEN);
      if ($('#panelRemember').checked) localStorage.setItem(PANEL_STORE, PANEL_TOKEN);
    } catch (e) { /* ignore */ }
    $('#panelPwdInput').value = '';
    panelHideGate();
    await startDashboard();
  } catch (err) {
    $('#panelLoginMsg').textContent = '网关不可达';
  }
}
async function panelLogout() {
  try { await api('/panel/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  PANEL_TOKEN = '';
  try { sessionStorage.removeItem(PANEL_STORE); localStorage.removeItem(PANEL_STORE); } catch (e) { /* ignore */ }
  panelNeedsLogin();
}

/* ---------------- 导航 ---------------- */
function nextGo(tab) {
  CURRENT_TAB = tab;
  $$('.main-page').forEach((p) => p.classList.toggle('active', p.id === `page${tab[0].toUpperCase()}${tab.slice(1)}`));
  $$('.next-nav-item').forEach((b) => {
    b.style.background = b.dataset.tab === tab ? 'var(--accent-soft)' : '';
    b.style.color = b.dataset.tab === tab ? 'var(--accent)' : '';
  });
  refreshTab(tab);
}
let POLLERS = [];
function addPoller(fn, ms) { POLLERS.push(setInterval(fn, ms)); }
function stopDashboard() {
  POLLERS.forEach((id) => clearInterval(id));
  POLLERS = [];
}

/* ---------------- 数据渲染 ---------------- */
function kpiCard(label, value, sub, cls) {
  return `<div class="card" style="padding:12px 14px">
    <div class="hint" style="font-size:11px">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px" class="${cls || ''}">${value}</div>
    <div class="hint" style="font-size:11px">${sub || ''}</div></div>`;
}
function badge(text, cls) { return `<span class="badge ${cls || ''}">${esc(text)}</span>`; }

async function loadOverview() {
  const [ov, lg] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/analytics?range=today').catch(() => null),
  ]);
  const today = lg ? lg.kpis : { requests: 0, errors: 0, errorRate: 0, chars: 0, avgLatencyMs: 0 };
  $('#ovKpis').innerHTML =
    kpiCard('今日请求', fmtNum(today.requests), `平均耗时 ${fmtMs(today.avgLatencyMs)}`) +
    kpiCard('今日错误', fmtNum(today.errors), `错误率 ${today.errorRate}%`, today.errors ? 'bad' : '') +
    kpiCard('今日输出字符', fmtNum(today.chars), '') +
    kpiCard('可用账号', `${fmtNum(ov.accounts.usable)} / ${fmtNum(ov.accounts.total)}`,
      `Cookie ${ov.accounts.byType.cookie} · 帐密 ${ov.accounts.byType.login} · Key ${ov.accounts.byType.apikey}`) +
    kpiCard('已签发 API Key', `${fmtNum(ov.gateway.enabled)} / ${fmtNum(ov.gateway.total)}`,
      `累计调用 ${fmtNum(ov.gateway.uses)} 次`) +
    kpiCard('累计请求', fmtNum(ov.stats.totalRequests), `总错误 ${fmtNum(ov.stats.totalErrors)} · 运行 ${fmtMs(ov.uptimeMs)}`);

  const models = Object.entries(ov.stats.perModel || {}).sort((a, b) => b[1].requests - a[1].requests);
  $('#ovModels tbody').innerHTML = models.length
    ? models.map(([m, v]) => `<tr><td>${esc(m)}</td><td style="text-align:right">${fmtNum(v.requests)}</td>
        <td style="text-align:right" class="${v.errors ? 'bad' : ''}">${fmtNum(v.errors)}</td>
        <td style="text-align:right">${fmtNum(v.chars)}</td><td style="text-align:right">—</td></tr>`).join('')
    : '<tr><td colspan="5" class="hint">尚无数据</td></tr>';

  $('#ovUpstream').innerHTML =
    badge(ov.accounts.usable > 0 ? '上游可用' : '账号池空', ov.accounts.usable > 0 ? 'ok' : 'warn') +
    badge(`${ov.accounts.disabled} 停用`, ov.accounts.disabled ? 'bad' : 'off') +
    badge(`${ov.accounts.cooling} 冷却/耗尽`, ov.accounts.cooling ? 'warn' : 'off') +
    badge(`匿名回退 ${ov.accounts.anonymousFallback ? '开启' : '关闭'}`, ov.accounts.anonymousFallback ? 'ok' : 'off');

  const logs = await api('/api/admin/logs?limit=8');
  LOGS = logs.logs;
  $('#ovRecent tbody').innerHTML = logs.logs.length
    ? logs.logs.map((l) => `<tr>
        <td class="mono hint">${fmtTime(l.ts)}</td><td>${esc(l.model || '')}</td>
        <td>${esc(l.gatewayKey || '')}</td>
        <td>${badge(l.status === 'ok' ? '成功' : l.status === 'pending' ? '进行中' : '失败', l.status === 'ok' ? 'ok' : l.status === 'pending' ? 'warn' : 'bad')}</td>
        <td style="text-align:right">${fmtMs(l.latencyMs)}</td>
        <td class="hint">${esc((l.error || l.preview || '').slice(0, 50))}</td></tr>`).join('')
    : '<tr><td colspan="6" class="hint">尚无请求</td></tr>';

  $('#usersHint').textContent = `账号 ${ov.accounts.usable}/${ov.accounts.total} · 今日 ${fmtNum(today.requests)} 请求`;
}

async function loadGateway() {
  const models = await fetch('/v1/models', { headers: { 'X-Panel-Token': PANEL_TOKEN } }).then((r) => r.json());
  const set = await api('/api/admin/settings');
  const map = set.settings.modelMap || {};
  const rows = (models.data || []).map((m) => `<tr>
    <td class="mono">${esc(m.id)}</td><td class="mono">${esc(map[m.id] || '（直通）')}</td>
    <td class="hint">${esc(m.id === set.settings.defaultModel ? '预设模型' : '')}</td></tr>`);
  $('#gwModels tbody').innerHTML = rows.join('') || '<tr><td colspan="3" class="hint">无模型</td></tr>';
  $('#gwBaseUrl').textContent = `${location.origin}/v1`;

  const { keys } = await api('/api/admin/gateway-keys');
  $('#gwKeys tbody').innerHTML = keys.length
    ? keys.map(kk => `<tr>
        <td>${esc(kk.name || '(未命名)')}</td>
        <td><span class="mono" style="cursor:pointer" title="点击复制" onclick="copyText('${esc(kk.key)}')">${esc(kk.key.slice(0, 22))}…</span></td>
        <td>${badge(kk.enabled ? '启用' : '停用', kk.enabled ? 'ok' : 'bad')}</td>
        <td style="text-align:right">${fmtNum(kk.uses)}${kk.requestLimit ? ' / ' + fmtNum(kk.requestLimit) : ''}</td>
        <td class="hint">${esc(kk.models.length ? kk.models.join(', ') : '全部')}</td>
        <td class="hint">${fmtTime(kk.lastUsedAt)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="sec mini" onclick="toggleGatewayKey('${kk.id}',${!kk.enabled})">${kk.enabled ? '停用' : '启用'}</button>
          <button class="sec mini danger" onclick="deleteGatewayKey('${kk.id}')">删除</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="hint">尚未签发 —— 当前为开放模式，任何请求都可用</td></tr>';
}
function toggleGwCreate() { const b = $('#gwCreate'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; }
async function createGatewayKey() {
  try {
    const r = await api('/api/admin/gateway-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#gwName').value.trim(),
        models: $('#gwModels').value.split(',').map((s) => s.trim()).filter(Boolean),
        requestLimit: parseInt($('#gwLimit').value || '0', 10) || 0,
      }),
    });
    await navigator.clipboard.writeText(r.key.key).catch(() => {});
    toast('已签发并复制到剪贴板：' + r.key.key.slice(0, 26) + '…');
    $('#gwCreate').style.display = 'none';
    await loadGateway();
  } catch (err) { toast(err.message, 'bad'); }
}
async function toggleGatewayKey(id, enabled) {
  try { await api('/api/admin/gateway-keys/enable', { method: 'POST', body: JSON.stringify({ id, enabled }) }); await loadGateway(); }
  catch (err) { toast(err.message, 'bad'); }
}
async function deleteGatewayKey(id) {
  if (!confirm('确定删除这把 API Key？使用它的客户端将立即失效。')) return;
  try { await api(`/api/admin/gateway-keys/${id}`, { method: 'DELETE' }); await loadGateway(); }
  catch (err) { toast(err.message, 'bad'); }
}

function accMode(mode) {
  $('#accBoxCookie').style.display = mode === 'cookie' ? 'block' : 'none';
  $('#accBoxLogin').style.display = mode === 'login' ? 'block' : 'none';
  $('#modeBtnCookie').classList.toggle('active', mode === 'cookie');
  $('#modeBtnLogin').classList.toggle('active', mode === 'login');
}
async function loadAccounts() {
  const { accounts } = await api('/api/admin/accounts');
  $('#accTable tbody').innerHTML = accounts.length
    ? accounts.map(a => `<tr>
        <td>${esc(a.name || a.email || a.cookiePreview || a.apiKeyPreview || '(未命名)')}</td>
        <td>${badge({ cookie: 'Cookie', login: '密码', apikey: 'API Key' }[a.type] || a.type, 'off')}</td>
        <td>${badge(a.status === 'disabled' ? '停用' : a.parked ? '冷却/耗尽' : '启用', a.status === 'disabled' ? 'bad' : a.parked ? 'warn' : 'ok')}</td>
        <td class="hint">${esc(a.userInfo ? (a.userInfo.plan || a.userInfo.username || '') : '')}</td>
        <td style="text-align:right">${fmtNum(a.uses)}</td>
        <td style="text-align:right" class="${a.errors ? 'bad' : ''}">${fmtNum(a.errors)}</td>
        <td class="hint" title="${esc(a.lastErrorMessage)}">${esc((a.lastErrorMessage || '—').slice(0, 42))}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="sec mini" onclick="testAccount('${a.id}', this)">测试</button>
          ${a.type === 'login' ? `<button class="sec mini" onclick="refreshAccount('${a.id}', this)">重登</button>` : ''}
          <button class="sec mini" onclick="toggleAccount('${a.id}','${a.status === 'disabled' ? 'active' : 'disabled'}')">${a.status === 'disabled' ? '启用' : '停用'}</button>
          <button class="sec mini danger" onclick="deleteAccount('${a.id}')">删除</button></td></tr>`).join('')
    : '<tr><td colspan="8" class="hint">账号池为空</td></tr>';
  $('#accSummary').textContent = `共 ${accounts.length} 个账号`;
}
async function addCookieAccounts() {
  const cookies = $('#accCookies').value.trim();
  if (!cookies) return toast('请先粘贴 Cookie', 'bad');
  try {
    const r = await api('/api/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ type: 'cookie', cookie: cookies, name: $('#accCookieName').value.trim() }),
    });
    toast(`已加入 ${r.added} 个账号${r.failed && r.failed.length ? `，${r.failed.length} 个失败` : ''}`, r.failed && r.failed.length ? 'bad' : '');
    $('#accCookies').value = '';
    await loadAccounts();
  } catch (err) { toast(err.message, 'bad'); }
}
async function addLoginAccount() {
  const email = $('#accLoginEmail').value.trim();
  const password = $('#accLoginPassword').value;
  if (!email || !password) return toast('请填写邮箱与密码', 'bad');
  const btn = $('#accLoginBtn');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ type: 'login', email, password }) });
    toast(`账号 ${email} 已登录并加入池`);
    $('#accLoginEmail').value = ''; $('#accLoginPassword').value = '';
    await loadAccounts();
  } catch (err) { toast(err.message, 'bad'); }
  finally { btn.disabled = false; btn.textContent = '登录并加入'; }
}
async function testAccount(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await api('/api/admin/accounts/test', { method: 'POST', body: JSON.stringify({ id }) });
    const who = r.user ? (r.user.username || r.user.email || JSON.stringify(r.user).slice(0, 60)) : '';
    toast(r.ok ? `账号有效 ${r.relogged ? '(已自动重登)' : ''} ${esc(who)}`.slice(0, 90) : `账号无效：${r.message || r.code}`, r.ok ? '' : 'bad');
  } catch (err) { toast(err.message, 'bad'); }
  btn.disabled = false; btn.textContent = '测试';
  await loadAccounts();
}
async function refreshAccount(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await api('/api/admin/accounts/refresh', { method: 'POST', body: JSON.stringify({ id }) });
    toast(r.ok ? '已重新登录' : `重登失败：${r.message || ''}`, r.ok ? '' : 'bad');
  } catch (err) { toast(err.message, 'bad'); }
  btn.disabled = false; btn.textContent = '重登';
  await loadAccounts();
}
async function toggleAccount(id, status) {
  try { await api('/api/admin/accounts/status', { method: 'POST', body: JSON.stringify({ id, status }) }); await loadAccounts(); }
  catch (err) { toast(err.message, 'bad'); }
}
async function deleteAccount(id) {
  if (!confirm('确定删除该账号？')) return;
  try { await api(`/api/admin/accounts/${id}`, { method: 'DELETE' }); await loadAccounts(); }
  catch (err) { toast(err.message, 'bad'); }
}

/* ---------------- 分析 ---------------- */
function setRange(range) {
  AN_RANGE = range;
  $$('#pageAnalytics .range-btn').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
  loadAnalytics();
}
async function loadAnalytics() {
  const a = await api(`/api/admin/analytics?range=${AN_RANGE}`);
  $('#anKpis').innerHTML =
    kpiCard('请求', fmtNum(a.kpis.requests), `${AN_RANGE === 'today' ? '今天' : AN_RANGE}`) +
    kpiCard('错误', fmtNum(a.kpis.errors), `错误率 ${a.kpis.errorRate}%`, a.kpis.errors ? 'bad' : '') +
    kpiCard('输出字符', fmtNum(a.kpis.chars), '') +
    kpiCard('平均耗时', fmtMs(a.kpis.avgLatencyMs), '');
  // 日请求量柱状图（纯 SVG，沿用主题色）
  const days = a.days;
  const max = Math.max(1, ...days.map((d) => d.requests));
  const bars = days.map((d, i) => {
    const h = Math.round((d.requests / max) * 92) + (d.requests ? 2 : 1);
    const x = i * (100 / days.length) + 1;
    const w = 100 / days.length - 2;
    return `<g><rect x="${x}" y="${100 - h}" width="${w}" height="${h}" rx="1.5" fill="var(--accent)" opacity="${d.requests ? 1 : 0.18}"></rect>
      <text x="${x + w / 2}" y="99" font-size="5" text-anchor="middle" fill="var(--dim)">${d.date.slice(5)}</text>
      ${d.requests ? `<text x="${x + w / 2}" y="${94 - h + 8}" font-size="0" fill="var(--fg)">${d.requests}</text>` : ''}</g>`;
  }).join('');
  $('#anChart').innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:180px">
    ${bars}</svg>
    <div class="hint" style="margin-top:6px">每日请求量 · 峰值 ${fmtNum(max)}</div>`;
  $('#anModels tbody').innerHTML = a.perModel.length
    ? a.perModel.map(m => `<tr><td>${esc(m.model)}</td><td style="text-align:right">${fmtNum(m.requests)}</td>
      <td style="text-align:right" class="${m.errors ? 'bad' : ''}">${fmtNum(m.errors)}</td>
      <td style="text-align:right">${fmtNum(m.chars)}</td><td style="text-align:right">${fmtMs(m.latencyMs)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="hint">尚无数据</td></tr>';
  $('#anKeys tbody').innerHTML = a.perGatewayKey.length
    ? a.perGatewayKey.map(k => `<tr><td>${esc(k.key)}</td><td style="text-align:right">${fmtNum(k.requests)}</td>
      <td style="text-align:right" class="${k.errors ? 'bad' : ''}">${fmtNum(k.errors)}</td>
      <td style="text-align:right">${k.requests ? Math.round(k.errors / k.requests * 100) + '%' : '—'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="hint">尚无数据</td></tr>';
}

/* ---------------- 日志 ---------------- */
async function loadLogs() {
  const data = await api('/api/admin/logs?limit=200');
  LOGS = data.logs;
  renderLogs();
}
function renderLogs() {
  const query = ($('#logFilter') ? $('#logFilter').value : '').toLowerCase();
  const outcome = $('#logOutcome') ? $('#logOutcome').value : '';
  const rows = LOGS.filter((l) =>
    (!query || `${l.model} ${l.gatewayKey} ${l.error || ''}`.toLowerCase().includes(query)) &&
    (!outcome || l.status === outcome)
  );
  $('#logTable tbody').innerHTML = rows.length
    ? rows.map(l => `<tr>
        <td class="mono hint">${fmtTime(l.ts)}</td>
        <td><span class="mono">${esc((l.kind || '').replace('/v1', ''))}</span></td>
        <td>${esc(l.model || '')}</td><td class="hint">${esc(l.gatewayKey || '')}</td>
        <td class="hint">${esc(l.upstream === 'anonymous' ? '匿名' : (l.upstream ? String(l.upstream).slice(0, 12) : ''))}</td>
        <td>${badge(l.status === 'ok' ? '成功' : l.status === 'pending' ? '进行中' : '失败', l.status === 'ok' ? 'ok' : l.status === 'pending' ? 'warn' : 'bad')}</td>
        <td style="text-align:right">${fmtMs(l.latencyMs)}</td>
        <td class="hint" title="${esc(l.error || l.preview || '')}">${esc((l.error || l.preview || '').slice(0, 46))}</td></tr>`).join('')
    : '<tr><td colspan="8" class="hint">无匹配日志</td></tr>';
  $('#logCount').textContent = `${rows.length} 条记录`;
}
function toggleLogPoll() {
  LOG_POLL = !LOG_POLL;
  $('#logPollBtn').textContent = LOG_POLL ? '暂停刷新' : '恢复刷新';
  if (LOG_POLL) loadLogs();
}
async function clearLogs() {
  if (!confirm('确定清空请求日志？')) return;
  try { await api('/api/admin/logs/clear', { method: 'POST' }); await loadLogs(); }
  catch (err) { toast(err.message, 'bad'); }
}

/* ---------------- 设置 ---------------- */
async function loadSettings() {
  const { settings } = await api('/api/admin/settings');
  $('#setModel').value = settings.defaultModel || 'deepai-standard';
  $('#setPassthrough').checked = Boolean(settings.passThroughModels);
  $('#setTimeou').value = settings.requestTimeoutMs || 180000;
  $('#setModelMap').value = JSON.stringify(settings.modelMap || {}, null, 2);
  const status = await api('/panel/status');
  $('#pwdHint').textContent = status.panel_password_is_default
    ? '当前仍使用默认密码（deepai2api 或 ADMIN_PASSWORD），建议立即修改。'
    : '面板密码已自定义，修改时需提供当前密码。';
}
async function saveSettings() {
  let modelMap;
  try { modelMap = JSON.parse($('#setModelMap').value); } catch { return toast('模型映射不是合法 JSON', 'bad'); }
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        defaultModel: $('#setModel').value.trim(),
        passThroughModels: $('#setPassthrough').checked,
        requestTimeoutMs: parseInt($('#setTimeou').value, 10),
        modelMap,
      }),
    });
    $('#setMsg').textContent = '已保存';
    setTimeout(() => { $('#setMsg').textContent = ''; }, 2500);
  } catch (err) { toast(err.message, 'bad'); }
}
async function changePanelPassword() {
  try {
    await api('/panel/password', {
      method: 'POST',
      body: JSON.stringify({ current: $('#pwdCurrent').value, next: $('#pwdNext').value }),
    });
    toast('面板密码已修改');
    $('#pwdCurrent').value = ''; $('#pwdNext').value = '';
    await loadSettings();
  } catch (err) { toast(err.message, 'bad'); }
}

/* ---------------- 杂项 ---------------- */
window.copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast('已复制'); } catch (e) { /* ignore */ } };

function refreshTab(tab) {
  if (tab === 'overview') loadOverview().catch(() => {});
  if (tab === 'gateway') loadGateway().catch(() => {});
  if (tab === 'accounts') loadAccounts().catch(() => {});
  if (tab === 'analytics') loadAnalytics().catch(() => {});
  if (tab === 'logs') loadLogs().catch(() => {});
  if (tab === 'settings') loadSettings().catch(() => {});
}

async function startDashboard() {
  addPoller(() => refreshTab(CURRENT_TAB), 8000);
  nextGo('overview');
  try {
    const h = await fetch('/healthz').then((r) => r.json());
    $('#navHealth').innerHTML = `服务正常<br>运行 ${Math.floor(h.uptime / 60)} 分钟`;
    $('#consolePort').textContent = location.port || '3737';
  } catch (e) { /* ignore */ }
}

/* ---------------- 启动 ---------------- */
async function bootPanel() {
  let status = {};
  try {
    const r = await fetch('/panel/status', { cache: 'no-store', headers: { 'X-Panel-Token': PANEL_TOKEN } });
    status = await r.json().catch(() => ({}));
  } catch (e) { status = {}; }
  const hint = $('#panelDefaultHint');
  if (hint && status.panel_password_is_default) hint.style.display = 'block';
  try {
    const remembered = localStorage.getItem(PANEL_REMEMBER_KEY) === '1';
    $('#panelRemember').checked = remembered;
  } catch (e) { /* ignore */ }
  if (status.authenticated) {
    panelHideGate();
    await startDashboard();
  } else {
    try { sessionStorage.removeItem(PANEL_STORE); } catch (e) { /* ignore */ }
    panelNeedsLogin();
  }
}
bootPanel();
