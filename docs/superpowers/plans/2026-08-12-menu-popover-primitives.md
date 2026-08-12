# Menu & Popover Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish controlled global Popover / DropdownMenu primitives, migrate Timeline Filter/Create/More to them, and keep existing Kiro menu call sites compatible without broad Kiro refactors.

**Architecture:** `Popover` owns only relative anchoring plus Esc/outside-click dismissal while feature code retains open state. `PopoverPanel` provides generic floating surface/placement; `DropdownMenuPanel/Item/Divider` add command-menu semantics. `KiroMenu.tsx` remains a compatibility facade over the new menu components, while Timeline uses the global primitives directly.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Zustand, Tailwind CSS, Lucide, Playwright.

## Global Constraints

- Product direction: Linear structure + Notion Calendar low-noise visual language.
- Do not add dependencies.
- Do not add persisted state, Zustand slices, React Context, or CustomEvent.
- Do not modify `lib/overlayStack.ts`.
- Do not introduce Portal/collision/focus-trap infrastructure in Task 2B1.
- Timeline keeps `filterOpen`, `quickOpen`, and `moreOpen` plus their existing mutual-exclusion handlers.
- Filter is a control Popover with real checkboxes, not a command menu.
- Quick Create and More are command menus.
- `KiroMenu.tsx` remains import-compatible; do not bulk-migrate Kiro consumers.
- Do not modify Tasks menus/context menu, Dialogs, Drawers, GroupModal, ConfirmDialog, SettingsModal, or Timeline scheduling/drag logic.
- Keep tests minimal: `npm run typecheck` + `tests/e2e/timeline-v2-visual.spec.ts`. Build is conditional, not default.
- Task 2B1 ends after this migration; do not start Task 2B2.

---

## File Structure

**Create**
- `components/ui/Popover.tsx` — controlled relative anchor, Esc/outside dismiss, generic floating panel and placement.
- `components/ui/DropdownMenu.tsx` — command-menu panel/item/divider built on PopoverPanel.

**Modify**
- `components/kiro/KiroMenu.tsx` — retain public Kiro API, delegate Panel/Item/Divider to global menu primitives; keep `useKiroPopover` behavior intact.
- `components/timeline/TimelineWorkspace.tsx` — migrate Filter/Create/More surfaces and three trigger buttons only.
- `tests/e2e/timeline-v2-visual.spec.ts` — update Timeline open helper to current Workspace Header and add one focused menu regression case.

**Do not modify**
- `lib/overlayStack.ts`
- `components/ui/ConfirmDialog.tsx`
- `components/group/GroupCollaborationView.tsx`
- `components/drawers/*`
- `components/modals/*`
- `components/dashboard/AssignmentTable.tsx`
- `components/assignment/AssignmentContextMenu.tsx`
- Kiro consumer files solely to change imports

---

### Task 1: Add global Popover/Menu primitives and Kiro compatibility facade

**Files:**
- Create: `components/ui/Popover.tsx`
- Create: `components/ui/DropdownMenu.tsx`
- Modify: `components/kiro/KiroMenu.tsx`

**Interfaces:**

```ts
export type PopoverPlacement = "bottom-end" | "bottom-start" | "top-end" | "right-end";

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export type DropdownMenuPanelProps = PopoverPanelProps;

export interface DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}
```

- [ ] **Step 1: Implement controlled `Popover` and `PopoverPanel`**

Create `components/ui/Popover.tsx`:

```tsx
"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type PopoverPlacement = "bottom-end" | "bottom-start" | "top-end" | "right-end";

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Popover({ open, onOpenChange, className, children, ...props }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const root = ref.current;
      if (root && !root.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className={cn("relative", className)} {...props}>
      {children}
    </div>
  );
}

const PLACEMENT_CLASSES: Record<PopoverPlacement, string> = {
  "bottom-end": "right-0 top-full mt-1.5",
  "bottom-start": "left-0 top-full mt-1.5",
  "top-end": "right-0 bottom-full mb-1.5",
  "right-end": "left-full right-auto bottom-0 ml-2",
};

export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export function PopoverPanel({ placement = "bottom-end", className, children, ...props }: PopoverPanelProps) {
  return (
    <div
      className={cn(
        "absolute z-40 bg-surface border border-line-strong rounded-2xl shadow-card ux-inline",
        "max-h-[min(420px,60vh)] overflow-y-auto",
        PLACEMENT_CLASSES[placement],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
```

`PopoverPanel` must not set `role="menu"`. Do not add internal open state, Context, Portal, focus trap, or collision logic.

- [ ] **Step 2: Implement command-menu primitives**

Create `components/ui/DropdownMenu.tsx`:

```tsx
"use client";

import React from "react";
import { PopoverPanel, PopoverPanelProps } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

export type DropdownMenuPanelProps = PopoverPanelProps;

export function DropdownMenuPanel({ className, children, ...props }: DropdownMenuPanelProps) {
  return (
    <PopoverPanel role="menu" className={cn("min-w-[190px] max-w-[300px] p-1 text-xs", className)} {...props}>
      {children}
    </PopoverPanel>
  );
}

export interface DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DropdownMenuItem({ icon: Icon, label, onClick, danger, disabled, className }: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-colors",
        danger ? "text-danger hover:bg-danger-bg" : "text-satin-grey hover:bg-alabaster hover:text-charcoal",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
        className
      )}
    >
      {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function DropdownMenuDivider() {
  return <div role="separator" className="my-1 h-px bg-line-soft" />;
}
```

Do not add keyboard roving, submenu, checkbox-item, shortcut, or portal APIs.

- [ ] **Step 3: Convert `KiroMenu.tsx` to a compatibility facade**

Keep the current `useKiroPopover()` implementation and its `{ open, setOpen, toggle, close, ref }` return shape unchanged. Replace only Panel/Item/Divider rendering:

```tsx
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";

export function KiroMenuPanel({ placement = "bottom-end", className, children }: {
  placement?: "bottom-end" | "top-end" | "right-end";
  className?: string;
  children: React.ReactNode;
}) {
  return <DropdownMenuPanel placement={placement} className={className}>{children}</DropdownMenuPanel>;
}

export function KiroMenuItem(props: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return <DropdownMenuItem {...props} />;
}

export function KiroMenuDivider() {
  return <DropdownMenuDivider />;
}
```

Do not change imports in Kiro consumer files.

- [ ] **Step 4: Run typecheck and commit Task 1**

```bash
npm run typecheck
git add components/ui/Popover.tsx components/ui/DropdownMenu.tsx components/kiro/KiroMenu.tsx
git commit -m "refactor(ui): add menu and popover primitives"
```

Expected: typecheck PASS before commit.

---

### Task 2: Migrate Timeline Filter/Create/More and add one focused regression

**Files:**
- Modify: `tests/e2e/timeline-v2-visual.spec.ts`
- Modify: `components/timeline/TimelineWorkspace.tsx`

- [ ] **Step 1: Update Timeline test helper and add one failing behavior case**

Replace `openTimeline` with:

```ts
async function openTimeline(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();
  await expect(page.getByTestId("timeline-workspace")).toBeVisible();
}
```

Append:

```ts
base("Task 2B1：Timeline Filter/Create/More 统一浮层并保持 dismiss/互斥", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await openTimeline(page);

  const filterButton = page.getByRole("button", { name: "筛选" });
  const createButton = page.getByRole("button", { name: "新建" });
  const moreButton = page.getByRole("button", { name: "更多操作" });

  await filterButton.click();
  const filterPanel = page.getByRole("group", { name: "时间表筛选" });
  await expect(filterPanel).toBeVisible();
  await expect(filterButton).toHaveAttribute("aria-expanded", "true");

  await createButton.click();
  await expect(filterPanel).toHaveCount(0);
  const createMenu = page.getByRole("menu", { name: "新建" });
  await expect(createMenu).toBeVisible();

  await moreButton.click();
  await expect(createMenu).toHaveCount(0);
  const moreMenu = page.getByRole("menu", { name: "更多操作" });
  await expect(moreMenu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(moreMenu).toHaveCount(0);
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");

  await filterButton.click();
  await expect(filterPanel).toBeVisible();
  await page.getByRole("heading", { name: "时间表" }).click();
  await expect(filterPanel).toHaveCount(0);

  await createButton.click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "学习计划" }).click();
  await expect(page.getByTestId("timeline-arrange-sheet")).toBeVisible();
});
```

Run only:

```bash
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
```

Expected pre-migration: new case FAILS because old Filter is a menu rather than a group and old More lacks an accessible menu name.

- [ ] **Step 2: Replace Timeline imports**

Remove the `KiroMenuPanel/KiroMenuItem/KiroMenuDivider` import and add:

```ts
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";
```

- [ ] **Step 3: Migrate Filter to control Popover**

Use this complete content:

```tsx
<Popover open={filterOpen} onOpenChange={setFilterOpen}>
  <IconButton
    variant="ghost"
    size="sm"
    onClick={() => {
      setFilterOpen((v) => !v);
      setQuickOpen(false);
      setMoreOpen(false);
    }}
    aria-label="筛选"
    aria-expanded={filterOpen}
    title="筛选"
  >
    <SlidersHorizontal className="w-4 h-4" />
  </IconButton>
  {filterOpen ? (
    <PopoverPanel placement="bottom-end" role="group" aria-label="时间表筛选" className="w-44 p-1.5 space-y-0.5">
      <p className="px-1.5 pb-1 text-[10px] font-bold text-sandrift">显示</p>
      <FilterToggle label="课程" checked disabled hint="时间表骨架，恒显示" />
      <FilterToggle label="学习计划" checked={filters.studyBlocks} onChange={(v) => setFilters((f) => ({ ...f, studyBlocks: v }))} />
      <FilterToggle label="DDL" checked={filters.ddl} onChange={(v) => setFilters((f) => ({ ...f, ddl: v }))} />
      <FilterToggle label="考试" checked={filters.exam} onChange={(v) => setFilters((f) => ({ ...f, exam: v }))} />
      <FilterToggle label="活动" checked={filters.activity} onChange={(v) => setFilters((f) => ({ ...f, activity: v }))} />
      <FilterToggle label="小组节点" checked={filters.group} onChange={(v) => setFilters((f) => ({ ...f, group: v }))} />
    </PopoverPanel>
  ) : null}
</Popover>
```

Do not modify `FilterToggle`.

- [ ] **Step 4: Migrate Quick Create**

Use:

```tsx
<Popover open={quickOpen} onOpenChange={setQuickOpen}>
  <IconButton
    variant="primary"
    size="sm"
    onClick={() => {
      setQuickOpen((v) => !v);
      setFilterOpen(false);
      setMoreOpen(false);
    }}
    aria-label="新建"
    aria-expanded={quickOpen}
    title="新建"
  >
    <Plus className="w-4 h-4" />
  </IconButton>
  {quickOpen ? (
    <DropdownMenuPanel placement="bottom-end" aria-label="新建" className="w-52">
      <DropdownMenuItem icon={GraduationCap} label="新建课程" onClick={() => { setQuickOpen(false); setAddCourseModalOpen(true); }} />
      <DropdownMenuItem icon={BookOpenCheck} label="学习计划" onClick={() => { setQuickOpen(false); setFreeBlockOpen(true); }} />
      <DropdownMenuItem
        icon={ListChecks}
        label="新建任务"
        onClick={() => {
          setQuickOpen(false);
          import("@/lib/uiEvents").then(({ openAssignmentEditor }) => openAssignmentEditor({}));
        }}
      />
      <DropdownMenuItem icon={CalendarClock} label="考试 / 日程" onClick={() => { setQuickOpen(false); setMarkOpen(true); }} />
    </DropdownMenuPanel>
  ) : null}
</Popover>
```

