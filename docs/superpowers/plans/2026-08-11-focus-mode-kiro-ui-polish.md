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
- Attachment-bearing user messages are not editable in V1.
- Do not add conversation branching or a version-tree UI.

## Dependency Order

`Task 1` is independent and can land first. The Focus chain is `Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6`. Message editing is `Task 7 -> Task 8`, but Task 7 must run after Task 5 so the Focus write-tool names are already included in the global mutating-tool registry used by edit safety.

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

In `components/kiro/KiroComposer.tsx`, keep the semantic `role="menu"` element as the only vertical scroller and use this exact class suffix:
```tsx
className="py-1 max-h-[min(320px,55vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
```

On the surrounding absolute popup container, remove only its `max-h-[min(320px,60dvh)]` and `overflow-y-auto` classes. Preserve its positioning, width, background, border, radius, and shadow. Mouse wheel, touchpad, keyboard focus, and menu semantics must continue to work.

- [ ] **Step 4: Verify**

Run:
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

**Produces:** `FocusSession` types, deterministic pure timing/transition helpers, persisted Store actions, backup/restore support, and a derived actual-study-time aggregate.

- [ ] **Step 1: Add the Focus types**

In `types/index.ts`, add exactly:
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

Add `focusSessions?: FocusSession[]` to `ClassFlowBackupData` so older backup fixtures remain valid.

- [ ] **Step 2: Write failing deterministic domain tests**

Create `tests/focusDomain.test.ts`. Use small fixture builders defined inside the test file; do not depend on wall-clock time. Cover these exact behaviors:

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

Also test: pause captures the current active segment; resume starts a new segment without counting the pause gap; manual finish stores real active elapsed milliseconds; invalid persisted records normalize to `null`; `sumCompletedFocusMs` sums exact milliseconds from completed history.

- [ ] **Step 3: Run the new tests and confirm the expected failure**

```bash
npx vitest run tests/focusDomain.test.ts
```
Expected: FAIL because the Focus domain does not exist yet.

- [ ] **Step 4: Implement the pure Focus domain**

In `lib/focus/focusDomain.ts`, export these contracts:
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

Export these functions with these responsibilities:
```ts
normalizeFocusSession(value: unknown): FocusSession | null;
deriveFocusClock(session: FocusSession, now: number): FocusClock;
pauseFocusSessionRecord(session: FocusSession, now: number): FocusSession;
resumeFocusSessionRecord(session: FocusSession, now: number): FocusSession;
finishFocusSessionRecord(session: FocusSession, now: number): FocusSession;
completeFocusSessionRecord(
  session: FocusSession,
  reason: "timer" | "recovered",
  now: number
): FocusSession;
sumCompletedFocusMs(sessions: FocusSession[]): number;
```

`deriveFocusClock` uses timestamp derivation:
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

All transition helpers return new objects and never mutate input. Natural/recovered completion clamps `actualActiveMs` to `plannedMinutes * 60_000`. Manual finish stores actual active time without rounding.

- [ ] **Step 5: Add Store state and actions**

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

Store rules:
- valid `plannedMinutes` is an integer from 1 through 240;
- reject a second `running` or `paused` Session;
- validate relation IDs against current Store state;
- selecting an Assignment writes its `assignmentId`, its real `courseId`, `assignmentTitleSnapshot`, and `courseNameSnapshot`;
- providing both Assignment and Course rejects a mismatch;
- selecting only a Course writes `courseId` and `courseNameSnapshot`;
- source defaults to `manual`;
- `pause`, `resume`, and `finish` operate only on the single active Session;
- `completeFocusSession` succeeds only when the requested ID is still `running`; repeated completion attempts return a bounded non-success result and do not mutate data.

- [ ] **Step 6: Persist and back up Focus history**

