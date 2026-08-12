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
// components/ui/Popover.tsx
export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "right-end";

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export function Popover(props: PopoverProps): React.ReactElement;
export function PopoverPanel(props: PopoverPanelProps): React.ReactElement;

// components/ui/DropdownMenu.tsx
export interface DropdownMenuPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export interface DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DropdownMenuPanel(props: DropdownMenuPanelProps): React.ReactElement;
export function DropdownMenuItem(props: DropdownMenuItemProps): React.ReactElement;
export function DropdownMenuDivider(): React.ReactElement;
```

- [ ] **Step 1: Implement controlled `Popover`**

Create `components/ui/Popover.tsx` with this behavior:

```tsx
"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "right-end";

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
```

Do not add internal open state, Context, Portal, focus trap, or collision logic.

- [ ] **Step 2: Implement `PopoverPanel` placement and surface**

In the same file, implement:

```tsx
const PLACEMENT_CLASSES: Record<PopoverPlacement, string> = {
  "bottom-end": "right-0 top-full mt-1.5",
  "bottom-start": "left-0 top-full mt-1.5",
  "top-end": "right-0 bottom-full mb-1.5",
  "right-end": "left-full right-auto bottom-0 ml-2",
};

export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export function PopoverPanel({
  placement = "bottom-end",
  className,
  children,
  ...props
}: PopoverPanelProps) {
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

`PopoverPanel` must not set `role="menu"` by default.

- [ ] **Step 3: Implement command-menu primitives**

Create `components/ui/DropdownMenu.tsx` using `PopoverPanel`:

```tsx
"use client";

import React from "react";
import { PopoverPanel, PopoverPanelProps } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

export interface DropdownMenuPanelProps extends PopoverPanelProps {}

export function DropdownMenuPanel({ className, children, ...props }: DropdownMenuPanelProps) {
  return (
    <PopoverPanel
      role="menu"
      className={cn("min-w-[190px] max-w-[300px] p-1 text-xs", className)}
      {...props}
    >
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

export function DropdownMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-colors",
        danger
          ? "text-danger hover:bg-danger-bg"
          : "text-satin-grey hover:bg-alabaster hover:text-charcoal",
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

- [ ] **Step 4: Convert `KiroMenu.tsx` to a compatibility facade**

Keep `useKiroPopover()` public behavior unchanged, including its existing `{ open, setOpen, toggle, close, ref }` return shape and Esc/outside dismissal.

Replace only the Panel/Item/Divider implementations with thin wrappers:

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
  return (
    <DropdownMenuPanel placement={placement} className={className}>
      {children}
    </DropdownMenuPanel>
  );
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

Do not change Kiro consumer imports in `KiroSessionActions`, `KiroMessage`, `KiroThreadRail`, or other Kiro files.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS. Fix only primitive/facade typing issues before continuing.

- [ ] **Step 6: Commit the primitive layer**

```bash
git add \
  components/ui/Popover.tsx \
  components/ui/DropdownMenu.tsx \
  components/kiro/KiroMenu.tsx

git commit -m "refactor(ui): add menu and popover primitives"
```

---

### Task 2: Migrate Timeline Filter/Create/More and add one focused regression

**Files:**
- Modify: `tests/e2e/timeline-v2-visual.spec.ts`
- Modify: `components/timeline/TimelineWorkspace.tsx`

**Consumes:** `Popover`, `PopoverPanel`, `DropdownMenuPanel`, `DropdownMenuItem`, `DropdownMenuDivider`, and existing `IconButton`.

- [ ] **Step 1: Update the Timeline E2E helper to current shell semantics**

In `tests/e2e/timeline-v2-visual.spec.ts`, change `openTimeline` so it no longer expects the pre-Task-1 week heading:

```ts
async function openTimeline(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();
  await expect(page.getByTestId("timeline-workspace")).toBeVisible();
}
```

- [ ] **Step 2: Add one failing menu behavior case**

Append this focused case to `tests/e2e/timeline-v2-visual.spec.ts`:

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

The intended pre-migration RED signal is the Filter assertion: current Filter is `role="menu"`, not `role="group"`; current More panel also lacks the explicit `aria-label="更多操作"`.

- [ ] **Step 3: Run only the targeted Timeline file to verify RED**

```bash
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
```

Expected: the new Task 2B1 case FAILS on the old Filter/More semantics. Do not run other E2E files.

- [ ] **Step 4: Replace Timeline menu imports**

In `components/timeline/TimelineWorkspace.tsx`, remove:

```ts
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
```

Add:

```ts
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";
```

Do not change unrelated imports or Timeline business helpers.

- [ ] **Step 5: Migrate Filter to a control Popover**

Replace only the Filter trigger/wrapper/panel with:

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
    <PopoverPanel
      placement="bottom-end"
      role="group"
      aria-label="时间表筛选"
      className="w-44 p-1.5 space-y-0.5"
    >
      <p className="px-1.5 pb-1 text-[10px] font-bold text-sandrift">显示</p>
      {/* keep the existing FilterToggle calls exactly */}
    </PopoverPanel>
  ) : null}
</Popover>
```

Copy all existing `FilterToggle` calls unchanged into the panel. Do not replace their checkboxes or state setters.

- [ ] **Step 6: Migrate Quick Create to command-menu primitives**

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
      {/* four existing actions using DropdownMenuItem */}
    </DropdownMenuPanel>
  ) : null}
