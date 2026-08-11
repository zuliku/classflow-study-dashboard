# Focus Mode + Kiro UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent single-session Focus timer, compact overview controls, Kiro Focus tools, safe Kiro user-message editing, and two small UI polish fixes without expanding V1 into a full analytics or conversation-branching system.

**Architecture:** Focus is an independent persisted domain in `useAppStore`; pure clock/transition logic lives under `lib/focus`, a root-level `FocusRuntime` reconciles real time and notification side effects, and `FocusControl` is a compact MiniCalendar-header controller. Kiro calls the same Focus domain actions through bounded read/write tools. User-message editing is implemented as a safe truncate-and-resend operation guarded against attachments and any mutating-tool suffix.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, Vitest 4, Tailwind CSS, Lucide React.

## Global Constraints

- Each Agent Task message is the sole source of truth for that task. Do not require checkout/cherry-pick/read-plan-commit steps before implementation.
- Inspect large files with targeted search/line slices; do not dump entire large files unless necessary.
- Keep tasks narrowly scoped. Do not perform unrelated refactors.
- Use TDD for domain/tool logic: focused failing test -> minimal implementation -> focused passing test.
- Run only the task's focused Vitest files plus `npm run typecheck`; do not run the full suite/build/E2E unless a focused failure requires it.
- Focus is not Reminder, StudyBlock, Task, Deadline, or CourseSchedule.
- Globally allow at most one active Focus Session (`running` or `paused`).
- Running Focus state persists and recovers from real wall-clock time. Paused time never counts.
- Manual early finish counts actual active elapsed time. Natural completion clamps to planned duration.
- Focus completion uses in-app feedback + short sound + already-authorized browser notification; Focus never requests notification permission.
- No full study analytics card in V1. Actual Focus time is stored/aggregatable independently from scheduled course load.
- No full-screen Focus modal. Use a small anchored popover beside the MiniCalendar header control.
- Kiro explicit present-tense Focus commands execute directly; missing required information is clarified; planning statements do not start timers.
- Focus write tools are not undoable in V1.
- Kiro user-message edit is text-only truncate-and-resend. Any mutating-tool call in the truncated suffix blocks editing.
- Attachment-bearing user messages are not editable in V1.
- No conversation branching/version-tree UI.

---

## File Structure Map

**New Focus files**
- `lib/focus/focusDomain.ts` — FocusSession normalization, clock derivation, transition helpers, aggregate study time.
- `lib/focus/focusRuntime.ts` — small pure runtime decision seam for live vs recovered completion.
- `lib/focus/focusNotifications.ts` — best-effort completion sound and already-authorized browser notification.
- `components/focus/FocusRuntime.tsx` — hydration/reconcile/single-timeout runtime.
- `components/focus/FocusControl.tsx` — MiniCalendar header button + setup/status popover.
- `tests/focusDomain.test.ts` — deterministic domain/store semantics.
- `tests/focusRuntime.test.ts` — runtime decision/dedup semantics.
- `tests/kiroFocusTools.test.ts` — Focus read/write tool contracts.
- `tests/kiroFocusPresentation.test.ts` — Kiro Focus labels/action-card props.
- `lib/ai/history/messageEditing.ts` — pure edit safety/truncation helpers.
- `tests/kiroMessageEditing.test.ts` — suffix-write and attachment guards.

**Existing files changed by bounded tasks**
- `types/index.ts`
- `store/useAppStore.ts`
- `components/settings/BackupSection.tsx`
- `app/page.tsx`
- `components/dashboard/MiniCalendar.tsx`
- `components/dashboard/UpcomingDDL.tsx`
- `components/kiro/KiroComposer.tsx`
- `components/kiro/KiroActionCard.tsx`
- `components/kiro/KiroChatSurface.tsx`
- `components/kiro/KiroConversation.tsx`
- `components/kiro/KiroMessage.tsx`
- `hooks/useKiroChat.ts`
- `lib/ai/config.ts`
- `lib/ai/tools/index.ts`
- `lib/ai/tools/formatters.ts`
- `lib/ai/tools/mutating.ts`
- `lib/ai/tools/read/executor.ts`
- `lib/ai/tools/read/registry.ts`
- `lib/ai/tools/read/schemas.ts`
- `lib/ai/tools/write/executor.ts`
- `lib/ai/tools/write/registry.ts`
- `lib/ai/tools/write/schemas.ts`
- `lib/ai/tools/write/types.ts`
- `tests/pagination.test.ts`
- Kiro `KiroWriteApi` fixture tests that fail typecheck after the interface extension, especially `tests/aiWrite.test.ts`, `tests/kiroTaskV2.test.ts`, and `tests/transaction.test.ts`.

