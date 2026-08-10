# Task 7G-C — Reminder Reliability & Referential Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reminder delivery reliable under current-session retiming and make Assignment/Course deletion referentially complete without adding new Reminder UX.

**Architecture:** Add a small pure dependency-closure module that is shared by Store mutations and Kiro transaction projection. Assignment deletion returns/restores one complete snapshot; Course deletion computes one deterministic cascade but remains non-undoable. Reminder Runtime gains an explicit boot/initial/running phase and reconciles newly overdue reminders after every in-session Reminder state change. Data-integrity validation learns StudyBlock and Reminder target references.

**Tech Stack:** TypeScript, React, Zustand, Vitest, existing ClassFlow Reminder Domain, existing Kiro write pipeline.

## Global Constraints

- Functional baseline: current `main` must contain Task 7G-B commit `40ffcc5f1e4970c2756132911d255a896a1d53d6` or equivalent code.
- Design source: `docs/superpowers/specs/2026-08-11-reminder-reliability-integrity-design.md`.
- The task message/specification is the implementation source of truth; do not stop if a documentation commit is missing locally.
- Current-session retiming that produces `scheduled && triggerAt <= now` must deliver immediately and must not use `missedReminderPolicy`.
- Initial hydration reconciliation still uses the existing missed-reminder policy.
- Assignment delete = complete deterministic cascade + complete Undo with original IDs/timestamps/history.
- Course delete = complete deterministic cascade after existing confirmation; no Undo.
- Keep Notification/browser side effects out of Zustand actions.
- Do not add Service Worker, Web Push, cloud scheduler, recurrence Reminder inheritance, snooze, new Reminder UI, Kiro feature expansion, or a generic dependency graph engine.
- Preserve existing strict CalendarMark matching; never infer ownership from title/date beyond the existing legacy matcher.
- Referential-closure clarification: if a linked DDL CalendarMark itself is deleted, any Reminder whose `targetType === "calendarMark"` and `targetId` equals that deleted mark ID must also be deleted/restored. Otherwise Task 7G-C would create the orphan Reminder state it is explicitly designed to eliminate.
- Development-speed rule: use `rg` and narrow file reads. Do not repeatedly dump `useAppStore.ts`, `useKiroChat.ts`, or large components in full.
- Verification by default is targeted Vitest files + `npm run typecheck`; do not run `npm test`, `npm run build`, or Playwright unless a targeted failure proves it necessary.

---

## File Structure

**Create**

- `lib/dataDependencies.ts` — pure Assignment/Course dependency collection, removal projection, and idempotent Assignment restoration.
- `lib/reminders/reminderRuntimePolicy.ts` — pure runtime-phase gate for current-session due reminders.
- `tests/dataDependencies.test.ts` — dependency closure tests.
- `tests/referentialIntegrityStore.test.ts` — Store Assignment/Course cascade and Undo regression tests.

**Modify**

- `store/useAppStore.ts` — atomic Assignment/Course cascade; snapshot-based restore contract.
- `lib/assignmentActions.ts` — use the shared Assignment snapshot and correct Undo copy.
- `components/drawers/AssignmentDrawer.tsx` — pass the complete snapshot to restore.
- `lib/ai/tools/write/types.ts` — Kiro API follows the snapshot restore signature.
- `lib/ai/tools/write/prepare.ts` — `delete_assignment` transaction projection uses the same cascade semantics; Undo restores the snapshot.
- `hooks/useKiroChat.ts` — only if TypeScript requires adapting the `buildWriteApi` restore signature; no runtime architecture changes.
- `components/reminders/ReminderRuntime.tsx` — phase-aware running-session due reconciliation.
- `lib/dataIntegrity.ts` — detect orphan StudyBlocks and Reminder targets and classify severity.
- `tests/reminderRuntime.test.ts` — runtime policy regression coverage.
- `tests/dataIntegrity.test.ts` — new integrity cases.
- Existing Kiro/assignment test fixtures that explicitly implement `KiroWriteApi` — signature-only adjustments if typecheck requires them.

---

### Task 1: Pure Dependency Closure

**Files:**
- Create: `lib/dataDependencies.ts`
- Create: `tests/dataDependencies.test.ts`

**Interfaces:**
- Consumes: `Assignment`, `CalendarMark`, `Course`, `CourseSchedule`, `GroupProject`, `Reminder`, `StudyBlock`; existing `isDDLMarkForAssignment` from `lib/calendarMark.ts`.
- Produces:

```ts
export interface DependencyCollections {
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
}

export interface AssignmentDeleteSnapshot {
  assignment: Assignment;
  calendarMarks: CalendarMark[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
}

export interface CourseDeleteCascade {
  course: Course;
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
}

export function collectAssignmentDeleteSnapshot(
  state: Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders">,
  assignmentId: string
): AssignmentDeleteSnapshot | null;

export function removeAssignmentDeleteSnapshot(
  state: Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders">,
  snapshot: AssignmentDeleteSnapshot
): Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders">;

export function restoreAssignmentDeleteSnapshot(
  state: Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders">,
  snapshot: AssignmentDeleteSnapshot
): Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders">;

export function collectCourseDeleteCascade(
  state: DependencyCollections,
  courseId: string
): CourseDeleteCascade | null;

export function removeCourseDeleteCascade(
  state: DependencyCollections,
  cascade: CourseDeleteCascade
): DependencyCollections;
```

- [ ] **Step 1: Write failing dependency tests**

Create `tests/dataDependencies.test.ts` with fixtures that include two courses, one Assignment with a strict linked DDL mark, two StudyBlocks, direct Assignment Reminder, StudyBlock Reminder, DDL-CalendarMark Reminder, standalone Reminder, and unrelated course data.

Core assertions:

```ts
it("Assignment snapshot closes Assignment -> DDL mark -> StudyBlock -> Reminder references", () => {
  const snapshot = collectAssignmentDeleteSnapshot(state, "a1");
  expect(snapshot?.assignment.id).toBe("a1");
  expect(snapshot?.calendarMarks.map((x) => x.id)).toEqual(["cm-a1"]);
  expect(snapshot?.studyBlocks.map((x) => x.id).sort()).toEqual(["sb-a1-1", "sb-a1-2"]);
  expect(snapshot?.reminders.map((x) => x.id).sort()).toEqual([
    "r-assignment",
    "r-ddl-mark",
    "r-studyblock",
  ]);
});

it("Assignment snapshot leaves standalone and unrelated reminders untouched", () => {
  const snapshot = collectAssignmentDeleteSnapshot(state, "a1")!;
  expect(snapshot.reminders.some((r) => r.id === "r-standalone")).toBe(false);
  expect(snapshot.reminders.some((r) => r.id === "r-other-course")).toBe(false);
});

it("restore is idempotent by id and preserves original objects", () => {
  const snapshot = collectAssignmentDeleteSnapshot(state, "a1")!;
  const removed = removeAssignmentDeleteSnapshot(state, snapshot);
  const once = restoreAssignmentDeleteSnapshot(removed, snapshot);
  const twice = restoreAssignmentDeleteSnapshot(once, snapshot);
  expect(twice).toEqual(once);
  expect(once.reminders.find((r) => r.id === "r-assignment")).toEqual(
    state.reminders.find((r) => r.id === "r-assignment")
  );
});

it("Course cascade includes direct-course and Assignment-owned StudyBlocks and all affected target reminders", () => {
  const cascade = collectCourseDeleteCascade(state, "c1")!;
  expect(cascade.assignments.map((x) => x.id)).toContain("a1");
  expect(cascade.studyBlocks.map((x) => x.id).sort()).toEqual(
    expect.arrayContaining(["sb-a1-1", "sb-a1-2", "sb-course-only"])
  );
  expect(cascade.reminders.map((x) => x.id)).toEqual(
    expect.arrayContaining(["r-assignment", "r-studyblock", "r-ddl-mark"])
  );
});

it("Course cascade preserves unrelated and standalone reminders", () => {
  const cascade = collectCourseDeleteCascade(state, "c1")!;
  expect(cascade.reminders.some((r) => r.id === "r-standalone")).toBe(false);
  expect(cascade.reminders.some((r) => r.id === "r-other-course")).toBe(false);
});

it("legacy DDL matching stays strict", () => {
  const cascade = collectCourseDeleteCascade(stateWithLegacyCollision, "c1")!;
  expect(cascade.calendarMarks.map((m) => m.id)).toContain("legacy-exact");
  expect(cascade.calendarMarks.map((m) => m.id)).not.toContain("same-title-wrong-date");
  expect(cascade.calendarMarks.map((m) => m.id)).not.toContain("same-date-wrong-title");
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
npx vitest run tests/dataDependencies.test.ts
```

Expected: FAIL because `lib/dataDependencies.ts` and its exports do not exist.

- [ ] **Step 3: Implement `lib/dataDependencies.ts`**

Use deterministic ID sets and the existing CalendarMark matcher. The Assignment collector must include Reminders targeting the deleted DDL CalendarMark IDs in addition to Assignment and StudyBlock targets.

Implementation shape:

```ts
import type {
  Assignment,
  CalendarMark,
  Course,
  CourseSchedule,
  GroupProject,
  Reminder,
  StudyBlock,
} from "@/types";
import { isDDLMarkForAssignment } from "@/lib/calendarMark";

const idsOf = <T extends { id: string }>(items: T[]) => new Set(items.map((x) => x.id));
const withoutIds = <T extends { id: string }>(items: T[], ids: Set<string>) =>
  items.filter((x) => !ids.has(x.id));
const restoreMissing = <T extends { id: string }>(items: T[], restored: T[]) => {
  const currentIds = idsOf(items);
  return [...restored.filter((x) => !currentIds.has(x.id)), ...items];
};

export function collectAssignmentDeleteSnapshot(state, assignmentId) {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return null;
  const calendarMarks = state.calendarMarks.filter((m) => isDDLMarkForAssignment(m, assignment));
  const studyBlocks = state.studyBlocks.filter((b) => b.assignmentId === assignmentId);
  const studyBlockIds = idsOf(studyBlocks);
  const calendarMarkIds = idsOf(calendarMarks);
  const reminders = state.reminders.filter(
    (r) =>
      (r.targetType === "assignment" && r.targetId === assignmentId) ||
      (r.targetType === "studyBlock" && !!r.targetId && studyBlockIds.has(r.targetId)) ||
      (r.targetType === "calendarMark" && !!r.targetId && calendarMarkIds.has(r.targetId))
  );
  return { assignment, calendarMarks, studyBlocks, reminders };
}
```

`removeAssignmentDeleteSnapshot` filters all four arrays by the snapshot ID sets. `restoreAssignmentDeleteSnapshot` uses ID-based insertion only; it must not call normalize/add actions or mutate snapshot objects.

For Course collection:

```ts
const course = state.courses.find((c) => c.id === courseId);
if (!course) return null;
const assignments = state.assignments.filter((a) => a.courseId === courseId);
const assignmentIds = idsOf(assignments);
const schedules = state.schedules.filter((s) => s.courseId === courseId);
const groupProjects = state.groupProjects.filter((g) => g.courseId === courseId);
const studyBlocks = state.studyBlocks.filter(
  (b) => b.courseId === courseId || (!!b.assignmentId && assignmentIds.has(b.assignmentId))
);
const studyBlockIds = idsOf(studyBlocks);
const calendarMarks = state.calendarMarks.filter((m) =>
  assignments.some((a) => isDDLMarkForAssignment(m, a))
);
const calendarMarkIds = idsOf(calendarMarks);
const reminders = state.reminders.filter(
  (r) =>
    (r.targetType === "assignment" && !!r.targetId && assignmentIds.has(r.targetId)) ||
    (r.targetType === "studyBlock" && !!r.targetId && studyBlockIds.has(r.targetId)) ||
    (r.targetType === "calendarMark" && !!r.targetId && calendarMarkIds.has(r.targetId))
);
```

`removeCourseDeleteCascade` filters Course + all cascade arrays and leaves unrelated entities untouched.

- [ ] **Step 4: Run dependency tests**

```bash
npx vitest run tests/dataDependencies.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/dataDependencies.ts tests/dataDependencies.test.ts
git commit -m "feat(integrity): add dependency cascade helpers"
```

---

### Task 2: Assignment Atomic Cascade + Complete Undo

**Files:**
- Modify: `store/useAppStore.ts`
- Modify: `lib/assignmentActions.ts`
- Modify: `components/drawers/AssignmentDrawer.tsx`
- Modify: `lib/ai/tools/write/types.ts`
- Modify: `lib/ai/tools/write/prepare.ts`
- Modify: `hooks/useKiroChat.ts` only if required by the changed API type
- Create: `tests/referentialIntegrityStore.test.ts`
- Modify only signature-compilation fixtures returned by `rg -n "KiroWriteApi|restoreAssignment\(|deleteAssignment\(" tests lib hooks components`.

**Interfaces:**
- Consumes: Task 1 `AssignmentDeleteSnapshot`, `collectAssignmentDeleteSnapshot`, `removeAssignmentDeleteSnapshot`, `restoreAssignmentDeleteSnapshot`.
- Produces:

```ts
// lib/assignmentActions.ts
export type DeleteResult = AssignmentDeleteSnapshot;

// AppState
restoreAssignment: (snapshot: AssignmentDeleteSnapshot) => void;

// KiroWriteApi
restoreAssignment: (snapshot: DeleteResult) => void;
```

- [ ] **Step 1: Write failing Assignment cascade/Undo Store tests**

In `tests/referentialIntegrityStore.test.ts`, seed one Assignment with:

- linked DDL CalendarMark
- two StudyBlocks
- one direct Assignment Reminder
- one StudyBlock Reminder
- one absolute Reminder attached to the linked DDL CalendarMark
- standalone Reminder
- unrelated course/Assignment data

Tests:

```ts
it("deleteAssignment removes the complete deterministic dependency closure", async () => {
  const store = await freshStore();
  const removed = store.getState().deleteAssignment("a1");
  expect(removed).not.toBeNull();
  const s = store.getState();
  expect(s.assignments.some((a) => a.id === "a1")).toBe(false);
  expect(s.calendarMarks.some((m) => m.id === "cm-a1")).toBe(false);
  expect(s.studyBlocks.some((b) => b.assignmentId === "a1")).toBe(false);
  expect(s.reminders.some((r) => ["r-a", "r-sb", "r-cm"].includes(r.id))).toBe(false);
  expect(s.reminders.some((r) => r.id === "r-standalone")).toBe(true);
});

it("restoreAssignment restores original IDs and Reminder history fields", async () => {
  const store = await freshStore();
  const removed = store.getState().deleteAssignment("a1")!;
  store.getState().restoreAssignment(removed);
  const s = store.getState();
  expect(s.assignments.find((a) => a.id === "a1")).toEqual(removed.assignment);
  expect(s.studyBlocks.filter((b) => removed.studyBlocks.some((x) => x.id === b.id))).toEqual(
    expect.arrayContaining(removed.studyBlocks)
  );
  for (const reminder of removed.reminders) {
    expect(s.reminders.find((r) => r.id === reminder.id)).toEqual(reminder);
  }
});

it("restoreAssignment is idempotent", async () => {
  const store = await freshStore();
  const removed = store.getState().deleteAssignment("a1")!;
  store.getState().restoreAssignment(removed);
  const once = store.getState();
  store.getState().restoreAssignment(removed);
  const twice = store.getState();
  expect(twice.assignments.filter((a) => a.id === "a1")).toHaveLength(1);
  expect(twice.studyBlocks.filter((b) => removed.studyBlocks.some((x) => x.id === b.id))).toHaveLength(removed.studyBlocks.length);
  expect(twice.reminders.filter((r) => removed.reminders.some((x) => x.id === r.id))).toHaveLength(removed.reminders.length);
  expect(twice.reminders).toEqual(once.reminders);
});
```

- [ ] **Step 2: Run the targeted Store test and verify failure**

```bash
npx vitest run tests/referentialIntegrityStore.test.ts
```

Expected: FAIL because current `deleteAssignment` does not remove StudyBlocks and old `restoreAssignment` accepts `(assignment, marks)`.

- [ ] **Step 3: Change the Store Assignment contract to one atomic snapshot mutation**

In `store/useAppStore.ts` import the Task 1 helpers/type. Replace the existing delete/restore behavior with:

```ts
deleteAssignment: (id) => {
  const current = get();
  const snapshot = collectAssignmentDeleteSnapshot(current, id);
  if (!snapshot) return null;
  const next = removeAssignmentDeleteSnapshot(current, snapshot);
  set({
    ...next,
    selectedAssignmentId:
      current.selectedAssignmentId === id ? null : current.selectedAssignmentId,
  });
  return snapshot;
},

restoreAssignment: (snapshot) =>
  set((state) => restoreAssignmentDeleteSnapshot(state, snapshot)),
```

Do not call `deleteStudyBlock`, `deleteReminder`, or `addReminder` inside these actions.

- [ ] **Step 4: Propagate the snapshot signature through normal UI actions**

In `lib/assignmentActions.ts`:

```ts
import type { AssignmentDeleteSnapshot } from "@/lib/dataDependencies";
export type DeleteResult = AssignmentDeleteSnapshot;
```

Change:

```ts
restoreAssignment: (snapshot: DeleteResult) => void;
```

and Undo:

```ts
onAction: () => removed.forEach((snapshot) => restoreAssignment(snapshot))
```

Correct the contradictory delete confirmation copy. It must no longer say “无法撤销”. Use:

```text
任务及其学习安排与提醒将一并删除，删除后可通过「撤销」恢复。
```

In `components/drawers/AssignmentDrawer.tsx` change:

```ts
onAction: () => restoreAssignment(removed)
```

No Reminder-specific UI changes.

- [ ] **Step 5: Propagate the snapshot contract through Kiro delete_assignment**

In `lib/ai/tools/write/types.ts`:

```ts
deleteAssignment: (id: string) => DeleteResult | null;
restoreAssignment: (snapshot: DeleteResult) => void;
```

