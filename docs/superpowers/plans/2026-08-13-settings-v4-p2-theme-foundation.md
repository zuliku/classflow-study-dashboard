# Settings V4 P2 — Theme Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `themePreference = system | light | dark` a real, global ClassFlow capability with no first-paint light flash, a warm low-saturation dark palette, and semantic color tokens that work across the app without mutating course/data colors.

**Architecture:** Mirror the existing reduced-motion pattern: persisted preference is read by a tiny pre-hydration bootstrap that writes `data-theme-preference` and `data-theme-effective` on `<html>`, while a client runtime listens to the Zustand preference and `prefers-color-scheme` changes. Convert the existing fixed light palette into CSS-variable-backed semantic/compatibility tokens so current `bg-surface`, `text-charcoal`, `border-line`, etc. automatically theme. Then remove remaining literal presentation whites/HEX values in bounded UI slices. Do not change domain-owned color values such as `Course.bgHex` or intentional chart series colors.

**Tech Stack:** Next.js 14, React 18, TypeScript, Zustand, Tailwind 3.4, CSS custom properties, `matchMedia`, Vitest, Playwright.

## Global Constraints

- Requires P1 complete first: `themePreference` exists and `外观与显示` is visible, but no Theme row yet.
- Keep `MOTION_BOOTSTRAP_SCRIPT` behavior unchanged; add a separate Theme bootstrap in this phase.
- The stored value is the user preference. Never persist `effectiveTheme`.
- `system` must respond to live `prefers-color-scheme` changes without refresh.
- Theme is presentation only. Never rewrite `Course.bgHex`, `borderHex`, `textHex`, assignment data, chart data values or persisted business records.
- Dark is not mathematical inversion and must not use pure black as the page background.
- Preserve the existing warm ClassFlow identity in light mode; this task must not visually redesign light mode.
- Native controls should receive `color-scheme` through the root effective theme.
- Do not introduce `next-themes` or another theme dependency; current architecture is sufficient.
- Do not merge Theme and Motion bootstrap code for DRY reasons in this phase.
- Testing is targeted: pure resolver tests + one theme E2E + typecheck; no full suite/build by default.

---

### Task 1: Implement pure Theme preference resolution and persisted-value reader

**Files:**
- Create: `lib/themePreference.ts`
- Create: `tests/themePreference.test.ts`

**Interfaces:**

```ts
export type EffectiveTheme = "light" | "dark";
export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemDark: boolean
): EffectiveTheme;
export function readPersistedThemePreference(raw: string | null): ThemePreference;
export function readEffectiveThemeDataset(value: string | undefined): EffectiveTheme | null;
export const THEME_BOOTSTRAP_SCRIPT: string;
```

- [ ] **Step 1: Write failing tests** covering:
  - explicit `light` ignores system dark;
  - explicit `dark` ignores system light;
  - `system` follows the boolean system value;
  - no/malformed storage returns `system`;
  - current Zustand persist envelope (`state.preferences.themePreference`) is read;
  - legacy direct-preferences envelope is tolerated like Motion;
  - invalid values fall back to `system`.

- [ ] **Step 2: Run only**:

```bash
npx vitest run tests/themePreference.test.ts
```

Confirm failure.

- [ ] **Step 3: Implement the pure functions** using the same storage key as `lib/motionPreference.ts` (`classflow-storage-v2`). Do not import the Zustand store into the bootstrap module.

- [ ] **Step 4: Implement `THEME_BOOTSTRAP_SCRIPT`.** Before paint it must:
  1. read localStorage defensively;
  2. resolve valid `themePreference` or `system`;
  3. read `matchMedia("(prefers-color-scheme: dark)").matches`;
  4. set `document.documentElement.dataset.themePreference`;
  5. set `document.documentElement.dataset.themeEffective`.

No `localStorage.setItem`, no Store mutation, no async work.

- [ ] **Step 5: Run the same unit file** until green.

- [ ] **Step 6: Commit** Theme resolution/bootstrap foundation.

---

### Task 2: Add runtime synchronization and first-paint wiring

**Files:**
- Create: `hooks/useEffectiveTheme.ts`
- Create: `components/providers/ThemeRuntime.tsx`
- Modify: `app/layout.tsx`
- Modify: `tests/themePreference.test.ts` if a small pure helper is added for runtime state

