# DeepAI console parity

The user requested the UI, account management, settings and other console flows from
`ardeyouxipianyi/workbuddy2api-hub`, and explicitly confirmed that DeepAI remains the upstream.
Reference revision: `d2343964bd768d87952cc823c373c14cbda4943f` (2026-11-07 checkout).

Use the reference next layout and component CSS, with DeepAI branding and working
DeepAI operations. Keep its MIT notice. WorkBuddy OAuth, regional routing, rewards,
CodeArts and upstream-only tools are not DeepAI capabilities and must not be presented
as working features. Preserve the existing Node.js gateway and state-file migration.

## Shared HTTP contracts

Existing `/panel/*` and `/api/admin/*` endpoints remain. JSON errors use `{error: string}`
on admin endpoints. Every new admin endpoint requires an authenticated panel session.

### Accounts

- `GET /api/admin/accounts`: `{accounts:[...]}`. Existing safe fields plus `group` and
  `weight` (integer 1..100, default 1). Never include full cookie, password or upstream key.
- `POST /api/admin/accounts`: cookie, login or apikey. API-key input:
  `{type:'apikey', apiKey, name?, group?, weight?}`. Existing cookie/login input remains.
- `POST /api/admin/accounts/update`: `{id,name?,group?,weight?}`.
- `POST /api/admin/accounts/batch`: `{ids:[id,...], action:'enable'|'disable'|'reset'|'test'|'refresh'|'delete'}`.
  Return `{results:[{id,ok,message?}], succeeded, failed}`. Refresh only login accounts;
  errors are per account. Run upstream operations sequentially.
- `POST /api/admin/accounts/import`: `{accounts:[{type,cookie?,email?,password?,apiKey?,name?,group?,weight?,status?}]}`.
  Import portable credentials; login entries with an existing cookie do not need a new login.
  Return `{added,failed:[{index,error}]}`. Deduplicate identity, including environment seeding.
- `POST /api/admin/accounts/export`: `{ids?:[]}` -> `{version:1,accounts:[portable account fields]}`.
  The UI explicitly labels the downloaded file as containing credentials.
- Existing status/reset/test/refresh/delete endpoints remain.

Pool methods owned by upstream worker: `addApiKeyAccount(apiKey,name='')`,
`updateAccount(id,{name,group,weight})`, `importAccount(record)`, `exportAccounts(ids)`.
`usable()` orders eligible accounts by uses/weight, then lastUsedAt, preserving sticky chats.

### Gateway keys

- Existing list/create/enable/delete remain.
- Key fields add `accountIds:[]` (empty means all pool accounts, otherwise no anonymous
  fallback), and editable `name`, `models:[]`, `requestLimit` (nonnegative integer).
  Model patterns support `*` wildcards and match the full client model name.
- `POST /api/admin/gateway-keys/update`: `{id,name?,models?,accountIds?,requestLimit?}`.
- `/v1/models` requires a valid gateway key once keys exist, filters model permissions,
  and permits authenticated panel sessions for the console model directory.
- Reserve request-limit usage before waiting for upstream, including failed calls.

### Settings

`GET /api/admin/settings` -> `{settings,editable}`. `POST` applies a validated partial
patch atomically, returning `{settings}`. Reject invalid values without modifying state.
Fields: existing `defaultModel`, `modelMap` (plain object with nonempty string values),
`passThroughModels`, `requestTimeoutMs` (5000..600000), plus:

- `allowAnonymousFallback`, `allowOpenWhenNoKeys`: boolean, env defaults
- `maxLogEntries`: integer 50..5000, env default
- `pollIntervalMs`: integer 2000..60000, default 8000
- `theme`: `light|dark|system`, default `system`
- `uiLanguage`: `zh-CN|zh-TW|en`, default `zh-CN`
- `visiblePages`: array of `overview,gateway,accounts,analytics,logs,settings`; settings always present
- `windowMaxHeight`: integer 0..4000, default 640

Only public panel settings are returned: password hashes are excluded. Password changes
require the current password and invalidate other sessions, retaining the current session.
Analytics today/7d/30d use calendar boundaries in `TZ` (server local timezone).

## Verification

Use Node built-in tests and local mock upstreams, isolated temporary state directories,
real HTTP requests and browser checks. Do not use real DeepAI credentials for testing.
Verify desktop and mobile views, session expiry, account operations, API-key restrictions,
settings reload, error responses, stream boundaries and state reload. Live account login,
upstream generation and Docker builds are separate from offline verification.
