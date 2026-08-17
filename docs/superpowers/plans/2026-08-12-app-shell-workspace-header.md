# App Shell & Workspace Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the greeting-centric global Header and per-page banner headers with one shared low-noise `WorkspaceHeader` primitive while preserving all existing workspace behavior.

**Architecture:** Each workspace owner composes the same `WorkspaceHeader`; there is no central header registry or new Store/event channel. `AssignmentsWorkspace` is the only new feature wrapper because Task Quick Add must remain inline and local-state driven while the page title/create action moves out of `AssignmentTable`.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Tailwind CSS, Lucide, existing Playwright/Vitest setup.

## Global Constraints

- Product direction: Linear structure + Notion Calendar low-noise visual language.
- Do not change Sidebar/Icon Rail/Bottom Nav IA.
- Do not change Command Center behavior.
- Do not add persisted state, header registry Context, or header-only CustomEvents.
- Do not redesign page bodies, cards, charts, task ViewBar, Group modals, Kiro composer/thread rail, or global typography.
- Workspace Header has no persistent shadow and is not a Card.
- Timeline Quick Create remains local; do not duplicate its `+` in Workspace Header.
- Task Quick Add remains the existing inline `QuickAddCard`; compact AssignmentTable behavior must remain unchanged.
- Keep tests targeted; no full Playwright suite unless a targeted regression proves cross-shell breakage.
- Maximum implementation commits: 2.

---

## File Structure

**Create**
- `components/layout/WorkspaceHeader.tsx`
- `components/layout/WorkspaceSearchButton.tsx`
- `components/assignment/AssignmentsWorkspace.tsx`

**Modify**
- `app/page.tsx`
- `components/dashboard/AssignmentTable.tsx`
- `components/timeline/TimelineWorkspace.tsx`
- `components/group/GroupCollaborationView.tsx`
- `tests/e2e/responsive.spec.ts`
- `tests/e2e/assignment-workspace.spec.ts`

**Delete after import check**
- `components/layout/Header.tsx`

**Run unchanged regression tests**
- `tests/e2e/command-center.spec.ts`
- `tests/e2e/first-run.spec.ts`
- `tests/e2e/overview-pagination.spec.ts`
- `tests/e2e/timetable-drag.spec.ts`

---

### Task 1: Shared header primitive + simple workspace migration

**Files:**
- Create: `components/layout/WorkspaceSearchButton.tsx`
- Create: `components/layout/WorkspaceHeader.tsx`
- Modify: `app/page.tsx`
- Delete after import check: `components/layout/Header.tsx`
- Test: `tests/e2e/responsive.spec.ts`
- Regression: `tests/e2e/command-center.spec.ts`
- Regression: `tests/e2e/first-run.spec.ts`

**Produces:**

```ts
export interface WorkspaceHeaderProps {
  title: React.ReactNode;
  context?: React.ReactNode;
  primaryAction?: React.ReactNode;
  actions?: React.ReactNode;
  hideSearch?: boolean;
  sticky?: boolean;
  className?: string;
}

export function WorkspaceHeader(props: WorkspaceHeaderProps): React.ReactElement;
export function WorkspaceSearchButton(): React.ReactElement;
```

- [ ] **Step 1: Add the failing shell assertions**

Extend the existing desktop/tablet/mobile cases in `tests/e2e/responsive.spec.ts` with stable semantic assertions:

```ts
await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();
```

In the mobile case, after switching to Tasks, also assert:

```ts
await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();
```

- [ ] **Step 2: Run the responsive test and confirm RED**

```bash
npx playwright test tests/e2e/responsive.spec.ts
```

Expected: desktop/tablet `总览` heading assertion fails because the legacy Header still renders greeting text.

- [ ] **Step 3: Implement `WorkspaceSearchButton`**

Reuse the current Command Center open behavior exactly:

```ts
const setSearchModalOpen = useAppStore((s) => s.setSearchModalOpen);
const setSearchModalView = useAppStore((s) => s.setSearchModalView);

const openSearch = () => {
  setSearchModalView("palette");
  setSearchModalOpen(true);
};
```

Render a real button with `aria-label="全局搜索"`. Responsive content:

```text
<768      icon only
>=768     icon + 搜索
>=1024    icon + 搜索 + ⌘ K
```

Use existing semantic colors and no `shadow-subtle`.

- [ ] **Step 4: Implement `WorkspaceHeader`**

Use this semantic skeleton:

```tsx
<header
  className={cn(
    "z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-[#F7F5F5] py-2.5",
    sticky && "sticky top-0",
    className
  )}
>
  <div className="min-w-0">
    <h1 className="truncate text-base font-semibold tracking-tight text-charcoal md:text-lg">
      {title}
    </h1>
    {context ? (
      <div className="mt-0.5 truncate text-[11px] text-sandrift md:text-xs">{context}</div>
    ) : null}
  </div>
  <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
    {actions}
    {primaryAction}
    {!hideSearch ? <WorkspaceSearchButton /> : null}
  </div>
</header>
```

Do not add feature variants.

- [ ] **Step 5: Remove the unconditional legacy Header**

Delete the `Header` import and `<Header />` render from `app/page.tsx`.

Before deleting the file, run:

```bash
grep -R 'components/layout/Header' app components tests -n
```

If no runtime import remains, delete `components/layout/Header.tsx`.

- [ ] **Step 6: Add current-week context in `app/page.tsx`**

Read `currentSemesterWeek` from Store and import `formatWeekDateRange` from `@/lib/semester`.

```ts
const currentWeekContext = `第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(
  semester,
  currentSemesterWeek
)}`;
```

- [ ] **Step 7: Migrate Overview**

Render before Overview body:

```tsx
<WorkspaceHeader title="总览" context={currentWeekContext} sticky />
```

Do not change Getting Started or Dashboard cards.

- [ ] **Step 8: Migrate Courses**

Delete the old Courses Header Card and render:

```tsx
<WorkspaceHeader
  title="课程资料"
  context={`${courses.length} 门课程 · ${totalCredits} 学分`}
  primaryAction={
    <button
      type="button"
      onClick={() => setAddCourseModalOpen(true)}
      className="ux-press flex h-8 items-center gap-1.5 rounded-lg bg-charcoal px-3 text-xs font-bold text-white transition-colors hover:bg-black"
    >
      <Plus className="h-3.5 w-3.5" />
      <span>添加课程</span>
    </button>
  }
  sticky
/>
```

Do not change Course Card UI.

- [ ] **Step 9: Migrate Analytics**

Delete the old Analytics Banner Card and render:

```tsx
<WorkspaceHeader
  title="学习统计"
  context={`本学期 · 第 ${currentSemesterWeek} 周`}
  sticky
/>
```

Do not change metrics/charts/empty state.

- [ ] **Step 10: Add Kiro Workspace-level header**

For `activeTab === "kiro"` render:

```tsx
<div className="flex flex-1 min-h-0 flex-col">
  <WorkspaceHeader title="Kiro" className="px-4 md:px-6" />
  <KiroWorkspace />
</div>
```

Do not edit `KiroHeader.tsx`.

Change `PageTransition` classes so Kiro does not inherit `space-y-5`:

```ts
activeTab === "kiro"
  ? "flex flex-col flex-1 min-h-0"
  : "space-y-5"
```

- [ ] **Step 11: Run focused shell regressions**

```bash
npx playwright test \
  tests/e2e/responsive.spec.ts \
  tests/e2e/command-center.spec.ts \
  tests/e2e/first-run.spec.ts
```

Expected: PASS.

- [ ] **Step 12: Typecheck and commit**

```bash
npm run typecheck

git add app/page.tsx components/layout/WorkspaceHeader.tsx components/layout/WorkspaceSearchButton.tsx components/layout/Header.tsx tests/e2e/responsive.spec.ts
git commit -m "refactor(ui): establish workspace header shell"
```

If `Header.tsx` was deleted, `git add` should naturally stage the deletion.

---

### Task 2: Tasks, Timeline and Group migration

**Files:**
- Create: `components/assignment/AssignmentsWorkspace.tsx`
- Modify: `components/dashboard/AssignmentTable.tsx`
- Modify: `app/page.tsx`
- Modify: `components/timeline/TimelineWorkspace.tsx`
- Modify: `components/group/GroupCollaborationView.tsx`
- Test: `tests/e2e/assignment-workspace.spec.ts`
- Regression: `tests/e2e/overview-pagination.spec.ts`
- Regression: `tests/e2e/timetable-drag.spec.ts`
- Regression: `tests/e2e/responsive.spec.ts`

**AssignmentTable interface:**

```ts
export interface AssignmentTableProps {
  mode?: "compact" | "workspace";
  workspaceQuickAddOpen?: boolean;
  onWorkspaceQuickAddOpenChange?: (open: boolean) => void;
}
```

- [ ] **Step 1: Add failing Task Workspace assertions**