---

### Task 1: UI Polish — Model Menu Scrollbar + Upcoming DDL 3/Page

**Files:**
- Modify: `components/kiro/KiroComposer.tsx`
- Modify: `components/dashboard/UpcomingDDL.tsx`
- Test: `tests/pagination.test.ts`

**Interfaces:**
- Consumes: existing `paginate(items, page, pageSize)`.
- Produces: one scroll owner in the model popup; `UPCOMING_DDL_PAGE_SIZE = 3` and a fixed three-row DDL list.

- [ ] **Step 1: Verify the existing pagination regression expectation**

Confirm `tests/pagination.test.ts` already contains the `UpcomingDDL 场景（pageSize=3）` case. Do not rewrite pagination itself.

- [ ] **Step 2: Run the focused test before UI changes**

Run:
```bash
npx vitest run tests/pagination.test.ts
```
Expected: PASS; this proves the shared pagination primitive already supports page size 3 and the regression is only in `UpcomingDDL` UI configuration.

- [ ] **Step 3: Restore UpcomingDDL to three rows per page**

In `components/dashboard/UpcomingDDL.tsx`, use:
```ts
const UPCOMING_DDL_PAGE_SIZE = 3;
```

Change the fixed row capacity from four rows to three rows, including empty-state span/comments:
```tsx
<div className="flex-1 min-h-0 grid grid-rows-3 gap-1.5">
  {pagedItems.length === 0 ? (
    <div className="row-span-3 flex flex-col items-center justify-center ...">
      ...
    </div>
  ) : (
    ...
  )}
</div>
```

Keep the existing footer and pager; do not add internal scrolling.

- [ ] **Step 4: Make the model popup have exactly one scroll owner and hide its visual scrollbar**

Keep the semantic menu as the only scrollable element:
```tsx
<div
  role="menu"
  aria-label="选择模型"
  className="py-1 max-h-[min(320px,55vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
```

On the surrounding absolute popup container, remove its `max-h-*` and `overflow-y-auto`; keep positioning, width, border, background, shadow, and radius. Wheel/touchpad scrolling must still work through the inner menu.

- [ ] **Step 5: Run focused verification**

Run:
```bash
npx vitest run tests/pagination.test.ts
npm run typecheck
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add components/kiro/KiroComposer.tsx components/dashboard/UpcomingDDL.tsx tests/pagination.test.ts
git commit -m "ui: polish model menu and ddl pagination"
```

---

### Task 2: Focus Domain + Store Persistence + Backup

**Files:**
- Create: `lib/focus/focusDomain.ts`
- Create: `tests/focusDomain.test.ts`
- Modify: `types/index.ts`
- Modify: `store/useAppStore.ts`
- Modify: `components/settings/BackupSection.tsx`
- Modify fixture tests only if `KiroWriteApi` is not involved yet: none expected in this task.

**Interfaces:**
- Produces types: `FocusSession`, `FocusSessionStatus`, `FocusSessionEndReason`, `FocusSessionSource`.
- Produces pure functions: `deriveFocusClock(session, now)`, `normalizeFocusSession(value)`, `sumCompletedFocusMs(sessions)`.
- Produces Store actions: `startFocusSession`, `pauseFocusSession`, `resumeFocusSession`, `finishFocusSession`, `completeFocusSession`.
- Later tasks consume these exact names.

Use these types in `types/index.ts`:
```ts
export type FocusSessionStatus = "running" | "paused" | "completed";
export type FocusSessionEndReason = "timer" | "manual" | "recovered";
export type FocusSessionSource = "manual" | "kiro";

export interface FocusSession {
  id: string;
  plannedMinutes: number;
  startedAt: number;
  activeStartedAt?: number;
  accumulatedActiveMs: number;
  status: FocusSessionStatus;
  endedAt?: number;
  endReason?: FocusSessionEndReason;
  actualActiveMs?: number;
  assignmentId?: string;
  courseId?: string;
  assignmentTitleSnapshot?: string;
  courseNameSnapshot?: string;
  note?: string;
  source: FocusSessionSource;
  createdAt: number;
  updatedAt: number;
}
```