In `lib/ai/tools/write/prepare.ts`, do not leave transaction projection as `projectRemove(... "assignments")`. The projection must match the real Store cascade:

```ts
return makeAction(
  state,
  view,
  (s) => {
    const snapshot = collectAssignmentDeleteSnapshot(s, assignmentId);
    if (!snapshot) return s;
    return { ...s, ...removeAssignmentDeleteSnapshot(s, snapshot) };
  },
  (api) => {
    const removed = api.deleteAssignment(assignmentId);
    if (!removed) return null;
    return { undo: () => api.restoreAssignment(removed) };
  }
);
```

This matters because `delete_assignment` is transaction-safe and later Change Set projections must see the same StudyBlock/Reminder removal as the real commit.

If `hooks/useKiroChat.ts` has an explicit wrapper, keep it as a direct pass-through:

```ts
restoreAssignment: (snapshot) => useAppStore.getState().restoreAssignment(snapshot),
```

Use `rg` to update only concrete old-signature test/fake API call sites.

- [ ] **Step 6: Run targeted Assignment/Kiro tests**

Run:

```bash
npx vitest run tests/referentialIntegrityStore.test.ts tests/aiWrite.test.ts
```

If `tests/aiWrite.test.ts` only needs fixture signature updates and has unrelated failures, stop and diagnose rather than expanding to the full suite.

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add store/useAppStore.ts lib/assignmentActions.ts components/drawers/AssignmentDrawer.tsx lib/ai/tools/write/types.ts lib/ai/tools/write/prepare.ts hooks/useKiroChat.ts tests/referentialIntegrityStore.test.ts tests/aiWrite.test.ts
git commit -m "fix(assignments): cascade and restore dependent planning data"
```

Only include files that actually changed.

---

### Task 3: Course Referentially Complete Cascade

**Files:**
- Modify: `store/useAppStore.ts`
- Modify: `tests/referentialIntegrityStore.test.ts`

**Interfaces:**
- Consumes: Task 1 `collectCourseDeleteCascade`, `removeCourseDeleteCascade`.
- Produces: existing `deleteCourse(courseId)` API unchanged; no restore/Undo API.

- [ ] **Step 1: Add failing Course cascade tests**

Append to `tests/referentialIntegrityStore.test.ts`:

```ts
it("deleteCourse removes schedules assignments projects StudyBlocks DDL marks and their reminders", async () => {
  const store = await freshStore();
  store.getState().deleteCourse("c1");
  const s = store.getState();
  expect(s.courses.some((c) => c.id === "c1")).toBe(false);
  expect(s.schedules.some((x) => x.courseId === "c1")).toBe(false);
  expect(s.assignments.some((x) => x.courseId === "c1")).toBe(false);
  expect(s.groupProjects.some((x) => x.courseId === "c1")).toBe(false);
  expect(s.studyBlocks.some((b) => b.courseId === "c1" || b.assignmentId === "a1")).toBe(false);
  expect(s.calendarMarks.some((m) => m.id === "cm-a1")).toBe(false);
  expect(s.reminders.some((r) => ["r-a", "r-sb", "r-cm"].includes(r.id))).toBe(false);
});

