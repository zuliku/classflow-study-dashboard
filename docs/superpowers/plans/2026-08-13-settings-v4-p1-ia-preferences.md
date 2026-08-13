# Settings V4 P1 — IA & Presentation Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the Settings information architecture, split tasks from notifications, remove the placeholder Focus settings page and incomplete global modified view, reserve a hidden `account-sync` section, and extend `AppPreferences` with the four presentation-preference fields that later P2/P3/P5 will activate.

**Architecture:** Keep the existing Settings modal/search shell and Zustand preference source of truth. P1 is structural: visible controls must remain real. Add the future presentation fields to the persisted preference schema now, but do **not** expose Theme/Language/Date/Time controls until their runtime layers land in P2/P3/P5. After P1, `通用` exposes only the already-live startup preference; `外观与显示` exposes only the already-live density and motion preferences. `account-sync` exists as a stable section id/metadata entry but is filtered out of production navigation and has no fake page.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Zustand persist, Tailwind, Vitest, Playwright.

## Global Constraints

- Approved design source: `docs/superpowers/specs/2026-08-13-settings-v4-productization-design.md`.
- Zero fake settings: do not render Theme/Language/Date/Time controls in P1 because their runtimes do not exist yet.
- Keep `个人资料` separate from future account identity.
- Keep `完整演示数据` exactly development-only; do not change its gate or production visibility.
- `账户与同步` is reserved only: stable id yes, visible navigation/page/login/sync/device placeholder no.
- Removing `专注与学习` from Settings must not alter Focus runtime/session behavior.
- Notification behavior/store/permission requests must be moved, not rewritten.
- Preserve row-level `modified` + reset affordances where they already work. Remove only the **global** “已修改 N” workspace and nav dots.
- Do not bump the Zustand persist version solely for additive preference fields; old payloads are repaired by `sanitizePreferences()` unless current store migration code proves a version bump is required.
- Do not change DDL/Reminder/StudyBlock time storage semantics.
- Validation is intentionally narrow. Do not run full `npm test`, full `npm run test:e2e`, or `npm run build` by default.
- If targeted validation exposes a small pre-existing selector/copy/type issue, fix it explicitly. Do not weaken assertions or skip tests.

---

### Task 1: Extend the persisted Presentation Preferences schema safely

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/preferences.ts`
- Modify: `tests/preferences.test.ts`
- Modify: `tests/settingsRegistry.test.ts`

**Interfaces:**
- Add: `ThemePreference`, `LanguagePreference`, `DateFormatPreference`, `TimeFormatPreference`.
- Extend: `AppPreferences`.
- Preserve: `DEFAULT_PREFERENCES`, `sanitizePreferences`, `getModifiedPreferenceKeys`, `resetPreferencePatch`.
- Remove after Task 2 wiring is gone: `PREFERENCE_SECTIONS`, `getModifiedSections`.

- [ ] **Step 1: Add failing preference tests** for the exact new defaults and sanitizer behavior:

```ts
expect(DEFAULT_PREFERENCES.themePreference).toBe("system");
expect(DEFAULT_PREFERENCES.languagePreference).toBe("system");
expect(DEFAULT_PREFERENCES.dateFormatPreference).toBe("system");
expect(DEFAULT_PREFERENCES.timeFormatPreference).toBe("system");

