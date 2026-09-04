# V5A9 — Kiro Preferences Modified / Reset Truth Closure Design

## Context

V5A7 closed Reminder preference modified/reset truth and V5A8 fixed Custom AI capability persistence. The remaining Settings V5 consistency gap is the Kiro UI/behavior preference store: real user-facing Kiro settings persist correctly, but their defaults are duplicated across store initialization/hydration and Settings rows cannot expose the standard `modified` / single-row reset affordance.

Base: `master` at `16aae2961cde6c35f50856cef408cd83f2b69ac5`.

## Goal

Give the user-facing Kiro preference rows one authoritative default/modified/reset contract without changing runtime behavior, storage keys, Registry IDs, conditional visibility, credentials, or permissions.

## In Scope

The Settings-facing preference surface is exactly these seven fields from `useKiroPreferencesStore`:

- `outputTextSize`
- `autoContextEnabled`
- `responsePreference`
- `webSearchEnabled`
- `webSearchCredentialMode`
- `webPdfVisionEnabled`
- `webPdfVisionModel`

Create a dedicated data-only `KiroSettingsPreferences` type, canonical `DEFAULT_KIRO_SETTINGS_PREFERENCES`, a pure modified-key helper, a pure reset-patch helper, and a store reset action that consumes those helpers.

The store initializer and hydrate fallbacks must reuse the same canonical defaults where a fallback is needed. Existing normalizers remain authoritative for normalization.

## Explicitly Out of Scope

The following persisted Kiro store fields are not Settings preference rows and must not be exposed through the V5A9 reset API:

- `sidecarSize`
- `sidecarPosition`
- `sidecarMinimizedPosition`
- `visualAttachmentPrivacyNoticeSeen`

Also excluded:

- AI provider/model/custom settings and `memoryEnabled`
- requested AI reasoning effort
- AI/Tavily/PDF Vision API keys in `sessionStorage`
- Kiro Memory contents
- Kiro Computer, Workspace, Agent mode, Terminal, and OS/browser permissions
- Settings Registry/search IDs
- runtime behavior or feature gates
- storage migration or a new storage key
- visual redesign

## Canonical Truth

`DEFAULT_KIRO_SETTINGS_PREFERENCES` is the only default source for the seven fields:

- `outputTextSize = "standard"`
- `autoContextEnabled = true`
- `responsePreference = DEFAULT_KIRO_RESPONSE_PREFERENCE`
- `webSearchEnabled = true`
- `webSearchCredentialMode = "server"`
- `webPdfVisionEnabled = true`
- `webPdfVisionModel = DEFAULT_WEB_PDF_VISION_MODEL`

All seven values are primitive/string values, so modified detection uses semantic primitive equality (`Object.is`) and never compares actions or non-Settings geometry/privacy state.

## Reset Semantics

Each row resets only its own persisted preference to its canonical default.

Important safety boundaries:

- Resetting `webSearchCredentialMode` to `server` must not erase a Tavily API key from `sessionStorage`.
- Resetting `webPdfVisionModel` or `webPdfVisionEnabled` must not erase the PDF Vision API key from `sessionStorage`.
- Resetting `webSearchEnabled` must not mutate connection-test UI state, keys, or unrelated Kiro preferences.
- Reset actions do not revoke browser/OS permissions and do not touch Agent/Workspace state.

No grouped reset semantics are introduced in V5A9.

## UI Mapping

Wire the standard `SettingsRow` `modified`, `onReset`, and explicit reset aria labels to:

- `kiro-response-preference` → `responsePreference`
- `kiro-output-text-size` → `outputTextSize`
- `kiro-auto-context` → `autoContextEnabled`
- `kiro-web-search-enabled` → `webSearchEnabled`
- `kiro-web-search-credential` → `webSearchCredentialMode`
- `kiro-web-pdf-vision-enabled` → `webPdfVisionEnabled`
- `kiro-web-pdf-vision-model` → `webPdfVisionModel`

Conditional rendering remains exactly as today. Session-key rows, test actions, service/status/privacy rows, and Memory rows do not get modified/reset affordances.

## Persistence Compatibility

Keep `classflow-kiro-preferences-v1`. No migration and no `v2` key.

Old persisted data with missing or invalid values continues to normalize to the same effective defaults. Sidecar and privacy fields keep their current normalization and persistence behavior.

## Tests

Use TDD with a test-only commit first.

Regression coverage must prove:

1. Canonical default snapshot reports no modified keys.
2. Each of the seven fields independently reports modified when changed.
3. Reset patch/action restores only the target field.
4. Resetting Settings preferences cannot reset Sidecar geometry or privacy-notice state.
5. Kiro Settings rows expose reset only when modified and clicking reset restores the canonical value.
6. Search credential reset preserves the Tavily session key.
7. PDF Vision preference reset preserves the Vision session key.
8. Existing hydrate behavior for legacy/malformed values remains conservative and unchanged.

## Verification

Required evidence before completion:

- failing PR CI on the test-only commit (RED)
- passing CI after implementation (GREEN), including repository typecheck/tests/build from `.github/workflows/ci.yml`
- final branch-vs-master diff audit showing only V5A9 files
- no secrets in diff
