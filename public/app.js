'use strict';

/* DeepAI console interactions. UI patterns adapted from workbuddy2api-hub (MIT). */
(() => {
  const Core = window.DeepAIConsoleCore;
  const PANEL_STORE = 'wb-proxy-panel-token';
  const REMEMBER_STORE = 'wb-proxy-panel-remember';
  const THEME_STORE = 'deepai-console-theme';
  const PAGE_META = {
    overview: ['navOverview', 'overviewDesc'], gateway: ['navGateway', 'gatewayDesc'],
    accounts: ['navAccounts', 'accountsDesc'], analytics: ['navAnalytics', 'analyticsDesc'],
    logs: ['navLogs', 'logsDesc'], settings: ['navSettings', 'settingsDesc'],
  };
  const MESSAGES = {
    'zh-CN': {
      loginTitle:'进入控制台',loginDescription:'使用面板密码管理网关、账号与设置。',panelPassword:'面板密码',rememberLogin:'保持登录',enterConsole:'进入控制台',defaultPasswordHint:'当前仍使用默认面板密码，请登录后立即修改。',workspace:'工作台',repository:'项目仓库',logout:'退出登录',gatewayOnline:'网关运行中',healthy:'正常',offline:'离线',
      navOverview:'总览',navGateway:'网关',navAccounts:'账号',navAnalytics:'分析',navLogs:'日志',navSettings:'设置',overviewTitle:'运行总览',overviewDesc:'网关、账号池和最近请求一屏看完。',gatewayTitle:'网关',gatewayDesc:'OpenAI 兼容地址、模型目录与下游鉴权状态。',accountsTitle:'账号',accountsDesc:'管理 DeepAI Cookie、账号密码与 API Key 凭据。',analyticsTitle:'用量分析',analyticsDesc:'依服务器时区统计今天、近 7 天与近 30 天。',logsTitle:'请求日志',logsDesc:'筛选网关调用、上游账号与错误信息。',settingsTitle:'设置',settingsDesc:'面板、API Key、模型、稳定性与界面选项。',
      refresh:'刷新',modelUsage:'模型统计',modelUsageDesc:'累计调用与输出字符。',model:'模型',requests:'请求',errors:'错误',outputChars:'输出字符',poolStatus:'账号池状态',poolStatusDesc:'可用、停用与冷却账号。',recentRequests:'最近请求',recentRequestsDesc:'最新八条网关活动。',viewAll:'查看全部',time:'时间',apiKey:'API Key',status:'状态',latency:'耗时',detail:'详情',totalRequests:'累计请求',todayRequests:'今日请求',todayErrors:'今日错误',availableAccounts:'可用账号',enabledKeys:'启用 Key',uptime:'运行时间',usable:'可用',disabled:'停用',cooling:'冷却',anonymousFallback:'匿名上游回退',openMode:'无 Key 时开放模式',
      createKey:'签发 API Key',baseUrl:'Base URL',chatEndpoint:'对话端点',imageEndpoint:'生图端点',copy:'复制',modelCatalog:'模型目录',modelCatalogDesc:'目录会依面板会话与 Key 权限显示。',publicModel:'对外模型 ID',upstreamModel:'上游 model',description:'说明',keyAccess:'API Key 鉴权',manageKeys:'管理 Key',openAccess:'尚未签发 Key，网关可处于开放模式。',closedAccess:'尚未签发 Key，但开放模式已关闭；下游请求会被拒绝。',protectedAccess:'网关已启用 API Key 鉴权。',keyCreatedTitle:'API Key 已签发',keyCreatedDesc:'请立即复制并妥善保存这把 Key。',keyCreatedWarning:'关闭后仍可在设置页复制，但请勿在不可信设备暴露密钥。',close:'关闭',
      importJson:'导入 JSON',exportJson:'导出 JSON',addAccount:'添加账号',browserLoginAdd:'登入新增',browserLoginTitle:'登入新增 DeepAI 账号',browserLoginDesc:'生成登录链接，登录完成后自动加入账号池。',browserLoginPrivacy:'登录链接会打开隔离的 DeepAI 登录页；登录完成后自动入池，不保存密码。',browserLoginStarting:'正在生成登录链接…',browserLoginWaiting:'请打开登录链接并完成 DeepAI 登录',browserLoginVerifying:'正在验证登录并加入账号池',browserLoginCompleted:'登录完成，账号已加入',browserLoginFailed:'登录失败',browserLoginCancelled:'登录已取消',browserLoginExpired:'登录链接已过期',browserLoginLink:'登录链接',startBrowserLogin:'生成登录链接',browserLoginExpires:'剩余 {time}',browserLoginAccountAdded:'账号 {name} 已加入账号池',browserLoginStartFailed:'无法生成登录链接',browserLoginInvalidLink:'登录服务返回了无效链接',browserLoginStep1:'生成登录链接',browserLoginStep1Hint:'由网关建立一次性登录会话。',browserLoginStep2:'打开链接并登录',browserLoginStep2Hint:'点击链接，在新页面完成 DeepAI 登录。',browserLoginStep3:'自动加入账号池',browserLoginStep3Hint:'面板会自动检测结果，无需复制 Cookie。',browserLoginClickLink:'点击此链接打开登录页',searchAccounts:'搜索名称、邮箱、分组或错误',allTypes:'全部类型',passwordLogin:'账号密码',allGroups:'全部分组',allStatus:'全部状态',active:'启用',sortName:'名称 A–Z',sortWeight:'权重高优先',sortUses:'使用多优先',sortNewest:'最新加入',noneSelected:'未选择账号',test:'测试',refreshLogin:'重登',enable:'启用',disable:'停用',reset:'重置',delete:'删除',account:'账号',type:'类型',group:'分组',weight:'权重',plan:'方案 / 点数',uses:'使用',lastError:'最近错误',actions:'操作',previous:'上一页',next:'下一页',edit:'编辑',noAccounts:'没有匹配账号',selectedCount:'已选择 {count} 个账号',pageSummary:'第 {page}/{pages} 页 · 共 {total} 个',
      today:'今天',sevenDays:'7 天',thirtyDays:'30 天',requestTrend:'请求趋势',requestTrendDesc:'按日请求与错误。',byModel:'按模型',byKey:'按 API Key',errorRate:'错误率',pauseRefresh:'暂停刷新',resumeRefresh:'恢复刷新',clearLogs:'清空日志',searchLogs:'搜索模型、Key、上游或错误',allResults:'全部结果',success:'成功',failed:'失败',endpoint:'端点',upstream:'上游',noData:'尚无数据',
      settingsBasic:'基本',settingsApi:'API 与鉴权',settingsModel:'模型',settingsStability:'稳定性',settingsSystem:'系统与界面',basicDesc:'面板密码、主题与界面语言。',currentPassword:'当前密码',newPassword:'新密码',changePassword:'修改密码',theme:'主题',themeSystem:'跟随系统',themeLight:'亮色',themeDark:'暗色',language:'界面语言',saveSettings:'保存设置',apiDesc:'下游 API Key、开放模式与匿名回退。',openModeDesc:'仅当尚未签发任何 Key 时允许匿名下游调用。',anonymousFallbackDesc:'账号池不可用时尝试 DeepAI 访客流程。',gatewayKeys:'下游 API Key',gatewayKeysDesc:'可限制模型、账号与请求次数。',addKey:'添加 Key',modelSettingsDesc:'默认模型、模型映射与未知模型直通。',defaultModel:'默认模型',passthroughModels:'未知模型直通',passthroughDesc:'允许未列入映射的模型名称直接传给上游。',modelMap:'模型映射 JSON',stabilityDesc:'请求超时、日志容量与控制台刷新频率。',requestTimeout:'上游超时（毫秒）',logLimit:'日志上限',pollInterval:'面板刷新间隔（毫秒）',systemDesc:'页面可见性、窗口限高与部署信息。',visiblePages:'可见页面',windowMaxHeight:'区块最大高度（0 = 不限制）',
      more:'更多',cycleTheme:'切换主题',accountModalDesc:'选择 DeepAI 凭据类型并填写安全信息。',nameOptional:'名称（可选）',groupOptional:'分组（可选）',cookieHint:'可一次贴入多行 Cookie，每行建立一个账号。',email:'邮箱',password:'密码',cancel:'取消',editAccount:'编辑账号',name:'名称',save:'保存',importAccounts:'导入账号 JSON',importDesc:'选择导出文件或贴入 version 1 JSON。',credentialWarning:'文件可能包含 Cookie、密码与 API Key，请只在可信设备处理。',selectFile:'选择文件',import:'导入',keyModalDesc:'空白模型或账号代表不限制。',allowedModels:'允许模型 / 通配符',modelsCsvHint:'逗号分隔，支持 *。',requestLimit:'请求上限（0 = 无限）',allowedAccounts:'允许账号',selectAll:'全选',clear:'清除',accountRestrictionHint:'不选择代表全部账号；选择账号后不会匿名回退。',copied:'已复制',saved:'已保存',created:'已创建',deleted:'已删除',operationFailed:'操作失败',sessionExpired:'登录已过期，请重新登录',wrongPassword:'密码不正确',gatewayUnavailable:'网关不可达',confirmDelete:'确定删除？此操作无法撤销。',confirmClearLogs:'确定清空所有请求日志？',confirmExport:'导出文件会包含 Cookie、密码或 API Key。请确认当前设备安全并继续。',
    },
    'zh-TW': {
      loginTitle:'進入控制台',loginDescription:'使用面板密碼管理閘道、帳號與設定。',panelPassword:'面板密碼',rememberLogin:'保持登入',enterConsole:'進入控制台',defaultPasswordHint:'目前仍使用預設面板密碼，請登入後立即修改。',workspace:'工作台',repository:'專案倉庫',logout:'登出',gatewayOnline:'閘道執行中',healthy:'正常',offline:'離線',
      navOverview:'總覽',navGateway:'閘道',navAccounts:'帳號',navAnalytics:'分析',navLogs:'日誌',navSettings:'設定',overviewTitle:'執行總覽',overviewDesc:'閘道、帳號池和最近請求一屏看完。',gatewayTitle:'閘道',gatewayDesc:'OpenAI 相容位址、模型目錄與下游驗證狀態。',accountsTitle:'帳號',accountsDesc:'管理 DeepAI Cookie、帳號密碼與 API Key 憑證。',analyticsTitle:'用量分析',analyticsDesc:'依伺服器時區統計今天、近 7 天與近 30 天。',logsTitle:'請求日誌',logsDesc:'篩選閘道呼叫、上游帳號與錯誤資訊。',settingsTitle:'設定',settingsDesc:'面板、API Key、模型、穩定性與介面選項。',
      refresh:'重新整理',modelUsage:'模型統計',modelUsageDesc:'累計呼叫與輸出字元。',model:'模型',requests:'請求',errors:'錯誤',outputChars:'輸出字元',poolStatus:'帳號池狀態',poolStatusDesc:'可用、停用與冷卻帳號。',recentRequests:'最近請求',recentRequestsDesc:'最新八筆閘道活動。',viewAll:'查看全部',time:'時間',apiKey:'API Key',status:'狀態',latency:'耗時',detail:'詳情',totalRequests:'累計請求',todayRequests:'今日請求',todayErrors:'今日錯誤',availableAccounts:'可用帳號',enabledKeys:'啟用 Key',uptime:'執行時間',usable:'可用',disabled:'停用',cooling:'冷卻',anonymousFallback:'匿名上游回退',openMode:'無 Key 時開放模式',
      createKey:'簽發 API Key',baseUrl:'Base URL',chatEndpoint:'對話端點',imageEndpoint:'生圖端點',copy:'複製',modelCatalog:'模型目錄',modelCatalogDesc:'目錄會依面板工作階段與 Key 權限顯示。',publicModel:'對外模型 ID',upstreamModel:'上游 model',description:'說明',keyAccess:'API Key 驗證',manageKeys:'管理 Key',openAccess:'尚未簽發 Key，閘道可處於開放模式。',closedAccess:'尚未簽發 Key，但開放模式已關閉；下游請求會被拒絕。',protectedAccess:'閘道已啟用 API Key 驗證。',keyCreatedTitle:'API Key 已簽發',keyCreatedDesc:'請立即複製並妥善保存這把 Key。',keyCreatedWarning:'關閉後仍可在設定頁複製，但請勿在不可信裝置暴露金鑰。',close:'關閉',
      importJson:'匯入 JSON',exportJson:'匯出 JSON',addAccount:'新增帳號',browserLoginAdd:'登入新增',browserLoginTitle:'登入新增 DeepAI 帳號',browserLoginDesc:'產生登入連結，登入完成後自動加入帳號池。',browserLoginPrivacy:'登入連結會開啟隔離的 DeepAI 登入頁；登入完成後自動入池，不保存密碼。',browserLoginStarting:'正在產生登入連結…',browserLoginWaiting:'請開啟登入連結並完成 DeepAI 登入',browserLoginVerifying:'正在驗證登入並加入帳號池',browserLoginCompleted:'登入完成，帳號已加入',browserLoginFailed:'登入失敗',browserLoginCancelled:'登入已取消',browserLoginExpired:'登入連結已過期',browserLoginLink:'登入連結',startBrowserLogin:'產生登入連結',browserLoginExpires:'剩餘 {time}',browserLoginAccountAdded:'帳號 {name} 已加入帳號池',browserLoginStartFailed:'無法產生登入連結',browserLoginInvalidLink:'登入服務傳回了無效連結',browserLoginStep1:'產生登入連結',browserLoginStep1Hint:'由閘道建立一次性登入工作階段。',browserLoginStep2:'開啟連結並登入',browserLoginStep2Hint:'點擊連結，在新頁面完成 DeepAI 登入。',browserLoginStep3:'自動加入帳號池',browserLoginStep3Hint:'面板會自動偵測結果，不需複製 Cookie。',browserLoginClickLink:'點擊此連結開啟登入頁',searchAccounts:'搜尋名稱、信箱、群組或錯誤',allTypes:'全部類型',passwordLogin:'帳號密碼',allGroups:'全部群組',allStatus:'全部狀態',active:'啟用',sortName:'名稱 A–Z',sortWeight:'權重高優先',sortUses:'使用多優先',sortNewest:'最新加入',noneSelected:'未選擇帳號',test:'測試',refreshLogin:'重登',enable:'啟用',disable:'停用',reset:'重設',delete:'刪除',account:'帳號',type:'類型',group:'群組',weight:'權重',plan:'方案 / 點數',uses:'使用',lastError:'最近錯誤',actions:'操作',previous:'上一頁',next:'下一頁',edit:'編輯',noAccounts:'沒有符合的帳號',selectedCount:'已選擇 {count} 個帳號',pageSummary:'第 {page}/{pages} 頁 · 共 {total} 個',
      today:'今天',sevenDays:'7 天',thirtyDays:'30 天',requestTrend:'請求趨勢',requestTrendDesc:'按日請求與錯誤。',byModel:'按模型',byKey:'按 API Key',errorRate:'錯誤率',pauseRefresh:'暫停重新整理',resumeRefresh:'恢復重新整理',clearLogs:'清空日誌',searchLogs:'搜尋模型、Key、上游或錯誤',allResults:'全部結果',success:'成功',failed:'失敗',endpoint:'端點',upstream:'上游',noData:'尚無資料',
      settingsBasic:'基本',settingsApi:'API 與驗證',settingsModel:'模型',settingsStability:'穩定性',settingsSystem:'系統與介面',basicDesc:'面板密碼、主題與介面語言。',currentPassword:'目前密碼',newPassword:'新密碼',changePassword:'修改密碼',theme:'主題',themeSystem:'跟隨系統',themeLight:'亮色',themeDark:'暗色',language:'介面語言',saveSettings:'儲存設定',apiDesc:'下游 API Key、開放模式與匿名回退。',openModeDesc:'僅在尚未簽發任何 Key 時允許匿名下游呼叫。',anonymousFallbackDesc:'帳號池不可用時嘗試 DeepAI 訪客流程。',gatewayKeys:'下游 API Key',gatewayKeysDesc:'可限制模型、帳號與請求次數。',addKey:'新增 Key',modelSettingsDesc:'預設模型、模型映射與未知模型直通。',defaultModel:'預設模型',passthroughModels:'未知模型直通',passthroughDesc:'允許未列入映射的模型名稱直接傳給上游。',modelMap:'模型映射 JSON',stabilityDesc:'請求逾時、日誌容量與控制台重新整理頻率。',requestTimeout:'上游逾時（毫秒）',logLimit:'日誌上限',pollInterval:'面板重新整理間隔（毫秒）',systemDesc:'頁面可見性、視窗限高與部署資訊。',visiblePages:'可見頁面',windowMaxHeight:'區塊最大高度（0 = 不限制）',
      more:'更多',cycleTheme:'切換主題',accountModalDesc:'選擇 DeepAI 憑證類型並填寫安全資訊。',nameOptional:'名稱（選填）',groupOptional:'群組（選填）',cookieHint:'可一次貼入多行 Cookie，每行建立一個帳號。',email:'信箱',password:'密碼',cancel:'取消',editAccount:'編輯帳號',name:'名稱',save:'儲存',importAccounts:'匯入帳號 JSON',importDesc:'選擇匯出檔或貼入 version 1 JSON。',credentialWarning:'檔案可能包含 Cookie、密碼與 API Key，請只在可信裝置處理。',selectFile:'選擇檔案',import:'匯入',keyModalDesc:'空白模型或帳號代表不限制。',allowedModels:'允許模型 / 萬用字元',modelsCsvHint:'逗號分隔，支援 *。',requestLimit:'請求上限（0 = 無限）',allowedAccounts:'允許帳號',selectAll:'全選',clear:'清除',accountRestrictionHint:'不選擇代表全部帳號；選擇帳號後不會匿名回退。',copied:'已複製',saved:'已儲存',created:'已建立',deleted:'已刪除',operationFailed:'操作失敗',sessionExpired:'登入已過期，請重新登入',wrongPassword:'密碼不正確',gatewayUnavailable:'閘道無法連線',confirmDelete:'確定刪除？此操作無法復原。',confirmClearLogs:'確定清空所有請求日誌？',confirmExport:'匯出檔會包含 Cookie、密碼或 API Key。請確認目前裝置安全並繼續。',
    },
    en: {
      loginTitle:'Open console',loginDescription:'Use the panel password to manage the gateway, accounts and settings.',panelPassword:'Panel password',rememberLogin:'Keep me signed in',enterConsole:'Open console',defaultPasswordHint:'The default panel password is still active. Change it after signing in.',workspace:'Workspace',repository:'Repository',logout:'Sign out',gatewayOnline:'Gateway online',healthy:'Healthy',offline:'Offline',
      navOverview:'Overview',navGateway:'Gateway',navAccounts:'Accounts',navAnalytics:'Analytics',navLogs:'Logs',navSettings:'Settings',overviewTitle:'Runtime overview',overviewDesc:'Gateway, account pool and recent requests at a glance.',gatewayTitle:'Gateway',gatewayDesc:'OpenAI-compatible URLs, model catalog and downstream authentication.',accountsTitle:'Accounts',accountsDesc:'Manage DeepAI cookies, password logins and API key credentials.',analyticsTitle:'Usage analytics',analyticsDesc:'Today, 7-day and 30-day windows in the server timezone.',logsTitle:'Request logs',logsDesc:'Filter gateway calls, upstream accounts and errors.',settingsTitle:'Settings',settingsDesc:'Panel, API keys, models, stability and interface options.',
      refresh:'Refresh',modelUsage:'Model usage',modelUsageDesc:'Cumulative calls and output characters.',model:'Model',requests:'Requests',errors:'Errors',outputChars:'Output chars',poolStatus:'Account pool',poolStatusDesc:'Usable, disabled and cooling accounts.',recentRequests:'Recent requests',recentRequestsDesc:'The eight newest gateway events.',viewAll:'View all',time:'Time',apiKey:'API key',status:'Status',latency:'Latency',detail:'Details',totalRequests:'Total requests',todayRequests:'Today',todayErrors:'Today errors',availableAccounts:'Usable accounts',enabledKeys:'Enabled keys',uptime:'Uptime',usable:'Usable',disabled:'Disabled',cooling:'Cooling',anonymousFallback:'Anonymous upstream fallback',openMode:'Open mode without keys',
      createKey:'Issue API key',baseUrl:'Base URL',chatEndpoint:'Chat endpoint',imageEndpoint:'Image endpoint',copy:'Copy',modelCatalog:'Model catalog',modelCatalogDesc:'The catalog follows the panel session and key permissions.',publicModel:'Public model ID',upstreamModel:'Upstream model',description:'Description',keyAccess:'API key access',manageKeys:'Manage keys',openAccess:'No keys have been issued; the gateway may run in open mode.',closedAccess:'No keys have been issued, but open mode is disabled; downstream requests will be rejected.',protectedAccess:'API key authentication is enabled.',keyCreatedTitle:'API key issued',keyCreatedDesc:'Copy and store this key now.',keyCreatedWarning:'You can still copy it from Settings later, but never expose it on an untrusted device.',close:'Close',
      importJson:'Import JSON',exportJson:'Export JSON',addAccount:'Add account',browserLoginAdd:'Sign in & add',browserLoginTitle:'Sign in and add a DeepAI account',browserLoginDesc:'Generate a sign-in link; the account is added automatically after sign-in.',browserLoginPrivacy:'The link opens an isolated DeepAI sign-in page. After sign-in, the account is added automatically and the password is not stored.',browserLoginStarting:'Generating sign-in link…',browserLoginWaiting:'Open the link and finish signing in to DeepAI',browserLoginVerifying:'Verifying sign-in and adding the account',browserLoginCompleted:'Sign-in complete; account added',browserLoginFailed:'Sign-in failed',browserLoginCancelled:'Sign-in cancelled',browserLoginExpired:'Sign-in link expired',browserLoginLink:'Sign-in link',startBrowserLogin:'Generate sign-in link',browserLoginExpires:'{time} remaining',browserLoginAccountAdded:'Account {name} was added to the pool',browserLoginStartFailed:'Could not generate sign-in link',browserLoginInvalidLink:'The sign-in service returned an invalid link',browserLoginStep1:'Generate sign-in link',browserLoginStep1Hint:'The gateway creates a one-time sign-in session.',browserLoginStep2:'Open the link and sign in',browserLoginStep2Hint:'Select the link and finish signing in to DeepAI on the new page.',browserLoginStep3:'Add to the account pool',browserLoginStep3Hint:'The console detects completion automatically; no cookies to copy.',browserLoginClickLink:'Open the sign-in page',searchAccounts:'Search name, email, group or error',allTypes:'All types',passwordLogin:'Email/password',allGroups:'All groups',allStatus:'All states',active:'Active',sortName:'Name A–Z',sortWeight:'Highest weight',sortUses:'Most used',sortNewest:'Newest',noneSelected:'No accounts selected',test:'Test',refreshLogin:'Relogin',enable:'Enable',disable:'Disable',reset:'Reset',delete:'Delete',account:'Account',type:'Type',group:'Group',weight:'Weight',plan:'Plan / credits',uses:'Uses',lastError:'Last error',actions:'Actions',previous:'Previous',next:'Next',edit:'Edit',noAccounts:'No matching accounts',selectedCount:'{count} accounts selected',pageSummary:'Page {page}/{pages} · {total} total',
      today:'Today',sevenDays:'7 days',thirtyDays:'30 days',requestTrend:'Request trend',requestTrendDesc:'Daily requests and errors.',byModel:'By model',byKey:'By API key',errorRate:'Error rate',pauseRefresh:'Pause refresh',resumeRefresh:'Resume refresh',clearLogs:'Clear logs',searchLogs:'Search model, key, upstream or error',allResults:'All results',success:'Success',failed:'Failed',endpoint:'Endpoint',upstream:'Upstream',noData:'No data',
      settingsBasic:'Basic',settingsApi:'API & access',settingsModel:'Models',settingsStability:'Stability',settingsSystem:'System & UI',basicDesc:'Panel password, theme and language.',currentPassword:'Current password',newPassword:'New password',changePassword:'Change password',theme:'Theme',themeSystem:'System',themeLight:'Light',themeDark:'Dark',language:'Language',saveSettings:'Save settings',apiDesc:'Downstream API keys, open mode and anonymous fallback.',openModeDesc:'Allow downstream calls without a key only before any key is issued.',anonymousFallbackDesc:'Try DeepAI guest flow when the account pool is unavailable.',gatewayKeys:'Downstream API keys',gatewayKeysDesc:'Restrict models, accounts and request counts.',addKey:'Add key',modelSettingsDesc:'Default model, mapping and unknown-model passthrough.',defaultModel:'Default model',passthroughModels:'Unknown-model passthrough',passthroughDesc:'Pass unmapped model names directly upstream.',modelMap:'Model map JSON',stabilityDesc:'Request timeout, log capacity and console polling.',requestTimeout:'Upstream timeout (ms)',logLimit:'Log limit',pollInterval:'Panel polling interval (ms)',systemDesc:'Visible pages, height caps and deployment facts.',visiblePages:'Visible pages',windowMaxHeight:'Section max height (0 = unlimited)',
      more:'More',cycleTheme:'Cycle theme',accountModalDesc:'Choose a DeepAI credential type and enter its secure fields.',nameOptional:'Name (optional)',groupOptional:'Group (optional)',cookieHint:'Paste multiple cookie lines to create multiple accounts.',email:'Email',password:'Password',cancel:'Cancel',editAccount:'Edit account',name:'Name',save:'Save',importAccounts:'Import account JSON',importDesc:'Choose an export or paste version 1 JSON.',credentialWarning:'The file may contain cookies, passwords and API keys. Handle it only on a trusted device.',selectFile:'Choose file',import:'Import',keyModalDesc:'Blank models or accounts mean unrestricted.',allowedModels:'Allowed models / wildcards',modelsCsvHint:'Comma-separated; * is supported.',requestLimit:'Request limit (0 = unlimited)',allowedAccounts:'Allowed accounts',selectAll:'Select all',clear:'Clear',accountRestrictionHint:'No selection means every account; selecting accounts disables anonymous fallback.',copied:'Copied',saved:'Saved',created:'Created',deleted:'Deleted',operationFailed:'Operation failed',sessionExpired:'Session expired. Sign in again.',wrongPassword:'Incorrect password',gatewayUnavailable:'Gateway unavailable',confirmDelete:'Delete this item? This cannot be undone.',confirmClearLogs:'Clear every request log?',confirmExport:'The export contains cookies, passwords or API keys. Continue only on a trusted device.',
    },
  };

  const state = {
    token: '', authenticated: false, page: 'overview', settingsGroup: 'basic',
    settings: Core.normalizeSettings({}), accounts: [], gatewayKeys: [], logs: [], models: [],
    accountPage: 1, accountPageSize: 12, selectedAccounts: new Set(), analyticsRange: '7d',
    logPoll: true, pollTimer: null, health: null, status: {}, loading: new Set(), keyAccountSelection: new Set(),
    browserLogin: { sessionState:'', authUrl:'', expiresAt:'', status:'', lastProgressStatus:'', timer:null, countdownTimer:null },
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = Core.escapeHtml;
  const t = (key, vars) => {
    let value = Core.translate(MESSAGES, state.settings.uiLanguage, key);
    for (const [name, replacement] of Object.entries(vars || {})) value = value.replaceAll(`{${name}}`, replacement);
    return value;
  };
  const fmtNum = (value) => (Number(value) || 0).toLocaleString(state.settings.uiLanguage);
  const fmtTime = (value) => value ? new Date(value).toLocaleString(state.settings.uiLanguage, { hour12: false }) : '—';
  const fmtMs = (value) => value === undefined || value === null ? '—' : Number(value) < 1000 ? `${value}ms` : `${(Number(value) / 1000).toFixed(1)}s`;
  const fmtDuration = (value) => { const seconds = Math.max(0, Math.round((Number(value) || 0) / 1000)); const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60); return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`; };

  function readStoredToken() {
    try { return sessionStorage.getItem(PANEL_STORE) || localStorage.getItem(PANEL_STORE) || ''; } catch (error) { return ''; }
  }
  function storeToken(token, remember) {
    try {
      sessionStorage.setItem(PANEL_STORE, token);
      if (remember) { localStorage.setItem(PANEL_STORE, token); localStorage.setItem(REMEMBER_STORE, '1'); }
      else { localStorage.removeItem(PANEL_STORE); localStorage.removeItem(REMEMBER_STORE); }
    } catch (error) { /* storage is optional */ }
  }
  function clearStoredToken() {
    try { sessionStorage.removeItem(PANEL_STORE); localStorage.removeItem(PANEL_STORE); } catch (error) { /* ignore */ }
  }
  function toast(message, kind = 'ok') {
    const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = message; $('#toastBox').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 300); }, 3000);
  }
  function setFormMessage(id, message = '', kind = 'bad') { const el = $(`#${id}`); if (!el) return; el.textContent = message; el.style.color = kind === 'ok' ? 'var(--accent2)' : 'var(--bad)'; }
  function setBusy(button, busy, label) { if (!button) return; if (busy) { button.dataset.previousText = button.textContent; button.disabled = true; button.textContent = label || '…'; } else { button.disabled = false; button.textContent = button.dataset.previousText || button.textContent; } }

  async function api(path, options = {}) {
    const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (state.token) headers['X-Panel-Token'] = state.token;
    let response;
    try { response = await fetch(path, { cache: 'no-store', ...options, headers }); }
    catch (error) { throw new Error(t('gatewayUnavailable')); }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { requireLogin(); throw new Error(t('sessionExpired')); }
    if (!response.ok) {
      const raw = body.error?.message || body.error || body.message || `HTTP ${response.status}`;
      throw new Error(String(raw));
    }
    return body;
  }
  async function panelFetch(path, options = {}) {
    const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (state.token) headers['X-Panel-Token'] = state.token;
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error || body.message || `HTTP ${response.status}`));
    return body;
  }

  function applyLanguage() {
    document.documentElement.lang = state.settings.uiLanguage;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $('#quickLanguage').value = state.settings.uiLanguage;
    $('#settingLanguage').value = state.settings.uiLanguage;
    updatePageHeading();
    if (state.browserLogin.status) renderBrowserLoginStatus({ status:state.browserLogin.status, expiresAt:state.browserLogin.expiresAt });
  }
  function resolveTheme(pref) { return pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref; }
  function applyTheme(pref, persist = true) {
    const next = ['light', 'dark', 'system'].includes(pref) ? pref : 'system';
    state.settings.theme = next; document.documentElement.dataset.theme = resolveTheme(next); document.documentElement.dataset.themePref = next;
    $('#settingTheme').value = next;
    if (persist) try { localStorage.setItem(THEME_STORE, next); } catch (error) { /* ignore */ }
  }
  function cycleTheme() { const order = ['system', 'light', 'dark']; applyTheme(order[(order.indexOf(state.settings.theme) + 1) % order.length]); }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.settings.theme === 'system') applyTheme('system', false); });

  function requireLogin() {
    state.authenticated = false; state.token = ''; clearStoredToken(); stopPolling();
    document.documentElement.classList.remove('wb-panel-session'); $('#panelGate').hidden = false; $('#panelGate').style.display = 'flex';
    setTimeout(() => $('#panelPwdInput')?.focus(), 0);
  }
  function enterConsole() { state.authenticated = true; document.documentElement.classList.add('wb-panel-session'); $('#panelGate').hidden = true; $('#panelGate').style.display = 'none'; startPolling(); }

  async function submitLogin(event) {
    event.preventDefault(); const button = $('#panelLoginBtn'); setFormMessage('panelLoginMsg'); setBusy(button, true);
    try {
      const body = { password: $('#panelPwdInput').value, remember: $('#panelRemember').checked };
      const result = await panelFetch('/panel/login', { method: 'POST', body: JSON.stringify(body) });
      if (!result.token) throw new Error(t('wrongPassword'));
      state.token = result.token; storeToken(result.token, body.remember); $('#panelPwdInput').value = ''; enterConsole(); await loadInitialData();
    } catch (error) { setFormMessage('panelLoginMsg', /password/i.test(error.message) ? t('wrongPassword') : error.message); }
    finally { setBusy(button, false); }
  }
  async function logout() { try { await api('/panel/logout', { method: 'POST', body: '{}' }); } catch (error) { /* session can already be gone */ } requireLogin(); }

  function updatePageHeading() { const meta = PAGE_META[state.page] || PAGE_META.overview; $('#nextPageTitle').textContent = t(meta[0]); $('#nextPageDesc').textContent = t(meta[1]); }
  function applyVisiblePages() {
    const visible = new Set(state.settings.visiblePages || Core.PAGE_IDS);
    $$('[data-nav-page]').forEach((el) => { const page = el.dataset.navPage; if (page) el.hidden = !visible.has(page); });
    if (!visible.has(state.page)) goPage(visible.has('overview') ? 'overview' : 'settings');
  }
  function goPage(page) {
    if (!(state.settings.visiblePages || Core.PAGE_IDS).includes(page) && page !== 'settings') return;
    state.page = page;
    $$('.main-page').forEach((el) => { const active = el.dataset.page === page; el.classList.toggle('active', active); el.hidden = !active; });
    $$('[data-nav-page]').forEach((el) => el.classList.toggle('active', el.dataset.navPage === page));
    updatePageHeading(); closeMobileNav(); closeMore(); refreshPage(page);
    try { const url = new URL(location.href); url.searchParams.set('tab', page); history.replaceState(null, '', url); } catch (error) { /* ignore */ }
  }
  function openMobileNav() { document.body.classList.add('next-sidebar-open'); }
  function closeMobileNav() { document.body.classList.remove('next-sidebar-open'); }
  function openMore() { $('#nextMoreSheet').classList.add('open'); $('#nextMoreSheet').setAttribute('aria-hidden', 'false'); document.body.classList.add('next-more-open'); }
  function closeMore() { $('#nextMoreSheet').classList.remove('open'); $('#nextMoreSheet').setAttribute('aria-hidden', 'true'); document.body.classList.remove('next-more-open'); }

  function badge(text, kind = 'off') { return `<span class="badge ${kind}">${esc(text)}</span>`; }
  function emptyRow(columns, label = t('noData')) { return `<tr><td colspan="${columns}" class="empty-cell">${esc(label)}</td></tr>`; }
  function kpi(label, value, sub = '', kind = '') { return `<article class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value ${kind}">${value}</div><div class="kpi-sub">${esc(sub)}</div></article>`; }
  function logStatus(log) { return log.status === 'ok' ? badge(t('success'), 'ok') : log.status === 'pending' ? badge('Pending', 'warn') : badge(t('failed'), 'bad'); }

  async function loadOverview() {
    const [overview, today, logData] = await Promise.all([api('/api/admin/overview'), api('/api/admin/analytics?range=today').catch(() => null), api('/api/admin/logs?limit=8')]);
    state.logs = logData.logs || [];
    const daily = today?.kpis || { requests: 0, errors: 0, errorRate: 0, chars: 0, avgLatencyMs: 0 };
    $('#overviewKpis').innerHTML = kpi(t('todayRequests'), fmtNum(daily.requests), `${t('latency')} ${fmtMs(daily.avgLatencyMs)}`) + kpi(t('todayErrors'), fmtNum(daily.errors), `${daily.errorRate || 0}%`, daily.errors ? 'bad-text' : '') + kpi(t('outputChars'), fmtNum(daily.chars)) + kpi(t('availableAccounts'), `${fmtNum(overview.accounts.usable)} / ${fmtNum(overview.accounts.total)}`) + kpi(t('enabledKeys'), `${fmtNum(overview.gateway.enabled)} / ${fmtNum(overview.gateway.total)}`, `${fmtNum(overview.gateway.uses)} ${t('uses')}`) + kpi(t('uptime'), fmtDuration(overview.uptimeMs), `v${overview.version || state.health?.version || ''}`);
    const models = Object.entries(overview.stats.perModel || {}).sort((left, right) => (right[1].requests || 0) - (left[1].requests || 0));
    $('#overviewModelsBody').innerHTML = models.length ? models.map(([name, row]) => `<tr><td class="mono">${esc(name)}</td><td class="num">${fmtNum(row.requests)}</td><td class="num ${row.errors ? 'bad-text' : ''}">${fmtNum(row.errors)}</td><td class="num">${fmtNum(row.chars)}</td></tr>`).join('') : emptyRow(4);
    $('#overviewPool').innerHTML = `<div class="status-row"><span>${t('usable')}</span><strong>${fmtNum(overview.accounts.usable)}</strong></div><div class="status-row"><span>${t('disabled')}</span><strong>${fmtNum(overview.accounts.disabled)}</strong></div><div class="status-row"><span>${t('cooling')}</span><strong>${fmtNum(overview.accounts.cooling)}</strong></div><div class="status-row"><span>${t('anonymousFallback')}</span>${badge(overview.accounts.anonymousFallback ? t('active') : t('disabled'), overview.accounts.anonymousFallback ? 'ok' : 'off')}</div>`;
    $('#overviewRecentBody').innerHTML = state.logs.length ? state.logs.map((log) => `<tr><td class="mono">${fmtTime(log.ts)}</td><td>${esc(log.model || '')}</td><td>${esc(log.gatewayKey || '')}</td><td>${logStatus(log)}</td><td class="num">${fmtMs(log.latencyMs)}</td><td class="wrap" title="${esc(log.error || log.preview || '')}">${esc((log.error || log.preview || '').slice(0, 70))}</td></tr>`).join('') : emptyRow(6);
  }

  async function loadGateway(force = false) {
    if (force || !state.models.length) {
      const response = await fetch('/v1/models', { cache: 'no-store', headers: state.token ? { 'X-Panel-Token': state.token } : {} });
      if (response.status === 401) { requireLogin(); throw new Error(t('sessionExpired')); }
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(data.error?.message || data.error || `HTTP ${response.status}`)); state.models = data.data || [];
    }
    if (!state.gatewayKeys.length) await loadGatewayKeys();
    const base = `${location.origin}/v1`; $('#gatewayBaseUrl').textContent = base; $('#gatewayChatUrl').textContent = `${base}/chat/completions`; $('#gatewayImageUrl').textContent = `${base}/images/generations`;
    const map = state.settings.modelMap || {};
    $('#gatewayModelsBody').innerHTML = state.models.length ? state.models.map((model) => `<tr><td class="mono">${esc(model.id)}</td><td class="mono">${esc(map[model.id] || model.id.replace(/^deepai-/, '') || '—')}</td><td>${model.id === state.settings.defaultModel ? badge(t('defaultModel'), 'ok') : ''}</td></tr>`).join('') : emptyRow(3);
    const enabled = state.gatewayKeys.filter((key) => key.enabled).length; $('#gatewayKeySummary').textContent = `${enabled} / ${state.gatewayKeys.length} ${t('active')}`;
    const empty = state.gatewayKeys.length === 0; const open = empty && state.settings.allowOpenWhenNoKeys; $('#gatewayAccessCallout').textContent = open ? t('openAccess') : empty ? t('closedAccess') : t('protectedAccess'); $('#gatewayAccessCallout').className = `callout ${open ? 'warning' : empty ? 'bad' : ''}`;
  }

  async function loadAccounts() { const data = await api('/api/admin/accounts'); state.accounts = data.accounts || []; updateGroupFilter(); renderAccounts(); }
  function accountFilters() { return { query: $('#accountSearch').value, type: $('#accountTypeFilter').value, group: $('#accountGroupFilter').value, status: $('#accountStatusFilter').value, sort: $('#accountSort').value }; }
  function updateGroupFilter() {
    const select = $('#accountGroupFilter'); const current = select.value; const groups = Array.from(new Set(state.accounts.map((account) => String(account.group || '').trim()).filter(Boolean))).sort();
    select.innerHTML = `<option value="all">${esc(t('allGroups'))}</option>${groups.map((group) => `<option value="${esc(group)}">${esc(group)}</option>`).join('')}`; select.value = groups.includes(current) ? current : 'all';
  }
  function renderAccounts() {
    const filtered = Core.filterAccounts(state.accounts, accountFilters()); const page = Core.paginate(filtered, state.accountPage, state.accountPageSize); state.accountPage = page.page;
    $('#accountsBody').innerHTML = page.items.length ? page.items.map((account) => {
      const label = account.name || account.email || account.cookiePreview || account.apiKeyPreview || account.id;
      const sub = account.email || account.cookiePreview || account.apiKeyPreview || account.id;
      const status = Core.accountStatus(account); const selected = state.selectedAccounts.has(account.id);
      return `<tr data-account-id="${esc(account.id)}"><td><input type="checkbox" data-account-select="${esc(account.id)}" ${selected ? 'checked' : ''}></td><td><div class="account-title"><b>${esc(label)}</b></div><div class="account-sub mono">${esc(sub)}</div></td><td>${badge({cookie:'Cookie',login:t('passwordLogin'),apikey:'API Key'}[account.type] || account.type)}</td><td>${account.group ? `<span class="group-chip">${esc(account.group)}</span>` : '—'}</td><td class="num">${fmtNum(account.weight || 1)}</td><td>${badge(status === 'active' ? t('active') : status === 'cooling' ? t('cooling') : t('disabled'), status === 'active' ? 'ok' : status === 'cooling' ? 'warn' : 'bad')}</td><td>${esc(account.userInfo?.plan || account.userInfo?.username || '—')}</td><td class="num">${fmtNum(account.uses)}</td><td class="wrap ${account.lastErrorMessage ? 'bad-text' : ''}" title="${esc(account.lastErrorMessage || '')}">${esc((account.lastErrorMessage || '—').slice(0, 55))}</td><td><div class="row-actions"><button type="button" class="sec mini" data-account-action="edit" data-id="${esc(account.id)}">${t('edit')}</button><button type="button" class="sec mini" data-account-action="test" data-id="${esc(account.id)}">${t('test')}</button><button type="button" class="sec mini" data-account-action="${account.status === 'disabled' ? 'enable' : 'disable'}" data-id="${esc(account.id)}">${account.status === 'disabled' ? t('enable') : t('disable')}</button><button type="button" class="sec mini danger" data-account-action="delete" data-id="${esc(account.id)}">${t('delete')}</button></div></td></tr>`;
    }).join('') : emptyRow(10, t('noAccounts'));
    $('#accountPageSummary').textContent = t('pageSummary', { page: page.page, pages: page.pages, total: page.total });
    $('[data-action="account-prev"]').disabled = page.page <= 1; $('[data-action="account-next"]').disabled = page.page >= page.pages;
    const selectedOnPage = page.items.filter((account) => state.selectedAccounts.has(account.id)).length; $('#accountSelectPage').checked = page.items.length > 0 && selectedOnPage === page.items.length; $('#accountSelectPage').indeterminate = selectedOnPage > 0 && selectedOnPage < page.items.length;
    $('#accountSelectionSummary').textContent = state.selectedAccounts.size ? t('selectedCount', { count: state.selectedAccounts.size }) : t('noneSelected');
  }

  async function loadAnalytics() {
    const data = await api(`/api/admin/analytics?range=${encodeURIComponent(state.analyticsRange)}`);
    $('#analyticsKpis').innerHTML = kpi(t('requests'), fmtNum(data.kpis.requests)) + kpi(t('errors'), fmtNum(data.kpis.errors), `${data.kpis.errorRate}%`, data.kpis.errors ? 'bad-text' : '') + kpi(t('outputChars'), fmtNum(data.kpis.chars)) + kpi(t('latency'), fmtMs(data.kpis.avgLatencyMs));
    const max = Math.max(1, ...(data.days || []).map((day) => day.requests || 0)); $('#analyticsChart').innerHTML = (data.days || []).map((day) => { const height = Math.max(2, Math.round((day.requests || 0) / max * 100)); const ratio = day.requests ? Math.round((day.errors || 0) / day.requests * 100) : 0; return `<div class="bar-column" title="${esc(day.date)} · ${fmtNum(day.requests)}"><div class="bar-track"><div class="bar-fill error" style="height:${height}%;--error-ratio:${ratio}%"></div></div><div class="bar-label">${esc(day.date.slice(5))}</div></div>`; }).join('');
    $('#analyticsModelsBody').innerHTML = data.perModel?.length ? data.perModel.map((row) => `<tr><td>${esc(row.model)}</td><td class="num">${fmtNum(row.requests)}</td><td class="num ${row.errors ? 'bad-text' : ''}">${fmtNum(row.errors)}</td><td class="num">${fmtMs(row.latencyMs)}</td></tr>`).join('') : emptyRow(4);
    $('#analyticsKeysBody').innerHTML = data.perGatewayKey?.length ? data.perGatewayKey.map((row) => `<tr><td>${esc(row.key)}</td><td class="num">${fmtNum(row.requests)}</td><td class="num ${row.errors ? 'bad-text' : ''}">${fmtNum(row.errors)}</td><td class="num">${row.requests ? Math.round(row.errors / row.requests * 100) : 0}%</td></tr>`).join('') : emptyRow(4);
  }

  async function loadLogs() { const data = await api('/api/admin/logs?limit=200'); state.logs = data.logs || []; renderLogs(); }
  function renderLogs() {
    const query = $('#logSearch').value.trim().toLowerCase(); const outcome = $('#logOutcome').value;
    const rows = state.logs.filter((log) => (!query || [log.kind, log.model, log.gatewayKey, log.upstream, log.error, log.preview].join(' ').toLowerCase().includes(query)) && (!outcome || log.status === outcome));
    $('#logsBody').innerHTML = rows.length ? rows.map((log) => `<tr><td class="mono">${fmtTime(log.ts)}</td><td class="mono">${esc(log.kind || '')}</td><td>${esc(log.model || '')}</td><td>${esc(log.gatewayKey || '')}</td><td>${esc(log.upstream === 'anonymous' ? t('anonymousFallback') : String(log.upstream || '').slice(0, 18))}</td><td>${logStatus(log)}</td><td class="num">${fmtMs(log.latencyMs)}</td><td class="wrap" title="${esc(log.error || log.preview || '')}">${esc((log.error || log.preview || '').slice(0, 80))}</td></tr>`).join('') : emptyRow(8);
    $('#logCount').textContent = `${rows.length} / ${state.logs.length}`;
  }

  async function loadGatewayKeys() { const data = await api('/api/admin/gateway-keys'); state.gatewayKeys = data.keys || []; renderKeyCards(); }
  function renderKeyCards() {
    $('#settingsKeyCards').innerHTML = state.gatewayKeys.length ? state.gatewayKeys.map((key) => `<article class="key-card ${key.enabled ? '' : 'disabled'}"><div class="key-card-head"><div class="key-card-name"><b>${esc(key.name || '(unnamed)')}</b><div class="key-mask mono">${esc(String(key.key || key.masked || '').slice(0, 24))}${key.key?.length > 24 ? '…' : ''}</div></div>${badge(key.enabled ? t('active') : t('disabled'), key.enabled ? 'ok' : 'bad')}</div><div class="key-meta">${badge(key.models?.length ? `${key.models.length} ${t('model')}` : 'All models')}${badge(key.accountIds?.length ? `${key.accountIds.length} ${t('account')}` : 'All accounts')}${badge(key.requestLimit ? `${fmtNum(key.uses)} / ${fmtNum(key.requestLimit)}` : `${fmtNum(key.uses)} uses`)}</div><div class="key-card-foot"><span>${fmtTime(key.lastUsedAt)}</span><div class="row-actions"><button type="button" class="sec mini" data-key-action="copy" data-id="${esc(key.id)}">${t('copy')}</button><button type="button" class="sec mini" data-key-action="edit" data-id="${esc(key.id)}">${t('edit')}</button><button type="button" class="sec mini" data-key-action="toggle" data-id="${esc(key.id)}">${key.enabled ? t('disable') : t('enable')}</button><button type="button" class="sec mini danger" data-key-action="delete" data-id="${esc(key.id)}">${t('delete')}</button></div></div></article>`).join('') : `<div class="callout ${state.settings.allowOpenWhenNoKeys ? 'warning' : 'bad'}">${esc(t(state.settings.allowOpenWhenNoKeys ? 'openAccess' : 'closedAccess'))}</div>`;
  }

  async function loadSettings() {
    const [data, status] = await Promise.all([api('/api/admin/settings'), api('/panel/status')]); state.status = status; state.settings = Core.normalizeSettings(data.settings || {});
    $('#settingDefaultModel').value = state.settings.defaultModel; $('#settingModelMap').value = JSON.stringify(state.settings.modelMap || {}, null, 2); $('#settingPassthrough').checked = state.settings.passThroughModels; $('#settingTimeout').value = state.settings.requestTimeoutMs; $('#settingOpenMode').checked = state.settings.allowOpenWhenNoKeys; $('#settingAnonymousFallback').checked = state.settings.allowAnonymousFallback; $('#settingLogLimit').value = state.settings.maxLogEntries; $('#settingPollInterval').value = state.settings.pollIntervalMs; $('#settingWindowMaxHeight').value = state.settings.windowMaxHeight; $('#settingTheme').value = state.settings.theme; $('#settingLanguage').value = state.settings.uiLanguage;
    $$('#visiblePagesGrid input').forEach((input) => { input.checked = state.settings.visiblePages.includes(input.value); });
    $('#passwordHint').textContent = status.panel_password_is_default ? t('defaultPasswordHint') : '';
    $('#environmentFacts').innerHTML = `<div class="fact"><span>Origin</span><b class="mono">${esc(location.origin)}</b></div><div class="fact"><span>Version</span><b>${esc(state.health?.version || '—')}</b></div><div class="fact"><span>Crypto</span><b>${status.crypto_ok === false ? 'Unavailable' : 'OK'}</b></div>`;
    applyLanguage(); applyTheme(state.settings.theme); applyVisiblePages(); applyWindowHeight(); restartPolling();
  }
  function applyWindowHeight() { document.documentElement.style.setProperty('--window-max-height', state.settings.windowMaxHeight ? `${state.settings.windowMaxHeight}px` : 'none'); }
  async function saveSettings(button) {
    let modelMap; try { modelMap = Core.parseModelMap($('#settingModelMap').value); } catch (error) { return toast(error.message, 'bad'); }
    const visiblePages = $$('#visiblePagesGrid input:checked').map((input) => input.value);
    const payload = { defaultModel: $('#settingDefaultModel').value.trim(), modelMap, passThroughModels: $('#settingPassthrough').checked, requestTimeoutMs: Number($('#settingTimeout').value), allowOpenWhenNoKeys: $('#settingOpenMode').checked, allowAnonymousFallback: $('#settingAnonymousFallback').checked, maxLogEntries: Number($('#settingLogLimit').value), pollIntervalMs: Number($('#settingPollInterval').value), theme: $('#settingTheme').value, uiLanguage: $('#settingLanguage').value, visiblePages, windowMaxHeight: Number($('#settingWindowMaxHeight').value) };
    setBusy(button, true); try { const result = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) }); state.settings = Core.normalizeSettings(result.settings || payload); applyLanguage(); applyTheme(state.settings.theme); applyVisiblePages(); applyWindowHeight(); restartPolling(); toast(t('saved')); } catch (error) { toast(error.message, 'bad'); } finally { setBusy(button, false); }
  }

  function openModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => $('input:not([type="hidden"]),textarea,select', modal)?.focus(), 0); }
  function closeModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.hidden = true; if (!$$('.modal-mask:not([hidden])').length) document.body.style.overflow = ''; }
  function selectAccountType(type) { $('#accountType').value = type; $$('[data-account-type]').forEach((button) => button.classList.toggle('active', button.dataset.accountType === type)); $$('[data-account-fields]').forEach((box) => { box.hidden = box.dataset.accountFields !== type; }); }
  function resetAccountForm() { $('#accountForm').reset(); $('#accountWeight').value = '1'; selectAccountType('cookie'); setFormMessage('accountFormMessage'); }
  async function submitAccount(event) {
    event.preventDefault(); const button = $('#accountSubmitBtn'); const type = $('#accountType').value; const common = { type, name: $('#accountName').value.trim(), group: $('#accountGroup').value.trim(), weight: Number($('#accountWeight').value) || 1 };
    if (type === 'cookie') common.cookie = $('#accountCookie').value.trim(); if (type === 'login') { common.email = $('#accountEmail').value.trim(); common.password = $('#accountPassword').value; } if (type === 'apikey') common.apiKey = $('#accountApiKey').value.trim();
    setBusy(button, true); setFormMessage('accountFormMessage'); try { const result = await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify(common) }); closeModal('accountModal'); resetAccountForm(); await loadAccounts(); toast(`${t('created')} ${result.added || 1}`); } catch (error) { setFormMessage('accountFormMessage', error.message); } finally { setBusy(button, false); }
  }
  function openEditAccount(id) { const account = state.accounts.find((item) => item.id === id); if (!account) return; $('#accountEditId').value = id; $('#accountEditName').value = account.name || ''; $('#accountEditGroup').value = account.group || ''; $('#accountEditWeight').value = account.weight || 1; $('#accountEditIdentity').textContent = account.email || account.cookiePreview || account.apiKeyPreview || account.id; setFormMessage('accountEditMessage'); openModal('accountEditModal'); }
  async function submitAccountEdit(event) { event.preventDefault(); const payload = { id: $('#accountEditId').value, name: $('#accountEditName').value.trim(), group: $('#accountEditGroup').value.trim(), weight: Number($('#accountEditWeight').value) || 1 }; const button = event.submitter; setBusy(button, true); try { await api('/api/admin/accounts/update', { method: 'POST', body: JSON.stringify(payload) }); closeModal('accountEditModal'); await loadAccounts(); toast(t('saved')); } catch (error) { setFormMessage('accountEditMessage', error.message); } finally { setBusy(button, false); } }

  async function accountAction(action, id, button) {
    if (action === 'edit') return openEditAccount(id); if (action === 'delete' && !confirm(t('confirmDelete'))) return; setBusy(button, true);
    try {
      if (action === 'delete') await api(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      else if (action === 'test') { const result = await api('/api/admin/accounts/test', { method: 'POST', body: JSON.stringify({ id }) }); if (result.ok === false) throw new Error(result.message || result.code || t('failed')); }
      else if (action === 'refresh') { const result = await api('/api/admin/accounts/refresh', { method: 'POST', body: JSON.stringify({ id }) }); if (result.ok === false) throw new Error(result.message || t('failed')); }
      else if (action === 'reset') await api('/api/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ id }) });
      else await api('/api/admin/accounts/status', { method: 'POST', body: JSON.stringify({ id, status: action === 'enable' ? 'active' : 'disabled' }) });
      state.selectedAccounts.delete(id); await loadAccounts(); toast(t(action === 'delete' ? 'deleted' : 'saved'));
    } catch (error) { toast(error.message, 'bad'); } finally { setBusy(button, false); }
  }
  async function batchAccounts(action, button) {
    const ids = Array.from(state.selectedAccounts); if (!ids.length) return toast(t('noneSelected'), 'bad'); if (action === 'delete' && !confirm(t('confirmDelete'))) return;
    setBusy(button, true); try { const result = await api('/api/admin/accounts/batch', { method: 'POST', body: JSON.stringify({ ids, action }) }); state.selectedAccounts.clear(); await loadAccounts(); toast(`${result.succeeded || 0} ${t('success')} · ${result.failed || 0} ${t('failed')}`, result.failed ? 'bad' : 'ok'); } catch (error) { toast(error.message, 'bad'); } finally { setBusy(button, false); }
  }
  async function exportAccounts() {
    if (!confirm(t('confirmExport'))) return; const ids = Array.from(state.selectedAccounts); try { const data = await api('/api/admin/accounts/export', { method: 'POST', body: JSON.stringify(ids.length ? { ids } : {}) }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `deepai-accounts-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); } catch (error) { toast(error.message, 'bad'); }
  }
  async function submitImport(event) { event.preventDefault(); let parsed; try { parsed = JSON.parse($('#importJson').value); } catch (error) { return setFormMessage('importMessage', 'Invalid JSON'); } const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts; if (!Array.isArray(accounts)) return setFormMessage('importMessage', 'JSON must contain accounts[]'); const button = event.submitter; setBusy(button, true); try { const result = await api('/api/admin/accounts/import', { method: 'POST', body: JSON.stringify({ accounts }) }); closeModal('importModal'); $('#importForm').reset(); await loadAccounts(); toast(`${result.added || 0} ${t('created')}${result.failed?.length ? ` · ${result.failed.length} ${t('failed')}` : ''}`, result.failed?.length ? 'bad' : 'ok'); } catch (error) { setFormMessage('importMessage', error.message); } finally { setBusy(button, false); } }

  function stopBrowserLoginPolling() {
    clearInterval(state.browserLogin.timer); clearInterval(state.browserLogin.countdownTimer);
    state.browserLogin.timer = null; state.browserLogin.countdownTimer = null;
  }
  function resetBrowserLogin() {
    stopBrowserLoginPolling();
    state.browserLogin.sessionState = ''; state.browserLogin.authUrl = ''; state.browserLogin.expiresAt = ''; state.browserLogin.status = ''; state.browserLogin.lastProgressStatus = '';
    $('#browserLoginForm').reset(); $('#browserLoginWeight').value = '1'; $('#browserLoginProgress').hidden = true; setBrowserLoginLink(''); setFormMessage('browserLoginMessage');
    $('#browserLoginStartBtn').hidden = false; $('#browserLoginCancelBtn').textContent = t('cancel'); $('#browserLoginCancelBtn').classList.remove('danger');
  }
  function browserLoginActive() { return state.browserLogin.status === 'starting' || (state.browserLogin.sessionState && !['completed','failed','cancelled','expired'].includes(state.browserLogin.status)); }
  function openBrowserLoginModal() { if (!browserLoginActive()) resetBrowserLogin(); openModal('browserLoginModal'); }
  function browserLoginStatusText(status) {
    return t({ starting:'browserLoginStarting', waiting:'browserLoginWaiting', verifying:'browserLoginVerifying', completed:'browserLoginCompleted', failed:'browserLoginFailed', cancelled:'browserLoginCancelled', expired:'browserLoginExpired' }[status] || 'browserLoginStarting');
  }
  function renderBrowserLoginCountdown() {
    const expiresAt = state.browserLogin.expiresAt; if (!expiresAt) { $('#browserLoginCountdown').textContent = '—'; return; }
    const expiry = Number(expiresAt) || new Date(expiresAt).getTime(); const remaining = Math.max(0, expiry - Date.now()); const seconds = Math.ceil(remaining / 1000); const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('#browserLoginCountdown').textContent = t('browserLoginExpires', { time });
  }
  function normalizeBrowserLoginUrl(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(t('browserLoginInvalidLink'));
    let url;
    try { url = new URL(value.trim(), location.origin); }
    catch (error) { throw new Error(t('browserLoginInvalidLink')); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(t('browserLoginInvalidLink'));
    return url.href;
  }
  function setBrowserLoginLink(url) {
    const link = $('#browserLoginLink'); const copy = $('#browserLoginCopyBtn');
    if (!link) return;
    if (url) {
      link.href = url; link.setAttribute('aria-disabled', 'false'); link.removeAttribute('tabindex');
      if (copy) copy.disabled = false;
    } else {
      link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.setAttribute('tabindex', '-1');
      if (copy) copy.disabled = true;
    }
    link.textContent = t('browserLoginClickLink');
  }
  function setBrowserLoginStages(status) {
    const stages = [$('#browserLoginStage1'), $('#browserLoginStage2'), $('#browserLoginStage3')];
    const terminal = ['failed','cancelled','expired'].includes(status);
    let classes;
    if (status === 'completed') classes = ['done','done','done'];
    else if (terminal) {
      const last = state.browserLogin.lastProgressStatus;
      classes = last === 'verifying' ? ['done','done','failed'] : state.browserLogin.authUrl ? ['done','failed','pending'] : ['failed','pending','pending'];
    } else if (status === 'verifying') classes = ['done','done','active'];
    else if (status === 'waiting') classes = ['done','active','pending'];
    else classes = ['active','pending','pending'];
    stages.forEach((stage, index) => { if (stage) stage.className = `browser-login-stage ${classes[index]}`; });
  }
  function renderBrowserLoginStatus(result) {
    const status = result.status || state.browserLogin.status || 'starting'; state.browserLogin.status = status; state.browserLogin.expiresAt = result.expiresAt || state.browserLogin.expiresAt;
    if (['starting','waiting','verifying'].includes(status)) state.browserLogin.lastProgressStatus = status;
    $('#browserLoginStatus').textContent = browserLoginStatusText(status); $('#browserLoginStateDot').className = `browser-login-dot ${status}`; renderBrowserLoginCountdown();
    setBrowserLoginStages(status);
    if (result.error) setFormMessage('browserLoginMessage', result.error);
  }
  async function pollBrowserLogin() {
    if (!state.browserLogin.sessionState) return;
    try {
      const result = await api(`/api/admin/accounts/login/status?state=${encodeURIComponent(state.browserLogin.sessionState)}`); renderBrowserLoginStatus(result);
      if (result.status === 'completed') {
        stopBrowserLoginPolling(); await loadAccounts(); toast(t('browserLoginAccountAdded', { name: result.account?.name || result.account?.id || t('account') }));
        $('#browserLoginStartBtn').hidden = true; $('#browserLoginCancelBtn').textContent = t('close'); $('#browserLoginCancelBtn').classList.remove('danger');
      } else if (['failed','cancelled','expired'].includes(result.status)) {
        stopBrowserLoginPolling(); $('#browserLoginStartBtn').hidden = false; $('#browserLoginCancelBtn').textContent = t('close'); $('#browserLoginCancelBtn').classList.remove('danger');
      }
    } catch (error) { setFormMessage('browserLoginMessage', error.message); }
  }
  async function submitBrowserLogin(event) {
    event.preventDefault(); setFormMessage('browserLoginMessage');
    const button = $('#browserLoginStartBtn');
    setBusy(button, true); $('#browserLoginCancelBtn').disabled = true; $('#browserLoginProgress').hidden = false; setBrowserLoginLink(''); renderBrowserLoginStatus({ status:'starting' });
    const metadata = {}; const name = $('#browserLoginName').value.trim(); const group = $('#browserLoginGroup').value.trim(); const weight = Math.min(100, Math.max(1, Number.parseInt($('#browserLoginWeight').value, 10) || 1));
    if (name) metadata.name = name; if (group) metadata.group = group; if (weight !== 1) metadata.weight = weight;
    try {
      const result = await api('/api/admin/accounts/login/start', { method:'POST', body:JSON.stringify(metadata) });
      if (typeof result.state !== 'string' || !result.state) throw new Error(t('browserLoginInvalidLink'));
      state.browserLogin.sessionState = result.state; state.browserLogin.authUrl = normalizeBrowserLoginUrl(result.authUrl); state.browserLogin.expiresAt = result.expiresAt; setBrowserLoginLink(state.browserLogin.authUrl); renderBrowserLoginStatus(result);
      $('#browserLoginCancelBtn').disabled = false;
      state.browserLogin.timer = setInterval(pollBrowserLogin, 2000); state.browserLogin.countdownTimer = setInterval(renderBrowserLoginCountdown, 1000); pollBrowserLogin();
      button.hidden = true;
    } catch (error) {
      state.browserLogin.sessionState = ''; state.browserLogin.authUrl = ''; state.browserLogin.status = ''; state.browserLogin.lastProgressStatus = ''; setBrowserLoginLink(''); $('#browserLoginProgress').hidden = true; setFormMessage('browserLoginMessage', `${t('browserLoginStartFailed')}: ${error.message}`);
    } finally { setBusy(button, false); $('#browserLoginCancelBtn').disabled = false; }
  }
  async function cancelBrowserLogin() {
    if (!state.browserLogin.sessionState || ['completed','failed','cancelled','expired'].includes(state.browserLogin.status)) { stopBrowserLoginPolling(); closeModal('browserLoginModal'); return; }
    const button = $('#browserLoginCancelBtn'); setBusy(button, true);
    try { await api('/api/admin/accounts/login/cancel', { method:'POST', body:JSON.stringify({ state:state.browserLogin.sessionState }) }); renderBrowserLoginStatus({ status:'cancelled' }); stopBrowserLoginPolling(); closeModal('browserLoginModal'); }
    catch (error) { setFormMessage('browserLoginMessage', error.message); }
    finally { setBusy(button, false); }
  }

  function filteredKeyAccounts() { const query = $('#gatewayKeyAccountSearch').value.trim().toLowerCase(); return state.accounts.filter((account) => !query || [account.name, account.email, account.group, account.id].join(' ').toLowerCase().includes(query)); }
  function renderKeyAccountPicker() { const visible = filteredKeyAccounts(); $('#gatewayKeyAccounts').innerHTML = visible.map((account) => `<label><input type="checkbox" value="${esc(account.id)}" ${state.keyAccountSelection.has(account.id) ? 'checked' : ''}><span>${esc(account.name || account.email || account.id)}${account.group ? ` · ${esc(account.group)}` : ''}</span></label>`).join('') || `<span class="hint">${esc(t('noAccounts'))}</span>`; }
  function openKeyModal(id = '') { const key = state.gatewayKeys.find((item) => item.id === id); state.keyAccountSelection = new Set(key?.accountIds || []); $('#gatewayKeyId').value = key?.id || ''; $('#gatewayKeyName').value = key?.name || ''; $('#gatewayKeyModels').value = (key?.models || []).join(', '); $('#gatewayKeyLimit').value = key?.requestLimit || 0; $('#gatewayKeyAccountSearch').value = ''; renderKeyAccountPicker(); setFormMessage('gatewayKeyMessage'); openModal('gatewayKeyModal'); }
  async function submitGatewayKey(event) {
    event.preventDefault(); const id = $('#gatewayKeyId').value; const payload = { name: $('#gatewayKeyName').value.trim(), models: Core.parseCsv($('#gatewayKeyModels').value), accountIds: Array.from(state.keyAccountSelection), requestLimit: Math.max(0, Number.parseInt($('#gatewayKeyLimit').value, 10) || 0) }; const button = event.submitter; setBusy(button, true);
    try { const result = await api(id ? '/api/admin/gateway-keys/update' : '/api/admin/gateway-keys', { method: 'POST', body: JSON.stringify(id ? { id, ...payload } : payload) }); closeModal('gatewayKeyModal'); await loadGatewayKeys(); await loadGateway(true); if (!id && result.key?.key) { $('#createdKeyValue').value = result.key.key; openModal('createdKeyModal'); toast(t('created')); } else toast(t('saved')); } catch (error) { setFormMessage('gatewayKeyMessage', error.message); } finally { setBusy(button, false); }
  }
  async function gatewayKeyAction(action, id, button) { const key = state.gatewayKeys.find((item) => item.id === id); if (!key) return; if (action === 'edit') return openKeyModal(id); if (action === 'copy') { if (!key.key) return toast(t('operationFailed'), 'bad'); return copyText(key.key); } if (action === 'delete' && !confirm(t('confirmDelete'))) return; setBusy(button, true); try { if (action === 'delete') await api(`/api/admin/gateway-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); else await api('/api/admin/gateway-keys/enable', { method: 'POST', body: JSON.stringify({ id, enabled: !key.enabled }) }); await loadGatewayKeys(); toast(t(action === 'delete' ? 'deleted' : 'saved')); } catch (error) { toast(error.message, 'bad'); } finally { setBusy(button, false); } }

  async function changePassword(button) { const current = $('#settingCurrentPassword').value; const next = $('#settingNewPassword').value; if (!next) return toast(t('newPassword'), 'bad'); setBusy(button, true); try { await api('/panel/password', { method: 'POST', body: JSON.stringify({ current, next }) }); $('#settingCurrentPassword').value = ''; $('#settingNewPassword').value = ''; toast(t('saved')); await loadSettings(); } catch (error) { toast(error.message, 'bad'); } finally { setBusy(button, false); } }
  async function clearLogs() { if (!confirm(t('confirmClearLogs'))) return; try { await api('/api/admin/logs/clear', { method: 'POST', body: '{}' }); state.logs = []; renderLogs(); toast(t('deleted')); } catch (error) { toast(error.message, 'bad'); } }
  async function copyText(text) { try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;top:-1000px'; document.body.appendChild(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error(t('operationFailed')); } toast(t('copied')); return true; } catch (error) { toast(error.message, 'bad'); return false; } }

  async function refreshPage(page = state.page) {
    if (!state.authenticated || state.loading.has(page)) return; state.loading.add(page);
    try { if (page === 'overview') await loadOverview(); else if (page === 'gateway') await loadGateway(); else if (page === 'accounts') await loadAccounts(); else if (page === 'analytics') await loadAnalytics(); else if (page === 'logs' && state.logPoll) await loadLogs(); else if (page === 'settings') { await Promise.all([loadSettings(), loadGatewayKeys(), state.accounts.length ? Promise.resolve() : loadAccounts()]); } }
    catch (error) { if (state.authenticated) toast(error.message, 'bad'); } finally { state.loading.delete(page); }
  }
  function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }
  function startPolling() { stopPolling(); state.pollTimer = setInterval(() => { if (!document.hidden) refreshPage(); }, state.settings.pollIntervalMs); }
  function restartPolling() { if (state.authenticated) startPolling(); }

  async function loadInitialData() {
    try { state.health = await fetch('/healthz', { cache: 'no-store' }).then((response) => response.json()); $('#topHealthText').textContent = t('healthy'); $('#sidebarHealthText').textContent = t('gatewayOnline'); }
    catch (error) { $('.next-status-dot')?.classList.add('offline'); $('#topHealthText').textContent = t('offline'); }
    await Promise.all([loadSettings(), loadGatewayKeys(), loadAccounts()]); const requested = new URL(location.href).searchParams.get('tab'); goPage((requested && Core.PAGE_IDS.includes(requested)) ? requested : 'overview');
  }
  async function boot() {
    state.token = readStoredToken(); try { $('#panelRemember').checked = localStorage.getItem(REMEMBER_STORE) === '1'; } catch (error) { /* ignore */ }
    try { const status = await panelFetch('/panel/status'); state.status = status; $('#panelDefaultHint').hidden = !status.panel_password_is_default; if (status.authenticated) { enterConsole(); await loadInitialData(); } else requireLogin(); } catch (error) { requireLogin(); setFormMessage('panelLoginMsg', error.message); }
  }

  function switchSettingsGroup(group) { state.settingsGroup = group; $$('[data-settings-group]').forEach((button) => button.classList.toggle('active', button.dataset.settingsGroup === group)); $$('[data-settings-section]').forEach((section) => { section.hidden = section.dataset.settingsSection !== group; }); }
  function handleClick(event) {
    const nav = event.target.closest('[data-nav-page]'); if (nav) { goPage(nav.dataset.navPage); return; }
    const close = event.target.closest('[data-close-modal]'); if (close) { closeModal(close.dataset.closeModal); return; }
    const accountType = event.target.closest('[data-account-type]'); if (accountType) { selectAccountType(accountType.dataset.accountType); return; }
    const settingGroup = event.target.closest('[data-settings-group]'); if (settingGroup) { switchSettingsGroup(settingGroup.dataset.settingsGroup); return; }
    const batch = event.target.closest('[data-batch-action]'); if (batch) { batchAccounts(batch.dataset.batchAction, batch); return; }
    const account = event.target.closest('[data-account-action]'); if (account) { accountAction(account.dataset.accountAction, account.dataset.id, account); return; }
    const key = event.target.closest('[data-key-action]'); if (key) { gatewayKeyAction(key.dataset.keyAction, key.dataset.id, key); return; }
    const copy = event.target.closest('[data-copy-target]'); if (copy) { const target = $(`#${copy.dataset.copyTarget}`); copyText(target?.value || target?.getAttribute?.('href') || target?.textContent || ''); return; }
    const action = event.target.closest('[data-action]'); if (!action) return;
    const name = action.dataset.action;
    if (name === 'logout') logout(); else if (name === 'toggle-mobile-nav') document.body.classList.contains('next-sidebar-open') ? closeMobileNav() : openMobileNav(); else if (name === 'close-mobile-nav') closeMobileNav(); else if (name === 'open-more') openMore(); else if (name === 'close-more') closeMore(); else if (name === 'cycle-theme') cycleTheme(); else if (name === 'refresh-page') refreshPage(); else if (name === 'refresh-models') loadGateway(true).catch((error) => toast(error.message, 'bad')); else if (name === 'open-account-modal') { resetAccountForm(); openModal('accountModal'); } else if (name === 'open-browser-login') openBrowserLoginModal(); else if (name === 'cancel-browser-login') cancelBrowserLogin(); else if (name === 'open-import') { setFormMessage('importMessage'); openModal('importModal'); } else if (name === 'export-accounts') exportAccounts(); else if (name === 'account-prev') { state.accountPage -= 1; renderAccounts(); } else if (name === 'account-next') { state.accountPage += 1; renderAccounts(); } else if (name === 'toggle-log-poll') { state.logPoll = !state.logPoll; action.textContent = t(state.logPoll ? 'pauseRefresh' : 'resumeRefresh'); if (state.logPoll) loadLogs(); } else if (name === 'clear-logs') clearLogs(); else if (name === 'save-settings') saveSettings(action); else if (name === 'change-password') changePassword(action); else if (name === 'open-key-modal') openKeyModal(); else if (name === 'open-key-settings') { goPage('settings'); switchSettingsGroup('api'); } else if (name === 'select-all-key-accounts') { Core.updateSelection(state.keyAccountSelection, filteredKeyAccounts().map((account) => account.id), true); renderKeyAccountPicker(); } else if (name === 'clear-key-accounts') { Core.updateSelection(state.keyAccountSelection, filteredKeyAccounts().map((account) => account.id), false); renderKeyAccountPicker(); }
  }

  document.addEventListener('click', handleClick);
  $('#panelLoginForm').addEventListener('submit', submitLogin); $('#accountForm').addEventListener('submit', submitAccount); $('#accountEditForm').addEventListener('submit', submitAccountEdit); $('#browserLoginForm').addEventListener('submit', submitBrowserLogin); $('#importForm').addEventListener('submit', submitImport); $('#gatewayKeyForm').addEventListener('submit', submitGatewayKey);
  $('#quickLanguage').addEventListener('change', (event) => { state.settings.uiLanguage = event.target.value; $('#settingLanguage').value = event.target.value; applyLanguage(); });
  $('#settingTheme').addEventListener('change', (event) => applyTheme(event.target.value)); $('#settingLanguage').addEventListener('change', (event) => { state.settings.uiLanguage = event.target.value; applyLanguage(); });
  ['accountSearch','accountTypeFilter','accountGroupFilter','accountStatusFilter','accountSort'].forEach((id) => $(`#${id}`).addEventListener(id === 'accountSearch' ? 'input' : 'change', () => { state.accountPage = 1; renderAccounts(); }));
  $('#accountSelectPage').addEventListener('change', (event) => { const filtered = Core.filterAccounts(state.accounts, accountFilters()); const page = Core.paginate(filtered, state.accountPage, state.accountPageSize); page.items.forEach((account) => event.target.checked ? state.selectedAccounts.add(account.id) : state.selectedAccounts.delete(account.id)); renderAccounts(); });
  $('#accountsBody').addEventListener('change', (event) => { if (!event.target.matches('[data-account-select]')) return; event.target.checked ? state.selectedAccounts.add(event.target.dataset.accountSelect) : state.selectedAccounts.delete(event.target.dataset.accountSelect); renderAccounts(); });
  $('#analyticsRanges').addEventListener('click', (event) => { const button = event.target.closest('[data-range]'); if (!button) return; state.analyticsRange = button.dataset.range; $$('#analyticsRanges button').forEach((item) => item.classList.toggle('active', item === button)); loadAnalytics().catch((error) => toast(error.message, 'bad')); });
  $('#logSearch').addEventListener('input', renderLogs); $('#logOutcome').addEventListener('change', renderLogs);
  $('#importFile').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (file) $('#importJson').value = await file.text(); });
  $('#gatewayKeyAccountSearch').addEventListener('input', renderKeyAccountPicker);
  $('#gatewayKeyAccounts').addEventListener('change', (event) => { if (!event.target.matches('input[type="checkbox"]')) return; Core.updateSelection(state.keyAccountSelection, [event.target.value], event.target.checked); });
  $$('.modal-mask').forEach((mask) => mask.addEventListener('mousedown', (event) => { if (event.target === mask) closeModal(mask.id); }));
  document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; const open = $$('.modal-mask:not([hidden])').at(-1); if (open) closeModal(open.id); else if ($('#nextMoreSheet').classList.contains('open')) closeMore(); else closeMobileNav(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.authenticated) refreshPage(); });
  boot();
})();