expect(sanitizePreferences({ themePreference: "dark" }).themePreference).toBe("dark");
expect(sanitizePreferences({ themePreference: "neon" }).themePreference).toBe("system");
expect(sanitizePreferences({ languagePreference: "en-US" }).languagePreference).toBe("en-US");
expect(sanitizePreferences({ languagePreference: "fr-FR" }).languagePreference).toBe("system");
expect(sanitizePreferences({ dateFormatPreference: "dmy" }).dateFormatPreference).toBe("dmy");
expect(sanitizePreferences({ dateFormatPreference: "long" }).dateFormatPreference).toBe("system");
expect(sanitizePreferences({ timeFormatPreference: "12h" }).timeFormatPreference).toBe("12h");
expect(sanitizePreferences({ timeFormatPreference: "ampm" }).timeFormatPreference).toBe("system");
```

Also extend the existing old-persisted-payload and backup round-trip cases so missing fields repair to `system`, while explicit valid values survive restore. Keep the current assertion that domain DDL remains unchanged after restore.

- [ ] **Step 2: Run only**:

```bash
npx vitest run tests/preferences.test.ts
```

Confirm the new assertions fail before implementation.

- [ ] **Step 3: Add the exact type aliases** in `types/index.ts`:

```ts
export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "system" | "zh-CN" | "en-US";
export type DateFormatPreference = "system" | "iso" | "mdy" | "dmy";
export type TimeFormatPreference = "system" | "24h" | "12h";
```

Add all four fields to `AppPreferences`. Keep them presentation-only; no domain model references them.

- [ ] **Step 4: Extend `lib/preferences.ts`.** Add readonly option arrays and defaults, then sanitize each field independently using the same membership-check pattern already used for motion/startup/task defaults. Do not create a second store.

```ts
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export const LANGUAGE_PREFERENCES = ["system", "zh-CN", "en-US"] as const;
export const DATE_FORMAT_PREFERENCES = ["system", "iso", "mdy", "dmy"] as const;
export const TIME_FORMAT_PREFERENCES = ["system", "24h", "12h"] as const;
```

- [ ] **Step 5: Update existing test fixtures** such as `validPrefs` so compile-time/full-object expectations include all four new fields. Do not loosen equality to partial matching merely to avoid updating fixtures.

- [ ] **Step 6: Run the targeted preference test again** and stop when green:

```bash
npx vitest run tests/preferences.test.ts
```

- [ ] **Step 7: Commit** the schema/sanitizer unit as one reviewable commit.

---

### Task 2: Replace the flat Settings section model with V4 visible/reserved IA

**Files:**
- Modify: `types/index.ts`
- Modify: `components/settings/SettingsNav.tsx`
- Modify: `components/settings/SettingsView.tsx`
- Modify: `lib/settingsRegistry.ts`
- Modify: `tests/settingsRegistry.test.ts`

**Target section union:**

```ts
export type SettingsSection =
  | "general"
  | "appearance"
  | "profile"
  | "semester"
  | "tasks"
  | "notifications"
  | "interaction"
  | "kiro"
  | "kiro-agent"
  | "account-sync"
  | "data"
  | "about";
```

`focus` is removed. `account-sync` is valid but hidden.

- [ ] **Step 1: Change the registry/unit tests first.** Assert:
  - `focus` is no longer a valid visible section/nav item;
  - `appearance` and `notifications` are visible sections;
  - `account-sync` is represented as reserved/hidden and never appears in the flattened visible nav;
  - browser-notification and missed-reminder registry entries belong to `notifications`;
  - `content-density` and `motion-preference` belong to `appearance`;
  - search ids remain stable.

Remove the V3 tests for `getModifiedSections`/`PREFERENCE_SECTIONS`; retain tests for `getModifiedPreferenceKeys` and `resetPreferencePatch`, because row-level reset remains valid.

- [ ] **Step 2: Run only**:

```bash
npx vitest run tests/settingsRegistry.test.ts
```

Confirm failure before changing implementation.

- [ ] **Step 3: Introduce grouped nav metadata** in `SettingsNav.tsx` without creating nested routes. Use four desktop visual groups:

```text
常规: 通用 / 外观与显示 / 个人资料
学习: 学期与课表 / 任务 / 通知与提醒 / 交互与快捷键
Kiro: Kiro 与 AI / Kiro Agent
数据与系统: [账户与同步 hidden] / 数据与存储 / 关于
```

Recommended shape:

```ts
interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
  visible?: boolean;
}

