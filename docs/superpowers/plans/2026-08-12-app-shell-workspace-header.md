# App Shell & Workspace Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the greeting-centric global Header and per-page banner headers with one shared low-noise `WorkspaceHeader` primitive while preserving all existing workspace behavior.

**Architecture:** Each workspace owner composes the same `WorkspaceHeader`; there is no central header registry or new Store/event channel. `AssignmentsWorkspace` is the only new feature wrapper because Task Quick Add must remain inline and local-state driven while the page title/create action moves out of `AssignmentTable`.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Tailwind CSS, Lucide, Playwright/Vitest as already configured.

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

---

## File Structure

**Create**
- `components/layout/WorkspaceHeader.tsx` — shared workspace identity/actions shell.
- `components/layout/WorkspaceSearchButton.tsx` — shared Command Center launcher.
- `components/assignment/AssignmentsWorkspace.tsx` — task page shell + controlled Quick Add state.

**Modify**
- `app/page.tsx` — remove unconditional legacy Header; compose Overview/Courses/Analytics/Kiro headers and use `AssignmentsWorkspace`.
- `components/dashboard/AssignmentTable.tsx` — workspace mode stops owning page title/create; accepts controlled Quick Add state; compact mode unchanged.
- `components/timeline/TimelineWorkspace.tsx` — add shared Workspace Header; demote original top row to local controls.
- `components/group/GroupCollaborationView.tsx` — replace Header Banner with shared Workspace Header.
- `tests/e2e/responsive.spec.ts` — shell title/search coverage at 1440/1024/390.
- `tests/e2e/assignment-workspace.spec.ts` — workspace header + inline Quick Add regression.

**Delete after import check**
- `components/layout/Header.tsx` — legacy greeting-centric header.

**Run unchanged regression tests**
- `tests/e2e/command-center.spec.ts`
- `tests/e2e/first-run.spec.ts`
- `tests/e2e/overview-pagination.spec.ts`
- `tests/e2e/timetable-drag.spec.ts`

---

### Task 1: Shared Workspace Header primitives

**Files:**
- Create: `components/layout/WorkspaceSearchButton.tsx`
- Create: `components/layout/WorkspaceHeader.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Produces:

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

- [ ] **Step 1: Add the failing responsive assertions**

In `tests/e2e/responsive.spec.ts`, extend the existing desktop/tablet/mobile cases with only stable shell assertions:

```ts
await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();
```

For the mobile case, also assert the same button remains reachable after switching to Tasks.

- [ ] **Step 2: Run the focused responsive test and confirm RED**

```bash
npx playwright test tests/e2e/responsive.spec.ts
```

Expected: the new `总览` desktop/tablet heading assertion fails because legacy Header still renders greeting text.

- [ ] **Step 3: Implement `WorkspaceSearchButton`**

Use the exact existing Command Center open behavior from `components/layout/Header.tsx`:

```ts
const setSearchModalOpen = useAppStore((s) => s.setSearchModalOpen);
const setSearchModalView = useAppStore((s) => s.setSearchModalView);

const openSearch = () => {
  setSearchModalView("palette");
  setSearchModalOpen(true);
};
```

Render one real button with:

```tsx
aria-label="全局搜索"
```

Responsive content:

```text
<768      icon only
>=768     icon + 搜索
>=1024    icon + 搜索 + ⌘ K
```

Use existing semantic colors; no `shadow-subtle`.

- [ ] **Step 4: Implement `WorkspaceHeader`**

Base semantic structure:

```tsx
<header className={cn(
  "z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-[#F7F5F5] py-2.5",
  sticky && "sticky top-0",
  className
)}>
  <div className="min-w-0">
    <h1 className="truncate text-base md:text-lg font-semibold tracking-tight text-charcoal">
      {title}
    </h1>
    {context && (
      <div className="mt-0.5 truncate text-[11px] md:text-xs text-sandrift">
        {context}
      </div>
    )}
  </div>
  <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
    {actions}
    {primaryAction}
    {!hideSearch && <WorkspaceSearchButton />}
  </div>