In `store/useAppStore.ts`:
- add optional `focusSessions` to `PersistedAppState` and `LegacyPersistedStateV0`;
- sanitize persisted entries through `normalizeFocusSession` and drop invalid entries;
- initialize `focusSessions: []`;
- clear Focus history in `clearLearningData` and `resetEntireApp`;
- restore `data.focusSessions` when present, otherwise restore `[]`;
- include `focusSessions` in `partialize`;
- bump Zustand persist version from 5 to 6 and document that v6 adds Focus Sessions.

In `components/settings/BackupSection.tsx`, select `focusSessions` and include it in `backupData()`.

- [ ] **Step 7: Add Store behavior tests**

In `tests/focusDomain.test.ts`, reset Store state in `beforeEach` and cover the one-active invariant, relation validation, pause-gap accounting, manual finish accounting, and old backup restore without `focusSessions`.

The one-active test must include:
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

**Produces:** one hydration-aware root runtime, one completion timeout, and best-effort delivery helpers.

- [ ] **Step 1: Write failing runtime decision tests**

Create `tests/focusRuntime.test.ts` for: no active Session -> `none`; paused Session -> `none`; running and not due -> `none`; booting and overdue -> `complete-recovered`; running phase and overdue -> `complete-live`. Also verify Store idempotency by calling `completeFocusSession` twice and asserting only the first call succeeds.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/focusRuntime.test.ts
```
Expected: FAIL because runtime helpers do not exist.

- [ ] **Step 3: Add the pure runtime decision seam**

In `lib/focus/focusRuntime.ts`, export:
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

- [ ] **Step 4: Implement best-effort completion helpers**

In `lib/focus/focusNotifications.ts`, export:
```ts
playFocusCompleteSound(): boolean;
showFocusBrowserNotification(input: { title: string; body: string }): boolean;
```

Rules:
- never call `Notification.requestPermission()`;
- browser notification requires `Notification.permission === "granted"`;
- sound is a short local WebAudio tone, plays once, and catches all failures;
- helper failures return `false` and never throw into Focus completion.

- [ ] **Step 5: Implement `FocusRuntime`**

`components/focus/FocusRuntime.tsx` must:
- wait for `useAppStore.persist` hydration;
- on first reconcile use phase `booting`;
- find the single `running` Focus Session;
- on boot overdue call `completeFocusSession(id, "recovered", now)` and show only a lightweight in-app Toast;
- once initial reconcile finishes, set phase to `running`;
- schedule one timeout using current derived `remainingMs`;
- on timeout, `visibilitychange` back to visible, and window focus, reread Store and reconcile;
- a paused Session schedules no timeout;
- every Session change clears and reschedules the single timeout;
- live completion first persists through `completeFocusSession(id, "timer", now)`; only an `ok: true` result may trigger Toast, sound, and browser notification;
- browser notification additionally requires `useReminderPreferencesStore.getState().browserNotificationsEnabled === true`;
- manual early finish is handled by UI/Kiro actions and must not trigger completion sound or browser notification here.

- [ ] **Step 6: Mount the runtime once**

In `app/page.tsx`, import `FocusRuntime` and render exactly one `<FocusRuntime />` near the existing `ReminderRuntime` and `ToastViewport`. Do not place it inside `MiniCalendar` or Kiro.

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

- [ ] **Step 1: Implement the three compact header states**

`FocusControl` renders:
- idle: `开始专注`;
- running: `● MM:SS · 专注中`, switching to `H:MM:SS` when remaining duration is at least one hour;
- paused: `Ⅱ MM:SS · 已暂停`, with the same hour formatting rule.

Default setup duration is 30 minutes. Presets are exactly `15`, `25`, `30`, `45`, and `60`. Custom duration is an integer from 1 through 240.

- [ ] **Step 2: Implement the anchored setup popover**

Use a `relative` wrapper and an `absolute` panel positioned from the Focus button; do not use a Dialog, portal, or full-screen overlay.

The relation selector must render exact grouped options from current Store data:
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

Use a text input or textarea with `aria-label="专注说明"`, maximum 200 characters, and no required value. Starting a Session calls `startFocusSession` with `source: "manual"`; map bounded domain errors to concise existing Toast messages.

- [ ] **Step 3: Implement active status mode**

For a running Session, use component-local `now` state refreshed once per second only for display. Do not persist ticks. Running popover actions are `暂停` and `提前结束`. Paused popover actions are `继续` and `提前结束`. Display `assignmentTitleSnapshot` first, otherwise `courseNameSnapshot`, and display `note` when present.

Manual finish shows a lightweight Toast such as `已结束专注 · 本次 12 分钟`; it does not play completion sound or create a system notification.

- [ ] **Step 4: Add popover dismissal behavior**

Escape closes the popover. Pointer-down outside the wrapper closes the popover. State transitions do not create a second overlay stack.

- [ ] **Step 5: Insert the control beside `回到今天`**

In `MiniCalendar`'s existing right-side header control group, import `FocusControl` and insert `<FocusControl />` immediately before the existing `回到今天` button. Do not rewrite the previous/next month buttons.

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
- Modify only KiroWriteApi fixtures reported by typecheck, with likely locations `tests/aiWrite.test.ts`, `tests/kiroTaskV2.test.ts`, and `tests/transaction.test.ts`.

**Produces:** read tool `get_focus_status`; write tools `start_focus_session`, `pause_focus_session`, `resume_focus_session`, `finish_focus_session`.

- [ ] **Step 1: Write failing Focus tool tests**

Create `tests/kiroFocusTools.test.ts` with a real Store-backed or faithful `KiroWriteApi` fixture. Cover:
- `get_focus_status` returns `{ active: false }` when no Session exists;
- after start, status returns `status`, `plannedMinutes`, exact `elapsedActiveMs`, exact `remainingMs`, relation snapshots, and note;
- direct start succeeds;
- second start rejects with `FOCUS_SESSION_ALREADY_ACTIVE`;
- invalid/missing relation IDs reject;
- Assignment/Course mismatch rejects;
- pause and resume enforce state transitions;
- finish records actual active elapsed time and returns `canUndo: false`.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/kiroFocusTools.test.ts
```
Expected: FAIL because the tools are not registered.