Keep the existing CustomEvent-based assignment editor path; do not introduce a Store action.

- [ ] **Step 5: Migrate More**

Use:

```tsx
<Popover open={moreOpen} onOpenChange={setMoreOpen} className="ml-0.5">
  <IconButton
    variant="ghost"
    size="sm"
    onClick={() => {
      setMoreOpen((v) => !v);
      setFilterOpen(false);
      setQuickOpen(false);
    }}
    aria-label="更多操作"
    aria-expanded={moreOpen}
    title="更多"
  >
    <MoreHorizontal className="w-4 h-4" />
  </IconButton>
  {moreOpen ? (
    <DropdownMenuPanel placement="bottom-end" aria-label="更多操作">
      <DropdownMenuItem icon={FileUp} label="导入课表" onClick={() => { setMoreOpen(false); setImportScheduleModalOpen(true); }} />
      <DropdownMenuItem icon={ExternalLink} label="全屏查看" onClick={() => { setMoreOpen(false); setFullTimetableModalOpen(true); }} />
      <DropdownMenuDivider />
      <DropdownMenuItem
        icon={SettingsIcon}
        label="时间表设置"
        onClick={() => {
          setMoreOpen(false);
          useAppStore.getState().setSettingsTargetSection?.("semester");
          useAppStore.getState().setSettingsModalOpen(true);
        }}
      />
    </DropdownMenuPanel>
  ) : null}
</Popover>
```

- [ ] **Step 6: Verify scope and run GREEN**

Confirm the diff did not modify previous/next/today, Ask Kiro, `FilterToggle`, Timeline geometry, drag/resize, `ArrangeSheet`, or `MarkSheet`. Confirm exactly one toolbar trigger has `aria-label="新建"`.

Run:

```bash
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
npm run typecheck
```

Expected: both PASS.

If the heading cannot serve as the outside-click target due to layout interception, replace only that test action with:

```ts
await page.getByTestId("timeline-workspace").click({ position: { x: 20, y: 100 } });
```

Keep the outside-dismiss assertion.

- [ ] **Step 7: Apply conditional build policy and commit Task 2**

Do not run `npm run build` unless a Client/Server boundary, unresolved module/runtime compile issue, config/dependency change, or Next/Tailwind compile anomaly occurred. Otherwise report `build: skipped by Task 2B1 test policy`.

Commit:

```bash
git add components/timeline/TimelineWorkspace.tsx tests/e2e/timeline-v2-visual.spec.ts
git commit -m "refactor(ui): migrate timeline menus to shared primitives"
```

---

## Final Verification Policy

Normal completion requires only:

```bash
npm run typecheck
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
```

Do not run `npm test`, full Playwright, `timetable-drag.spec.ts`, Kiro E2E, Settings E2E, Tasks E2E, or screenshot regression unless the focused Timeline test exposes a concrete cross-domain issue.

## Final Report

Report actual results for:

```text
UI Productization Task 2B1 Result

Commits:
- primitive/facade commit SHA and message
- Timeline migration commit SHA and message

Primitives:
- Popover / PopoverPanel
- DropdownMenuPanel / Item / Divider

Timeline:
- Filter control Popover
- Quick Create command menu
- More command menu
- mutual exclusion / Esc / outside dismiss

Kiro compatibility:
- KiroMenu facade status
- whether any Kiro consumer import changed

Verification:
- timeline-v2-visual.spec.ts
- typecheck
- build PASS or skipped by policy

Scope:
- Dialog/Drawer not started
- Tasks menus not migrated
```

## STOP

After Task 2B1 is complete, STOP. Do not start Task 2B2.