# Core UI Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish six feature-neutral global UI primitives and migrate the first high-value ClassFlow controls to them without broad UI rewrites.

**Architecture:** Add `Button`, `IconButton`, `Input`, `SearchField`, `SegmentedControl`, and `Switch` under `components/ui`. Preserve Settings compatibility by turning `SettingsControls.tsx` into thin adapters over the global primitives. Migrate only Workspace Search/primary actions and the Tasks search/view controls; leave Menu/Dialog/Drawer/Timeline/Kiro bulk migrations for later tasks.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Tailwind CSS, Lucide, existing Playwright setup.

## Global Constraints

- Product direction: Linear structure + Notion Calendar low-noise visual language.
- Do not add dependencies.
- Do not add persisted state, Context, or CustomEvent.
- Do not redesign page bodies, cards, menus, dialogs, drawers, Timeline toolbar, Kiro composer/rail, or Group forms.
- `SettingsSelect` remains backed by existing `UISelect`.
- Existing Settings call sites should not require broad edits.
- Tasks Archive and Risk Filter remain feature-specific; only Primary Views use `SegmentedControl`.
- Keep tests minimal: `npm run typecheck` + one targeted Tasks E2E invocation. Build is conditional, not default.
- Task 2A ends after the scoped migration; do not start Task 2B.

---

## File Structure

**Create**
- `components/ui/Button.tsx` — standard text/content button primitive.
- `components/ui/IconButton.tsx` — square icon-only button primitive.
- `components/ui/Input.tsx` — standard single-line input primitive.
- `components/ui/SearchField.tsx` — search input composition using `Input` semantics.
- `components/ui/SegmentedControl.tsx` — pressed-button segmented selection primitive.
- `components/ui/Switch.tsx` — accessible boolean switch primitive.

**Modify**
- `components/settings/SettingsControls.tsx` — keep public Settings API, delegate to global primitives.
- `components/layout/WorkspaceSearchButton.tsx` — use global button primitive while preserving Command Center behavior.
- `components/assignment/AssignmentsWorkspace.tsx` — use global `Button` for primary create action.
- `app/page.tsx` — use global `Button` for Courses primary action and fix Kiro PageTransition spacing.
- `components/group/GroupCollaborationView.tsx` — use global `Button` for project creation.
- `components/dashboard/AssignmentTable.tsx` — use `SearchField` and `SegmentedControl` for Tasks workspace controls only.
- `tests/e2e/assignment-workspace.spec.ts` — add one compact regression covering search + view switching; retain existing Task 1 Quick Add case.

**Do not modify**
- `components/ui/Select.tsx`
- Timeline menu/control implementation
- Kiro menu/composer/rail controls
- Dialog/Drawer/Popover implementations

---

### Task 1: Add global core primitives and Settings compatibility wrappers

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/IconButton.tsx`
- Create: `components/ui/Input.tsx`
- Create: `components/ui/SearchField.tsx`
- Create: `components/ui/SegmentedControl.tsx`
- Create: `components/ui/Switch.tsx`
- Modify: `components/settings/SettingsControls.tsx`

**Interfaces:**

```ts
// Button.tsx
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}
export function Button(props: ButtonProps): React.ReactElement;

// IconButton.tsx
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "secondary" | "primary" | "danger";
  size?: "sm" | "md";
}
export function IconButton(props: IconButtonProps): React.ReactElement;

// Input.tsx
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}
export function Input(props: InputProps): React.ReactElement;

// SearchField.tsx
export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onClear?: () => void;
}
export function SearchField(props: SearchFieldProps): React.ReactElement;

// SegmentedControl.tsx
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}
export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
  className?: string;
}
export function SegmentedControl<T extends string | number>(
  props: SegmentedControlProps<T>
): React.ReactElement;

// Switch.tsx
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}
export function Switch(props: SwitchProps): React.ReactElement;
```

- [ ] **Step 1: Implement `Button` and `IconButton` using existing semantic tokens**

`Button` must forward all native button props and use `type="button"` only when the caller does not provide a type. Use these base semantics:

```ts
const BUTTON_VARIANTS = {
  primary: "bg-charcoal text-white hover:bg-black",
  secondary: "bg-white border border-line text-charcoal hover:bg-alabaster",
  ghost: "text-satin-grey hover:bg-alabaster hover:text-charcoal",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border",
  accent: "bg-pastel-mint text-charcoal hover:bg-pastel-mint",
};

