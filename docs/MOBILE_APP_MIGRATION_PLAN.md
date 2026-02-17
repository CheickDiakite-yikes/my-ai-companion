# Mobile App Migration Plan (Systematic)

## Goal

Move from a WebView wrapper to a real native Expo app without disrupting the production web app.

## Current baseline

- Web app remains source of truth for full feature set.
- Expo wrapper (`mobile/`) runs as a native shell around the web UI.
- Shared workspace package (`packages/app-core`) now exists for cross-platform runtime/config utilities.

## Phase 1 (now): foundation

1. Workspace layout:
   - Root npm workspaces for `mobile` and `packages/*`.
   - Shared package `@zeeme/app-core`.
2. Shared runtime primitives:
   - URL resolution (`resolveWebAppUrl`).
   - trace id generation (`createTraceId`).
3. Safe integration:
   - Web client uses shared `createTraceId`.
   - Expo wrapper uses shared URL resolution.

Exit criteria:
- Web app behavior unchanged.
- Expo wrapper still launches and points to configured URL.

## Phase 2: shared API contract + client

1. Add `@zeeme/app-core` API client primitives:
   - typed request helper
   - auth/session endpoint types
   - unified error shape
2. Keep web routes/server unchanged; only shift client call sites gradually.
3. Add contract tests for high-traffic endpoints.

Exit criteria:
- Web and native use the same API helper and types.
- No endpoint shape drift between clients.

## Phase 3: native-first shell

1. Replace WebView shell with native navigation/screens:
   - auth gate
   - conversation list
   - chat thread
   - profile/settings
2. Keep voice/camera feature parity staged:
   - text first
   - image upload
   - voice session
3. Maintain feature flags for controlled rollouts.

Exit criteria:
- Text chat end-to-end works natively.
- Session/auth and message persistence parity with web.

## Phase 4: progressive migration off WebView

1. Route-by-route replacement:
   - Keep WebView fallback only for unsupported features.
2. Add instrumentation parity:
   - trace id propagation
   - request timing
   - failure signatures
3. TestFlight release gating and hardening.

Exit criteria:
- WebView no longer needed for core user journeys.
- TestFlight beta is stable with release checklist pass.

## Non-goals for this pass

- Rewriting server architecture.
- Migrating all UI components to universal/react-native-web.
- Changing auth model.