interface SettingsNavGroup {
  id: "general" | "learning" | "kiro" | "system";
  label: string;
  items: SettingsNavItem[];
}
```

Export a flattened `VISIBLE_SETTINGS_NAV` for mobile/search label lookup. Set `account-sync` to `visible: false`; do not create an AccountSync component.

- [ ] **Step 4: Remove modified-dot plumbing** from `SettingsNavProps`, nav items, mobile tabs, and `SettingsView`. Remove `showModified`, `modifiedGroups`, `ToolbarTabs`, `preferenceTitle`, `formatPreferenceValue`, global reset button, and imports that only support that view. Keep `SettingsRow.modified` behavior untouched.

After removal, the right pane should start directly with search results or section content; delete the now-empty `settings-toolbar` wrapper rather than keeping dead spacing.

- [ ] **Step 5: Guard external section targeting.** When `settingsTargetSection` is set, only navigate if it is in `VISIBLE_SETTINGS_NAV`; otherwise clear the target and remain/fallback to `general`. This prevents a future `account-sync` target from opening a nonexistent page in this phase.

- [ ] **Step 6: Update `lib/settingsRegistry.ts` section assignments** only; do not translate registry copy yet. P3 owns i18n. Keep IDs stable.

- [ ] **Step 7: Run the targeted registry tests** again:

```bash
npx vitest run tests/settingsRegistry.test.ts
```

- [ ] **Step 8: Commit** the IA metadata/global-modified-view removal as one commit.

---

### Task 3: Split General/Appearance and Task/Notifications without changing behavior

**Files:**
- Modify: `components/settings/GeneralSettings.tsx`
- Create: `components/settings/AppearanceSettings.tsx`
- Modify: `components/settings/TaskSettings.tsx`
- Create: `components/settings/NotificationSettings.tsx`
- Modify: `components/settings/SettingsView.tsx`
- Delete: `components/settings/FocusSettings.tsx`
- Modify: `tests/e2e/settings-productization.spec.ts`
- Modify: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Update the focused E2E expectations first.** Replace V3 assertions with V4 structure:
  - desktop nav exposes `通用`, `外观与显示`, `个人资料`, `学期与课表`, `任务`, `通知与提醒`, `交互与快捷键`, `Kiro 与 AI`, `Kiro Agent`, `数据与存储`, `关于`;
  - `专注与学习` is absent;
  - `账户与同步` is absent in this phase;
  - `任务` contains task defaults but no browser notification switch;
  - `通知与提醒` contains `应用内提醒`, browser notification permission state, missed-reminder policy;
  - `外观与显示` contains live `界面密度` + `动效偏好`;
  - `通用` still contains `默认打开位置`;
  - there is no global `已修改` toolbar/view.

Do not add assertions for Theme/Language/Date/Time rows yet.

- [ ] **Step 2: Run only the productization spec** and confirm failure:

```bash
npx playwright test tests/e2e/settings-productization.spec.ts --project=chromium
```

If the repo Playwright config has no named `chromium` project, run the same single file without `--project`; do not run all E2E.

- [ ] **Step 3: Make `GeneralSettings` startup-only.** Move the existing density and motion rows out intact. Update section description accordingly. Do not add language/date/time controls yet.

- [ ] **Step 4: Create `AppearanceSettings.tsx`** by moving the existing `contentDensity` and `motionPreference` rows, reset behavior and exact stores intact. Use `data-testid="settings-appearance"`. Do not add the theme row yet; P2 adds it once Theme runtime is real.

- [ ] **Step 5: Make `TaskSettings` task-only.** Keep exactly these rows and existing behavior:
  - `ddl-warning-days`
  - `default-ddl-time`
  - `default-task-priority`
  - `default-task-status`
  - `default-task-workspace-view`

Remove all reminder-store/browser-permission imports from this component.

- [ ] **Step 6: Create `NotificationSettings.tsx`** by moving, not redesigning, the current reminder block and permission logic from `TaskSettings`. Keep `useReminderPreferencesStore`, permission request only on explicit user toggle, denied/unsupported handling, and conditional recent-only window exactly as current behavior. Use `data-testid="settings-notifications"`.

- [ ] **Step 7: Remove `FocusSettings` from `SettingsView` and delete its file.** Do not touch `components/focus/*`, `FocusRuntime`, `FocusSession`, or Kiro focus tools.

- [ ] **Step 8: Wire all visible sections into `SettingsView` as resident hidden panes** so Profile/Semester local draft state continues surviving section switches. Add `AppearanceSettings` and `NotificationSettings` panes. There is no mounted account-sync pane.

- [ ] **Step 9: Update the mobile Settings test** in `tests/e2e/settings.spec.ts` to use `任务` / `通知与提醒`; remove assertions around the old modified workspace/toolbar and replace that test with search -> row jump -> row-level reset behavior. Search for `默认截止时间`, change it, use the row reset affordance directly, and verify `23:59` returns.

- [ ] **Step 10: Run only the two affected Settings E2E files**:

```bash
npx playwright test tests/e2e/settings-productization.spec.ts tests/e2e/settings.spec.ts
```

Fix only selectors/copy genuinely changed by V4; do not weaken unrelated behavior assertions.

- [ ] **Step 11: Commit** the section split/removal as one commit.

---

### Task 4: Formalize Kiro Settings copy boundaries without changing stores

**Files:**
- Modify: `components/settings/KiroAISettings.tsx`
- Modify: `components/settings/KiroMemorySettings.tsx` only if group placement requires a wrapper/copy adjustment
- Modify: `components/settings/KiroAgentSettings.tsx`
- Modify: `lib/settingsRegistry.ts`
- Modify: `tests/e2e/settings-productization.spec.ts`
- Modify: targeted Kiro settings E2E only if existing selectors depend on renamed group headings

**Target Kiro & AI groups:**

```text
模型与服务
回答与个性化
联网与工具
记忆
```

- [ ] **Step 1: Update the productization E2E group-heading expectations** to the four approved groups while keeping assertions for Provider/API Key/connection, output size, web search and Memory controls.

- [ ] **Step 2: Re-group existing rows in `KiroAISettings.tsx` without moving state between stores.** This is an IA/copy change only. Provider/model/reasoning/credentials stay on their current stores; output size/response preference/auto context stay on `useKiroPreferencesStore`; search/PDF vision stay on existing search preferences/session credentials; Memory remains `KiroMemorySettings`.

- [ ] **Step 3: Remove roadmap UI from `KiroAgentSettings.tsx`.** Delete the `桌面能力 / 桌面版后续支持 / future Tauri Full Access` row and unused `MonitorUp` import. Keep the current `安全与能力` statement about V1 exclusions because that describes the present security boundary, not roadmap.

- [ ] **Step 4: Keep Computer Agent behavior unchanged.** No permission-mode, workspace grant, sandbox or file-system capability changes belong in P1.

- [ ] **Step 5: Run only**:

```bash
npx playwright test tests/e2e/settings-productization.spec.ts tests/e2e/kiro-computer-controls.spec.ts
```

- [ ] **Step 6: Commit** the Kiro Settings IA/copy cleanup.

---

### Task 5: P1 verification and no-fake-settings audit

**Files:**
- Verify: `types/index.ts`
- Verify: `lib/preferences.ts`
- Verify: `lib/settingsRegistry.ts`
- Verify: `components/settings/*`
- Verify: `tests/preferences.test.ts`
- Verify: `tests/settingsRegistry.test.ts`
- Verify: `tests/e2e/settings.spec.ts`
- Verify: `tests/e2e/settings-productization.spec.ts`

- [ ] **Step 1: Run the two focused unit files:**

```bash
npx vitest run tests/preferences.test.ts tests/settingsRegistry.test.ts
```

- [ ] **Step 2: Run TypeScript:**

```bash
npm run typecheck
```

- [ ] **Step 3: Run only the focused Settings E2E:**

```bash
npx playwright test tests/e2e/settings.spec.ts tests/e2e/settings-productization.spec.ts
```

- [ ] **Step 4: Manual smoke in the existing dev server:**
  - desktop grouped nav reads correctly and does not shift the Settings detail pane;
  - mobile tabs still scroll horizontally without viewport overflow;
  - no `已修改 N` global view or modified nav dots remain;
  - row-level reset still appears after changing a supported AppPreference;
  - `专注与学习` absent; Focus feature itself still usable outside Settings;
  - `账户与同步` absent from production-facing Settings;
  - `完整演示数据` remains present only in development;
  - notification permission still requests only after explicit user action;
  - Theme/Language/Date/Time rows are **not** visible yet.

- [ ] **Step 5: Do not run** full `npm test`, full E2E, or build unless a targeted failure requires broader diagnosis.

## P1 Completion Contract

P1 is complete only when Settings V4 structure is real but does not pretend later runtimes already exist. Expected visible state at P1 completion:

```text
通用                -> 默认打开位置
外观与显示          -> 界面密度 / 动效
个人资料
学期与课表
任务                -> task defaults only
通知与提醒          -> notification/reminder behavior only
交互与快捷键
Kiro 与 AI          -> four internal groups
Kiro Agent          -> present capability/safety only
数据与存储
关于
```

`account-sync` exists in code but is hidden. Theme/Language/Date/Time preference values exist safely in persisted preferences but become user-visible only when P2/P3/P5 make them functional.

## Deferred to Later V4 Plans

- P2: Theme runtime, dark palette, semantic color migration, Theme row.
- P3: typed i18n runtime, English/Chinese settings + shell, Language row.
- P4: remaining product UI i18n migration.
- P5: presentation formatter facade, Date/Time rows and UI migration.
- Later project: Account & Cloud Sync V1 implementation and visible `账户与同步` page.