const BUTTON_SIZES = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-9 px-3.5 text-xs",
};
```

Common classes must include `ux-press`, `rounded-lg`, `font-bold`, `transition-colors`, `focus-visible` treatment, and native disabled styling.

`IconButton` uses the same interaction language but square dimensions:

```ts
const ICON_BUTTON_SIZES = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
};
```

Do not add tooltip, loading, `asChild`, icon-position props, or business state.

- [ ] **Step 2: Implement `Input` and `SearchField`**

`Input` uses standard HTML input props and these core classes:

```text
w-full h-9 px-2.5 bg-[#F7F5F5] border rounded-lg
text-xs font-semibold text-charcoal
placeholder:text-sandrift
focus:outline-none focus:border-charcoal
disabled:opacity-50 disabled:cursor-not-allowed
```

`invalid` selects `border-danger-border`, otherwise `border-line`; `mono` adds `font-mono`.

`SearchField` must:
- render a Lucide `Search` icon on the left;
- forward `value`, `onChange`, `placeholder`, `aria-label`, and other input props;
- render the inner input with `type="search"` so it has searchbox semantics;
- keep filtering/debounce logic outside the primitive;
- render a clear button only when `onClear` exists and the controlled/string value is non-empty;
- if a clear button is rendered, give it `aria-label="清除搜索"`;
- treat `className` as additional styling for the input element; the primitive's wrapper remains feature-neutral.

- [ ] **Step 3: Implement `SegmentedControl` and `Switch`**

`SegmentedControl`:

```tsx
<div role="group" aria-label={ariaLabel}>
  {options.map((option) => (
    <button
      type="button"
      aria-pressed={value === option.value}
      disabled={option.disabled}
      onClick={() => onChange(option.value)}
    >
      {option.label}
    </button>
  ))}
</div>
```

Visual base:

```text
container: flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong
item: px-2.5 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap
active: bg-white text-charcoal shadow-subtle
inactive: text-satin-grey hover:text-charcoal
```

`Switch` keeps the current SettingsToggle geometry and semantics:

```text
role=switch
aria-checked
w-9 h-5
thumb w-4 h-4
checked bg-charcoal
unchecked bg-alba
```

Disabled must set native `disabled`, visual opacity, and prevent `onChange`.

- [ ] **Step 4: Convert `SettingsControls.tsx` to thin adapters**

Keep these existing exports and call signatures so current Settings consumers do not need broad edits:

```text
SettingsSelect
SettingsToggle
SettingsSegmentedControl
SettingsInput
SettingsButton
SettingsButtonVariant
```

Mapping:

```text
SettingsButton           -> Button
SettingsInput            -> Input
SettingsToggle           -> Switch
SettingsSegmentedControl -> SegmentedControl
SettingsSelect           -> UISelect (unchanged)
```

The wrapper may translate legacy prop names such as `ariaLabel`, `error`, and `testid` to native/global props, but it must not retain a second full copy of the Tailwind style definitions.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS. If it fails, fix only primitive/wrapper type mismatches before continuing.

- [ ] **Step 6: Commit the primitive layer**

```bash
git add \
  components/ui/Button.tsx \
  components/ui/IconButton.tsx \
  components/ui/Input.tsx \
  components/ui/SearchField.tsx \
  components/ui/SegmentedControl.tsx \
  components/ui/Switch.tsx \
  components/settings/SettingsControls.tsx

git commit -m "refactor(ui): add core UI primitives"
```

---

### Task 2: Migrate first workspace consumers and close Task 1 spacing regression

**Files:**
- Modify: `components/layout/WorkspaceSearchButton.tsx`
- Modify: `components/assignment/AssignmentsWorkspace.tsx`
- Modify: `app/page.tsx`
- Modify: `components/group/GroupCollaborationView.tsx`
- Modify: `components/dashboard/AssignmentTable.tsx`
- Modify: `tests/e2e/assignment-workspace.spec.ts`

**Consumes:** global primitives from Task 1.

- [ ] **Step 1: Add one focused Tasks regression case before migration**

Append this single test to `tests/e2e/assignment-workspace.spec.ts` using the existing `openWorkspace(page)` helper:

```ts
test("Task 2A core controls：搜索筛选 + Primary View 切换保持可用", async ({ page }) => {
  await openWorkspace(page);

  const search = page.getByLabel("搜索任务");
  await search.fill("数据库");
  await expect(page.locator('[data-assignment-id="a4"]')).toBeVisible();
  await expect(page.locator('[data-assignment-id="a1"]')).toHaveCount(0);

  await search.fill("");
  const allView = page.getByRole("button", { name: /全部/ }).first();
  await allView.click();
  await expect(allView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-assignment-id="a1"]')).toBeVisible();
});
```

- [ ] **Step 2: Run only this E2E file once to establish the RED baseline**

```bash
npx playwright test tests/e2e/assignment-workspace.spec.ts
```

Expected before migration: the new `aria-pressed` assertion fails because the current hand-written Primary View tabs do not expose pressed semantics. Search behavior may already pass. Do not run other E2E files.

- [ ] **Step 3: Migrate `WorkspaceSearchButton`**

Preserve exactly:

```ts
setSearchModalView("palette");
setSearchModalOpen(true);
```

Use the global `Button` for the control. Keep:

```text
aria-label="全局搜索"
<768 icon only
>=768 icon + 搜索
>=1024 icon + 搜索 + ⌘ K
```

`IconButton` is part of the new global vocabulary but does not need a forced consumer in Task 2A; do not split one responsive search action into two DOM buttons solely to demonstrate it.

Do not change Command Center behavior or keyboard shortcut behavior.

- [ ] **Step 4: Migrate Workspace primary actions to `Button`**

Use `Button variant="primary" size="sm"` for:

```text
components/assignment/AssignmentsWorkspace.tsx
- 新增任务 / 收起

app/page.tsx
- Courses 添加课程

components/group/GroupCollaborationView.tsx
- 新建项目
```

Keep the existing handlers and responsive labels exactly. Do not migrate unrelated buttons in those files.

- [ ] **Step 5: Fix Kiro `PageTransition` spacing composition**

In `app/page.tsx`, replace the additive class composition with mutually exclusive classes:

```tsx
<PageTransition
  tab={activeTab}
  className={
    activeTab === "kiro"
      ? "flex flex-col flex-1 min-h-0"
      : "space-y-5"
  }
>
```

Do not modify `KiroWorkspace`, `KiroHeader`, composer, history rail, or sidecar.

- [ ] **Step 6: Migrate Tasks workspace Search to `SearchField`**

Replace only the hand-written Search icon/input wrapper in `AssignmentTable.tsx` with:

```tsx
<SearchField
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  placeholder="搜索任务…"
  aria-label="搜索任务"
  className="min-w-[150px]"
/>
```

Do not change search/filter semantics.

- [ ] **Step 7: Migrate Tasks Primary Views to `SegmentedControl`**

Only in the non-archive branch, replace the hand-written `PRIMARY_TASK_WORKSPACE_VIEWS.map(...)` container with:

```tsx
<SegmentedControl
  value={assignmentWorkspaceView}
  onChange={setAssignmentWorkspaceView}
  ariaLabel="任务视图"
  options={PRIMARY_TASK_WORKSPACE_VIEWS.map((view) => ({
    value: view.id,
    label: (
      <span className="flex items-center gap-1">
        {view.label}
        <span className="text-[9px] font-bold text-sandrift/80">
          {workspaceViewResult?.counts[view.id] ?? 0}
        </span>
      </span>
    ),
  }))}
/>
```

Keep Archive UI, Risk Filter, More menu, course filter, and count semantics unchanged.

- [ ] **Step 8: Run the single targeted E2E file**

```bash
npx playwright test tests/e2e/assignment-workspace.spec.ts
```

Expected: PASS, including the existing Task 1 Quick Add test and the new Task 2A core-controls case.

Do not run responsive/settings/full Playwright suites unless this focused test exposes a concrete cross-shell failure.

- [ ] **Step 9: Run final typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Conditional build gate**

Do **not** run `npm run build` by default.

Run it only if any of the following occurred during implementation:
- a Client/Server import boundary error appeared;
- Next/Tailwind compilation behaved differently from typecheck;
- config or dependencies changed;
- the new primitive imports caused an unresolved module/runtime compile issue.

If none occurred, record `build: skipped by Task 2A test policy` in the final report.

- [ ] **Step 11: Commit the migration**

```bash
git add \
  components/layout/WorkspaceSearchButton.tsx \
  components/assignment/AssignmentsWorkspace.tsx \
  app/page.tsx \
  components/group/GroupCollaborationView.tsx \
  components/dashboard/AssignmentTable.tsx \
  tests/e2e/assignment-workspace.spec.ts

git commit -m "refactor(ui): migrate core workspace controls"
```

---

## Final Verification Checklist

- [ ] Six feature-neutral global primitives exist under `components/ui`.
- [ ] Primitives do not read Zustand/Kiro stores.
- [ ] `SettingsControls.tsx` remains import-compatible and is now a thin adapter layer.
- [ ] `SettingsSelect` still uses existing `UISelect`.
- [ ] Workspace Search still opens the same Command Center palette.
- [ ] Tasks/Courses/Group primary actions use global `Button` without handler changes.
- [ ] Tasks Search uses `SearchField`; search semantics unchanged.
- [ ] Tasks Primary Views use `SegmentedControl`; counts and ordering unchanged.
- [ ] Archive and Risk Filter remain feature-specific.
- [ ] Kiro no longer inherits `space-y-5` in `PageTransition`.
- [ ] No dependency/config/persisted-state/Context/CustomEvent additions.
- [ ] `npx playwright test tests/e2e/assignment-workspace.spec.ts` passes.
- [ ] `npm run typecheck` passes.
- [ ] Build is either skipped under policy or, if triggered by a concrete condition, passes.
- [ ] No Task 2B Menu/Dialog/Drawer/Popover work was started.

## Final Report Format

Report exactly these sections with the actual commit SHAs created during implementation:

```text
UI Productization Task 2A Result

Commits:
- first implementation commit SHA and message
- second implementation commit SHA and message, if a second commit was created

Primitives:
- Button
- IconButton
- Input
- SearchField
- SegmentedControl
- Switch

Compatibility:
- SettingsControls wrapper result
- SettingsSelect unchanged

Migrated surfaces:
- Workspace Search
- Tasks primary action/search/views
- Courses primary action
- Group primary action
- Kiro PageTransition spacing hotfix

Verification:
- assignment-workspace.spec.ts: actual PASS/FAIL result
- typecheck: actual PASS/FAIL result
- build: actual PASS result, or "skipped by Task 2A test policy"

Scope:
- Task 2B not started
```

After reporting, STOP.