- [ ] **Step 3: Add Read Tool schema, registry, and executor**

Add `get_focus_status` with `z.object({})`. Extend `ReadToolState` with optional `focusSessions?: FocusSession[]` so old fixtures compile. The executor finds the single active Session and uses `deriveFocusClock(active, Date.now())`; the model must never calculate timer facts itself.

- [ ] **Step 4: Add Write Tool schemas and registry**

Use this exact start schema:
```ts
z.object({
  plannedMinutes: z.number().int().min(1).max(240),
  assignmentId: z.string().min(1).optional(),
  courseId: z.string().min(1).optional(),
  note: z.string().trim().max(200).optional(),
})
```

Use `z.object({})` for pause, resume, and finish. Register all four as normal risk. Add all four names to `KIRO_MUTATING_TOOL_NAMES` so regenerate and edit safety recognize them as persistent mutations.

- [ ] **Step 5: Extend the bounded Kiro write API and result envelope**

In `lib/ai/tools/write/types.ts`, add:
```ts
startFocusSession: AppState["startFocusSession"];
pauseFocusSession: AppState["pauseFocusSession"];
resumeFocusSession: AppState["resumeFocusSession"];
finishFocusSession: AppState["finishFocusSession"];
```

Add `"focus-session"` to action `entityType`. Add all Task 2 Focus error codes to the failure `code` union. Focus action results always have `canUndo: false`.

- [ ] **Step 6: Implement Write Tool executors**

`start_focus_session` calls `api.startFocusSession` with `source: "kiro"`. Pause/resume/finish call the matching bounded API action. Translate the Store result into `WriteToolResult`; do not call `useAppStore.setState` from the executor. Include real Session facts in `action.after` so Task 6 can render factual result cards.

- [ ] **Step 7: Expose Store Focus actions in `buildWriteApi`**

