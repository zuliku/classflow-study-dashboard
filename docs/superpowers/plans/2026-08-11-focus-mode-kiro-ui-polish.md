# Focus Mode + Kiro UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent single-session Focus timer, compact overview controls, Kiro Focus tools, safe Kiro user-message editing, and two small UI polish fixes without expanding V1 into a full analytics or conversation-branching system.

**Architecture:** Focus is an independent persisted domain in `useAppStore`. Pure clock and transition logic lives under `lib/focus`; a root-level `FocusRuntime` reconciles real time and delivery side effects; `FocusControl` is a compact MiniCalendar-header controller. Kiro calls the same Focus domain actions through bounded read/write tools. User-message editing is a safe truncate-and-resend operation guarded against attachments and every mutating tool in the truncated suffix.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, Vitest 4, Tailwind CSS, Lucide React.

## Global Constraints

- Each Agent Task message is the sole source of truth for that task. Do not require checkout, cherry-pick, or reading a plan commit before implementation.
- Inspect large files with targeted search and line slices; do not dump entire large files unless necessary.
- Keep every task narrowly scoped. Do not perform unrelated refactors.
- Use TDD for domain/tool logic: focused failing test, minimal implementation, focused passing test.
- Run only the task's focused Vitest files plus `npm run typecheck`; do not run the full suite, build, or E2E unless a focused failure requires escalation.
- Focus is not Reminder, StudyBlock, Task, Deadline, or CourseSchedule.
- Globally allow at most one active Focus Session (`running` or `paused`).
- Running Focus state persists and recovers from real wall-clock time. Paused time never counts.
- Manual early finish counts actual active elapsed time. Natural completion clamps to the planned duration.
- Focus completion uses in-app feedback, a short best-effort sound, and an already-authorized browser notification. Focus never requests notification permission.
- Do not add a full study analytics card in V1. Actual Focus time remains a separate aggregate from scheduled course load.
- Do not add a full-screen Focus modal. Use a small anchored popover beside the MiniCalendar header control.
- Kiro explicit present-tense Focus commands execute directly. Missing required information is clarified. Planning statements do not start timers.
- Focus write tools are not undoable in V1.
- Kiro user-message edit is text-only truncate-and-resend. Any mutating-tool call in the truncated suffix blocks editing.
- Attachment-bearing target user messages are not editable in V1.
- Do not add conversation branching or a version-tree UI.

## Dependency Order

`Task 1` is independent and can land first. The Focus chain is `Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6`. Message editing is `Task 7 -> Task 8`, and Task 7 runs after Task 5 so the Focus write-tool names are already present in the mutating-tool registry used by edit safety.

---

### Task 1: UI Polish — Model Menu Scrollbar + Upcoming DDL 3/Page

**Files:**
- Modify: `components/kiro/KiroComposer.tsx`
- Modify: `components/dashboard/UpcomingDDL.tsx`
- Test: `tests/pagination.test.ts`

**Produces:** one model-menu scroll owner with an invisible scrollbar, plus `UPCOMING_DDL_PAGE_SIZE = 3` and a fixed three-row DDL list.

- [ ] **Step 1: Verify the shared paginator already covers page size 3**

Run:
```bash
npx vitest run tests/pagination.test.ts
```
Expected: PASS. The existing test named `UpcomingDDL 场景（pageSize=3）：3/4/7 items 页数正确` proves `paginate` itself needs no change.

- [ ] **Step 2: Restore UpcomingDDL to three rows per page**

In `components/dashboard/UpcomingDDL.tsx`, change the constant to:
```ts
const UPCOMING_DDL_PAGE_SIZE = 3;
```

Change the list container from `grid-rows-4` to `grid-rows-3`. Change the empty-state wrapper from `row-span-4` to this exact markup:
```tsx
<div className="row-span-3 flex flex-col items-center justify-center text-xs text-sandrift space-y-1">
  <CheckCircle2 className="w-6 h-6 text-success" />
  <p>暂无临近 DDL</p>
</div>
```

Update comments that still say four items. Keep the existing footer and pagination controls. Do not add internal scrolling.

