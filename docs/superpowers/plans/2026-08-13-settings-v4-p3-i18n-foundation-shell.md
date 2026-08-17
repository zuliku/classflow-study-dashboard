# Settings V4 P3 — i18n Foundation & App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `languagePreference = system | zh-CN | en-US` a real application preference, establish a lightweight typed translation layer, and migrate Settings + global navigation/shell/common command UI to bilingual product-owned copy without locale URL routing.

**Architecture:** Keep routing unchanged. Store only the user language preference in `AppPreferences`; resolve the effective locale at runtime from `navigator.languages` when preference is `system`. A typed flat message dictionary (`zh-CN` as key source, `en-US` required to satisfy the same key set) feeds a small `I18nProvider` and `useI18n()` hook. A defensive pre-hydration script updates `<html lang>`/locale datasets early for accessibility; translated React text switches after the client provider resolves. User content is never translated. Settings registry and navigation metadata use message keys instead of hardcoded display strings.

**Tech Stack:** Next.js 14, React 18 Context, TypeScript, Zustand, browser `navigator.languages` / `languagechange`, Vitest, Playwright. No new i18n package.

## Global Constraints

- Requires P1 complete; `languagePreference` exists but is not visible yet.
- P2 may already have Theme bootstrap/runtime. Do not merge Theme/Motion/Locale bootstrap code in this phase.
- Supported effective locales are exactly `zh-CN` and `en-US`.
- System resolution: any `zh`, `zh-*` -> `zh-CN`; any `en`, `en-*` -> `en-US`; all other languages -> `zh-CN` fallback.
- Product-owned UI chrome is translated. User content is not: course/task/project names, teacher names, descriptions, file names, Kiro user/assistant message bodies and model outputs must remain unchanged.
- Do not add `/zh-CN` or `/en-US` routes, middleware locale redirects, or server-locale cookies in V1.
- No machine translation and no runtime network translation.
- Do not translate persisted enum values; only labels presented to users.
- Search should work in the active UI language and keep useful bilingual keyword aliases where appropriate.
- Intermediate commits may be partially translated, but P3 completion must make Settings + global nav/shell/common command chrome coherent in both supported languages.
- Keep tests targeted; do not run full E2E/build by default.

---

### Task 1: Build typed locale resolution and dictionary contracts

**Files:**
- Create: `lib/i18n/messages/zh-CN.ts`
- Create: `lib/i18n/messages/en-US.ts`
- Create: `lib/i18n/types.ts`
- Create: `lib/i18n/resolveLocale.ts`
- Create: `lib/i18n/translator.ts`
- Create: `tests/i18n.test.ts`

**Core interfaces:**

```ts
export type SupportedLocale = "zh-CN" | "en-US";
export type MessageKey = keyof typeof zhCNMessages;
export type TranslateValues = Record<string, string | number>;
export type TranslateFn = (key: MessageKey, values?: TranslateValues) => string;

export function resolveEffectiveLocale(
  preference: LanguagePreference,
  systemLanguages: readonly string[]
): SupportedLocale;

export function translate(
  locale: SupportedLocale,
  key: MessageKey,
  values?: TranslateValues
): string;
```

- [ ] **Step 1: Write failing unit tests** for:
  - explicit `zh-CN` / `en-US` ignoring system order;
  - `system` resolving `zh-Hans-CN`, `zh-TW`, `en-GB`, `en-US` to the supported locale families;
  - unsupported-only systems (e.g. `fr-FR`) falling back to `zh-CN`;
  - first supported entry in `navigator.languages` winning;
  - `translate()` returning both Chinese/English strings;
  - interpolation such as `"{count} results"` replacing named values;
  - English dictionary compile-time coverage through `satisfies Record<MessageKey, string>`.

- [ ] **Step 2: Run only**:

```bash
npx vitest run tests/i18n.test.ts
```

Confirm failure.

- [ ] **Step 3: Create the initial Chinese canonical dictionary** with keys needed by P3. Use flat names grouped by prefix, for example:

```ts
export const zhCNMessages = {
  "common.close": "关闭",
  "common.search": "搜索",
  "common.reset": "恢复默认",
  "settings.title": "设置",
  "settings.search.placeholder": "搜索设置",
  "settings.nav.general": "通用",
  "settings.nav.appearance": "外观与显示",
  "nav.overview": "总览",
  "nav.timetable": "时间表",
  "nav.assignments": "任务与 DDL",
  "command.group.create": "创建",
  // ...all P3-owned strings
} as const;
```

Do not put user data into dictionaries.

- [ ] **Step 4: Create `en-US.ts`** with natural concise product copy and:

```ts
export const enUSMessages = {
  // same exact keys
} satisfies Record<MessageKey, string>;
```

No `as any`, no optional keys.

- [ ] **Step 5: Implement a tiny interpolation function** that replaces `{name}` from supplied values. Missing values leave the token intact in development rather than throwing the entire UI. Do not implement ICU plural rules in V1.

- [ ] **Step 6: Run the unit test** until green and commit the pure i18n foundation.

---

### Task 2: Persist/read the language preference and synchronize effective locale

**Files:**
- Create: `lib/languagePreference.ts`
- Create: `components/providers/I18nProvider.tsx`
- Modify: `app/layout.tsx`
- Modify: `tests/i18n.test.ts`

**Interfaces:**

```ts
export function readPersistedLanguagePreference(raw: string | null): LanguagePreference;
export const LOCALE_BOOTSTRAP_SCRIPT: string;

interface I18nContextValue {
  locale: SupportedLocale;
  t: TranslateFn;
}

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useI18n(): I18nContextValue;
```

- [ ] **Step 1: Add failing persisted-reader tests** mirroring Motion/Theme envelopes: valid `state.preferences.languagePreference`, legacy direct preferences, missing/malformed/unsupported -> `system`.

- [ ] **Step 2: Implement `LOCALE_BOOTSTRAP_SCRIPT`.** It must defensively read the preference, inspect `navigator.languages`/`navigator.language`, resolve `zh-CN|en-US`, then set:

```ts
root.dataset.languagePreference = preference;
root.dataset.localeEffective = locale;
root.lang = locale;
```

It does not translate DOM text and does not mutate localStorage.

- [ ] **Step 3: Add the script in `app/layout.tsx`** beside Theme/Motion bootstrap scripts. Keep the static SSR fallback `<html lang="zh-CN">`; the bootstrap corrects the attribute before paint when possible. Do not introduce dynamic server cookies/routes.

- [ ] **Step 4: Implement `I18nProvider`.** Subscribe narrowly to `preferences.languagePreference`. On client mount, resolve from `navigator.languages`. When preference is `system`, listen for `window` `languagechange` and recompute. On every effective-locale change update root datasets/lang. Memoize `t` from effective locale.

Use `zh-CN` as the deterministic SSR/first-render fallback so hydration markup matches; switching to system English immediately after hydration is acceptable in this V1 architecture. Do not initialize translated children from `document` in a way that creates hydration mismatches.

- [ ] **Step 5: Mount `I18nProvider` once in `app/layout.tsx`** around `children` (ThemeRuntime can remain a sibling/inside body). Avoid per-workspace providers.

- [ ] **Step 6: Run**:

```bash
npx vitest run tests/i18n.test.ts tests/preferences.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit** locale runtime/provider wiring.

---

### Task 3: Migrate Settings navigation/search metadata and expose the real Language setting

**Files:**
- Modify: `components/settings/SettingsNav.tsx`
- Modify: `components/settings/SettingsModal.tsx`
- Modify: `components/settings/SettingsView.tsx`
- Modify: `components/settings/GeneralSettings.tsx`
- Modify: `lib/settingsRegistry.ts`
- Modify: `tests/settingsRegistry.test.ts`
- Create/Modify: `tests/e2e/language-preference.spec.ts`

**Registry shape:**

```ts
export interface SettingDefinition {
  id: string;
  section: SettingsSection;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  keywords?: string[]; // bilingual aliases allowed
}
```

`searchSettings(query, t)` matches localized title + description + static bilingual aliases. It returns stable ids/sections/keys, not pretranslated persisted data.

- [ ] **Step 1: Change `tests/settingsRegistry.test.ts` first** to use a deterministic `t` for `zh-CN`, retain all stable-id/search coverage, and add English search examples (`deadline`, `theme`, `notifications`, `language`).

- [ ] **Step 2: Run only** `npx vitest run tests/settingsRegistry.test.ts` and confirm failure.

- [ ] **Step 3: Convert Settings nav metadata labels/group headings to message keys.** `SettingsNav` calls `useI18n()` and translates at render time. Reserved hidden `account-sync` remains hidden in both locales.

- [ ] **Step 4: Convert `SettingsModal` and `SettingsView` shell copy**: dialog aria-label, title/subtitle, search button/placeholder/close label, search result count/empty state, group path labels and mobile tab labels. Keep search IDs/highlight behavior unchanged.

- [ ] **Step 5: Convert `lib/settingsRegistry.ts`** to key-backed titles/descriptions and bilingual keywords. Do not infer text by scraping rendered DOM.

- [ ] **Step 6: Add the Language row to `GeneralSettings` now that runtime is real.** Exact options:

```text
跟随系统 / 简体中文 / English
System default / 简体中文 / English
```

The currently selected UI language should re-render immediately after selection. Use `preferences.languagePreference`, immediate save and row-level reset.

- [ ] **Step 7: Add registry item `language-preference`** under `general` and include aliases `语言`, `language`, `中文`, `English`, `system`.

- [ ] **Step 8: Write focused E2E** in `tests/e2e/language-preference.spec.ts`:
  1. open Settings in default Chinese and switch to English;
  2. Settings title/nav/common labels become English without reload;
  3. root `lang` and `data-locale-effective` become `en-US`;
  4. reload persists explicit English;
  5. switch back to system with browser language mocked/emulated as Chinese and verify `zh-CN`;
  6. `account-sync` remains absent.

If Playwright cannot directly emulate `navigator.languages` in the existing fixture, use `page.addInitScript` before navigation to define a deterministic languages value; do not weaken the system-resolution assertion.

- [ ] **Step 9: Run only**:

```bash
npx vitest run tests/i18n.test.ts tests/settingsRegistry.test.ts
npx playwright test tests/e2e/language-preference.spec.ts
npm run typecheck
```

- [ ] **Step 10: Commit** Settings shell + Language control migration.

---

### Task 4: Translate all non-Kiro Settings pages and shared Settings primitives

**Files:**
- Modify: `components/settings/AppearanceSettings.tsx`
- Modify: `components/settings/ProfileSettings.tsx`
- Modify: `components/settings/SemesterSettings.tsx`
- Modify: `components/settings/TaskSettings.tsx`
- Modify: `components/settings/NotificationSettings.tsx`
- Modify: `components/settings/InteractionSettings.tsx`
- Modify: `components/settings/DataSettings.tsx`
- Modify: `components/settings/AboutSettings.tsx`
- Modify as required: `components/settings/BackupSection.tsx`, `RestoreSection.tsx`, `DangerZone.tsx`, `DataOverview.tsx`, `DataHealth.tsx`, `SettingsRow.tsx`, `SettingsSaveBar.tsx`, `SettingsControls.tsx`, `SettingsActionRow.tsx`, `SettingsGroup.tsx`, `SettingsSection.tsx`
- Modify: `lib/i18n/messages/zh-CN.ts`
- Modify: `lib/i18n/messages/en-US.ts`
- Modify targeted Settings E2E selectors only where accessible names intentionally change under English

- [ ] **Step 1: Add message keys in small groups** and translate each Settings component's product copy through `useI18n()`. Keep actual values (student name, semester name, counts, backup file metadata) untouched.

- [ ] **Step 2: Preserve browser/system vocabulary where appropriate.** `API`, `JSON`, `ZIP`, `ClassFlow`, `IndexedDB` do not need artificial translation. Translate explanatory text around them.

- [ ] **Step 3: Keep Notification permission logic unchanged.** Only labels/descriptions/status messages become translated. Map permission descriptors through product-owned message keys rather than changing browser permission values.

- [ ] **Step 4: Translate destructive confirmation copy** for Data restore/clear flows, but do not change confirmation conditions, data scopes or dev demo gating.

- [ ] **Step 5: Keep development-only demo controls translated only if they are rendered in development; still no production visibility.** Do not move the gate.

- [ ] **Step 6: Run**:

```bash
npx playwright test tests/e2e/settings.spec.ts tests/e2e/settings-data.spec.ts tests/e2e/settings-productization.spec.ts
npm run typecheck
```

Use Chinese as the default in existing specs unless the spec is specifically testing English; this minimizes selector churn.

- [ ] **Step 7: Commit** non-Kiro Settings translation.

---

### Task 5: Translate Kiro & Agent Settings chrome without translating model/user content

**Files:**
- Modify: `components/settings/KiroAISettings.tsx`
- Modify: `components/settings/KiroMemorySettings.tsx`
- Modify: `components/settings/KiroAgentSettings.tsx`
- Modify: `lib/ai/errors.ts` only if UI-owned display messages need a key/code boundary; do not translate provider raw errors destructively
- Modify: i18n message dictionaries
- Verify targeted Kiro settings E2E

- [ ] **Step 1: Translate four Kiro Settings group headings and row copy** (`模型与服务`, `回答与个性化`, `联网与工具`, `记忆`) plus Agent settings headings/buttons/statuses.

- [ ] **Step 2: Keep provider/model/vendor names verbatim** (`DeepSeek`, `OpenCode Go`, model IDs, Base URL, API Key terminology). Translate surrounding UI descriptions and generic option labels.

- [ ] **Step 3: Distinguish raw service errors from product errors.** Product-authored errors/status strings should be translated from stable error codes where available; raw provider/server message payloads should remain as received rather than being machine-translated.

- [ ] **Step 4: Keep Kiro Memory entry contents untouched.** Only manager chrome (`编辑`, `删除`, `清空`, empty states, buttons) is translated.

- [ ] **Step 5: Run only**:

```bash
npx playwright test tests/e2e/settings-productization.spec.ts tests/e2e/kiro-memory.spec.ts tests/e2e/kiro-computer-controls.spec.ts
npm run typecheck
```

- [ ] **Step 6: Commit** Kiro/Agent Settings translation.

---

### Task 6: Translate global navigation and Bottom/Sidebar shell

**Files:**
- Modify: `components/layout/navItems.ts`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/layout/BottomNav.tsx`
- Modify: `components/layout/WorkspaceSearchButton.tsx`
- Modify: `components/layout/WorkspaceHeader.tsx` only for component-owned labels/actions; page title/context props remain caller-owned
- Modify: i18n dictionaries
- Modify targeted navigation/responsive E2E only if necessary

