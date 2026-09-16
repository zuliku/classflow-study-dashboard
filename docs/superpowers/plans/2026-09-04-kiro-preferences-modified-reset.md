# V5A9 Kiro Preferences Modified / Reset Truth Closure Implementation Plan

> **For implementation:** execute this plan task-by-task with test-first discipline and verify every claimed result with repository CI.

**Goal:** Add canonical default/modified/reset semantics for the seven Settings-facing Kiro preferences and wire them into the existing `SettingsRow` reset affordance without touching credentials, geometry, permissions, or runtime behavior.

**Architecture:** Keep `useKiroPreferencesStore` as the source of truth. Introduce a data-only Settings preference slice plus pure helpers in the same module, reuse the canonical defaults in initialization/hydration, and have `KiroAISettings` derive a modified-key set from a snapshot of exactly those seven fields. The reset store action accepts only `KiroSettingsPreferenceKey`, making excluded fields unrepresentable through this API.

**Tech Stack:** TypeScript 5.5, React 18, Zustand persist, Vitest/jsdom, GitHub Actions.

---

### Task 1: Establish failing preference-contract tests

**Files:**
- Create: `tests/kiroPreferencesModifiedReset.test.tsx`
- Reference: `store/useKiroPreferencesStore.ts`
- Reference: `tests/reminderPreferences.test.tsx`

**Step 1: Write failing tests**

Add pure contract tests that import the not-yet-existing V5A9 exports and assert:

- canonical defaults for exactly seven Settings fields
- defaults produce no modified keys
- changing each field independently produces exactly that modified key
- `resetKiroSettingsPreferencePatch` returns the canonical target value
- excluded geometry/privacy keys are not part of the Settings preference key surface

**Step 2: Commit tests only**

Commit the test file before production implementation.

**Step 3: Open a PR and confirm RED**

Use PR CI as the executable environment. The test-only commit must fail because the new V5A9 exports/actions/UI contract do not exist yet. Record the failing workflow/check evidence before implementation.

### Task 2: Add canonical store truth

**Files:**
- Modify: `store/useKiroPreferencesStore.ts`
- Test: `tests/kiroPreferencesModifiedReset.test.tsx`

**Step 1: Implement the smallest store surface**

Add:

- `KiroSettingsPreferences`
- `KiroSettingsPreferenceKey`
- `DEFAULT_KIRO_SETTINGS_PREFERENCES`
- `getModifiedKiroSettingsPreferenceKeys`
- `resetKiroSettingsPreferencePatch`
- `resetKiroSettingsPreference(key)` store action

Use `Object.is` for primitive/string comparison.

**Step 2: Reuse defaults without broad refactor**

Spread canonical Settings defaults into store initialization and replace duplicated manual hydrate fallbacks for the seven in-scope fields where applicable. Keep existing normalizers and all excluded field logic unchanged.

**Step 3: Preserve type boundary**

The reset action must accept only `KiroSettingsPreferenceKey`; Sidecar geometry/privacy fields must not be accepted.

### Task 3: Wire Kiro Settings consumer rows

**Files:**
- Modify: `components/settings/KiroAISettings.tsx`
- Test: `tests/kiroPreferencesModifiedReset.test.tsx`

**Step 1: Derive one modified snapshot**

Build a `KiroSettingsPreferences` snapshot from the seven current values and derive a `Set` using `getModifiedKiroSettingsPreferenceKeys`.

**Step 2: Wire each real preference row**

Add `modified`, `onReset`, and a stable explicit `resetAriaLabel` to:

- `kiro-response-preference`
- `kiro-output-text-size`
- `kiro-auto-context`
- `kiro-web-search-enabled`
- `kiro-web-search-credential`
- `kiro-web-pdf-vision-enabled`
- `kiro-web-pdf-vision-model`

Do not alter Registry IDs, gates, disclosure state, or runtime setters.

**Step 3: Do not wire non-preference rows**

API key inputs, test-connection actions, search status/privacy/service rows, Memory rows, and all Agent settings remain without V5A9 reset semantics.

### Task 4: Add consumer and safety regressions

**Files:**
- Modify: `tests/kiroPreferencesModifiedReset.test.tsx`

Add jsdom consumer tests proving representative rows:

- show reset when modified and remove it after reset
- restore canonical values
- credential-mode reset does not clear the Tavily session key
- PDF Vision enabled/model reset does not clear the PDF Vision session key
- resetting one Kiro Settings preference leaves other Settings preferences plus Sidecar/privacy state unchanged

Mock only infrastructure necessary to render `KiroAISettings`; do not mock the preference store under test.

### Task 5: Verify GREEN and audit scope

**Step 1: Wait for PR CI after implementation commits**

Require green evidence for the repository CI workflow, which runs dependency install, secret scan, typecheck, tests, and build.

**Step 2: Inspect branch diff against `master`**

Expected files only:

- `store/useKiroPreferencesStore.ts`
- `components/settings/KiroAISettings.tsx`
- `tests/kiroPreferencesModifiedReset.test.tsx`
- V5A9 design/plan docs

Reject unrelated changes, new storage keys, migrations, credentials, permission changes, or Registry churn.

**Step 3: Merge to `master` only after green**

After merge, verify the resulting `master` commit and CI/status before reporting completion.

### Definition of Done

- Seven Settings-facing Kiro preferences share one canonical default truth.
- Each row exposes standard modified/reset behavior.
- Reset is per-field and side-effect free.
- Session API keys are preserved by resets.
- Geometry/privacy/Agent/AI settings are excluded from the reset API.
- `classflow-kiro-preferences-v1` remains unchanged.
- No migration or runtime behavior change.
- PR demonstrates RED before implementation and GREEN after implementation.
- Final diff is limited to V5A9 scope.