</header>
```

Do not add feature variants.

- [ ] **Step 5: Do not wire pages yet; typecheck primitives**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit primitives**

```bash
git add components/layout/WorkspaceHeader.tsx components/layout/WorkspaceSearchButton.tsx tests/e2e/responsive.spec.ts
git commit -m "refactor(ui): add shared workspace header"
```

---

### Task 2: Extract Tasks page shell without breaking Quick Add

**Files:**
- Create: `components/assignment/AssignmentsWorkspace.tsx`
- Modify: `components/dashboard/AssignmentTable.tsx`
- Modify: `app/page.tsx`
- Test: `tests/e2e/assignment-workspace.spec.ts`
- Regression: `tests/e2e/overview-pagination.spec.ts`

**Interfaces:**
- `AssignmentTableProps` becomes:

```ts
export interface AssignmentTableProps {
  mode?: "compact" | "workspace";
  workspaceQuickAddOpen?: boolean;
  onWorkspaceQuickAddOpenChange?: (open: boolean) => void;
}
```

- `AssignmentsWorkspace` owns `quickAddOpen` and renders `AssignmentTable mode="workspace"`.

- [ ] **Step 1: Add failing task workspace assertions**

Extend the existing open-workspace flow in `tests/e2e/assignment-workspace.spec.ts`:

```ts
await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
await expect(page.getByRole("button", { name: "新增任务" })).toBeVisible();
```

Then click the Header create action and assert the existing inline Quick Add appears using its existing stable selector/text; do not assert implementation classes.

- [ ] **Step 2: Run task workspace test and confirm RED**

```bash
npx playwright test tests/e2e/assignment-workspace.spec.ts
```

Expected: the new shell/placement assertion fails before migration.

- [ ] **Step 3: Make workspace Quick Add controlled**

In `AssignmentTable.tsx`:

1. Remove workspace ownership of `quickAddOpen` local state.
2. Read:

```ts
const quickAddOpen = workspaceQuickAddOpen ?? false;
const setQuickAddOpen = (open: boolean) => onWorkspaceQuickAddOpenChange?.(open);
```

3. In **workspace mode only**, remove the title/create/Kiro action row.
4. Keep `QuickAddCard` inside `AssignmentTable`:

```tsx
{isWorkspace && quickAddOpen && (
  <QuickAddCard
    defaultCourseId={courseFilter !== "all" ? courseFilter : undefined}
    onClose={() => setQuickAddOpen(false)}
  />
)}
```

5. Preserve compact mode's existing `任务清单` title, count, overdue indicator, add button, modal behavior and pagination exactly.

- [ ] **Step 4: Create `AssignmentsWorkspace`**

Use local state:

```ts
const [quickAddOpen, setQuickAddOpen] = useState(false);
```

Context:

```ts
const incompleteCount = assignments.filter((a) => a.status !== "completed").length;
```

Header Primary:

```tsx
<button
  type="button"
  aria-expanded={quickAddOpen}
  onClick={() => setQuickAddOpen((v) => !v)}
  className="ux-press flex h-8 items-center gap-1.5 rounded-lg bg-charcoal px-3 text-xs font-bold text-white hover:bg-black"
>
  <Plus className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">{quickAddOpen ? "收起" : "新增任务"}</span>
  <span className="sm:hidden">{quickAddOpen ? "收起" : "新增"}</span>
</button>
```

Move the existing Ask Kiro and highlighted-task breakdown actions from `AssignmentTable` into `WorkspaceHeader.actions`, using the same `highlightedAssignmentId/currentSemesterWeek/useKiroHandoff` behavior. Do not change prompt copy.

Render:

```tsx
<div className="space-y-4" data-testid="assignments-tab">
  <WorkspaceHeader
    title="任务与 DDL"
    context={`${incompleteCount} 项未完成`}
    actions={...}
    primaryAction={...}
    sticky
  />
  <AssignmentTable
    mode="workspace"
    workspaceQuickAddOpen={quickAddOpen}
    onWorkspaceQuickAddOpenChange={setQuickAddOpen}
  />
