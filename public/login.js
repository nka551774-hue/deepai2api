'use strict';

(() => {
  const MESSAGES = {
    'zh-CN': {
      isolatedBrowser:'隔离登录视窗',back:'返回',reload:'重新载入',connecting:'正在连接安全登录视窗',waiting:'等待中',starting:'启动中',verifying:'正在验证登录',completed:'登录完成',failed:'登录失败',cancelled:'登录已取消',expired:'登录已过期',privacyNotice:'在隔离视窗登录 DeepAI，系统自动加入账号池；不保存密码。',preparingBrowser:'正在准备隔离浏览器…',keyboardHint:'也可直接使用键盘、点击画面或滚轮操作',textInput:'文字',passwordInput:'密码',mobileInputPlaceholder:'输入文字后发送',sendText:'发送',mobileInputHint:'手机输入时，先点击画面中的输入框，再在这里输入；内容只发送到隔离浏览器。',secureSession:'安全会话已建立',cancelLogin:'取消登录',invalidLink:'登录链接无效',invalidLinkHelp:'请关闭此视窗并从控制台重新开始。',sessionComplete:'账号已自动加入账号池，可以关闭此视窗。',sessionCancelled:'此登录会话已取消。',sessionExpired:'登录链接已过期，请从控制台重新生成。',connectionLost:'无法连接登录服务，正在重试…',frameUnavailable:'正在等待浏览器画面…',requestFailed:'操作失败',cancelConfirm:'确定取消本次登录？',statusUnknown:'处理中',minutesSeconds:'{minutes}:{seconds}',pageFallback:'DeepAI 登录',tokenRejected:'登录链接无效或已失效。',insecureOrigin:'为保护账号密码，请使用 HTTPS 或在 localhost 开启此登录视窗。'
    },
    'zh-TW': {
      isolatedBrowser:'隔離登入視窗',back:'返回',reload:'重新載入',connecting:'正在連接安全登入視窗',waiting:'等待中',starting:'啟動中',verifying:'正在驗證登入',completed:'登入完成',failed:'登入失敗',cancelled:'登入已取消',expired:'登入已過期',privacyNotice:'在隔離視窗登入 DeepAI，系統自動加入帳號池；不保存密碼。',preparingBrowser:'正在準備隔離瀏覽器…',keyboardHint:'也可直接使用鍵盤、點擊畫面或滾輪操作',textInput:'文字',passwordInput:'密碼',mobileInputPlaceholder:'輸入文字後傳送',sendText:'傳送',mobileInputHint:'手機輸入時，先點擊畫面中的輸入框，再在這裡輸入；內容只傳送到隔離瀏覽器。',secureSession:'安全工作階段已建立',cancelLogin:'取消登入',invalidLink:'登入連結無效',invalidLinkHelp:'請關閉此視窗並從控制台重新開始。',sessionComplete:'帳號已自動加入帳號池，可以關閉此視窗。',sessionCancelled:'此登入工作階段已取消。',sessionExpired:'登入連結已過期，請從控制台重新產生。',connectionLost:'無法連接登入服務，正在重試…',frameUnavailable:'正在等待瀏覽器畫面…',requestFailed:'操作失敗',cancelConfirm:'確定取消本次登入？',statusUnknown:'處理中',minutesSeconds:'{minutes}:{seconds}',pageFallback:'DeepAI 登入',tokenRejected:'登入連結無效或已失效。',insecureOrigin:'為保護帳號密碼，請使用 HTTPS 或在 localhost 開啟此登入視窗。'
    },
    en: {
      isolatedBrowser:'Isolated sign-in window',back:'Back',reload:'Reload',connecting:'Connecting to the secure sign-in window',waiting:'Waiting',starting:'Starting',verifying:'Verifying sign-in',completed:'Sign-in complete',failed:'Sign-in failed',cancelled:'Sign-in cancelled',expired:'Sign-in expired',privacyNotice:'Sign in to DeepAI in this isolated window. The account is added automatically and your password is not stored.',preparingBrowser:'Preparing the isolated browser…',keyboardHint:'You can also use your keyboard, click the page, or scroll',textInput:'Text',passwordInput:'Password',mobileInputPlaceholder:'Enter text, then send',sendText:'Send',mobileInputHint:'On mobile, tap the page field first, then type here. Text is sent only to the isolated browser.',secureSession:'Secure session established',cancelLogin:'Cancel sign-in',invalidLink:'Invalid sign-in link',invalidLinkHelp:'Close this window and start again from the console.',sessionComplete:'The account was added automatically. You can close this window.',sessionCancelled:'This sign-in session was cancelled.',sessionExpired:'This sign-in link expired. Generate a new one from the console.',connectionLost:'Cannot reach the sign-in service. Retrying…',frameUnavailable:'Waiting for the browser view…',requestFailed:'Operation failed',cancelConfirm:'Cancel this sign-in?',statusUnknown:'Working',minutesSeconds:'{minutes}:{seconds}',pageFallback:'DeepAI sign-in',tokenRejected:'This sign-in link is invalid or expired.',insecureOrigin:'To protect your credentials, open this sign-in window over HTTPS or on localhost.'
    },
  };
  const ALLOWED_KEYS = new Set(['Tab','Shift+Tab','Enter','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Delete','Space','Control+a','Meta+a']);
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const state = params.get('state') || '';
  const token = params.get('token') || '';
  const privateHttp = location.protocol === 'http:' && params.get('privateHttp') === '1';
  history.replaceState(null, '', location.pathname + location.search);

  let language = navigator.language?.toLowerCase().startsWith('zh-tw') || navigator.language?.toLowerCase().startsWith('zh-hk') ? 'zh-TW' : navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  let statusTimer = null;
  let frameTimer = null;
  let countdownTimer = null;
  let frameUrl = '';
  let terminal = false;
  let inputPending = false;
  const inputQueue = [];
  let expiresAt = 0;
  let framePending = false;
  let frameReady = false;
  let sessionStatus = 'starting';
  let lastFrameAt = 0;
  let scrollAccumulator = 0;
  let scrollTimer = null;

  function t(key, vars = {}) {
    let value = MESSAGES[language]?.[key] || MESSAGES['zh-CN'][key] || key;
    for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, replacement);
    return value;
  }
  const HTTP_NOTICE = {
    'zh-CN': '当前使用内网 HTTP，你与面板之间的登录输入未经 HTTPS 加密。请确认你信任这条连接。',
    'zh-TW': '目前使用區網 HTTP，你與面板之間的登入輸入未經 HTTPS 加密。請確認你信任這條連線。',
    en: 'This LAN connection uses HTTP. Your sign-in input to the panel is not encrypted by HTTPS. Continue only on a connection you trust.',
  };
  function applyLanguage() {
    document.documentElement.lang = language;
    document.title = `DeepAI · ${t('isolatedBrowser')}`;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const value = t(el.dataset.i18nAria); el.setAttribute('aria-label', value); el.title = value; });
    if (privateHttp) $('#httpNotice').textContent = HTTP_NOTICE[language];
    $('#languageSelect').value = language;
    const type = $('#mobileInputType').value; $('#mobileTextInput').type = type;
  }
  function clearInputQueue() { while (inputQueue.length) inputQueue.shift().resolvers.forEach((resolve) => resolve(false)); }
  function setInputEnabled(enabled) {
    document.querySelectorAll('[data-command],[data-key],#mobileInputForm button,#mobileTextInput,#mobileInputType').forEach((el) => { el.disabled = !enabled; });
  }
  function stopTimers() { clearInterval(statusTimer); clearInterval(frameTimer); clearInterval(countdownTimer); statusTimer = frameTimer = countdownTimer = null; clearTimeout(scrollTimer); scrollAccumulator = 0; clearInputQueue(); }
  function showTerminal(kind, title, message) {
    terminal = true; stopTimers(); $('#framePlaceholder').hidden = true; $('#browserFrame').hidden = true;
    const box = $('#terminalState'); box.hidden = false; box.classList.toggle('bad', kind !== 'completed');
    $('#terminalIcon').textContent = kind === 'completed' ? '✓' : '!'; $('#terminalTitle').textContent = title; $('#terminalMessage').textContent = message || '';
    $('#cancelBtn').disabled = true; setInputEnabled(false);
  }
  async function request(path, options = {}, expectBlob = false) {
    const headers = { 'X-Login-Token': token, ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    if (expectBlob && response.ok) return response.blob();
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error?.message || body.error || body.message || (response.status === 401 ? t('tokenRejected') : `HTTP ${response.status}`)));
    return body;
  }
  function updateCountdown(value = expiresAt) {
    const expiry = Number(value) || new Date(value).getTime();
    if (!expiry) { $('#countdown').textContent = '--:--'; return; }
    const remaining = Math.max(0, expiry - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000); const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0'); const seconds = String(totalSeconds % 60).padStart(2, '0');
    $('#countdown').textContent = t('minutesSeconds', { minutes, seconds });
  }
  function updatePageIdentity(data) {
    const rawUrl = data.url || ''; let hostname = 'deepai.org';
    try { hostname = new URL(rawUrl).hostname || hostname; } catch (error) { /* status may not have a URL yet */ }
    $('#pageHost').textContent = hostname; $('#pageUrl').textContent = rawUrl || hostname; $('#pageTitle').textContent = data.title || t('pageFallback');
  }
  function statusLabel(status) { return ['starting','waiting','verifying','completed','failed','cancelled','expired'].includes(status) ? t(status) : t('statusUnknown'); }
  async function pollStatus() {
    if (terminal) return;
    try {
      const data = await request(`/api/account-login/status?state=${encodeURIComponent(state)}`);
      expiresAt = Number(data.expiresAt) || expiresAt; const status = data.status || 'waiting'; sessionStatus = status; $('#statusBadge').className = `status-badge ${status}`; $('#statusBadge').textContent = statusLabel(status); $('#connectionStatus').textContent = privateHttp ? 'HTTP' : t('secureSession'); updatePageIdentity(data); updateCountdown();
      if (status === 'completed') showTerminal(status, t('completed'), t('sessionComplete'));
      else if (status === 'failed') showTerminal(status, t('failed'), data.error || t('requestFailed'));
      else if (status === 'cancelled') showTerminal(status, t('cancelled'), t('sessionCancelled'));
      else if (status === 'expired') showTerminal(status, t('expired'), t('sessionExpired'));
      else if (status !== 'starting') refreshFrame();
    } catch (error) { $('#connectionStatus').textContent = error.message || t('connectionLost'); }
  }
  async function refreshFrame() {
    if (terminal || sessionStatus === 'starting' || framePending || document.hidden || Date.now() - lastFrameAt < 700) return;
    lastFrameAt = Date.now(); framePending = true;
    try {
      const blob = await request(`/api/account-login/frame?state=${encodeURIComponent(state)}&t=${Date.now()}`, {}, true);
      if (!blob.size || terminal) return;
      const nextUrl = URL.createObjectURL(blob); const image = new Image(); image.onload = () => { if (terminal) { URL.revokeObjectURL(nextUrl); return; } const frame = $('#browserFrame'); if (frameUrl) URL.revokeObjectURL(frameUrl); frameUrl = nextUrl; frame.src = nextUrl; frame.hidden = false; frameReady = true; setInputEnabled(true); $('#framePlaceholder').hidden = true; }; image.onerror = () => URL.revokeObjectURL(nextUrl); image.src = nextUrl;
    } catch (error) { if ($('#browserFrame').hidden) $('#framePlaceholder p').textContent = t('frameUnavailable'); }
    finally { framePending = false; }
  }
  async function drainInputQueue() {
    if (inputPending || terminal) return; inputPending = true;
    while (inputQueue.length && !terminal) {
      const item = inputQueue.shift();
      try { await request('/api/account-login/input', { method:'POST', body:JSON.stringify({ state, event:item.event }) }); item.resolvers.forEach((resolve) => resolve(true)); }
      catch (error) { $('#connectionStatus').textContent = error.message || t('requestFailed'); item.resolvers.forEach((resolve) => resolve(false)); }
    }
    inputPending = false; if (!terminal) setTimeout(refreshFrame, 100);
  }
  function sendInput(event) {
    if (terminal || !frameReady) return Promise.resolve(false);
    return new Promise((resolve) => {
      const last = inputQueue.at(-1);
      if (event.type === 'text' && last?.event.type === 'text' && last.event.text.length + event.text.length <= 4000) { last.event.text += event.text; last.resolvers.push(resolve); }
      else inputQueue.push({ event:{ ...event }, resolvers:[resolve] });
      drainInputQueue();
    });
  }
  function clickFrame(event) {
    const image = $('#browserFrame'); if (image.hidden || !image.naturalWidth || !image.naturalHeight) return;
    const rect = image.getBoundingClientRect(); const x = Math.max(0, Math.min(image.naturalWidth, (event.clientX - rect.left) * image.naturalWidth / rect.width)); const y = Math.max(0, Math.min(image.naturalHeight, (event.clientY - rect.top) * image.naturalHeight / rect.height));
    sendInput({ type:'click', x:Math.round(x), y:Math.round(y) }); $('#viewport').focus({ preventScroll:true });
  }
  function pressKey(key) { if (!frameReady) return false; if (key === ' ') key = 'Space'; if (!ALLOWED_KEYS.has(key)) return false; sendInput({ type:'press', key }); return true; }
  function queueScroll(deltaY) { if (!frameReady) return; scrollAccumulator += deltaY; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { const delta = Math.max(-1200, Math.min(1200, Math.round(scrollAccumulator))); scrollAccumulator = 0; sendInput({ type:'scroll', deltaY:delta }); }, 80); }
  async function cancelLogin() {
    if (terminal || !confirm(t('cancelConfirm'))) return;
    $('#cancelBtn').disabled = true;
    try { await request('/api/account-login/cancel', { method:'POST', body:JSON.stringify({ state }) }); showTerminal('cancelled', t('cancelled'), t('sessionCancelled')); }
    catch (error) { $('#connectionStatus').textContent = error.message; $('#cancelBtn').disabled = false; }
  }
  function invalidLink(message = t('invalidLinkHelp')) { applyLanguage(); showTerminal('failed', t('invalidLink'), message); $('#connectionStatus').textContent = t('invalidLink'); }
  function start() {
    applyLanguage();
    setInputEnabled(false);
    if (!state || !token) return invalidLink();
    const localHosts = new Set(['localhost','127.0.0.1','[::1]','::1']);
    if (!window.isSecureContext && !localHosts.has(location.hostname) && !privateHttp) return invalidLink(t('insecureOrigin'));
    $('#httpNotice').hidden = !privateHttp;
    pollStatus(); statusTimer = setInterval(pollStatus, 2000); frameTimer = setInterval(refreshFrame, 1000); countdownTimer = setInterval(updateCountdown, 1000);
  }

  $('#languageSelect').addEventListener('change', (event) => { language = event.target.value; applyLanguage(); });
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => sendInput(button.dataset.command === 'back' ? { type:'back' } : { type:'reload' })));
  document.querySelectorAll('[data-key]').forEach((button) => button.addEventListener('click', () => pressKey(button.dataset.key)));
  $('#browserFrame').addEventListener('click', clickFrame);
  $('#viewport').addEventListener('wheel', (event) => { event.preventDefault(); queueScroll(event.deltaY); }, { passive:false });
  $('#viewport').addEventListener('keydown', (event) => {
    const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' ? (event.metaKey ? 'Meta+a' : 'Control+a') : '';
    const key = event.key === 'Tab' && event.shiftKey ? 'Shift+Tab' : selectAll || event.key;
    if (pressKey(key)) event.preventDefault(); else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); sendInput({ type:'text', text:event.key }); }
  });
  $('#mobileInputType').addEventListener('change', (event) => { $('#mobileTextInput').type = event.target.value; $('#mobileTextInput').focus(); });
  $('#mobileInputForm').addEventListener('submit', async (event) => { event.preventDefault(); const input = $('#mobileTextInput'); if (!input.value) return; const sent = await sendInput({ type:'text', text:input.value }); if (sent) input.value = ''; input.focus(); });
  $('#cancelBtn').addEventListener('click', cancelLogin);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollStatus(); refreshFrame(); } });
  window.addEventListener('beforeunload', () => { stopTimers(); if (frameUrl) URL.revokeObjectURL(frameUrl); });
  start();
})();
