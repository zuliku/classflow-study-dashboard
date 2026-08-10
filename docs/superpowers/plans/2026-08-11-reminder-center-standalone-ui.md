# Reminder Center & Standalone UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-workspace Reminder Center opened from the sidebar/mobile More menu, show unread state and reminder history, support standalone reminder CRUD, and connect existing in-app/browser notification clicks to reminder targets.

**Architecture:** Keep `Reminder` business state in `useAppStore` and the A2 runtime/delivery pipeline unchanged. Add a tiny non-persisted UI store for Reminder Center open state, pure view helpers for grouping/formatting, and a floating panel mounted globally in `app/page.tsx`. The panel is an action surface, not a `NavTab` workspace.

**Tech Stack:** Next.js/React, TypeScript, Zustand, Tailwind utilities, lucide-react, existing ClassFlow reminder domain/runtime.

## Global Constraints

- Functional baseline: `aba425bb835491280d779ad6c80d22f08304d3d9` (Task 7G-A2).
- Reuse the existing `Reminder` entity and `useAppStore` actions; do not redesign reminder timing/status semantics.
- Keep `ReminderRuntime`, scheduler, browser permission flow, Toast, backup, recurring task logic, and Kiro tools out of scope unless explicitly required for notification-click navigation.
- Reminder Center is a global action panel, not a new `NavTab`.
- Sidebar unread affordance is a small dot, never a numeric badge.
- Standalone reminder creation uses absolute local wall-clock time only.
- Prefer existing ClassFlow visual tokens and `KiroLogoIcon`; do not add UI libraries.
- Testing is intentionally narrow: one targeted pure-helper test file plus `npm run typecheck`; skip full unit suite, build, and Playwright/E2E.

---

### Task 1: Reminder Center view helpers and UI state

**Files:**
- Create: `store/useReminderCenterStore.ts`
- Create: `lib/reminders/reminderCenterView.ts`
- Test: `tests/reminderCenterView.test.ts`

**Interfaces:**
- Consumes: `Reminder`, `parseLocalDDL`, local wall-clock strings.
- Produces: `useReminderCenterStore`, `hasUnreadFiredReminders(reminders)`, `getReminderCenterGroups(reminders)`, `formatReminderCenterTime(triggerAt, now)`.

- [ ] **Step 1: Write targeted failing tests** covering unread fired detection, scheduled ascending order, fired/skipped descending history order, and today/tomorrow/date labels.
- [ ] **Step 2: Run only** `npx vitest run tests/reminderCenterView.test.ts` and confirm the new helpers are missing/failing.
- [ ] **Step 3: Implement the non-persisted UI store** with `open`, `close`, and `toggle`; do not put this transient state in `useAppStore` persistence.
- [ ] **Step 4: Implement pure view helpers**. `scheduled` goes to upcoming; `fired` and `skipped` go to history; `fired && !readAt` is unread. Invalid dates return a safe short label rather than throwing.
- [ ] **Step 5: Run** `npx vitest run tests/reminderCenterView.test.ts` and stop when green.

### Task 2: Sidebar/mobile entry and bulk-read action