- [ ] **Step 1: Change navigation item metadata from display `label` to stable `labelKey`.** Keep ids/icons/sections unchanged. Sidebar and BottomNav translate via `useI18n()` at render time.

- [ ] **Step 2: Translate global action labels** (`提醒`, `设置`, `更多`, search/accessibility labels, expand/collapse tooltips) without changing click targets or active-tab semantics.

- [ ] **Step 3: Keep Kiro brand name `Kiro` unchanged.** Do not translate user profile values or course/task context shown inside navigation.

- [ ] **Step 4: Run only relevant shell tests:**

```bash
npx playwright test tests/e2e/responsive.spec.ts tests/e2e/sidebar-kiro.spec.ts tests/e2e/language-preference.spec.ts
npm run typecheck
```

- [ ] **Step 5: Commit** shell navigation translation.

---

### Task 7: Make Command Center labels/search locale-aware while preserving command behavior

**Files:**
- Modify: `lib/commands.ts`
- Modify: `components/command/CommandCenter.tsx`
- Modify: `components/command/GlobalShortcutController.tsx` only if it constructs display command labels
- Modify: `tests/commands.test.ts`
- Modify: `tests/e2e/command-center.spec.ts`
- Modify: i18n dictionaries

**Architecture rule:** Command ids, `when`, `run`, context scopes and actions remain unchanged. Only display labels/group labels/keywords are localized.

