# Assignment Multiple Reminder UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple scheduled reminders to Assignment Drawer with four relative DDL presets plus custom absolute time, including edit/delete and duplicate/past-time guards.

**Architecture:** Keep Reminder Domain/Runtime/Center unchanged. Put task-specific schedule/view logic in a small pure helper and task-specific UI in a dedicated `AssignmentReminderSection` component so the already-large `AssignmentDrawer` only wires the section into the Plan area. Relative edits reuse `updateReminder` followed by `reconcileTargetReminders`; absolute edits patch `triggerAt` directly.

**Tech Stack:** Next.js/React, TypeScript, Zustand, Tailwind utilities, date-fns/React existing stack, existing local-wall-clock reminder domain.

## Global Constraints

- Functional baseline: `8bbf4745df10e0aed22038966a591f10bfbf1097` (Task 7G-A3a).
- Task-message specification is the implementation source of truth; this plan file is optional context and must not block execution if unavailable in an Agent worktree.
- Support multiple scheduled reminders per Assignment.
- Relative presets: `0`, `-10`, `-60`, `-1440` minutes; relative reminders follow Assignment DDL through the existing domain reconciliation.
- Custom task reminder is absolute and does not move when DDL changes.
- No DDL means relative presets are disabled; custom absolute remains available.
- Preset trigger times already in the past are disabled rather than immediately firing.
- Completed assignments cannot create new reminders.
- Drawer manages scheduled reminders only; fired/skipped history remains in Reminder Center.
- Do not implement reminder inheritance for recurring task occurrences.
- No new UI library, no Service Worker/Push, no Kiro tools in this task.
- Testing is intentionally narrow: one pure-helper test file + `npm run typecheck`; no full suite/build/E2E by default.

---

### Task 1: Assignment reminder view/preset helpers

**Files:**
- Create: `lib/reminders/assignmentReminderView.ts`
- Test: `tests/assignmentReminderView.test.ts`

**Interfaces:**
- Consumes: `Assignment`, `Reminder`, `parseLocalDDL`, `resolveReminderTriggerAt`.
- Produces: `ASSIGNMENT_REMINDER_PRESETS`, `getAssignmentScheduledReminders`, `getAssignmentPresetAvailability`, `hasAssignmentReminderDuplicate`, `formatAssignmentReminderLabel`.

- [ ] **Step 1: Write targeted tests** for the exact four preset offsets, no-DDL disabled state, past-preset disabled state, relative duplicate detection, absolute duplicate detection, edit exclusion by id, scheduled-only filtering/sort, and label formatting.

```ts
expect(ASSIGNMENT_REMINDER_PRESETS.map((p) => p.offsetMinutes)).toEqual([0, -10, -60, -1440]);
expect(hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "relative", offsetMinutes: -60 })).toBe(true);
```

- [ ] **Step 2: Run only** `npx vitest run tests/assignmentReminderView.test.ts` and confirm failure before implementation.
- [ ] **Step 3: Implement pure helpers.** Availability must resolve each relative trigger from current `assignment.ddl`; invalid/missing DDL disables every relative preset. `triggerAt <= now` disables that preset. Duplicate checks only compare scheduled reminders for the same Assignment and same schedule mode/value, with optional `excludeId` during edit.
- [ ] **Step 4: Run the same targeted test file** and stop when green.

### Task 2: Dedicated Assignment reminder section

**Files:**
- Create: `components/reminders/AssignmentReminderSection.tsx`

**Interfaces:**
- Consumes: `assignment: Assignment`, `useAppStore.reminders`, `addReminder`, `updateReminder`, `deleteReminder`, `reconcileTargetReminders` and Task 1 helpers.
- Produces: a self-contained scheduled-reminder manager suitable for placement inside Assignment Drawer.

- [ ] **Step 1: Render section header** with weak `Bell` icon, title `提醒`, current scheduled count, and `+ 添加` action. For `assignment.status === "completed"`, hide/disable add and show a restrained `已完成任务无需新增提醒` hint.
- [ ] **Step 2: Render existing scheduled Assignment reminders** sorted by trigger time. Each row shows `formatAssignmentReminderLabel(reminder)` plus compact resolved trigger time and has edit + delete affordances. Do not show fired/skipped history here.
- [ ] **Step 3: Implement the lightweight picker** anchored inside this section, not a modal. Presets are exactly `到期时`, `提前 10 分钟`, `提前 1 小时`, `提前 1 天`, then a separator and `自定义时间…`. Disabled preset rows show why: `需要先设置截止时间`, `该提醒时间已过`, or `已添加`.
- [ ] **Step 4: Create relative reminder** with the current task title and current DDL as the input anchor:

```ts
addReminder({
  title: assignment.title,
  targetType: "assignment",
  targetId: assignment.id,
  timingMode: "relative",
  offsetMinutes,
  triggerAt: assignment.ddl!,
  source: "manual",
});
```

Do not call `toISOString()`.

- [ ] **Step 5: Implement custom absolute editor inside the same popover.** Fields are date + time only; task title is inherited automatically. Reject invalid/past time and exact duplicate absolute schedule with inline copy, not Toast.
- [ ] **Step 6: Implement edit mode.** Relative -> relative or absolute -> relative uses:

```ts
updateReminder(reminderId, {
  title: assignment.title,
  timingMode: "relative",
  offsetMinutes,
  triggerAt: assignment.ddl!,
});
reconcileTargetReminders("assignment", assignment.id);
```

Relative/absolute -> custom absolute uses:

```ts
updateReminder(reminderId, {
  title: assignment.title,
  timingMode: "absolute",
  offsetMinutes: undefined,
  triggerAt,
});
```

Only `status === "scheduled"` is editable. Duplicate checks exclude the reminder being edited.
- [ ] **Step 7: Delete directly** with `deleteReminder(id)`. No confirm, no Undo, no Toast.

### Task 3: Wire into Assignment Drawer without growing it further

**Files:**
- Modify: `components/drawers/AssignmentDrawer.tsx`

**Interfaces:**
- Consumes: `AssignmentReminderSection`.
- Produces: Reminder UI in the task Plan area.

- [ ] **Step 1: Import `AssignmentReminderSection`.** Do not move Reminder logic into the Drawer.
- [ ] **Step 2: Insert `<AssignmentReminderSection assignment={assignment} />`** after the existing deadline/estimated-time/study-plan block and before the Execution/progress section.
- [ ] **Step 3: Preserve all existing Drawer behavior** for status, recurrence metadata, StudyBlocks, materials, Kiro handoff, delete/undo, and edit.

### Task 4: Verification

**Files:**
- Test: `tests/assignmentReminderView.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Run** `npx vitest run tests/assignmentReminderView.test.ts`.
- [ ] **Step 2: Run** `npm run typecheck`.
- [ ] **Step 3: Manual smoke only:** task with DDL creates four preset types; multiple reminders coexist; duplicate preset cannot be added twice; DDL-less task disables relative but allows custom; a relative preset whose resolved time is past is disabled; custom absolute can be created/edited; changing DDL moves relative reminders but not absolute; deleting a reminder removes it from Drawer and Reminder Center; completed task cannot add new reminders.
- [ ] **Step 4: Explicitly skip** `npm test`, `npm run build`, and `npx playwright test` unless a targeted failure makes one necessary.

## Deferred

- Reminder inheritance into the next recurring Assignment occurrence.
- StudyBlock/CalendarMark reminder editing UI.
- Snooze, sound, grouping, notification-per-reminder settings.
- Kiro `list/create/update/delete_reminder` tools (Task 7G-B).
- Service Worker, Push Subscription, cloud scheduler, multi-device delivery.