Add `focusSessions?: FocusSession[]` to `ClassFlowBackupData`.

Define Store result contracts in `lib/focus/focusDomain.ts`:
```ts
export type FocusErrorCode =
  | "FOCUS_SESSION_ALREADY_ACTIVE"
  | "NO_ACTIVE_FOCUS_SESSION"
  | "FOCUS_ALREADY_PAUSED"
  | "FOCUS_NOT_PAUSED"
  | "INVALID_FOCUS_DURATION"
  | "FOCUS_TARGET_NOT_FOUND"
  | "FOCUS_TARGET_MISMATCH";

export type FocusMutationResult =
  | { ok: true; session: FocusSession }
  | { ok: false; code: FocusErrorCode };

export interface FocusClock {
  elapsedActiveMs: number;
  remainingMs: number;
  due: boolean;
}
```

- [ ] **Step 1: Write deterministic failing domain tests**

Create `tests/focusDomain.test.ts` covering at minimum:
```ts
it("derives elapsed time from timestamps instead of tick accumulation", () => {
  const s = runningSession({ plannedMinutes: 30, activeStartedAt: 1_000, accumulatedActiveMs: 60_000 });
  expect(deriveFocusClock(s, 121_000)).toEqual({
    elapsedActiveMs: 180_000,
    remainingMs: 1_620_000,
    due: false,
  });
});

it("natural completion clamps to planned duration", () => {
  const s = runningSession({ plannedMinutes: 30, activeStartedAt: 0 });
  const result = completeFocusSessionRecord(s, "timer", 1_900_000);
  expect(result.actualActiveMs).toBe(1_800_000);
});

it("paused time does not increase elapsed time", () => {
  const s = pausedSession({ plannedMinutes: 30, accumulatedActiveMs: 600_000 });
  expect(deriveFocusClock(s, 9_999_999).elapsedActiveMs).toBe(600_000);
});
```

Also cover manual finish, resume from remaining time, invalid normalized records, and `sumCompletedFocusMs` using exact milliseconds rather than per-session rounded minutes.

- [ ] **Step 2: Run the new test and verify failure**

Run:
```bash
npx vitest run tests/focusDomain.test.ts
```
Expected: FAIL because Focus domain/types do not exist.

- [ ] **Step 3: Implement pure Focus domain helpers**

`deriveFocusClock` must follow:
```ts
const plannedMs = session.plannedMinutes * 60_000;
const currentActiveMs =
  session.status === "running" && session.activeStartedAt !== undefined
    ? Math.max(0, now - session.activeStartedAt)
    : 0;
const elapsedActiveMs = Math.max(0, session.accumulatedActiveMs + currentActiveMs);
const remainingMs = Math.max(0, plannedMs - elapsedActiveMs);
return { elapsedActiveMs, remainingMs, due: remainingMs === 0 };
```

Transition helpers must return new objects, never mutate the input. `completeFocusSessionRecord(..., "timer" | "recovered", now)` clamps `actualActiveMs` to planned milliseconds; manual finish stores actual elapsed milliseconds.

- [ ] **Step 4: Add persisted Store state/actions**

Add to `AppState`:
```ts
focusSessions: FocusSession[];
startFocusSession: (input: {
  plannedMinutes: number;
  assignmentId?: string;
  courseId?: string;
  note?: string;
  source?: FocusSessionSource;
}, now?: number) => FocusMutationResult;
pauseFocusSession: (now?: number) => FocusMutationResult;
resumeFocusSession: (now?: number) => FocusMutationResult;
finishFocusSession: (now?: number) => FocusMutationResult;
completeFocusSession: (
  sessionId: string,
  reason: Extract<FocusSessionEndReason, "timer" | "recovered">,
  now?: number
) => FocusMutationResult;
```

Store rules:
- `startFocusSession`: default duration is not injected here; input must already contain a duration; valid range is 1–240 minutes.
- reject a second active session;
- validate `assignmentId` and/or `courseId` against current state;
- if Assignment is selected, save its `courseId` and both snapshot labels;
- if Assignment and Course are both provided, reject mismatch;
- source defaults to `manual`;
- `pause/resume/finish` operate on the single active session;
- `completeFocusSession` is idempotent: if the ID is no longer `running`, return a non-success result and do not count/notify twice.

