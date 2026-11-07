# DeepAI Console Parity Implementation Plan

> **For agentic workers:** Implement independent tasks with parallel agents and review their changes before integration.

**Goal:** Reproduce the reference console's usable DeepAI account, key, settings and monitoring flows.

**Architecture:** Keep the dependency-free Node server. Reuse the reference's visual shell;
connect it to validated admin APIs and the existing DeepAI transport. Persist new fields
with backwards-compatible defaults.

**Tech Stack:** Node.js 18+, native HTTP/fetch, plain HTML/CSS/JavaScript, node:test.

**Spec:** `docs/console-parity.md`

## Global Constraints

- DeepAI remains the upstream; no fake WorkBuddy-only controls.
- Keep state-file compatibility, zero runtime dependencies and upstream license notice.
- The user authorized updating Docker/Compose and committing/pushing the completed changes on 2026-11-07. Verify the container before publishing.

### Task 1: Account pool and transport

**Files:** `src/accountPool.js`, `src/deepai.js`, `src/streamParser.js`, `test/upstream.test.js`.
**Interfaces:** Account methods and permissions in the shared spec; `opts.accountIds` scopes scheduling.

- [x] Reproduce streaming callback, UUID, account ordering and duplicate-seed failures with offline tests.
- [x] Add validated account metadata and portable import/export methods.
- [x] Apply account permissions to chat and image API scheduling, preserve stable conversation identities.
- [x] Fix transport/parser errors covered by failing tests and run the upstream suite.

### Task 2: Validated admin management

**Files:** `src/adminRoutes.js`, `src/auth.js`, `src/settings.js`, `test/admin.test.js`.
**Interfaces:** Exact endpoints and fields in the shared spec.

- [x] Write failing tests for account/key/settings CRUD, atomic validation and calendar analytics.
- [x] Implement shared settings defaults/validation/public projection; account bulk/import/export routes.
- [x] Add key permission editing and safe password verification/session handling.
- [x] Run admin/auth regression tests using isolated state.

### Task 3: Reference console UI

**Files:** `public/index.html`, `public/app.js`, `public/style.css`, optional focused public modules.
**Interfaces:** Consume shared admin contracts, retain panel-token session flow.

- [x] Reuse nextShell/sidebar/topbar/content markup and component styles with attribution.
- [x] Implement account modal, filtering/pagination, batch operations, import/export and metadata editing.
- [x] Implement key permissions/settings groups/theme/language/navigation, monitoring and clear errors.
- [x] Verify no duplicate IDs, syntax errors or missing event handlers; check real browser flows.

### Task 4: Gateway integration and verification

**Files:** `server.js`, `src/openaiRoutes.js`, `src/store.js`, `package.json`, `README.md`, `test/gateway.test.js`.

- [x] Reproduce malformed JSON, empty message, open-mode accounting and quota-concurrency failures.
- [x] Await async route errors, return correct HTTP errors, scope conversations and enforce key/model permissions.
- [x] Wire persisted settings to runtime behavior and add `npm test`.
- [x] Run all offline tests, browser smoke tests and final independent code review; document verification limits.