**Interfaces:**
- `useEffectiveTheme(): "light" | "dark"`
- `<ThemeRuntime />` has no visible UI; it keeps root datasets synchronized.

- [ ] **Step 1: Implement `useEffectiveTheme`.** Subscribe narrowly to `useAppStore((s) => s.preferences.themePreference)`. For `system`, subscribe to `window.matchMedia("(prefers-color-scheme: dark)")`; remove the listener on cleanup. Explicit light/dark preferences must not be affected by system changes.

- [ ] **Step 2: Implement `ThemeRuntime`.** On effective/preference changes, update:

```ts
const root = document.documentElement;
root.dataset.themePreference = preference;
root.dataset.themeEffective = effective;
```

Do not own any app data.

- [ ] **Step 3: Wire the prepaint script in `app/layout.tsx`** next to the existing Motion bootstrap:

```tsx
<head>
  <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
  <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP_SCRIPT }} />
</head>
```

The exact ordering is not semantically important, but keep both synchronous and tiny. Keep `suppressHydrationWarning` on `<html>`.

- [ ] **Step 4: Mount `<ThemeRuntime />` once** under `<body>` before/alongside page children. Do not wrap every page separately.

- [ ] **Step 5: Remove the fixed body utility `bg-[#F7F5F5]`** from `app/layout.tsx`; body background/color must come from semantic theme tokens/CSS in Task 3.

- [ ] **Step 6: Run**:

```bash
npm run typecheck
npx vitest run tests/themePreference.test.ts
```

- [ ] **Step 7: Commit** runtime/bootstrap wiring.

---