- [ ] **Step 5: Persist, migrate, clear, reset, restore**

In `store/useAppStore.ts`:
- add `focusSessions?: FocusSession[]` to `PersistedAppState` and `LegacyPersistedStateV0`;
- sanitize with `normalizeFocusSession`, dropping invalid entries;
- initialize `focusSessions: []`;
- clear it in `clearLearningData` and `resetEntireApp`;
- restore old backup with `Array.isArray(data.focusSessions) ? ... : []`;
- include it in `partialize`;
- bump persist version from 5 to 6 and update migration comment.

In `components/settings/BackupSection.tsx`, select `focusSessions` from Store and include it in `backupData()`.

- [ ] **Step 6: Add Store-focused tests to the same file**

Using `useAppStore.setState(...)` in `beforeEach`, verify:
```ts
expect(useAppStore.getState().startFocusSession({ plannedMinutes: 30 }, 1_000).ok).toBe(true);
expect(useAppStore.getState().startFocusSession({ plannedMinutes: 25 }, 2_000)).toMatchObject({
  ok: false,
  code: "FOCUS_SESSION_ALREADY_ACTIVE",
});
```

Also verify pause -> long wall-clock gap -> resume does not count the gap, manual finish counts active milliseconds, and an old restore payload with no `focusSessions` produces `[]`.

- [ ] **Step 7: Run focused verification**

```bash
npx vitest run tests/focusDomain.test.ts tests/backupRestore.test.ts
npm run typecheck
```
Expected: PASS. If `backupRestore.test.ts` contains fixtures requiring the new optional field, keep `focusSessions` optional in backup types so old fixtures remain valid.

- [ ] **Step 8: Commit**

```bash
git add types/index.ts lib/focus/focusDomain.ts store/useAppStore.ts components/settings/BackupSection.tsx tests/focusDomain.test.ts
git commit -m "feat(focus): add persistent focus session domain"
```

---

### Task 3: Focus Runtime + Completion Delivery

**Files:**
- Create: `lib/focus/focusRuntime.ts`
- Create: `lib/focus/focusNotifications.ts`
- Create: `components/focus/FocusRuntime.tsx`
- Create: `tests/focusRuntime.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `deriveFocusClock`, `useAppStore.completeFocusSession` from Task 2.
- Produces: root-level `<FocusRuntime />` and pure `getFocusRuntimeDecision(session, now, phase)`.

Use:
```ts
export type FocusRuntimePhase = "booting" | "running";
export type FocusRuntimeDecision = "none" | "complete-recovered" | "complete-live";

export function getFocusRuntimeDecision(
  session: FocusSession | undefined,
  now: number,
  phase: FocusRuntimePhase
): FocusRuntimeDecision {
  if (!session || session.status !== "running") return "none";
  if (!deriveFocusClock(session, now).due) return "none";
  return phase === "booting" ? "complete-recovered" : "complete-live";
}
```

- [ ] **Step 1: Write failing runtime decision tests**

Create tests for not-due, paused, boot-recovered, and live completion decisions. Also verify duplicate completion through Store: the first `completeFocusSession` succeeds and the second does not.

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/focusRuntime.test.ts
```
Expected: FAIL because runtime files do not exist.

- [ ] **Step 3: Implement best-effort notification helpers**

In `lib/focus/focusNotifications.ts`:
```ts
export function playFocusCompleteSound(): boolean;
export function showFocusBrowserNotification(input: { title: string; body: string }): boolean;
```

Rules:
- never call `Notification.requestPermission()`;
- browser notification only when `typeof Notification !== "undefined" && Notification.permission === "granted"`;
- short sound is best effort and catches WebAudio failures;
- helper failure never throws into Focus completion.

- [ ] **Step 4: Implement one root FocusRuntime**

`components/focus/FocusRuntime.tsx` must:
- wait for `useAppStore.persist` hydration before first reconcile;
- find the single `running` Focus Session;
- on boot overdue: call `completeFocusSession(id, "recovered", now)` and show only in-app toast;
- after boot, schedule one timeout for current `remainingMs`;
- on timeout, `visibilitychange -> visible`, or window focus, reconcile current Store state again;
- on first successful live completion, toast + sound + browser notification if existing `useReminderPreferencesStore.getState().browserNotificationsEnabled` is true;
- paused sessions schedule no timeout;
- clear old timeout whenever active session changes/unmounts.