</Popover>
```

Use four `DropdownMenuItem` entries with the existing icons, labels, and handlers. Preserve each existing `setQuickOpen(false)` call and preserve the dynamic import for `openAssignmentEditor`.

- [ ] **Step 7: Migrate More to command-menu primitives**

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
      <DropdownMenuItem
        icon={FileUp}
        label="导入课表"
        onClick={() => {
          setMoreOpen(false);
          setImportScheduleModalOpen(true);
        }}
      />
      <DropdownMenuItem
        icon={ExternalLink}
        label="全屏查看"
        onClick={() => {
          setMoreOpen(false);
          setFullTimetableModalOpen(true);
        }}
      />
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

Do not modify settings deep-link semantics.

- [ ] **Step 8: Verify the toolbar did not expand in scope**

Check the Timeline toolbar diff. The following must remain untouched:

```text
上一周
下一周
今天
Ask Kiro
FilterToggle implementation
Timeline grid/body
TimelineKeyLane
StudyBlock/DDL drag and resize logic
ArrangeSheet/MarkSheet implementation
```

There must still be exactly one `aria-label="新建"` toolbar trigger.

- [ ] **Step 9: Run the single targeted E2E file**

```bash
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
```

Expected: PASS for all tests in this file, including the Task 2B1 menu case.

If the new case fails because clicking the Workspace Header heading is intercepted by sticky layout, use `page.getByTestId("timeline-workspace").click({ position: { x: 20, y: 100 } })` as the outside-click target; do not weaken the outside-dismiss assertion.

- [ ] **Step 10: Run final typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Conditional build gate**

Do not run `npm run build` by default.

Run it only if implementation produced a Client/Server import boundary error, unresolved module/runtime compile problem, config/dependency change, or Tailwind/Next compile anomaly not covered by typecheck.

If none occurred, final report must state:

```text
build: skipped by Task 2B1 test policy
```

- [ ] **Step 12: Commit the Timeline migration**

```bash
git add \
  components/timeline/TimelineWorkspace.tsx \
  tests/e2e/timeline-v2-visual.spec.ts

git commit -m "refactor(ui): migrate timeline menus to shared primitives"
```

---

## Final Verification Policy

Required and sufficient for normal Task 2B1 completion:

```bash
npm run typecheck
npx playwright test tests/e2e/timeline-v2-visual.spec.ts
```

Do not run `npm test`, full Playwright, `timetable-drag.spec.ts`, Kiro E2E, Settings E2E, Tasks E2E, or screenshot regression unless the focused test exposes a concrete issue in one of those domains.

## Final Report

Report only:

```text
UI Productization Task 2B1 Result

Commits:
- actual commit SHA and message for primitive/facade change
- actual commit SHA and message for Timeline migration

Primitives:
- Popover / PopoverPanel
- DropdownMenuPanel / Item / Divider

Timeline:
- Filter control Popover
- Quick Create command menu
- More command menu
- mutual exclusion / Esc / outside dismiss status

Kiro compatibility:
- KiroMenu facade status
- confirm no bulk Kiro import migration

Verification:
- timeline-v2-visual.spec.ts result
- typecheck result
- build result or skipped by Task 2B1 policy

Scope:
- Dialog/Drawer not started
- Tasks menus not migrated
```

## STOP

After Task 2B1 is complete, STOP. Do not start Task 2B2.