### Task 3: Convert the global palette to CSS-variable-backed semantic tokens

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.js`
- Verify: `components/ui/*`
- Verify: `components/settings/SettingsControls.tsx`

**Token strategy:** Store color channels as RGB triples so Tailwind opacity modifiers continue to work.

```css
:root,
html[data-theme-effective="light"] {
  --color-background: 247 245 245;
  --color-surface: 244 242 239;
  --color-surface-soft: 240 235 225;
  --color-surface-muted: 227 230 224;
  --color-text-primary: 49 48 50;
  --color-text-secondary: 103 98 102;
  --color-text-muted: 164 143 130;
  --color-border: 205 185 171;
  --color-accent-muted: 227 230 224;
}

html[data-theme-effective="dark"] {
  --color-background: 28 27 29;
  --color-surface: 35 33 35;
  --color-surface-soft: 42 39 38;
  --color-surface-muted: 46 48 45;
  --color-text-primary: 236 232 228;
  --color-text-secondary: 188 180 176;
  --color-text-muted: 151 138 129;
  --color-border: 92 82 77;
  --color-accent-muted: 57 62 56;
}
```

These dark values are the implementation baseline; small contrast tuning during the manual smoke is allowed, but do not change the warm/low-saturation direction.

- [ ] **Step 1: Define light and dark semantic variables** in `globals.css` for:
  - background;
  - surface / surface-soft / surface-muted;
  - text primary / secondary / muted;
  - border base / soft / strong;
  - accent muted;
  - danger foreground/background/border;
  - warning foreground/background/border;
  - success foreground/background/border.

Keep Motion tokens outside the theme blocks.

- [ ] **Step 2: Set root color-scheme:**

```css
html[data-theme-effective="light"] { color-scheme: light; }
html[data-theme-effective="dark"] { color-scheme: dark; }
```

Set `body` background and foreground through the semantic variables, not fixed HEX.

- [ ] **Step 3: Convert Tailwind color definitions to CSS variables.** Use one helper in `tailwind.config.js`:

```js
const cssColor = (name) => `rgb(var(${name}) / <alpha-value>)`;
```

Keep **compatibility aliases** during V4 so existing code immediately themes:
  - `background` -> `--color-background`;
  - `surface*` -> corresponding surface vars;
  - `charcoal` -> primary text;
  - `satin-grey` -> secondary text;
  - `sandrift` -> muted text;
  - `alabaster` -> surface-soft;
  - `alba` / `pastel-mint` -> theme-appropriate muted/accent surface;
  - `stone-beige` and `line.*` -> border vars;
  - danger/warning/success -> theme vars.

Also add new semantic aliases `foreground`, `foreground-muted`, `foreground-subtle`, `accent-muted` for new code. Do not require a whole-app class rename in this task.

- [ ] **Step 4: Preserve opacity behavior.** Verify existing classes such as `bg-pastel-mint/60`, `text-charcoal/80`, `border-line-soft` still compile and render because variables are RGB channels.

- [ ] **Step 5: Check primitive surfaces manually** (`Button`, `Input`, `Switch`, `Dialog`, `DropdownMenu`, `Popover`, `ToastViewport`) and replace literal `white`/fixed presentational colors only where they prevent dark mode. Do not redesign component APIs.

- [ ] **Step 6: Run** `npm run typecheck` and commit token infrastructure before broad consumer migration.

---

### Task 4: Migrate App Shell, Settings and shared UI away from literal light-only colors

**Files:**
- Modify: `app/page.tsx` only for shell/overview presentation colors encountered in this slice
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/layout/BottomNav.tsx`
- Modify: `components/layout/WorkspaceHeader.tsx`
- Modify: `components/layout/WorkspaceSearchButton.tsx`
- Modify: `components/settings/*.tsx` where literal `bg-white`, raw HEX or fixed light-only border/background appears
- Modify: `components/ui/*.tsx` where literal light-only colors appear
- Modify: `components/command/CommandCenter.tsx`

- [ ] **Step 1: Generate a bounded audit before editing:**

```bash
rg -n 'bg-white|hover:bg-white|bg-black|hover:bg-black|text-black|#[0-9A-Fa-f]{6}|bg-\[#|text-\[#|border-\[#' \
  app/page.tsx components/layout components/settings components/ui components/command \
  --glob '*.tsx'
```

Classify each hit as either UI presentation or intentional data/brand color. Do not edit intentional data colors.

- [ ] **Step 2: Replace presentation-only hits** with the semantic/compatibility tokens created in Task 3. Examples:
  - card/input/menu `bg-white` -> `bg-surface` or `bg-background` according to hierarchy;
  - primary black hover -> semantic primary foreground surface rather than raw black;
  - fixed sandrift icon HEX -> `text-sandrift`;
  - fixed settings search backgrounds/borders -> surface/line tokens.

- [ ] **Step 3: Preserve hierarchy.** Page background < card surface < inset/hover surface should remain visually distinguishable in both themes. Do not flatten every panel to the same token.

- [ ] **Step 4: Re-run the same `rg` command.** Remaining hits in this bounded scope must be explainable as intentional data/logo/chart colors; remove accidental presentation literals.

- [ ] **Step 5: Run** `npm run typecheck` and commit this bounded migration.

---

### Task 5: Migrate the main study workspaces in bounded slices

**Files:**
- Modify as reported by the same presentation-color audit under:
  - `components/dashboard/*.tsx`
  - `components/assignment/*.tsx`
  - `components/timeline/*.tsx`
  - `components/drawers/*.tsx`
  - `components/modals/*.tsx`
  - `components/group/*.tsx`
  - `components/reminders/*.tsx`
  - `components/focus/*.tsx`

**Explicit non-theme data exceptions:**
- `Course.bgHex`, `Course.borderHex`, `Course.textHex`;
- user-selected or fixture course colors;
- chart/series palette constants whose purpose is data differentiation;
- vendor/logo colors;
- generated preview/document contents.

- [ ] **Step 1: Audit one directory at a time** with:

```bash
rg -n 'bg-white|hover:bg-white|bg-black|hover:bg-black|text-black|#[0-9A-Fa-f]{6}|bg-\[#|text-\[#|border-\[#' components/<slice> --glob '*.tsx'
```

Do not read giant files wholesale if not needed; use `rg` + focused line ranges.

- [ ] **Step 2: Migrate `dashboard` + `assignment`** presentation hits; run `npm run typecheck`; commit.
- [ ] **Step 3: Migrate `timeline` + `drawers` + `modals`** presentation hits; run `npm run typecheck`; commit.
- [ ] **Step 4: Migrate `group` + `reminders` + `focus`** presentation hits; run `npm run typecheck`; commit.

Keep each commit bounded. Do not mix behavior refactors into color migration.

---

### Task 6: Theme Kiro surfaces without altering conversation/content semantics

**Files:**
- Modify as required by audit: `components/kiro/*.tsx`
- Modify: Kiro-specific UI helpers only if they return literal presentation classes/colors
- Preserve: markdown/KaTeX content logic, conversation history, agent state and provider logic

- [ ] **Step 1: Run the same color audit** on `components/kiro` and identify presentation literals.
- [ ] **Step 2: Convert Kiro rail, thread, composer, menu, worklog, attachment and agent-control surfaces** to semantic tokens. Preserve the intentional continuous Sidebar/Thread Rail brand flow in Full Motion.
- [ ] **Step 3: Do not transform model/user content colors that are intentionally embedded in rendered documents/images/code samples.** Theme only the surrounding ClassFlow UI chrome.
- [ ] **Step 4: Run targeted Kiro layout tests only if changed selectors/styles affect them:**

```bash
npx playwright test tests/e2e/kiro-layout.spec.ts tests/e2e/kiro-responsive.spec.ts
```

If pure class changes do not affect tested geometry/visibility, typecheck + manual smoke is sufficient.
- [ ] **Step 5: Commit** Kiro theme migration separately.

---

### Task 7: Expose the real Theme setting and verify system/explicit behavior

**Files:**
- Modify: `components/settings/AppearanceSettings.tsx`
- Modify: `lib/settingsRegistry.ts`
- Create: `tests/e2e/theme-preference.spec.ts`
- Modify: `tests/settingsRegistry.test.ts`

- [ ] **Step 1: Add registry/unit assertions** that `theme-preference` belongs to `appearance` and is searchable by `主题`, `深色`, `dark`, `light`, `system`.

- [ ] **Step 2: Add the Theme row** to `AppearanceSettings` now that runtime is real:
  - label: `主题`;
  - description: `控制 ClassFlow 的明暗外观；跟随系统时自动响应系统主题。`;
  - options: `跟随系统 / 浅色 / 深色`;
  - store: existing `preferences.themePreference`;
  - immediate save;
  - row-level reset via `resetPreferencePatch("themePreference")`.

- [ ] **Step 3: Write focused E2E cases**:
  1. `page.emulateMedia({ colorScheme: "dark" })` + `system` => root `data-theme-effective="dark"`;
  2. system changes to light while app remains open => effective dataset changes to light;
  3. explicit `dark` remains dark when emulated system becomes light;
  4. explicit `light` remains light when system is dark;
  5. reload preserves the preference and root is already on the correct effective theme when UI becomes visible.

Prefer root dataset assertions plus one representative computed background/foreground check; do not create brittle screenshot pixel tests in V1.

- [ ] **Step 4: Run only**:

```bash
npx vitest run tests/themePreference.test.ts tests/preferences.test.ts tests/settingsRegistry.test.ts
npx playwright test tests/e2e/theme-preference.spec.ts
npm run typecheck
```

- [ ] **Step 5: Manual visual smoke** in light, explicit dark, and system dark across:
  - Settings;
  - Overview;
  - Tasks;
  - Timetable/Timeline;
  - one Drawer + one Modal;
  - Kiro workspace;
  - notification/reminder surfaces.

Check text contrast, input native controls, borders, hover/selected/focus states, scrollbars and KaTeX/code blocks. Fix contrast/token mapping only; do not redesign layouts.

- [ ] **Step 6: Explicitly skip** full suite/build unless targeted failures justify escalation.

## P2 Completion Contract

P2 is complete when:
- Theme row is visible and immediately functional;
- explicit and system themes persist/resolve correctly;
- no light flash occurs because the effective dataset is set before paint;
- system theme changes update live;
- core ClassFlow UI is usable in both light and dark;
- course/data colors are not rewritten;
- Light mode remains visually equivalent to the pre-V4 palette;
- Theme runtime does not touch Motion runtime.

## Deferred

- Custom theme colors/accent picker.
- OLED/pure-black mode.
- Per-workspace themes.
- Cloud sync of preferences (Account & Cloud Sync V1 later synchronizes `themePreference`, not `effectiveTheme`).