Use Store result success as the side-effect gate:
```ts
const result = state.completeFocusSession(id, reason, now);
if (!result.ok) return;
// only this caller may now deliver completion effects
```

- [ ] **Step 5: Mount runtime once in `app/page.tsx`**

Import and render near existing `ReminderRuntime` / `ToastViewport`:
```tsx
<FocusRuntime />
<ReminderRuntime />
```
Do not put runtime inside MiniCalendar.

- [ ] **Step 6: Run focused verification**

```bash
npx vitest run tests/focusDomain.test.ts tests/focusRuntime.test.ts tests/browserNotifications.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/focus/focusRuntime.ts lib/focus/focusNotifications.ts components/focus/FocusRuntime.tsx app/page.tsx tests/focusRuntime.test.ts
git commit -m "feat(focus): add real-time runtime and completion delivery"
```

---

### Task 4: Overview Focus Button + Anchored Popover

**Files:**
- Create: `components/focus/FocusControl.tsx`
- Modify: `components/dashboard/MiniCalendar.tsx`

**Interfaces:**
- Consumes: Task 2 Store actions and `deriveFocusClock`.
- Produces: compact MiniCalendar-header Focus UI.

- [ ] **Step 1: Add `FocusControl` as an isolated component**

Idle button:
```text
开始专注
```
Running button:
```text
● 24:36 · 专注中
```
Paused button:
```text
Ⅱ 24:36 · 已暂停
```

Default setup duration is 30 minutes. Presets are exactly `15 / 25 / 30 / 45 / 60`, plus a numeric custom input constrained to `1..240`.

- [ ] **Step 2: Implement setup popover state**

Use a small `position: absolute` panel anchored to the control wrapper, not a modal/portal. Include:
```tsx
<select aria-label="关联对象">
  <option value="none">不关联</option>
  <optgroup label="课程">...</optgroup>
  <optgroup label="任务">...</optgroup>
</select>
<input aria-label="专注说明" ... />
```

Encode selection values as `course:<id>` or `assignment:<id>`. On submit call `startFocusSession({ plannedMinutes, courseId/assignmentId, note, source: "manual" })`. Surface domain errors with the existing Toast store.

- [ ] **Step 3: Implement active status mode**

The component may tick local React `now` once per second for display only:
```ts
const [now, setNow] = useState(Date.now());
useEffect(() => {
  if (!active || active.status !== "running") return;
  const id = window.setInterval(() => setNow(Date.now()), 1000);
  return () => window.clearInterval(id);
}, [active?.id, active?.status]);
```

Never write remaining seconds to Zustand.

Popover actions:
- running: `暂停`, `提前结束`;
- paused: `继续`, `提前结束`.

Display relation snapshot/note if present.

- [ ] **Step 4: Add escape/outside-click close behavior**

The popover closes on Escape and pointer-down outside. Starting/pausing/resuming/finishing does not create a second overlay system.

- [ ] **Step 5: Insert beside `回到今天` in MiniCalendar header**

In the existing right-side header controls:
```tsx
<div className="flex items-center space-x-1">
  <FocusControl />
  <button onClick={handleResetToday}>回到今天</button>
  ...
</div>
```

Do not add any new large card, calendar footer, floating timer, sidebar timer, or browser-title timer.

- [ ] **Step 6: Run focused verification**

```bash
npx vitest run tests/focusDomain.test.ts tests/focusRuntime.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/focus/FocusControl.tsx components/dashboard/MiniCalendar.tsx
git commit -m "feat(focus): add compact overview focus control"
```

---

### Task 5: Kiro Focus Tool Contracts + Executors

**Files:**
- Modify: `lib/ai/tools/read/schemas.ts`
- Modify: `lib/ai/tools/read/registry.ts`
- Modify: `lib/ai/tools/read/executor.ts`
- Modify: `lib/ai/tools/write/schemas.ts`
- Modify: `lib/ai/tools/write/registry.ts`
- Modify: `lib/ai/tools/write/executor.ts`
- Modify: `lib/ai/tools/write/types.ts`
- Modify: `lib/ai/tools/mutating.ts`
- Modify: `hooks/useKiroChat.ts`
- Create: `tests/kiroFocusTools.test.ts`
- Modify KiroWriteApi fixtures only as required by typecheck: `tests/aiWrite.test.ts`, `tests/kiroTaskV2.test.ts`, `tests/transaction.test.ts`, and any other exact fixture found by searching `KiroWriteApi`.