</div>
```

- [ ] **Step 5: Replace direct workspace table in `app/page.tsx`**

Replace:

```tsx
<AssignmentTable mode="workspace" />
```

with:

```tsx
<AssignmentsWorkspace />
```

Keep compact Overview usage untouched.

- [ ] **Step 6: Run focused task + compact regression**

```bash
npx playwright test tests/e2e/assignment-workspace.spec.ts tests/e2e/overview-pagination.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

### Task 3: Remove legacy global Header and migrate simple workspaces

**Files:**
- Modify: `app/page.tsx`
- Delete after import check: `components/layout/Header.tsx`
- Test: `tests/e2e/responsive.spec.ts`
- Regression: `tests/e2e/command-center.spec.ts`
- Regression: `tests/e2e/first-run.spec.ts`

**Interfaces:**
- Consumes `WorkspaceHeader`.

- [ ] **Step 1: Remove unconditional legacy Header**

Delete from `app/page.tsx`:

```tsx
import { Header } from "@/components/layout/Header";
```

and:

```tsx
<Header />
```

Before deleting `Header.tsx`, run:

```bash
grep -R 'components/layout/Header' app components tests -n
```

If `app/page.tsx` was the only runtime import, delete the file.

- [ ] **Step 2: Add required date/week derivation in `app/page.tsx`**

Reuse existing semester helpers; do not copy Header logic into a second helper. Import `formatWeekDateRange` if not already present and read `currentSemesterWeek` from Store.

Use:

```ts
const currentWeekContext = `第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(
  semester,
  currentSemesterWeek
)}`;
```

- [ ] **Step 3: Migrate Overview**

At the top of Overview content render:

```tsx
<WorkspaceHeader title="总览" context={currentWeekContext} sticky />
```

Do not redesign Getting Started or Overview cards.

- [ ] **Step 4: Migrate Courses**

Delete the old Courses Header Card and render:

```tsx
<WorkspaceHeader
  title="课程资料"
  context={`${courses.length} 门课程 · ${totalCredits} 学分`}
  primaryAction={
    <button type="button" onClick={() => setAddCourseModalOpen(true)} ...>
      <Plus ... />
      <span>添加课程</span>
    </button>
  }
  sticky
/>
```

Do not change Course Card UI.

- [ ] **Step 5: Migrate Analytics**

Delete the Analytics Banner Card and render:

```tsx
<WorkspaceHeader
  title="学习统计"
  context={`本学期 · 第 ${currentSemesterWeek} 周`}
  sticky
/>
```

Do not alter metrics/charts/empty state.

- [ ] **Step 6: Add Kiro Workspace-level header without changing Thread Header**

For `activeTab === "kiro"`, render a flex column wrapper:

```tsx
<div className="flex flex-1 min-h-0 flex-col">
  <WorkspaceHeader title="Kiro" className="px-4 md:px-6" />
  <KiroWorkspace />
</div>
```

Change `PageTransition` class selection so Kiro does **not** inherit `space-y-5` between Workspace Header and `KiroWorkspace`:

```ts
activeTab === "kiro"
  ? "flex flex-col flex-1 min-h-0"
  : "space-y-5"
```

Do not edit `KiroHeader.tsx`.

- [ ] **Step 7: Run simple shell regressions**

```bash
npx playwright test \
  tests/e2e/responsive.spec.ts \
  tests/e2e/command-center.spec.ts \
  tests/e2e/first-run.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

### Task 4: Migrate Timeline and Group local-owner headers

**Files:**
- Modify: `components/timeline/TimelineWorkspace.tsx`
- Modify: `components/group/GroupCollaborationView.tsx`
- Regression: `tests/e2e/timetable-drag.spec.ts`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Both components consume `WorkspaceHeader` directly because their primary/local actions depend on local component state.

- [ ] **Step 1: Migrate Timeline identity to Workspace Header**

At the top of `TimelineWorkspace` fragment render:

```tsx
<WorkspaceHeader
  title="时间表"
  context={`第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(semester, currentSemesterWeek)}`}
  sticky