In `hooks/useKiroChat.ts`, add these exact wrappers:
```ts
startFocusSession: (input, now) => useAppStore.getState().startFocusSession(input, now),
pauseFocusSession: (now) => useAppStore.getState().pauseFocusSession(now),
resumeFocusSession: (now) => useAppStore.getState().resumeFocusSession(now),
finishFocusSession: (now) => useAppStore.getState().finishFocusSession(now),
```

Do not create Focus timer state inside Kiro.

- [ ] **Step 8: Repair compile-only KiroWriteApi fixtures**

Run:
```bash
rg "KiroWriteApi|implements KiroWriteApi" tests lib components hooks
```

Add only the four new Focus method stubs/wrappers where TypeScript requires them. Do not broaden unrelated test behavior.

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

**Consumes:** Task 5 Focus tool names and factual tool results.

**Produces:** explicit Focus intent policy, semantic activity labels, and Focus action cards.

- [ ] **Step 1: Write failing presentation tests**

Create `tests/kiroFocusPresentation.test.ts`. Assert `toolLabel` names and `actionToCardProps` headings for all four actions:
- start -> `已开始专注`;
- pause -> `已暂停专注`;
- resume -> `已继续专注`;
- finish -> `已结束专注`.

Assert duration, remaining-time, relation title, and note are read from `action.after`/`action.before`, not reconstructed from model prose.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/kiroFocusPresentation.test.ts
```
Expected: FAIL because Focus presentation is not registered.

- [ ] **Step 3: Add Focus semantics to `KIRO_SYSTEM_PROMPT`**

Add a `# Focus Session 语义` section containing these rules:
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

- [ ] **Step 4: Add activity labels and action-card variant**

Add formatter labels:
```ts
get_focus_status: "查看专注状态",
start_focus_session: "开始专注",
pause_focus_session: "暂停专注",
resume_focus_session: "继续专注",
finish_focus_session: "结束专注",
```

Extend `KiroActionCardVariant` with `"focus-session"` and use a compact Lucide `Timer` or `Clock3` icon already available in the installed `lucide-react` version. Render only factual fields from the Write Tool action result.

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

**Consumes:** the global `KIRO_MUTATING_TOOL_NAMES`, including the Focus writes from Task 5.

**Produces:** pure suffix safety/truncation helpers, per-user-message editability metadata, and `chat.editAndResend(messageId, text)`.

- [ ] **Step 1: Write failing pure safety tests**