**Interfaces:**
- Produces read tool: `get_focus_status`.
- Produces write tools: `start_focus_session`, `pause_focus_session`, `resume_focus_session`, `finish_focus_session`.
- All write tools call Task 2 Store actions through `KiroWriteApi`; no separate timer state.

- [ ] **Step 1: Write failing tool tests**

Cover:
```ts
expect(executeKiroReadTool("get_focus_status", {}, state)).toMatchObject({
  ok: true,
  data: { active: false },
});
```

Then start a session and verify status includes `status`, `plannedMinutes`, `elapsedActiveMs`, `remainingMs`, snapshots/note when present.

Write-tool cases must cover direct start, already-active rejection, pause/resume state guards, manual finish actual duration, missing target, and Assignment/Course mismatch.

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/kiroFocusTools.test.ts
```
Expected: FAIL because tools are unregistered.

- [ ] **Step 3: Add schemas and registries**

Read schema:
```ts
get_focus_status: z.object({})
```

Start schema:
```ts
z.object({
  plannedMinutes: z.number().int().min(1).max(240),
  assignmentId: z.string().min(1).optional(),
  courseId: z.string().min(1).optional(),
  note: z.string().trim().max(200).optional(),
})
```
Pause/resume/finish use `z.object({})`.

All four Focus write risks are `normal`.

Add all four names to `KIRO_MUTATING_TOOL_NAMES` so regenerate/edit safety treats them as real persistent mutations.

- [ ] **Step 4: Extend `KiroWriteApi` and tool result codes**

Add:
```ts
startFocusSession: AppState["startFocusSession"];
pauseFocusSession: AppState["pauseFocusSession"];
resumeFocusSession: AppState["resumeFocusSession"];
finishFocusSession: AppState["finishFocusSession"];
```

Add `"focus-session"` to action entity types and Focus error codes to the error envelope. Focus actions always return `canUndo: false`.

- [ ] **Step 5: Implement read/write executors**

`get_focus_status` must derive timing with `deriveFocusClock(active, Date.now())`; do not make the model calculate elapsed time.

Write executors pass `source: "kiro"` on start and translate Store `FocusMutationResult` into bounded `WriteToolResult` without directly mutating Zustand.

- [ ] **Step 6: Expose Focus actions in `buildWriteApi`**

In `hooks/useKiroChat.ts`, add wrappers like:
```ts
startFocusSession: (input, now) => useAppStore.getState().startFocusSession(input, now),
pauseFocusSession: (now) => useAppStore.getState().pauseFocusSession(now),
resumeFocusSession: (now) => useAppStore.getState().resumeFocusSession(now),
finishFocusSession: (now) => useAppStore.getState().finishFocusSession(now),
```

Do not add a second Focus runtime inside Kiro.

- [ ] **Step 7: Repair compile-only KiroWriteApi fixtures**

Search:
```bash
rg "KiroWriteApi|implements KiroWriteApi" tests lib components hooks
```
Add minimal wrappers/no-op fixtures only where TypeScript requires them; do not broaden unrelated tests.

- [ ] **Step 8: Run focused verification**

```bash
npx vitest run tests/kiroFocusTools.test.ts tests/aiWrite.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/tools hooks/useKiroChat.ts tests/kiroFocusTools.test.ts tests/aiWrite.test.ts tests/kiroTaskV2.test.ts tests/transaction.test.ts
git commit -m "feat(kiro): add bounded focus tools"
```

---

### Task 6: Kiro Focus Intent Policy + Result Cards

**Files:**
- Modify: `lib/ai/config.ts`
- Modify: `lib/ai/tools/formatters.ts`
- Modify: `components/kiro/KiroActionCard.tsx`
- Create: `tests/kiroFocusPresentation.test.ts`

**Interfaces:**
- Consumes: Task 5 Focus tool names/results.
- Produces: system-prompt behavior and factual action-card formatting.

- [ ] **Step 1: Write failing presentation tests**

Test `toolLabel` / `actionToCardProps` for all four Focus write results. Expected headings:
- start -> `已开始专注`
- pause -> `已暂停专注`
- resume -> `已继续专注`
- finish -> `已结束专注`

Use actual tool-result `after`/`before` data for duration/remaining-time copy; do not fabricate values.

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/kiroFocusPresentation.test.ts
```
Expected: FAIL because Focus presentation is not registered.