/>
```

- [ ] **Step 2: Convert Timeline's original Header Controls to a local toolbar**

Remove only the fixed week identity block:

```text
第 N 周 + date range
```

Keep in the local toolbar:

```text
‹  ›  今天                         Filter  +  Ask Kiro  ···
```

The `+` remains exactly one copy and keeps its existing `quickOpen` menu/state.

Do not change Filter menu content, More menu content, StudyBlock interactions, Key Lane, grid or unscheduled shelf.

- [ ] **Step 3: Adjust Timeline height only as required by the new header**

Start with the smallest deterministic change: keep mobile behavior and change the desktop root from:

```text
md:h-[calc(100dvh-92px)]
```

to:

```text
md:h-[calc(100dvh-128px)]
```

Do not introduce a second scroll container. Verify the 08:00–21:00 grid remains visible at 1440×900 and 1024×768; if this exact value causes clipping, adjust only this single shell offset using measured header height—do not redesign Timeline internals.

- [ ] **Step 4: Migrate Group Header Banner**

Replace the existing Group Header Banner with:

```tsx
<WorkspaceHeader
  title="小组协作"
  context={`${groupProjects.length} 个项目`}
  actions={activeProject ? (
    <KiroFlowButton
      icon={KIRO_ICON}
      label="Ask Kiro"
      size="sm"
      className="h-8"
      onClick={() => handoff.openForGroupProject(activeProject.id)}
    />
  ) : undefined}
  primaryAction={
    <button type="button" onClick={openCreateProject} ...>
      <Plus ... />
      <span>新建项目</span>
    </button>
  }
  sticky
/>
```

Delete only the old Banner shell; keep `openCreateProject`, forms, project list and empty-state secondary create action unchanged.

- [ ] **Step 5: Run Timeline drag + responsive regressions**

```bash
npx playwright test tests/e2e/timetable-drag.spec.ts tests/e2e/responsive.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit workspace migrations**

```bash
git add app/page.tsx components/layout components/assignment components/dashboard/AssignmentTable.tsx components/timeline/TimelineWorkspace.tsx components/group/GroupCollaborationView.tsx tests/e2e/responsive.spec.ts tests/e2e/assignment-workspace.spec.ts
git commit -m "refactor(ui): unify workspace headers"
```

---

### Task 5: Final focused verification and visual smoke

**Files:** no new production files unless fixing a regression found here.

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

Do not run the full Playwright suite unless this set reveals a shared-shell regression.

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

- [ ] **Step 4: Desktop visual smoke at 1440×900**

Verify:

```text
Overview    总览 + week context + search
Timeline    时间表 + one local + button only
Tasks       任务与 DDL + inline Quick Add
Courses     no old banner card
Analytics   no old banner card
Group       no old banner card; Ask Kiro + 新建项目 work
Kiro        Kiro workspace title + existing thread title; no vertical overflow regression
```

- [ ] **Step 5: Tablet smoke at 1024×768**

Verify Icon Rail remains unchanged, Header title/search remain reachable, Timeline has no double scroll and primary actions do not collide.

- [ ] **Step 6: Mobile smoke at 390×844**

Verify Bottom Nav unchanged, title always visible, Global Search icon reachable, Tasks/Courses/Group create actions fit without horizontal overflow, Kiro Composer remains above Bottom Nav.

- [ ] **Step 7: Confirm scope discipline**

Run:

```bash
git diff --stat HEAD~2..HEAD
git status --short
```

Confirm no unrelated primitives/cards/charts/modals were redesigned.

---

## Self-review notes

- **Spec coverage:** Covers all seven workspaces, Search, greeting/date ownership, Task Quick Add, Timeline local `+`, Group local form state, Kiro two-level header, responsive behavior and explicit non-goals.
- **No Header state registry:** `AssignmentsWorkspace`, Timeline and Group keep ephemeral actions local; no Store/CustomEvent is added.
- **Compact task safety:** Overview `AssignmentTable mode="compact"` remains outside the new wrapper and retains its existing header/create/pagination behavior.
- **Testing scope:** Two existing E2E files receive small stable assertions; four existing regression files are run unchanged. No new visual test framework or full suite is required.