- [ ] **Step 3: Make the model popup have exactly one vertical scroll owner**

In `components/kiro/KiroComposer.tsx`, keep the semantic `role="menu"` element as the only vertical scroller and use this exact class string:
```tsx
className="py-1 max-h-[min(320px,55vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
```

On the surrounding absolute popup container, remove only its `max-h-[min(320px,60dvh)]` and `overflow-y-auto` classes. Preserve positioning, width, background, border, radius, and shadow. Mouse wheel, touchpad, keyboard focus, and menu semantics must continue to work.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/pagination.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

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

**Produces:** `FocusSession` types, deterministic timing/transition helpers, persisted Store actions, backup/restore support, and a derived actual-study-time aggregate.

- [ ] **Step 1: Add Focus types**

In `types/index.ts`, add:
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

Add `focusSessions?: FocusSession[]` to `ClassFlowBackupData` so old backup fixtures remain valid.

- [ ] **Step 2: Write failing domain tests**

Create `tests/focusDomain.test.ts` with deterministic fixture builders defined in the test file. Cover these exact cases:
```ts
it("derives elapsed time from timestamps instead of tick accumulation", () => {
  const session = makeRunningSession({
    plannedMinutes: 30,
    activeStartedAt: 1_000,
    accumulatedActiveMs: 60_000,
  });
  expect(deriveFocusClock(session, 121_000)).toEqual({
    elapsedActiveMs: 180_000,
    remainingMs: 1_620_000,
    due: false,
  });
});

it("natural completion clamps late callbacks to the planned duration", () => {
  const session = makeRunningSession({ plannedMinutes: 30, activeStartedAt: 0 });
  const completed = completeFocusSessionRecord(session, "timer", 1_900_000);
  expect(completed.actualActiveMs).toBe(1_800_000);
});

it("paused wall-clock time never increases active elapsed time", () => {
  const session = makePausedSession({ plannedMinutes: 30, accumulatedActiveMs: 600_000 });
  expect(deriveFocusClock(session, 9_999_999).elapsedActiveMs).toBe(600_000);
});
```

Also test: pause captures the current active segment; resume starts a new segment without counting the pause gap; manual finish stores real active milliseconds; invalid persisted records normalize to `null`; `sumCompletedFocusMs` sums exact completed-session milliseconds without per-session rounding.

- [ ] **Step 3: Confirm the expected failing test**

```bash
npx vitest run tests/focusDomain.test.ts
```
Expected: FAIL because the Focus domain does not exist yet.

- [ ] **Step 4: Implement the pure Focus domain**

In `lib/focus/focusDomain.ts`, export:
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