Create `tests/kiroMessageEditing.test.ts` with explicit fixtures for:
1. a text-only user message followed only by read-only assistant turns -> allowed;
2. a target user message whose later assistant suffix contains `tool-update_assignment` -> blocked with `write-suffix`;
3. the earliest user message when a still-later turn contains a write -> blocked with `write-suffix`;
4. a target user message with an attachment snapshot -> blocked with `attachments`;
5. a restored assistant message ID listed in `historicalWriteMessageIds` -> blocked with `write-suffix` even though restored raw parts contain only text;
6. truncation returns all messages strictly before the edited user message and removes the edited message plus every later message.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/kiroMessageEditing.test.ts
```
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement library-safe mutation detection and edit helpers**

In `lib/ai/history/messageEditing.ts`, export:
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

`truncateBeforeEditedUserMessage` must return `messages.slice(0, targetIndex)` for a valid target. `getUserMessageEditBlockReason` scans from the target index through the end and blocks any live mutating tool call or any message ID in `historicalWriteMessageIds`.

Move the existing mutation test out of hook-local implementation by making `hooks/useKiroChat.ts` import `messageHasMutatingToolCalls`; preserve the exported `messageHasWriteToolCalls` name as a thin alias if existing tests/importers require it.

- [ ] **Step 4: Make attachment-free resend explicit**

Refactor the current `send` implementation inside `useKiroChat` into an internal helper that accepts a concrete `turnAttachments: KiroAttachment[]`. Standard Composer send calls it with the current `attachments`; edit resend calls it with `[]`.

Also change the turn-snapshot builder to accept the same concrete attachment list, so an edited text-only message cannot accidentally include attachments currently sitting in the Composer. The Composer attachment state itself must remain untouched by editing.

The external `send(text: string)` signature remains unchanged.

- [ ] **Step 5: Derive editability after attachment/history metadata is attached to views**

Extend `KiroChatMessageView` with:
```ts
canEdit?: boolean;
editDisabledReason?: UserMessageEditBlockReason;
```

When building user views, compute `targetHasAttachments` from the final `view.attachments`. Build `historicalWriteMessageIds` from restored assistant-message IDs whose `restoredActionsRef` entry is non-empty. Do not block a historical message merely because `metadata.restored === "1"`; a restored text-only read-only suffix is editable.

Include `streaming`/turn-in-flight state in editability derivation so all user messages temporarily disable while a turn is submitted or streaming.

- [ ] **Step 6: Implement `editAndResend` in `useKiroChat`**

At submit time:
1. trim and reject empty text;
2. locate the target raw user message and reconstruct its current text;
3. if trimmed text is unchanged, return `true` without a model request;
4. rerun the full safety guard using current raw messages, final target attachment state, current turn-in-flight state, and restored write IDs;
5. on a blocked guard, push an informational Toast and return `false`;
6. compute `prefix = truncateBeforeEditedUserMessage(chat.messages, messageId)`;
7. call `chat.setMessages(prefix)`;
8. clear stale view/source/undo state that belongs only to the removed suffix while preserving the existing conversation identity;
9. call the internal attachment-free send helper with revised text and `[]`.

Editing only occurs inside an existing conversation, so `KiroSessionProvider` does not create a new conversation seed. The existing provider spreads the hook chat object into `sessionChat`; expose `editAndResend` unchanged through that object. History persistence observes the updated messages under the same conversation ID.

- [ ] **Step 7: Verify**

```bash
npx vitest run tests/kiroMessageEditing.test.ts tests/kiroConversationSeed.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

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

**Produces:** a Pencil action and inline textarea editing on Kiro user messages.

- [ ] **Step 1: Thread the edit callback through existing component props**

Add `onEditUserMessage: (messageId: string, text: string) => Promise<boolean>` to `KiroConversation`. In the existing `KiroChatSurface` call, pass `onEditUserMessage={chat.editAndResend}`. In `KiroConversationRow`, pass the current user message ID, `view.canEdit`, `view.editDisabledReason`, and the callback into `KiroUserMessage`.

- [ ] **Step 2: Add the Pencil action beside Copy**

Use Lucide `Pencil` or `PencilLine`. Keep the existing action visibility behavior: mobile always reachable; desktop visible on group hover/focus.

Keep the Edit control visible but disabled when blocked. Use these exact `title` strings:
- `write-suffix`: `该消息之后包含已执行操作，无法直接编辑；请发送新的修改指令。`
- `attachments`: `该消息包含附件，暂不支持直接编辑；请重新发送。`
- `turn-in-flight`: `Kiro 正在处理当前消息，请稍后再编辑。`
- `message-not-found`: `该消息已不可编辑。`

- [ ] **Step 3: Implement inline edit state inside `KiroUserMessage`**

Clicking Edit replaces only the text bubble with an autosizing textarea initialized to the current content. Render two controls below it: `取消` and `保存并发送`.

Keyboard behavior:
```ts
if (event.key === "Escape") cancelEdit();
if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitEdit();
```

Plain Enter inserts a newline. A trimmed empty value cannot submit. Unchanged trimmed text exits edit mode without invoking `onEditUserMessage`. While submit is awaiting the Promise, disable both submit and repeated Edit actions.

- [ ] **Step 4: Preserve the existing low-intrusion layout**

Do not use a Dialog/Modal. Do not add branches or versions. Do not change assistant-message Copy/Regenerate/More behavior.

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

After Tasks 1 through 8 are individually reviewed and committed, run only this consolidated targeted gate:

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