- [ ] **Step 3: Add Focus semantics to `KIRO_SYSTEM_PROMPT`**

Add a `# Focus Session 语义` section with these explicit rules:
```text
- FocusSession 表示“现在正在进行/已经完成的一次真实专注计时”，不是 StudyBlock 计划。
- 明确现在执行的命令（开始专注30分钟、现在专注统计学45分钟）可直接调用 start_focus_session，不额外确认。
- 用户只说“开始专注”但没有时长时先询问时长，不静默套默认值。
- “晚上准备专注”“今天应该专注多久”属于计划/讨论，不启动 FocusSession。
- 关联课程/任务前先用读取工具解析真实 ID；多个候选必须询问，不得猜。
- 已有 running/paused Session 时不得覆盖；使用 get_focus_status 告知当前状态。
- 暂停/继续/结束的明确命令直接调用对应工具，不做二次确认。
- 只有 Tool 返回 ok:true 后才能声称状态已改变。
```

- [ ] **Step 4: Add semantic labels and Focus action-card variant**

Add formatter labels:
```ts
get_focus_status: "查看专注状态",
start_focus_session: "开始专注",
pause_focus_session: "暂停专注",
resume_focus_session: "继续专注",
finish_focus_session: "结束专注",
```

Extend `KiroActionCardVariant` with `"focus-session"` and use a compact Clock/Timer icon. Action-card facts come from the tool result only.

- [ ] **Step 5: Run focused verification**

```bash
npx vitest run tests/kiroFocusPresentation.test.ts tests/kiroFocusTools.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/config.ts lib/ai/tools/formatters.ts components/kiro/KiroActionCard.tsx tests/kiroFocusPresentation.test.ts
git commit -m "feat(kiro): teach Kiro focus intent and presentation"
```

---

### Task 7: Safe User-Message Edit Core + Hook Operation

**Files:**
- Create: `lib/ai/history/messageEditing.ts`
- Create: `tests/kiroMessageEditing.test.ts`
- Modify: `hooks/useKiroChat.ts`

**Interfaces:**
- Produces: `UserMessageEditBlockReason`, `getUserMessageEditBlockReason`, `truncateBeforeEditedUserMessage`.
- Extends Kiro chat hook with `editAndResend(messageId, text): Promise<boolean>` and per-view editability metadata.
- Task 8 consumes these fields/callback.

Define:
```ts
export type UserMessageEditBlockReason =
  | "turn-in-flight"
  | "attachments"
  | "write-suffix"
  | "message-not-found";
```

Move/reuse mutating tool-part detection in a library-safe way so `messageHasWriteToolCalls` does not create a `lib -> hook` dependency. `hooks/useKiroChat.ts` may re-export/import the helper if existing tests depend on its name.

- [ ] **Step 1: Write failing pure safety tests**

Cover:
```ts
it("allows a text-only read-only suffix", ...);
it("blocks when any later assistant message contains a mutating tool", ...);
it("blocks the earliest user message when a later turn contains a write", ...);
it("blocks attachment-bearing target messages", ...);
it("truncateBeforeEditedUserMessage removes target and everything after it", ...);
```