Recommended interface change:

```ts
export function getCommands(t: TranslateFn): AppCommand[];
export function getContextCommands(ctx: CommandContext, t: TranslateFn): AppCommand[];
export function getAssignmentContextCommands(ctx: CommandContext, t: TranslateFn): AppCommand[];
export function buildPalette(ctx: CommandContext, query: string, t: TranslateFn): PaletteItem[];
export function getGroupLabels(t: TranslateFn): Record<CommandGroup, string>;
```

- [ ] **Step 1: Update `tests/commands.test.ts` first** to use `createTranslator("zh-CN")` (or equivalent pure translator) and preserve existing command behavior/stale-entity tests. Add one English assertion: `create-task` renders `New task`, while context commands interpolate the real course/task name unchanged.

- [ ] **Step 2: Run** `npx vitest run tests/commands.test.ts` and confirm failure.

- [ ] **Step 3: Refactor command display generation to receive `t`.** Do not make `lib/commands.ts` import React context/hooks. Keep command library pure.

Example context label:

```ts
t("command.context.newTaskForCourse", { course: course.name })
```

The interpolated `course.name` stays exactly the user-provided name.

- [ ] **Step 4: Update `CommandCenter` to obtain `t` from `useI18n()` and pass it into palette builders/group labels.** Translate placeholder, empty state, shortcut-guide chrome and accessibility labels.

- [ ] **Step 5: Keep bilingual aliases for command discoverability** where useful: an English UI may still match common Chinese command terms and vice versa, but command labels themselves follow active locale.

- [ ] **Step 6: Run only**:

```bash
npx vitest run tests/commands.test.ts
npx playwright test tests/e2e/command-center.spec.ts
npm run typecheck
```

- [ ] **Step 7: Commit** command localization separately from command behavior.

---

### Task 8: P3 language verification

**Files:**
- Verify: `lib/i18n/*`
- Verify: Settings components
- Verify: layout/navigation/command components
- Verify: language-specific tests

- [ ] **Step 1: Run focused unit tests:**

```bash
npx vitest run tests/i18n.test.ts tests/preferences.test.ts tests/settingsRegistry.test.ts tests/commands.test.ts
```

- [ ] **Step 2: Run TypeScript:**

```bash
npm run typecheck
```

- [ ] **Step 3: Run focused E2E:**

```bash
npx playwright test \
  tests/e2e/language-preference.spec.ts \
  tests/e2e/settings.spec.ts \
  tests/e2e/settings-productization.spec.ts \
  tests/e2e/command-center.spec.ts \
  tests/e2e/responsive.spec.ts
```

- [ ] **Step 4: Manual smoke:** switch Chinese -> English -> System and verify Settings, Sidebar, BottomNav, Command Center and shared dialog/common labels update immediately. Confirm user course/task/profile names are byte-for-byte unchanged.

- [ ] **Step 5: Run a scoped source audit for P3-owned surfaces:**

```bash
rg -n '[\p{Han}]' components/settings components/layout components/command lib/commands.ts --glob '*.{ts,tsx}'
```

Remaining Chinese is allowed only in:
- `zh-CN` dictionary;
- bilingual search keyword arrays/tests/fixtures;
- developer comments;
- intentional user/demo fixture data.

Move stray product-owned literals into message dictionaries.

- [ ] **Step 6: Do not run** full suite/build unless a focused failure requires escalation.

## P3 Completion Contract

P3 is complete when:
- Language row is visible and real;
- explicit Chinese/English and system resolution persist correctly;
- `<html lang>`/locale datasets reflect the effective locale;
- Settings, global navigation, common shell and Command Center chrome are coherent in English and Chinese;
- dictionaries are type-locked so missing English keys fail typecheck;
- user content and Kiro response bodies are never translated;
- routes/URLs are unchanged.

## Deferred to P4

- Full workspace/body copy migration for Overview, Tasks, Timetable/Timeline, Courses, Analytics, Group and main Kiro workspace.
- Product-wide final Chinese-literal audit.