export function normalizeFocusSession(value: unknown): FocusSession | null;
export function deriveFocusClock(session: FocusSession, now: number): FocusClock;
export function pauseFocusSessionRecord(session: FocusSession, now: number): FocusSession;
export function resumeFocusSessionRecord(session: FocusSession, now: number): FocusSession;
export function finishFocusSessionRecord(session: FocusSession, now: number): FocusSession;
export function completeFocusSessionRecord(
  session: FocusSession,
  reason: "timer" | "recovered",
  now: number
): FocusSession;
export function sumCompletedFocusMs(sessions: FocusSession[]): number;
```

`deriveFocusClock` uses:
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

All transition helpers return new objects. Natural/recovered completion clamps `actualActiveMs` to `plannedMinutes * 60_000`; manual finish stores actual active time without rounding.

- [ ] **Step 5: Add Store state/actions**

Add to `AppState`:
```ts
focusSessions: FocusSession[];
startFocusSession: (
  input: {
    plannedMinutes: number;
    assignmentId?: string;
    courseId?: string;
    note?: string;
    source?: FocusSessionSource;
  },
  now?: number
) => FocusMutationResult;
pauseFocusSession: (now?: number) => FocusMutationResult;
resumeFocusSession: (now?: number) => FocusMutationResult;
finishFocusSession: (now?: number) => FocusMutationResult;
completeFocusSession: (
  sessionId: string,
  reason: "timer" | "recovered",
  now?: number
) => FocusMutationResult;
```

Rules:
- valid `plannedMinutes` is an integer from 1 through 240;
- reject a second `running` or `paused` Session;
- validate relation IDs against current Store state;
- selecting an Assignment writes its real `assignmentId`, `courseId`, `assignmentTitleSnapshot`, and `courseNameSnapshot`;
- Assignment plus a nonmatching Course rejects with `FOCUS_TARGET_MISMATCH`;
- selecting only a Course writes `courseId` and `courseNameSnapshot`;
- source defaults to `manual`;
- pause/resume/finish operate on the single active Session;
- `completeFocusSession` succeeds only when the requested ID is still `running`, so repeated completion attempts cannot double-count or double-notify.

- [ ] **Step 6: Persist and back up Focus history**

In `store/useAppStore.ts`:
- add optional `focusSessions` to `PersistedAppState` and `LegacyPersistedStateV0`;
- sanitize through `normalizeFocusSession` and drop invalid entries;
- initialize `focusSessions: []`;
- clear it in `clearLearningData` and `resetEntireApp`;
- restore `data.focusSessions` when present, otherwise `[]`;
- include it in `partialize`;
- bump persist version from 5 to 6 and document v6 as Focus Sessions.

In `components/settings/BackupSection.tsx`, select `focusSessions` and include it in `backupData()`.

- [ ] **Step 7: Add Store behavior tests**

Reset Store state in `beforeEach`. Test one-active, relation validation, pause-gap accounting, manual finish, and old backup restore without `focusSessions`.

The one-active test includes:
```ts
const first = useAppStore.getState().startFocusSession({ plannedMinutes: 30 }, 1_000);
expect(first.ok).toBe(true);
const second = useAppStore.getState().startFocusSession({ plannedMinutes: 25 }, 2_000);
expect(second).toMatchObject({
  ok: false,
  code: "FOCUS_SESSION_ALREADY_ACTIVE",
});
```

- [ ] **Step 8: Verify**

```bash
npx vitest run tests/focusDomain.test.ts tests/backupRestore.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit**

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

**Consumes:** Task 2 `deriveFocusClock` and `completeFocusSession`.

**Produces:** one hydration-aware root runtime, one completion timeout, and best-effort completion delivery.

- [ ] **Step 1: Write failing runtime tests**

Create `tests/focusRuntime.test.ts`. Cover: no active -> `none`; paused -> `none`; running/not due -> `none`; booting/overdue -> `complete-recovered`; running-phase/overdue -> `complete-live`; duplicate Store completion where only the first call succeeds.

- [ ] **Step 2: Confirm failure**

```bash
npx vitest run tests/focusRuntime.test.ts
```
Expected: FAIL because runtime helpers do not exist.

- [ ] **Step 3: Add runtime decision seam**

In `lib/focus/focusRuntime.ts`:
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

- [ ] **Step 4: Implement notification helpers**

In `lib/focus/focusNotifications.ts`, export:
```ts
export function playFocusCompleteSound(): boolean;
export function showFocusBrowserNotification(input: { title: string; body: string }): boolean;
```

Rules: never call `Notification.requestPermission()`; require `Notification.permission === "granted"`; sound is one short local WebAudio tone; all failures return `false` and never throw into completion.

- [ ] **Step 5: Implement `FocusRuntime`**

`components/focus/FocusRuntime.tsx` must:
- wait for `useAppStore.persist` hydration;
- reconcile first with phase `booting`;
- find the single `running` Session;
- boot overdue -> `completeFocusSession(id, "recovered", now)` + in-app Toast only;
- after initial reconcile set phase `running`;
- schedule one timeout from derived `remainingMs`;
- timeout, `visibilitychange` to visible, and window focus all reread Store and reconcile;
- paused -> no timeout;
- Session changes clear/reschedule the one timeout;
- live completion persists first via `completeFocusSession(id, "timer", now)`; only `ok: true` triggers Toast + sound + browser notification;
- browser notification also requires `useReminderPreferencesStore.getState().browserNotificationsEnabled === true`;
- manual finish is not delivered by this runtime.