Also cover restored historical actions: the helper API should accept a `historicalWriteMessageIds: Set<string>` (or equivalent callback) so a loaded conversation cannot hide an already-executed persisted action merely because raw restored UI parts no longer contain tool calls.

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/kiroMessageEditing.test.ts
```
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement pure helpers**

Required behavior:
```ts
export function truncateBeforeEditedUserMessage<T extends { id: string; role: string }>(
  messages: T[],
  messageId: string
): T[] {
  const index = messages.findIndex((m) => m.id === messageId && m.role === "user");
  return index < 0 ? messages : messages.slice(0, index);
}
```

Safety scans the suffix starting at the target user message through the current end and blocks if any assistant message has a live mutating tool part or belongs to the restored-history write set.

- [ ] **Step 4: Extend `KiroChatMessageView` with editability**

Add:
```ts
canEdit?: boolean;
editDisabledReason?: UserMessageEditBlockReason;
```
Only user views need these fields.

Attachment presence must use the attachment snapshot already bound to that User Turn; do not assume the original `File` is still available.

- [ ] **Step 5: Implement `editAndResend` inside `useKiroChat`**

At submit time re-run all guards. Then:
```ts
const prefix = truncateBeforeEditedUserMessage(chat.messages, messageId);
chat.setMessages(prefix);
// clear per-turn counters/snapshot state exactly as a fresh send path requires
await send(revisedText);
```

Do not preserve the old suffix. Do not attempt to undo prior writes. Do not resend attachments. Empty or unchanged text returns without a model request.

Because Session history lifecycle wraps `chat.send` in `KiroSessionProvider`, expose the edit operation through the same session/runtime chat object without bypassing conversation persistence. If `editAndResend` needs a lifecycle wrapper analogous to `sendWithTurn`, add the smallest wrapper in `KiroSessionProvider`; do not create a second chat instance.

- [ ] **Step 6: Run focused verification**

```bash
npx vitest run tests/kiroMessageEditing.test.ts tests/kiroConversationSeed.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/history/messageEditing.ts hooks/useKiroChat.ts components/kiro/KiroSessionProvider.tsx tests/kiroMessageEditing.test.ts
git commit -m "feat(kiro): add safe user message edit semantics"
```

---

### Task 8: User-Message Inline Edit UI

**Files:**
- Modify: `components/kiro/KiroChatSurface.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/KiroMessage.tsx`

**Interfaces:**
- Consumes: Task 7 `view.canEdit`, `view.editDisabledReason`, and `chat.editAndResend`.
- Produces: Pencil action + inline textarea editing.

- [ ] **Step 1: Thread edit callback through ChatSurface -> Conversation -> UserMessage**

In `KiroChatSurface`:
```tsx
<KiroConversation
  ...
  onEditUserMessage={chat.editAndResend}
/>
```

`KiroConversationRow` passes the target `view.id`, `canEdit`, reason, and callback to `KiroUserMessage`.

- [ ] **Step 2: Add Pencil action beside Copy**

Use `Pencil`/`PencilLine` from Lucide. Keep current responsive action visibility: desktop hover/focus, mobile always reachable.

If editing is blocked, keep the edit control visibly disabled with `title` text:
- `write-suffix`: `该消息之后包含已执行操作，无法直接编辑；请发送新的修改指令。`
- `attachments`: `该消息包含附件，暂不支持直接编辑；请重新发送。`
- `turn-in-flight`: `Kiro 正在处理当前消息，请稍后再编辑。`

- [ ] **Step 3: Implement inline edit state inside `KiroUserMessage`**

When active, replace only the bubble content with an autosizing textarea and controls:
```text
取消    保存并发送
```
Keyboard behavior:
```ts
if (event.key === "Escape") cancel();
if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
```
Plain Enter inserts a newline. Empty trimmed text cannot submit. Unchanged text exits edit mode without calling the model.

- [ ] **Step 4: Preserve low-intrusion layout**

Do not use a Dialog/Modal, do not add conversation branches, and do not change assistant-message actions.

- [ ] **Step 5: Run focused verification**

```bash
npx vitest run tests/kiroMessageEditing.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/kiro/KiroChatSurface.tsx components/kiro/KiroConversation.tsx components/kiro/KiroMessage.tsx
git commit -m "feat(kiro): add inline user message editing"
```

---

## Final Integration Gate

After Tasks 1–8 are individually reviewed and committed, run only this consolidated targeted gate:

```bash
npx vitest run \
  tests/pagination.test.ts \
  tests/focusDomain.test.ts \
  tests/focusRuntime.test.ts \
  tests/kiroFocusTools.test.ts \
  tests/kiroFocusPresentation.test.ts \
  tests/kiroMessageEditing.test.ts \
  tests/browserNotifications.test.ts \
  tests/kiroConversationSeed.test.ts
npm run typecheck
```

Expected: all targeted tests and typecheck PASS.

Do not run `npm run build`, the full Vitest suite, or Playwright by default. Escalate only if a targeted failure reveals a cross-cutting regression.