In `tests/e2e/assignment-workspace.spec.ts`, after opening the workspace assert:

```ts
await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
await expect(page.getByRole("button", { name: "新增任务" })).toBeVisible();
```

Click `新增任务` and assert:

```ts
await expect(page.getByTestId("quick-add-card")).toBeVisible();
```

Click the same header button again and assert:

```ts
await expect(page.getByTestId("quick-add-card")).toBeHidden();
```

- [ ] **Step 2: Run the task workspace test and confirm RED**

```bash
npx playwright test tests/e2e/assignment-workspace.spec.ts
```

Expected: Header placement/controlled Quick Add assertions fail before migration.

- [ ] **Step 3: Make workspace Quick Add controlled in `AssignmentTable`**

Remove the workspace `quickAddOpen` local state. Read:

```ts
const quickAddOpen = workspaceQuickAddOpen ?? false;
const setQuickAddOpen = (open: boolean) => onWorkspaceQuickAddOpenChange?.(open);
```

For `isWorkspace === true`:

- do not render the `任务与 DDL` title row;
- do not render workspace Ask Kiro / breakdown / create controls;
- keep `QuickAddCard` inside the table so it continues to use local `courseFilter`:

```tsx
{quickAddOpen ? (
  <QuickAddCard
    defaultCourseId={courseFilter !== "all" ? courseFilter : undefined}
    onClose={() => setQuickAddOpen(false)}
  />
) : null}
```

For compact mode, preserve the current `任务清单` heading, count, overdue badge, create button, modal behavior and pagination.

- [ ] **Step 4: Create `AssignmentsWorkspace`**

Use:

```ts
const [quickAddOpen, setQuickAddOpen] = useState(false);
const assignments = useAppStore((s) => s.assignments);
const highlightedAssignmentId = useAppStore((s) => s.highlightedAssignmentId);
const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
const incompleteCount = assignments.filter((a) => a.status !== "completed").length;
const handoff = useKiroHandoff();
```

Actions:

```tsx
const headerActions = (
  <>
    <KiroFlowButton
      icon={KIRO_ICON}
      label="Ask Kiro"
      size="sm"
      className="h-8"
      onClick={() =>
        highlightedAssignmentId
          ? handoff.openForAssignment(highlightedAssignmentId)
          : handoff.openForWeek(currentSemesterWeek)
      }
    />
    {highlightedAssignmentId ? (
      <button
        type="button"
        onClick={() => {
          handoff.openForAssignment(highlightedAssignmentId);
          handoff.handoffPrompt(
            "帮我拆解这个任务，拆成 2–8 个可执行的步骤，并估算每步和总耗时。"
          );
        }}
        className="ux-press hidden h-8 rounded-lg border border-line bg-alabaster px-2.5 text-[11px] font-bold text-charcoal transition-colors hover:bg-line-soft lg:inline-flex lg:items-center"
      >
        帮我拆解当前任务
      </button>
    ) : null}
  </>
);
```

Primary action:

```tsx
const primaryAction = (
  <button
    type="button"
    aria-expanded={quickAddOpen}
    onClick={() => setQuickAddOpen((v) => !v)}
    className="ux-press flex h-8 items-center gap-1.5 rounded-lg bg-charcoal px-3 text-xs font-bold text-white transition-colors hover:bg-black"
  >
    <Plus className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">{quickAddOpen ? "收起" : "新增任务"}</span>
    <span className="sm:hidden">{quickAddOpen ? "收起" : "新增"}</span>
  </button>
);
```

Render:

```tsx
<div className="space-y-4" data-testid="assignments-tab">
  <WorkspaceHeader
    title="任务与 DDL"
    context={`${incompleteCount} 项未完成`}
    actions={headerActions}
    primaryAction={primaryAction}
    sticky
  />
  <AssignmentTable
    mode="workspace"
    workspaceQuickAddOpen={quickAddOpen}
    onWorkspaceQuickAddOpenChange={setQuickAddOpen}
  />
</div>
```

- [ ] **Step 5: Use `AssignmentsWorkspace` in `app/page.tsx`**

Replace the direct workspace table branch with:

```tsx
{activeTab === "assignments" ? <AssignmentsWorkspace /> : null}
```

Do not change Overview's `<AssignmentTable mode="compact" />`.

- [ ] **Step 6: Migrate Timeline header identity**

Import and render:

```tsx
<WorkspaceHeader
  title="时间表"
  context={`第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(semester, currentSemesterWeek)}`}
  sticky
/>
```