- [ ] **Step 6: Mount once**

In `app/page.tsx`, import and render exactly one `<FocusRuntime />` near `ReminderRuntime` and `ToastViewport`. Do not mount it inside MiniCalendar or Kiro.

- [ ] **Step 7: Verify**

```bash
npx vitest run tests/focusDomain.test.ts tests/focusRuntime.test.ts tests/browserNotifications.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/focus/focusRuntime.ts lib/focus/focusNotifications.ts components/focus/FocusRuntime.tsx app/page.tsx tests/focusRuntime.test.ts
git commit -m "feat(focus): add real-time runtime and completion delivery"
```

---

### Task 4: Overview Focus Button + Anchored Popover

**Files:**
- Create: `components/focus/FocusControl.tsx`
- Modify: `components/dashboard/MiniCalendar.tsx`

**Consumes:** Task 2 Store actions and `deriveFocusClock`.

**Produces:** a low-intrusion MiniCalendar-header Focus controller.

- [ ] **Step 1: Implement compact states**

Render:
- idle: `开始专注`;
- running: `● MM:SS · 专注中`, using `H:MM:SS` at one hour or more;
- paused: `Ⅱ MM:SS · 已暂停`, with the same hour rule.

Default setup duration is 30 minutes. Presets are 15, 25, 30, 45, 60. Custom duration is integer 1 through 240.

- [ ] **Step 2: Implement anchored setup popover**

Use a `relative` wrapper and an `absolute` panel; no Dialog, portal, or full-screen overlay.

Render the relation selector from current Store data:
```tsx
<select aria-label="关联对象" value={relation} onChange={(event) => setRelation(event.target.value)}>
  <option value="none">不关联</option>
  <optgroup label="课程">
    {courses.map((course) => (
      <option key={course.id} value={`course:${course.id}`}>
        {course.name}
      </option>
    ))}
  </optgroup>
  <optgroup label="任务">
    {assignments
      .filter((assignment) => assignment.status !== "completed")
      .map((assignment) => (
        <option key={assignment.id} value={`assignment:${assignment.id}`}>
          {assignment.title}
        </option>
      ))}
  </optgroup>
</select>
```

Use a `<textarea aria-label="专注说明" maxLength={200} />`. Starting calls `startFocusSession` with `source: "manual"`. Map each bounded Focus error code to one concise existing Toast message; do not expose raw error codes.

- [ ] **Step 3: Implement active popover**

Running Session display uses component-local `now` refreshed once per second only for rendering; no per-second Zustand writes. Running actions: `暂停`, `提前结束`. Paused actions: `继续`, `提前结束`. Display `assignmentTitleSnapshot`, otherwise `courseNameSnapshot`; show note when present.

Manual finish shows `已结束专注 · 本次 N 分钟` using the final `actualActiveMs` rounded only for display. It does not play completion sound or create a system notification.

- [ ] **Step 4: Dismissal**

Escape closes the popover. Pointer-down outside the wrapper closes it. Do not create another overlay stack.

- [ ] **Step 5: Insert beside `回到今天`**

In MiniCalendar's existing right-side header controls, import `FocusControl` and insert `<FocusControl />` immediately before the current `回到今天` button. Do not rewrite previous/next month buttons.

Do not add a calendar footer, permanent Focus statistics, floating timer, sidebar timer, or browser-title timer.

- [ ] **Step 6: Verify**

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
- Modify only KiroWriteApi fixtures reported by typecheck; likely locations are `tests/aiWrite.test.ts`, `tests/kiroTaskV2.test.ts`, and `tests/transaction.test.ts`.

**Produces:** `get_focus_status`, `start_focus_session`, `pause_focus_session`, `resume_focus_session`, `finish_focus_session`.

- [ ] **Step 1: Write failing tool tests**

Create `tests/kiroFocusTools.test.ts` with a `KiroWriteApi` fixture whose four Focus methods delegate to `useAppStore.getState()` and whose unrelated methods follow the existing minimal fixture style. Cover inactive status, running status facts, direct start, second-start rejection, missing relation, relation mismatch, pause/resume guards, manual finish actual time, and `canUndo: false`.

