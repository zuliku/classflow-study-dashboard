# Kiro Reminder Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Kiro read, create, update, and delete ClassFlow reminders while reusing the existing Reminder domain, runtime, undo, Activity Trace, and Action Card infrastructure.

**Architecture:** Add one read tool (`list_reminders`) and three normal-risk write tools (`create_reminder`, `update_reminder`, `delete_reminder`). Read execution stays pure; writes go through the existing Browser Executor and restricted `KiroWriteApi`. Reminder timing remains owned by the existing Reminder domain: relative reminders resolve against target anchors and absolute reminders remain fixed.

**Tech Stack:** TypeScript, Zod, AI SDK tool registry, Zustand `useAppStore`, existing Kiro read/write executors, Vitest.

## Global Constraints

- Functional baseline: `836559e899c21bd23845e85a0833fac66eb49b5f` (Task 7G-A3b).
- Do not redesign `Reminder`, scheduler, Reminder Center, Assignment Reminder UI, browser notification permissions, backup, or persistence.
- Reminder writes are direct low-risk operations; `delete_reminder` is normal risk because reminder deletion is already a direct UI action and must be undoable.
- Kiro may create a reminder only for explicit current-turn reminder intent; it must never infer reminders merely because a deadline or future event was mentioned.
- Relative reminders require a real non-standalone target and a valid future target-derived trigger; absolute reminders require a future local wall-clock `triggerAt`.
- Reminder operations are not part of `apply_change_set` V1; multiple reminder writes may use individual reminder tools within the existing per-turn write limit.
- Testing is intentionally narrow: one targeted `tests/kiroReminderTools.test.ts` plus `npm run typecheck`; skip full suite, build, and Playwright/E2E.

---

### Task 1: Read tool — list reminders

**Files:**
- Modify: `lib/ai/tools/read/schemas.ts`
- Modify: `lib/ai/tools/read/registry.ts`
- Modify: `lib/ai/tools/read/executor.ts`
- Modify: `lib/ai/tools/formatters.ts`
- Test: `tests/kiroReminderTools.test.ts`

**Interfaces:**
- Consumes: existing `Reminder` objects from `useAppStore`.
- Produces: `list_reminders` with optional query/target/status/time filters and deterministic sorting.

- [ ] **Step 1: Add a failing read-tool test**

```ts
it("list_reminders defaults to scheduled and sorts by triggerAt", () => {
  const result = executeKiroReadTool("list_reminders", {}, stateWithReminders);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect((result.data as { reminders: { id: string }[] }).reminders.map((r) => r.id)).toEqual(["r-soon", "r-later"]);
});
```

- [ ] **Step 2: Run only the new file and confirm failure**

```bash
npx vitest run tests/kiroReminderTools.test.ts
```

- [ ] **Step 3: Add the schema**

```ts
export const listRemindersSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  targetType: z.enum(["assignment", "studyBlock", "calendarMark", "standalone"]).optional(),
  targetId: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["scheduled", "fired", "skipped", "all"]).default("scheduled"),
  from: z.string().regex(LOCAL_DATETIME_RE).optional(),
  to: z.string().regex(LOCAL_DATETIME_RE).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
```

- [ ] **Step 4: Register `list_reminders`** with a description that says the default is upcoming scheduled reminders and that callers should use the returned reminder ID for update/delete.

- [ ] **Step 5: Add `reminders?: Reminder[]` to `ReadToolState`** and implement `listReminders`. Use `(state.reminders ?? [])` to preserve old fixtures. Scheduled results sort ascending by `triggerAt`; fired/skipped/all history-oriented results sort descending. Return only semantic fields: `id`, `title`, `note`, `targetType`, `targetId`, `timingMode`, `offsetMinutes`, `triggerAt`, `status`, `readAt`, `source`.

- [ ] **Step 6: Add the Activity Trace label**

```ts
list_reminders: "查看提醒",
```

- [ ] **Step 7: Run the targeted test file** and stop when the read cases are green.

---