it("deleteCourse preserves unrelated data and standalone reminders", async () => {
  const store = await freshStore();
  store.getState().deleteCourse("c1");
  const s = store.getState();
  expect(s.courses.some((c) => c.id === "c2")).toBe(true);
  expect(s.assignments.some((a) => a.id === "a2")).toBe(true);
  expect(s.reminders.some((r) => r.id === "r-standalone")).toBe(true);
  expect(s.reminders.some((r) => r.id === "r-other-course")).toBe(true);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/referentialIntegrityStore.test.ts
```

Expected: Course tests FAIL because current `deleteCourse` does not remove dependent StudyBlocks/Reminders.

- [ ] **Step 3: Implement Course cascade in one state mutation**

In `deleteCourse(courseId)`:

1. Read current state.
2. Call `collectCourseDeleteCascade(current, courseId)`; return early if null.
3. Preserve existing material Blob cleanup using `cascade.course.materials` before the state mutation.
4. Call `removeCourseDeleteCascade(current, cascade)`.
5. `set` the resulting dependency collections and clear `selectedCourseId` if needed.
6. If `selectedAssignmentId` points to a deleted Assignment, clear it as a stale UI reference.

Shape:

```ts
deleteCourse: (courseId) => {
  const current = get();
  const cascade = collectCourseDeleteCascade(current, courseId);
  if (!cascade) return;

  cascade.course.materials.forEach((m) => {
    if (m.storageKey) deleteFileBlob(m.storageKey).catch(() => {});
  });

  const next = removeCourseDeleteCascade(current, cascade);
  const deletedAssignmentIds = new Set(cascade.assignments.map((a) => a.id));
  set({
    ...next,
    selectedCourseId: current.selectedCourseId === courseId ? null : current.selectedCourseId,
    selectedAssignmentId:
      current.selectedAssignmentId && deletedAssignmentIds.has(current.selectedAssignmentId)
        ? null
        : current.selectedAssignmentId,
  });
},
```

Do not add Course Undo. Do not change existing confirmation UI semantics.

- [ ] **Step 4: Run Store cascade tests**

```bash
npx vitest run tests/referentialIntegrityStore.test.ts tests/dataDependencies.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add store/useAppStore.ts tests/referentialIntegrityStore.test.ts
git commit -m "fix(courses): cascade dependent planning and reminder data"
```

---

### Task 4: Runtime Phase Guard + Immediate Running-Session Delivery

**Files:**
- Create: `lib/reminders/reminderRuntimePolicy.ts`
- Modify: `components/reminders/ReminderRuntime.tsx`
- Modify: `tests/reminderRuntime.test.ts`

**Interfaces:**
- Consumes: existing `getDueScheduledReminders`, existing `deliver()` status guard.
- Produces:

```ts
export type ReminderRuntimePhase = "booting" | "initial-reconcile" | "running";

export function getRunningSessionDueReminders(
  reminders: Reminder[],
  now: string,
  phase: ReminderRuntimePhase
): Reminder[];
```

- [ ] **Step 1: Write failing runtime-policy tests**

Add to `tests/reminderRuntime.test.ts`:

```ts
import { getRunningSessionDueReminders } from "@/lib/reminders/reminderRuntimePolicy";

it("booting / initial-reconcile never bypass missed policy", () => {
  const due = [mkReminder("due", "2026-08-10T11:00:00")];
  expect(getRunningSessionDueReminders(due, NOW, "booting")).toEqual([]);
  expect(getRunningSessionDueReminders(due, NOW, "initial-reconcile")).toEqual([]);
});

it("running returns newly overdue scheduled reminders immediately", () => {
  const retimed = [
    mkReminder("retimed", "2026-08-10T11:30:00", {
      targetType: "assignment",
      targetId: "a1",
      timingMode: "relative",
      offsetMinutes: -60,
    }),
  ];
  expect(getRunningSessionDueReminders(retimed, NOW, "running").map((r) => r.id)).toEqual(["retimed"]);
});

it("running excludes fired and skipped", () => {
  const reminders = [
    mkReminder("fired", "2026-08-10T11:00:00", { status: "fired" }),
    mkReminder("skipped", "2026-08-10T11:00:00", { status: "skipped" }),
  ];
  expect(getRunningSessionDueReminders(reminders, NOW, "running")).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/reminderRuntime.test.ts
```

Expected: FAIL because `reminderRuntimePolicy.ts` does not exist.

- [ ] **Step 3: Implement the small pure phase gate**

Create:

```ts
import type { Reminder } from "@/types";
import { getDueScheduledReminders } from "@/lib/reminders/reminderScheduler";

export type ReminderRuntimePhase = "booting" | "initial-reconcile" | "running";

export function getRunningSessionDueReminders(
  reminders: Reminder[],
  now: string,
  phase: ReminderRuntimePhase
): Reminder[] {
  return phase === "running" ? getDueScheduledReminders(reminders, now) : [];
}
```

- [ ] **Step 4: Refactor ReminderRuntime to explicit phases and one running-session reconcile**

In `ReminderRuntime.tsx`:

```ts
const phaseRef = useRef<ReminderRuntimePhase>("booting");
const sessionReconcileRef = useRef<() => void>(() => {});
```

Keep `deliver()` unchanged in its critical order: re-read Store -> require `scheduled` -> mark fired -> enqueue -> optional browser notification.

Implement:

```ts
const runSessionDueReconcile = useCallback(() => {
  const state = useAppStore.getState();
  const now = formatLocalDateTime(new Date());
  const due = getRunningSessionDueReminders(state.reminders, now, phaseRef.current);
  for (const reminder of due) deliver(reminder);
  scheduleNext();
}, [deliver, scheduleNext]);

sessionReconcileRef.current = runSessionDueReconcile;
```

To avoid a callback dependency cycle, the timer callback in `scheduleNext()` should invoke the ref:

```ts
timerRef.current = window.setTimeout(() => {
  timerRef.current = null;
  sessionReconcileRef.current();
}, Math.max(delay, 0));
```

Initial hydration path:

```ts
phaseRef.current = "initial-reconcile";
runInitialReconcile(); // existing missed policy loop only
phaseRef.current = "running";
scheduleNext();
```

Adjust `runInitialReconcile()` so it does not itself transition to running; keep policy handling clearly separate.

Focus/visibility:

```ts
const onVisibility = () => {
  if (document.visibilityState === "visible") runSessionDueReconcile();
};
const onFocus = () => runSessionDueReconcile();
```

Reminder-array effect:

```ts
useEffect(() => {
  if (phaseRef.current !== "running") return;
  runSessionDueReconcile();
}, [reminders, runSessionDueReconcile]);
```

This is the critical fix: in-session DDL/StudyBlock retiming changes `reminders`, and newly overdue scheduled reminders are delivered immediately instead of merely looking for the next future timer.

Do not call Reminder delivery from Store actions.

- [ ] **Step 5: Run runtime/domain tests**

```bash
npx vitest run tests/reminderRuntime.test.ts tests/reminderDomain.test.ts
```

Expected: PASS. Existing missed-policy tests must remain green.

- [ ] **Step 6: Commit Task 4**

```bash
git add lib/reminders/reminderRuntimePolicy.ts components/reminders/ReminderRuntime.tsx tests/reminderRuntime.test.ts
git commit -m "fix(reminders): deliver newly overdue reminders during active sessions"
```

---

### Task 5: Extend Data Integrity to StudyBlock and Reminder References

**Files:**
- Modify: `lib/dataIntegrity.ts`
- Modify: `tests/dataIntegrity.test.ts`
- Modify production snapshot callers only if typecheck shows they omit `studyBlocks` / `reminders`; `ClassFlowBackupData` callers such as `lib/backupPackage.ts` should naturally carry them.

**Interfaces:**
- `DataSnapshot` gains compatibility-safe fields:

```ts
studyBlocks?: StudyBlock[];
reminders?: Reminder[];
```

- `DataIntegrityIssues` gains:

```ts
orphanStudyBlocks: {
  studyBlockId: string;
  title: string;
  missingCourseId?: string;
  missingAssignmentId?: string;
}[];

orphanReminderTargets: {
  reminderId: string;
  title: string;
  targetType: "assignment" | "studyBlock" | "calendarMark";
  targetId: string;
}[];
```

- Severity: `orphanStudyBlocks` -> fatal; `orphanReminderTargets` -> warning.

- [ ] **Step 1: Write failing integrity tests**

Extend the test helper `mkData()` so new test cases can pass `studyBlocks` and `reminders`. Add:

```ts
it("missing StudyBlock Assignment or Course is fatal", () => {
  const issues = findDataIntegrityIssues(mkData({
    studyBlocks: [
      { id: "sb-a", title: "A", date: "2026-08-12", startTime: "09:00", endTime: "10:00", assignmentId: "missing-a", courseId: "c_1", source: "manual" },
      { id: "sb-c", title: "B", date: "2026-08-12", startTime: "10:00", endTime: "11:00", courseId: "missing-c", source: "manual" },
    ],
  }));
  expect(issues.orphanStudyBlocks.map((x) => x.studyBlockId).sort()).toEqual(["sb-a", "sb-c"]);
  expect(classifyIntegrityIssues(issues).fatal.some((x) => x.includes("学习计划"))).toBe(true);
});

it("missing Reminder targets warn while standalone remains valid", () => {
  const issues = findDataIntegrityIssues(mkData({
    studyBlocks: [],
    reminders: [
      mkReminder("r-a", { targetType: "assignment", targetId: "missing-a" }),
      mkReminder("r-sb", { targetType: "studyBlock", targetId: "missing-sb" }),
      mkReminder("r-cm", { targetType: "calendarMark", targetId: "missing-cm" }),
      mkReminder("r-standalone", { targetType: "standalone", targetId: undefined }),
    ],
  }));
  expect(issues.orphanReminderTargets.map((x) => x.reminderId).sort()).toEqual(["r-a", "r-cm", "r-sb"]);
  const classified = classifyIntegrityIssues(issues);
  expect(classified.warnings.some((x) => x.includes("提醒"))).toBe(true);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run tests/dataIntegrity.test.ts
```

Expected: FAIL because the new issue fields do not exist.

- [ ] **Step 3: Implement integrity detection**

In `lib/dataIntegrity.ts` import `Reminder` and `StudyBlock`. Use compatibility defaults:

```ts
const studyBlocks = snapshot.studyBlocks ?? [];
const reminders = snapshot.reminders ?? [];
const studyBlockIds = new Set(studyBlocks.map((b) => b.id));
const calendarMarkIds = new Set(snapshot.calendarMarks.map((m) => m.id));
```

StudyBlocks:

```ts
const orphanStudyBlocks = studyBlocks.flatMap((b) => {
  const missingCourseId = b.courseId && !courseIds.has(b.courseId) ? b.courseId : undefined;
  const missingAssignmentId = b.assignmentId && !assignmentIds.has(b.assignmentId) ? b.assignmentId : undefined;
  return missingCourseId || missingAssignmentId
    ? [{ studyBlockId: b.id, title: b.title, missingCourseId, missingAssignmentId }]
    : [];
});
```

Reminder targets:

```ts
const orphanReminderTargets = reminders.flatMap((r) => {
  if (r.targetType === "standalone") return [];
  const targetId = r.targetId;
  if (!targetId) {
    return [{ reminderId: r.id, title: r.title, targetType: r.targetType, targetId: "" }];
  }
  const exists =
    r.targetType === "assignment"
      ? assignmentIds.has(targetId)
      : r.targetType === "studyBlock"
        ? studyBlockIds.has(targetId)
        : calendarMarkIds.has(targetId);
  return exists ? [] : [{ reminderId: r.id, title: r.title, targetType: r.targetType, targetId }];
});
```

Add both fields to the returned issue object.

Classification:

```ts
if (issues.orphanStudyBlocks.length > 0) {
  fatal.push(`${issues.orphanStudyBlocks.length} 个学习计划引用了不存在的课程或任务`);
}
if (issues.orphanReminderTargets.length > 0) {
  warnings.push(`${issues.orphanReminderTargets.length} 个提醒指向已不存在的目标`);
}
```

Do not mutate or rebind any data.

- [ ] **Step 4: Run integrity tests**

```bash
npx vitest run tests/dataIntegrity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add lib/dataIntegrity.ts tests/dataIntegrity.test.ts
git commit -m "fix(integrity): detect orphan study blocks and reminder targets"
```

---

### Task 6: Focused Integration Verification

**Files:**
- Modify only files required to resolve failures proven by the commands below.

**Interfaces:**
- Consumes all prior tasks.
- Produces no new feature API.

- [ ] **Step 1: Run only the directly affected tests**

```bash
npx vitest run \
  tests/dataDependencies.test.ts \
  tests/referentialIntegrityStore.test.ts \
  tests/reminderRuntime.test.ts \
  tests/reminderDomain.test.ts \
  tests/dataIntegrity.test.ts \
  tests/aiWrite.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

If typecheck reports old `restoreAssignment(assignment, marks)` call sites or explicit `KiroWriteApi` fixtures, update only those exact sites to the snapshot signature and rerun typecheck. Do not refactor unrelated code.

- [ ] **Step 3: Manual smoke only; no Playwright**

Check these flows quickly in dev:

1. Keep ClassFlow open; create Assignment relative `-60m` reminder; move DDL earlier until the resolved reminder time is already past -> Reminder fires immediately.
2. Move a StudyBlock earlier until its relative reminder becomes overdue -> fires immediately.
3. Set missed policy to `skip`; reload with a historical overdue scheduled Reminder -> initial reconcile skips it rather than current-session delivering it.
4. Delete an Assignment with StudyBlocks + direct Reminder + StudyBlock Reminder + DDL-mark Reminder -> all disappear.
5. Undo Assignment delete -> all return with original IDs and Reminder history fields.
6. Delete a Course after the existing confirmation -> its schedules/assignments/projects/StudyBlocks/linked DDL marks/affected reminders disappear; standalone and unrelated reminders remain.
7. Crafted orphan StudyBlock -> integrity classification fatal.
8. Crafted orphan Reminder target -> integrity classification warning.

- [ ] **Step 4: Explicitly skip broad verification**

Do **not** run by default:

```bash
npm test
npm run build
npx playwright test
```

Only run one of them if a targeted failure cannot be isolated without it, and state why in the completion report.

- [ ] **Step 5: Final commit if verification required fixes**

If Task 6 required no code changes, do not create an empty commit. If it required narrow compatibility fixes:

```bash
git add <only-files-changed-by-verification>
git commit -m "fix(integrity): align cascade call sites"
```

---

## Completion Report Format

Report only:

1. current-session immediate Reminder delivery behavior
2. Assignment cascade + full Undo behavior
3. Course cascade behavior and confirmation/no-Undo preserved
4. Data Integrity additions and severity
5. Kiro `delete_assignment` projection/Undo compatibility
6. files created/modified
7. exact targeted test command + result
8. `npm run typecheck` result
9. explicit statement that full suite/build/Playwright were not run, unless one was necessary and why

Do not paste the full diff. Do not continue into cloud Reminder work or another Task.