- [ ] **Step 2: Confirm failure**

```bash
npx vitest run tests/kiroFocusTools.test.ts
```
Expected: FAIL because tools are not registered.

- [ ] **Step 3: Add Read Tool**

Add `get_focus_status` with `z.object({})`. Extend `ReadToolState` with optional `focusSessions?: FocusSession[]`. Executor finds the one active Session and uses `deriveFocusClock(active, Date.now())`; the model never calculates timer facts.

- [ ] **Step 4: Add Write Tool schemas/registry**

Start schema:
```ts
z.object({
  plannedMinutes: z.number().int().min(1).max(240),
  assignmentId: z.string().min(1).optional(),
  courseId: z.string().min(1).optional(),
  note: z.string().trim().max(200).optional(),
})
```

Pause/resume/finish use `z.object({})`. All four risks are normal. Add all four write names to `KIRO_MUTATING_TOOL_NAMES`.

- [ ] **Step 5: Extend `KiroWriteApi` and result envelope**

Add:
```ts
startFocusSession: AppState["startFocusSession"];
pauseFocusSession: AppState["pauseFocusSession"];
resumeFocusSession: AppState["resumeFocusSession"];
finishFocusSession: AppState["finishFocusSession"];
```

Add `"focus-session"` to action `entityType`, and add every Task 2 Focus error code to the failure-code union. Focus actions always return `canUndo: false`.

- [ ] **Step 6: Implement Write Tool executors**

`start_focus_session` calls `api.startFocusSession` with `source: "kiro"`. Pause/resume/finish call matching API methods. Translate Store results into bounded `WriteToolResult`; no direct `setState`. Put real Session facts in `action.after` so presentation can be factual.

- [ ] **Step 7: Expose Store Focus methods in `buildWriteApi`**

Add:
```ts
startFocusSession: (input, now) => useAppStore.getState().startFocusSession(input, now),
pauseFocusSession: (now) => useAppStore.getState().pauseFocusSession(now),
resumeFocusSession: (now) => useAppStore.getState().resumeFocusSession(now),
finishFocusSession: (now) => useAppStore.getState().finishFocusSession(now),
```

Do not create Kiro-local timer state.

- [ ] **Step 8: Repair compile-only fixtures**

Run:
```bash
rg "KiroWriteApi|implements KiroWriteApi" tests lib components hooks
```

Add only the four new Focus methods to fixtures TypeScript reports. Do not widen unrelated tests.

- [ ] **Step 9: Verify**

```bash
npx vitest run tests/kiroFocusTools.test.ts tests/aiWrite.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 10: Commit**

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

**Consumes:** Task 5 Focus tool names/results.

**Produces:** explicit Focus intent policy, semantic activity labels, factual Focus action cards.

- [ ] **Step 1: Write failing presentation tests**

Create `tests/kiroFocusPresentation.test.ts`. Assert labels and `actionToCardProps` headings:
- start -> `已开始专注`;
- pause -> `已暂停专注`;
- resume -> `已继续专注`;
- finish -> `已结束专注`.

Assert duration, remaining time, relation title, and note are derived from action facts, not model prose.

- [ ] **Step 2: Confirm failure**

```bash
npx vitest run tests/kiroFocusPresentation.test.ts
```
Expected: FAIL because Focus presentation is absent.

- [ ] **Step 3: Add system-prompt Focus semantics**

Add `# Focus Session 语义` with these rules:
```text
- FocusSession 表示现在正在进行或已经完成的一次真实专注计时，不是 StudyBlock 计划。
- 明确现在执行的命令，例如“开始专注30分钟”“现在专注统计学45分钟”，可直接调用 start_focus_session，不额外确认。
- 用户只说“开始专注”但没有时长时，先询问时长，不静默套默认值。
- “晚上准备专注”“今天应该专注多久”属于计划或讨论，不启动 FocusSession。
- 关联课程或任务前先用读取工具解析真实 ID；多个候选必须询问，不得猜。
- 已有 running 或 paused Session 时不得覆盖；使用 get_focus_status 告知当前状态。
- 暂停、继续、结束的明确命令直接调用对应工具，不做二次确认。
- 只有 Tool 返回 ok:true 后才能声称 Focus 状态已经改变。
```