### Task 2: Restricted Reminder write API and exact undo support

**Files:**
- Modify: `store/useAppStore.ts`
- Modify: `lib/ai/tools/write/types.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify compile-only test/fake API implementations discovered by `rg "KiroWriteApi" tests lib hooks`.

**Interfaces:**
- Consumes: existing store actions `addReminder`, `updateReminder`, `deleteReminder`, `reconcileTargetReminders`.
- Produces: `restoreReminder(reminder)`, plus restricted Kiro API methods for reminder mutations.

- [ ] **Step 1: Add exact restore to AppState**

```ts
restoreReminder: (reminder: Reminder) => void;
```

Implementation must preserve the original ID and avoid duplicates:

```ts
restoreReminder: (reminder) =>
  set((state) => ({
    reminders: state.reminders.some((r) => r.id === reminder.id)
      ? state.reminders
      : [...state.reminders, reminder],
  })),
```

- [ ] **Step 2: Extend `KiroWriteApi`**

```ts
addReminder: AppState["addReminder"];
updateReminder: AppState["updateReminder"];
deleteReminder: AppState["deleteReminder"];
restoreReminder: AppState["restoreReminder"];
reconcileTargetReminders: AppState["reconcileTargetReminders"];
```

- [ ] **Step 3: Wire those methods in `buildWriteApi`** using `useAppStore.getState()`; do not expose `setState`.

- [ ] **Step 4: Patch compile-only fake APIs** to provide the five reminder methods. Do not add broad tests solely for fixture plumbing.

---

### Task 3: Reminder write schemas, registry, risk, and executor

**Files:**
- Modify: `lib/ai/tools/write/schemas.ts`
- Modify: `lib/ai/tools/write/registry.ts`
- Modify: `lib/ai/tools/write/types.ts`
- Modify: `lib/ai/tools/write/executor.ts`
- Test: `tests/kiroReminderTools.test.ts`

**Interfaces:**
- Produces: `create_reminder`, `update_reminder`, `delete_reminder`.

- [ ] **Step 1: Add failing write tests** for: standalone absolute create + undo; assignment relative create; reject relative without anchor; reject past trigger; update relative to absolute + undo; delete + exact-ID undo.

- [ ] **Step 2: Add schemas.** `create_reminder` is a discriminated union. Relative requires `targetType` in assignment/studyBlock/calendarMark, `targetId`, and `offsetMinutes` from -43200 through 0. Absolute requires `triggerAt`; `targetType` defaults to standalone and `targetId` is optional for standalone only. `update_reminder` cannot retarget; it accepts only title/note/timing fields. `delete_reminder` accepts `reminderId`.

- [ ] **Step 3: Register all three write tools** with descriptions emphasizing explicit user intent and local wall-clock time.

- [ ] **Step 4: Mark all three as normal risk**

```ts
create_reminder: "normal",
update_reminder: "normal",
delete_reminder: "normal",
```

Also extend `WriteToolResult.action.entityType` with `"reminder"`.

- [ ] **Step 5: Implement a local target resolver in the executor** using existing `getReminderTargetAnchor`, `resolveReminderTriggerAt`, and `parseLocalDDL`. Do not duplicate timezone logic or use `toISOString()`.

- [ ] **Step 6: Implement `create_reminder`.** Validate the target exists, reject completed Assignment relative reminders, resolve the effective trigger, require the result to be in the future, reject exact scheduled duplicates, call `api.addReminder({... source: "kiro" })`, and register undo with `api.deleteReminder(id)`.

- [ ] **Step 7: Implement `update_reminder`.** Only scheduled reminders may be edited. Do not allow target retargeting. Compute the resulting timing mode before mutation; if relative, require a valid target anchor and future resolved trigger. If converting to absolute, clear `offsetMinutes`. Exclude the current ID from duplicate checks. Register undo from a snapshot of the full pre-edit Reminder; if undo restores a relative reminder, call `reconcileTargetReminders` afterward.

- [ ] **Step 8: Implement `delete_reminder`.** Snapshot the full Reminder, call `api.deleteReminder`, register undo with `api.restoreReminder(snapshot)`, and return a normal delete action.

- [ ] **Step 9: Add the executors to the unified executor map**. Do not add reminder actions to `apply_change_set`.

- [ ] **Step 10: Run only**

```bash
npx vitest run tests/kiroReminderTools.test.ts
```

---

### Task 4: Reminder Action Cards and Kiro prompt rules

**Files:**
- Modify: `components/kiro/KiroActionCard.tsx`
- Modify: `lib/ai/tools/formatters.ts`
- Modify: `lib/ai/config.ts`
- Test: `tests/kiroReminderTools.test.ts` only if pure presentation helpers are exported and cheap to test.

**Interfaces:**
- Consumes: reminder `WriteToolResult.action` before/after snapshots.
- Produces: user-facing reminder cards without raw `timingMode`, `offsetMinutes`, or `triggerAt` key names.

- [ ] **Step 1: Add semantic labels**

```ts
create_reminder: "创建提醒",
update_reminder: "修改提醒",
delete_reminder: "删除提醒",
```

- [ ] **Step 2: Add a reminder Action Card branch.** Use the existing card component; adding a `reminder` variant/Bell icon is allowed. Create should say `已创建提醒`, update `已调整提醒`, delete `已删除提醒`. Format relative timing as `到期时 / 提前 N 分钟 / 提前 N 小时 / 提前 N 天`; absolute timing as `M月d日 HH:mm`. Never display raw internal key names.

- [ ] **Step 3: Extend the system prompt** with these rules:

```text
# Reminder 语义
- Reminder 是独立业务实体，不等于 Task / Deadline / StudyBlock。
- 只有用户当前明确要求“提醒我 / 设置提醒 / 修改提醒 / 取消提醒”或明确等价表达时才能写 Reminder；仅仅提到截止时间、考试、计划或未来事件不构成创建提醒授权。
- 查询/定位提醒先使用 list_reminders；多个候选时必须询问，不得猜 reminderId。
- “提前 N 分钟/小时/天提醒这个任务”优先创建 relative Reminder；relative 会随目标时间变化自动跟随。
- 用户指定明确日期时间时使用 absolute Reminder；absolute 不随目标时间变化。
- standalone Reminder 只能 absolute。
- relative Reminder 必须依附 Assignment / StudyBlock / CalendarMark 的真实 targetId；没有合法时间锚点时不要创建。
- Reminder write tools 暂不进入 apply_change_set；多个 Reminder 修改可在每回合现有 Write 上限内逐项调用，超过上限应拆分请求。
- 只有 write tool 返回 ok:true 后才能声称提醒已创建/修改/删除。
```

- [ ] **Step 4: Do not change** Reminder Center, Reminder Runtime, browser notification permission flow, scheduler, Assignment Reminder UI, or Cloud Phase code.

---

### Task 5: Verification

**Files:**
- Test: `tests/kiroReminderTools.test.ts`

- [ ] **Step 1: Keep the targeted file around 9–12 tests**, covering read filtering/sort and the six high-value write/undo/validation paths above.

- [ ] **Step 2: Run**

```bash
npx vitest run tests/kiroReminderTools.test.ts
```

- [ ] **Step 3: Run**

```bash
npm run typecheck
```

- [ ] **Step 4: Stop when green.** Explicitly skip `npm test`, `npm run build`, and `npx playwright test` unless a targeted failure requires escalation.

- [ ] **Step 5: Manual smoke only:** ask Kiro to list upcoming reminders; create a standalone reminder; create `提前1小时` for a task; edit it to an absolute time; delete it; click Undo and confirm the original reminder ID is restored; mention a deadline without asking for a reminder and confirm Kiro does not create one.

## Deferred

Recurring reminder inheritance, bulk reminder Change Set support, StudyBlock/CalendarMark manual picker UI, snooze, sound, Service Worker, Push Subscription, cloud scheduler, multi-device delivery, and delivery receipts remain deferred.