In the existing Timeline local controls remove only the fixed week identity/date block. Keep exactly one local create button and keep:

```text
‹  ›  今天                         Filter  +  Ask Kiro  ···
```

Do not change menu contents or Timeline business interactions.

Change only the desktop Timeline root height expression from:

```text
md:h-[calc(100dvh-92px)]
```

to:

```text
md:h-[calc(100dvh-128px)]
```

Keep the existing mobile `h-[calc(100dvh-128px)]` behavior.

- [ ] **Step 7: Migrate Group Header Banner**

Replace the current Group Header Banner with:

```tsx
<WorkspaceHeader
  title="小组协作"
  context={`${groupProjects.length} 个项目`}
  actions={
    activeProject ? (
      <KiroFlowButton
        icon={KIRO_ICON}
        label="Ask Kiro"
        size="sm"
        className="h-8"
        onClick={() => handoff.openForGroupProject(activeProject.id)}
      />
    ) : undefined
  }
  primaryAction={
    <button
      type="button"
      onClick={openCreateProject}
      className="ux-press flex h-8 items-center gap-1.5 rounded-lg bg-charcoal px-3 text-xs font-bold text-white transition-colors hover:bg-black"
    >
      <Plus className="h-3.5 w-3.5" />
      <span>新建项目</span>
    </button>
  }
  sticky
/>
```

Keep `openCreateProject`, project form state, Ask Kiro condition, project list and empty-state secondary create action unchanged. Do not add Store state or CustomEvents.

- [ ] **Step 8: Run focused regressions**

```bash
npx playwright test \
  tests/e2e/assignment-workspace.spec.ts \
  tests/e2e/overview-pagination.spec.ts \
  tests/e2e/timetable-drag.spec.ts \
  tests/e2e/responsive.spec.ts
```

Expected: PASS.

If `timetable-drag.spec.ts` fails because the grid bounding box moved vertically, use `superpowers:systematic-debugging`; fix only the Workspace Header/Timeline root-height composition, not drag math or TimetableGrid internals.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck

git add app/page.tsx components/assignment/AssignmentsWorkspace.tsx components/dashboard/AssignmentTable.tsx components/timeline/TimelineWorkspace.tsx components/group/GroupCollaborationView.tsx tests/e2e/assignment-workspace.spec.ts
git commit -m "refactor(ui): migrate workspaces to shared header"
```

---

### Task 3: Final focused verification

**Files:** no planned production changes.

- [ ] **Step 1: Run the minimal E2E set**

```bash
npx playwright test \
  tests/e2e/responsive.spec.ts \
  tests/e2e/command-center.spec.ts \
  tests/e2e/first-run.spec.ts \
  tests/e2e/assignment-workspace.spec.ts \
  tests/e2e/overview-pagination.spec.ts \
  tests/e2e/timetable-drag.spec.ts
```

Do not run the full Playwright suite unless this set exposes a shared-shell regression.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Desktop smoke at 1440×900**

Verify:

```text
Overview    总览 + week context + Global Search
Timeline    时间表 + one local Quick Create button only
Tasks       任务与 DDL + Header create toggles inline Quick Add
Courses     no old banner card
Analytics   no old banner card
Group       no old banner card; Ask Kiro + 新建项目 work
Kiro        Workspace title Kiro + existing Thread title; no scroll-height regression
```

- [ ] **Step 5: Tablet smoke at 1024×768**

Verify Icon Rail unchanged, Workspace title/Search reachable, Timeline has no double scroll, and Header actions do not collide.

- [ ] **Step 6: Mobile smoke at 390×844**

Verify Bottom Nav unchanged, title always visible, Global Search icon reachable, Tasks/Courses/Group create actions fit without horizontal overflow, and Kiro Composer remains above Bottom Nav.

- [ ] **Step 7: Scope check**

```bash
git status --short
git log --oneline -4
```

Confirm there are at most two implementation commits and no unrelated Button/Modal/Card/Chart redesign.

---

## Self-review

- Spec coverage: all seven workspaces, global Search, greeting/date ownership, Tasks Quick Add, Timeline local `+`, Group local form state, Kiro two-level header and responsive behavior are covered.
- No placeholder interfaces remain.
- `AssignmentTable` compact behavior remains explicitly outside the new `AssignmentsWorkspace` wrapper.
- No central Header registry, Store state, or CustomEvent is introduced.
- The test plan modifies only two existing E2E files and runs four additional existing regression files unchanged.