- [ ] **Step 4: Add labels and action-card variant**

Add:
```ts
get_focus_status: "查看专注状态",
start_focus_session: "开始专注",
pause_focus_session: "暂停专注",
resume_focus_session: "继续专注",
finish_focus_session: "结束专注",
```

Extend `KiroActionCardVariant` with `"focus-session"` and use Lucide `Timer`. Render only fields from the real Write Tool action result.

- [ ] **Step 5: Verify**

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

**Consumes:** `KIRO_MUTATING_TOOL_NAMES`, including Task 5 Focus writes.

**Produces:** suffix safety/truncation helpers, robust message attachment mapping, per-user-message editability metadata, and `chat.editAndResend(messageId, text)`.

- [ ] **Step 1: Write failing safety tests**

Create `tests/kiroMessageEditing.test.ts` with fixtures for:
1. text-only target + read-only suffix -> allowed;
2. later `tool-update_assignment` in suffix -> `write-suffix`;
3. an earlier target with a still-later write -> `write-suffix`;
4. target attachment -> `attachments`;
5. restored assistant ID in `historicalWriteMessageIds` -> `write-suffix` even though restored raw parts are text-only;
6. truncation returns all messages strictly before the target and removes target plus suffix;
7. restored messages alone do not block editing when their suffix has no persisted actions.

- [ ] **Step 2: Confirm failure**

```bash
npx vitest run tests/kiroMessageEditing.test.ts
```
Expected: FAIL because edit helpers do not exist.

- [ ] **Step 3: Implement library-safe mutation/edit helpers**

In `lib/ai/history/messageEditing.ts`:
```ts
export type UserMessageEditBlockReason =
  | "turn-in-flight"
  | "attachments"
  | "write-suffix"
  | "message-not-found";

export function messageHasMutatingToolCalls(
  message: Pick<UIMessage, "parts">
): boolean;

export function getUserMessageEditBlockReason(input: {
  messages: UIMessage[];
  messageId: string;
  turnInFlight: boolean;
  targetHasAttachments: boolean;
  historicalWriteMessageIds: Set<string>;
}): UserMessageEditBlockReason | null;

export function truncateBeforeEditedUserMessage<T extends { id: string; role: string }>(
  messages: T[],
  messageId: string
): T[];
```

`truncateBeforeEditedUserMessage` returns `messages.slice(0, targetIndex)`. The guard scans from target through current end. Move hook-local mutation detection to this helper and keep `messageHasWriteToolCalls` as a thin alias only if existing imports require the old export name.

- [ ] **Step 4: Make turn attachment input explicit**

Refactor `buildTurnSnapshot` to accept `turnAttachments: KiroAttachment[]` and build document context from that argument rather than the hook's ambient Composer attachment array.

Refactor the current send body into an internal `sendWithAttachments(text: string, turnAttachments: KiroAttachment[]): Promise<boolean>`. Public `send(text)` calls `sendWithAttachments(text, attachments)`. Edit resend calls `sendWithAttachments(revisedText, [])`. This ensures editing never consumes or sends attachments currently waiting in the Composer, and the Composer attachment state remains unchanged.

- [ ] **Step 5: Stabilize attachment snapshots for truncation/history**

Change `snapshotQueueRef` semantics so every live user send pushes exactly one entry, including `[]` for text-only turns. When deriving message views, consume `snapshotQueueRef` only for user messages where `isRestoredMessage(m) === false`; restored attachments continue to come only from `restoredAttachmentsRef`.

This gives one positional snapshot per live user message and prevents a new live resend from attaching to the first restored historical user message.

- [ ] **Step 6: Derive per-message editability**

Extend `KiroChatMessageView`:
```ts
canEdit?: boolean;
editDisabledReason?: UserMessageEditBlockReason;
```