**Files:**
- Modify: `components/layout/navItems.ts`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/layout/BottomNav.tsx`
- Modify: `store/useAppStore.ts` only for one bulk read action.

**Interfaces:**
- Consumes: `useReminderCenterStore`, `hasUnreadFiredReminders`.
- Produces: `markAllFiredRemindersRead(readAt: string)` and global action id `reminders`.

- [ ] **Step 1: Extend `GlobalAction`** to `"reminders" | "settings"`; add `{ id: "reminders", label: "提醒", icon: Bell }` immediately before Settings. Do not add reminders to `NavTab`, `WORKSPACE_NAV_ITEMS`, or `MORE_TAB_IDS`.
- [ ] **Step 2: Update Sidebar action dispatch** so Reminder toggles the center and Settings opens Settings. Render a restrained 1.5px/2px unread dot only for the Reminder action when `status === "fired" && !readAt`; never render a count.
- [ ] **Step 3: Add Reminder to `BOTTOM_NAV_MORE`** and teach `BottomNav.handleSelect` that `reminders` is an action opening the center, not a workspace tab.
- [ ] **Step 4: Add `markAllFiredRemindersRead(readAt)`** as one Zustand `set`, touching only fired reminders that do not already have `readAt`. This exists to clear the unread dot when the user actually opens the center without N sequential persisted writes.
- [ ] **Step 5: Do not add a broad store test** unless typecheck exposes an integration problem; the pure unread selector is already covered in Task 1.

### Task 3: Reminder Center panel and standalone CRUD

**Files:**
- Create: `components/reminders/ReminderCenter.tsx`
- Create: `components/reminders/StandaloneReminderEditor.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useReminderCenterStore`, `useAppStore.reminders`, `addReminder`, `updateReminder`, `deleteReminder`, `markAllFiredRemindersRead`, `formatLocalDateTime`, `combineLocalDateTime`/existing local DDL helpers.
- Produces: a global floating Reminder Center with standalone create/edit and attached-target navigation.

- [ ] **Step 1: Mount `<ReminderCenter />`** with the existing global overlays near `ReminderRuntime`/`ReminderViewport`; do not place it in `KiroSessionProvider` state.
- [ ] **Step 2: Build the panel shell.** Desktop: fixed from the sidebar edge (`left-16 xl:left-56`), approximately `w-[380px]`, full viewport height, surface/border/shadow, no workspace switch and no heavy backdrop. Mobile: full-width sheet above BottomNav/safe area. Header: `提醒`, close button, `+ 新建`.
- [ ] **Step 3: On transition from closed to open**, call `markAllFiredRemindersRead(formatLocalDateTime(new Date()))` once. Do not mark scheduled or skipped reminders read.
- [ ] **Step 4: Render two sections:** `即将提醒` from scheduled reminders sorted ascending, and `已提醒` from fired/skipped sorted newest first. Each row shows title, compact trigger-time label, a weak source/timing label, and delete. Fired unread styling can only exist before the center is opened; skipped rows explicitly say `已跳过`.
- [ ] **Step 5: Attached reminder row navigation:** Assignment closes center and calls `setSelectedAssignmentId(targetId)`; StudyBlock/CalendarMark closes center and switches to `timetable`. Standalone scheduled rows open their editor. Do not invent a StudyBlock/CalendarMark drawer.
- [ ] **Step 6: Implement standalone create/edit inline inside the panel**, not another modal. Fields: title, date, time, optional note. Creation always uses `targetType: "standalone"`, `timingMode: "absolute"`, `source: "manual"`; combine date/time using local wall-clock helpers and reject empty title, invalid time, and past trigger time with inline copy. Editing is allowed only while the standalone reminder is `scheduled`; history is view/delete only.
- [ ] **Step 7: Keep delete direct and simple** for V1; no confirm modal, no Undo architecture, no Toast dependency.

### Task 4: Complete notification click navigation

**Files:**
- Modify: `components/reminders/ReminderViewport.tsx`
- Modify: `components/reminders/ReminderRuntime.tsx`
- Modify: `lib/reminders/browserNotifications.ts`

**Interfaces:**
- Consumes: `useReminderCenterStore` and existing target navigation actions.
- Produces: consistent click navigation for in-app and browser notifications.

- [ ] **Step 1: Fix the known A2 browser-click gap.** Extend `showBrowserReminderNotification` with optional `onClick?: () => void`; `notification.onclick` still calls `window.focus()`, then invokes `onClick`, then closes.
- [ ] **Step 2: In `ReminderRuntime`, pass a click callback** that marks the reminder read and navigates by target: Assignment → `setSelectedAssignmentId`; StudyBlock/CalendarMark → `setActiveTab("timetable")`; standalone → `useReminderCenterStore.getState().open()`.
- [ ] **Step 3: In `ReminderViewport`, replace the standalone no-op** with opening Reminder Center after marking read/dismissing. Keep existing Assignment and timeline behavior.
- [ ] **Step 4: Do not request browser permission or change A2 scheduler/delivery semantics.** This task only completes navigation.

### Task 5: Verification

**Files:**
- Test: `tests/reminderCenterView.test.ts`

**Interfaces:**
- Consumes/Produces: none beyond verification.

- [ ] **Step 1: Run** `npx vitest run tests/reminderCenterView.test.ts`.
- [ ] **Step 2: Run** `npm run typecheck`.
- [ ] **Step 3: Perform a short manual smoke only:** open/close sidebar Reminder Center; unread dot clears on open; create a future standalone reminder; edit it; delete it; click an Assignment reminder row; open mobile More → Reminder; click a standalone in-app notification and confirm center opens.
- [ ] **Step 4: Explicitly skip** `npm test`, `npm run build`, and `npx playwright test` unless a targeted failure makes one necessary.

## Deferred to Task 7G-A3b

Assignment Drawer multiple-reminder UI, relative preset picker (`到期时 / 提前10分钟 / 提前1小时 / 提前1天`), custom absolute assignment reminder, attached reminder edit UI, duplicate preset affordance, and no-DDL disabled relative options.

## Deferred to Task 7G-B / Cloud Phase

Kiro reminder tools, recurring reminder inheritance, snooze, reminder sounds, Service Worker, Push Subscription, cloud scheduler, multi-device delivery, and push receipts.