After final attachment/history metadata is attached to a user view, compute `targetHasAttachments` from `view.attachments`. Build `historicalWriteMessageIds` from restored assistant IDs whose `restoredActionsRef` entry is non-empty. A message is not blocked merely because `metadata.restored === "1"`. Include current `streaming`/submitted state so all edit actions temporarily disable while a turn is in flight.

- [ ] **Step 7: Implement `editAndResend`**

At submit time:
1. trim and reject empty text;
2. locate the target raw user message and reconstruct current text;
3. unchanged trimmed text -> return `true` without a model request;
4. rerun the full safety guard using current raw messages, final target attachment state, current in-flight state, and restored write IDs;
5. blocked -> informational Toast + return `false`;
6. compute `prefix = truncateBeforeEditedUserMessage(chat.messages, messageId)`;
7. collect `removedIds` from the raw messages after the prefix;
8. `chat.setMessages(prefix)`;
9. trim live attachment snapshots to the number of non-restored user messages in `prefix`;
10. delete `removedIds` from `restoredActionsRef`, `restoredAttachmentsRef`, and `restoredSourcesRef`;
11. clear `viewCacheRef`, `turnSourcesRef`, visible `sources`, and `visionPagesRef`; keep `undoRegistryRef` because the guard guarantees no truncated suffix write while earlier-prefix writes may still be undoable;
12. call `sendWithAttachments(revisedText, [])`.

Editing happens inside an existing conversation, so do not create a new conversation seed. `KiroSessionProvider` already spreads the hook chat object into `sessionChat`; expose `editAndResend` unchanged and retain the current conversation ID for persistence.

- [ ] **Step 8: Verify**

```bash
npx vitest run tests/kiroMessageEditing.test.ts tests/kiroConversationSeed.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/history/messageEditing.ts hooks/useKiroChat.ts tests/kiroMessageEditing.test.ts
git commit -m "feat(kiro): add safe user message edit semantics"
```

---

### Task 8: User-Message Inline Edit UI

**Files:**
- Modify: `components/kiro/KiroChatSurface.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/KiroMessage.tsx`

**Consumes:** Task 7 `canEdit`, `editDisabledReason`, and `chat.editAndResend`.

**Produces:** Pencil action + inline textarea editing.

- [ ] **Step 1: Thread callback through existing props**

Add `onEditUserMessage: (messageId: string, text: string) => Promise<boolean>` to `KiroConversation`. Pass `onEditUserMessage={chat.editAndResend}` from the existing `KiroChatSurface` call. In `KiroConversationRow`, pass message ID, `view.canEdit`, `view.editDisabledReason`, and the callback to `KiroUserMessage`.

- [ ] **Step 2: Add Pencil beside Copy**

Use Lucide `Pencil`. Preserve current responsive action visibility: mobile always reachable; desktop group hover/focus.

Keep Edit visible but disabled when blocked. Exact `title` strings:
- `write-suffix`: `该消息之后包含已执行操作，无法直接编辑；请发送新的修改指令。`
- `attachments`: `该消息包含附件，暂不支持直接编辑；请重新发送。`
- `turn-in-flight`: `Kiro 正在处理当前消息，请稍后再编辑。`
- `message-not-found`: `该消息已不可编辑。`

- [ ] **Step 3: Implement inline edit state**

Edit replaces only the text bubble with an autosizing textarea initialized to current content. Render `取消` and `保存并发送` below it.

Keyboard behavior:
```ts
if (event.key === "Escape") cancelEdit();
if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitEdit();
```

Plain Enter inserts a newline. Trimmed empty text cannot submit. Unchanged trimmed text exits without calling `onEditUserMessage`. While awaiting submit Promise, disable submit and repeated Edit.

- [ ] **Step 4: Preserve layout scope**

No Dialog/Modal. No branch/version UI. Do not change assistant Copy/Regenerate/More behavior.

- [ ] **Step 5: Verify**

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

After Tasks 1 through 8 are individually reviewed and committed:
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

Do not run `npm run build`, the full Vitest suite, or Playwright by default. Escalate only if a targeted failure demonstrates a cross-cutting regression.