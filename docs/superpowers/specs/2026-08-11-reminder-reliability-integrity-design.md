# Task 7G-C — Reminder Reliability & Referential Integrity Design

Date: 2026-08-11

## 1. Goal

Task 7G-C is a reliability hardening pass for the Reminder system after Task 7G-A1/A2/A3a/A3b and 7G-B.

The feature set is already complete enough for normal use. This task does **not** add new Reminder UX. It closes three correctness gaps:

1. A relative Reminder that becomes overdue because its target time is moved earlier during the current ClassFlow session must be delivered immediately.
2. Deleting an Assignment must delete all dependent StudyBlocks and Reminders atomically, and Undo must restore the full dependency graph with original IDs and timestamps.
3. Deleting a Course must perform complete cascade cleanup so no orphan Assignment, StudyBlock, Reminder, Schedule, GroupProject, or linked DDL mark remains.

It also extends the existing data-integrity gate so damaged backups or historical data can report orphan StudyBlocks and Reminder targets.

## 2. Locked Product Decisions

### 2.1 Retimed relative Reminder

If ClassFlow is already running and a scheduled relative Reminder is recalculated to `triggerAt <= now` because its target time changed, ClassFlow immediately delivers the Reminder.

This is a current-session event and **does not use** `missedReminderPolicy`.

Example:

- current time: 22:10
- Assignment DDL changes from 23:00 to 22:30
- Reminder is `-60 minutes`
- new triggerAt becomes 21:30

Result:

- Reminder is immediately delivered
- status becomes `fired`
- in-app Reminder card is enqueued
- browser notification is sent if the existing browser-notification preference and permission allow it

### 2.2 Course deletion

Course deletion remains a destructive action that requires the existing confirmation flow and is **not undoable**.

After confirmation, all deterministic dependents are deleted in one cascade.

### 2.3 Assignment deletion

Assignment deletion uses **complete cascade + complete Undo**.

Deleting an Assignment removes:

- the Assignment
- linked DDL CalendarMark records
- all StudyBlocks whose `assignmentId` equals the Assignment ID
- all Reminders directly targeting the Assignment
- all Reminders targeting the deleted StudyBlocks

Undo restores all of the above with their original IDs and original persisted fields.

## 3. Architecture

Use a small pure dependency layer plus existing Zustand mutation/runtime boundaries.

Recommended new module:

`lib/dataDependencies.ts`

Responsibilities:

- collect deterministic dependents for Assignment deletion
- collect deterministic dependents for Course deletion
- return snapshots / ID sets only
- never mutate Zustand
- never call browser APIs
- never guess entity relationships

The Store remains responsible for atomic state mutation.

Reminder Runtime remains responsible for delivery side effects.

Data Integrity remains responsible for reporting broken references during validation / restore.

Do not introduce a generic graph engine or transaction framework in this task.

## 4. Assignment Delete Snapshot

Define a shared domain snapshot, either in `lib/dataDependencies.ts` or a narrowly scoped shared type module:

```ts
export interface AssignmentDeleteSnapshot {
  assignment: Assignment;
  calendarMarks: CalendarMark[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
}
```

`calendarMarks` contains only marks deterministically linked to the deleted Assignment using the existing CalendarMark matching semantics.

`studyBlocks` contains every StudyBlock with:

```ts
block.assignmentId === assignment.id
```

`reminders` contains both:

```ts
r.targetType === "assignment" && r.targetId === assignment.id
```

and:

```ts
r.targetType === "studyBlock" && deletedStudyBlockIds.has(r.targetId)
```

All Reminder statuses are included:

- `scheduled`
- `fired`
- `skipped`

The deletion snapshot is a preservation mechanism for Undo, not a filtered view.

## 5. Assignment Delete Mutation

`deleteAssignment(id)` must:

1. collect the full `AssignmentDeleteSnapshot`
2. return `null` if the Assignment does not exist
3. perform one Zustand state mutation removing all snapshot entities
4. clear `selectedAssignmentId` if it points to the deleted Assignment
5. return the complete snapshot

Do not implement cascade by sequentially calling `deleteStudyBlock`, `deleteReminder`, or `deleteCalendarMark` actions.

Reason: a single mutation prevents transient orphan states and keeps deletion deterministic for every caller.

## 6. Assignment Undo

Replace the old restore contract:

```ts
restoreAssignment(assignment, marks)
```

with a snapshot-based contract:

```ts
restoreAssignment(snapshot: AssignmentDeleteSnapshot): void
```

Restore behavior:

- restore original Assignment object
- restore original CalendarMark objects
- restore original StudyBlock objects
- restore original Reminder objects
- preserve original IDs
- preserve Reminder `status`, `firedAt`, `readAt`, `triggerAt`, `createdAt`, `updatedAt`
- preserve StudyBlock times and source fields
- preserve CalendarMark `sourceId`

Do not restore via `addAssignment`, `addStudyBlock`, or `addReminder`, because those paths generate new IDs and/or timestamps and can re-resolve relative reminders.

Restore is idempotent by ID: repeated Undo invocation must not duplicate entities.

## 7. Shared Assignment Delete Callers

The new snapshot contract must become the single Assignment deletion contract used by all existing callers, including:

- Assignment Drawer
- Assignment workspace bulk actions
- Context Menu / Command Center
- Kiro `delete_assignment`
- existing Undo toast flows

`lib/assignmentActions.ts` should update its `DeleteResult` alias or replace it with `AssignmentDeleteSnapshot` rather than introducing a second delete result type.

Kiro must use the same Store contract; no Reminder-specific delete patch should exist inside Kiro for Assignment deletion.

## 8. Course Cascade

Course deletion remains non-undoable but must be referentially complete.

For deleted course `courseId = C`, deterministically collect:

### 8.1 Direct Course children

- Course `C`
- all `CourseSchedule` with `schedule.courseId === C`
- all `Assignment` with `assignment.courseId === C`
- all `GroupProject` with `groupProject.courseId === C`

### 8.2 StudyBlocks

Delete a StudyBlock when either condition is true:

```ts
block.courseId === C
```

or:

```ts
block.assignmentId && deletedAssignmentIds.has(block.assignmentId)
```

Both checks are required to clean historical or partially linked data deterministically.

### 8.3 Reminders

Delete any Reminder targeting a deleted Assignment:

```ts
r.targetType === "assignment" && deletedAssignmentIds.has(r.targetId)
```

Delete any Reminder targeting a deleted StudyBlock:

```ts
r.targetType === "studyBlock" && deletedStudyBlockIds.has(r.targetId)
```

All statuses are deleted.

Standalone Reminders are never deleted by Course cascade.

Reminders targeting unrelated CalendarMarks are not deleted.

### 8.4 CalendarMarks

Delete only DDL marks deterministically linked to deleted Assignments using existing sourceId / strict legacy matching semantics.

Do not infer Course ownership from CalendarMark title or date.

Do not automatically delete Exam / Activity CalendarMarks because their title resembles the Course.

### 8.5 Course materials

Keep the existing file/blob cleanup behavior. Task 7G-C does not redesign course material storage.

The Course cascade change only ensures no remaining StudyBlock / Reminder / Assignment references deleted course-owned data.

## 9. Runtime Phase Model

Reminder Runtime must explicitly distinguish initialization from the running session.

Conceptual phases:

```ts
type ReminderRuntimePhase =
  | "booting"
  | "initial-reconcile"
  | "running";
```

Equivalent refs/booleans are acceptable if behavior is unambiguous.

### 9.1 Initial reconcile

After both `useAppStore` and `useReminderPreferencesStore` finish hydration:

1. enter `initial-reconcile`
2. inspect overdue scheduled Reminders
3. apply existing `missedReminderPolicy`
4. deliver / skip according to the policy
5. enter `running`
6. schedule the next future Reminder

This preserves the existing semantic meaning of missed reminders: ClassFlow was not running when they were missed.

### 9.2 Running session reconcile

Once runtime phase is `running`, all overdue scheduled Reminders are delivered immediately, regardless of `missedReminderPolicy`.

Create one shared runtime operation, conceptually:

```ts
runSessionDueReconcile()
```

It:

1. reads current `useAppStore.getState()`
2. computes `scheduled && triggerAt <= now`
3. calls existing `deliver()` for each due Reminder
4. calls `scheduleNext()` afterward

Use this same behavior for:

- timer wake-up
- `window.focus`
- `visibilitychange -> visible`
- Reminder state changes after runtime entered `running`

## 10. Reminder State Change Reconciliation

The existing Reminder subscription/effect must no longer only reschedule the nearest future Reminder.

While runtime is `running`, a Reminder array change must first perform session due reconciliation.

This is required for target retiming:

```text
Assignment / StudyBlock time changes
→ Store recalculates relative triggerAt
→ reminders array changes
→ Runtime detects newly overdue scheduled Reminder
→ immediate delivery
```

Expected behaviors:

- new future Reminder: no delivery; nearest timer is recalculated
- Reminder deletion: no delivery; nearest timer is recalculated
- fired/skipped Reminder update: no delivery
- target moved later: relative trigger remains future; timer is recalculated
- target moved earlier but trigger remains future: timer is recalculated
- target moved earlier and trigger becomes overdue: immediate delivery
- StudyBlock retiming follows the same rule as Assignment DDL retiming

## 11. Initialization Race Guard

Do not run session due reconciliation before initial missed-policy reconciliation completes.

A naive effect such as:

```ts
useEffect(() => runSessionDueReconcile(), [reminders])
```

without a runtime-phase guard is invalid because hydration can change the Reminder array and bypass the user’s missed-reminder policy.

The reminders-change path must require runtime phase `running`.

## 12. Delivery Deduplication

Keep the existing `deliver()` status re-read guard.

Before side effects, delivery re-reads the current Reminder and proceeds only when:

```ts
current.status === "scheduled"
```

The first delivery marks the Reminder `fired` before other delivery paths can proceed.

This remains the deduplication mechanism for simultaneous:

- timer
- focus
- visibility
- reminder-change reconciliation

Do not add a mutex, `deliveringIds` set, or delivery token in this task unless a concrete bug proves the status guard insufficient.

## 13. Store / Runtime Boundary

Keep side effects out of Zustand domain actions.

Store responsibility:

```text
target changed
→ relative Reminder triggerAt recalculated
```

Runtime responsibility:

```text
scheduled Reminder is now due
→ mark fired
→ enqueue in-app notification
→ optionally send browser notification
```

Do not call browser Notification APIs or Reminder delivery store actions from `updateAssignment`, `updateStudyBlock`, or other Store mutations.

This boundary remains compatible with a future cloud scheduler / Web Push architecture.

## 14. Data Integrity Extension

Extend `lib/dataIntegrity.ts` so the integrity layer knows about `StudyBlock` and `Reminder` references.

`DataSnapshot` gains optional/required arrays according to existing compatibility style:

```ts
studyBlocks: StudyBlock[]
reminders: Reminder[]
```

If older fixtures require compatibility, optional input with `?? []` is acceptable, but production snapshots must supply real data.

### 14.1 orphanStudyBlocks

Report a StudyBlock when:

```ts
block.courseId && !courseIds.has(block.courseId)
```

or:

```ts
block.assignmentId && !assignmentIds.has(block.assignmentId)
```

Report enough information to diagnose the broken reference, for example:

```ts
{
  studyBlockId: string;
  title: string;
  missingCourseId?: string;
  missingAssignmentId?: string;
}
```

Do not automatically remove the missing ID or rebind the StudyBlock.

### 14.2 orphanReminderTargets

Check only Reminder types that require targets:

- `assignment`
- `studyBlock`
- `calendarMark`

A Reminder is orphaned when its `targetId` does not exist in the corresponding entity set.

Standalone Reminder without `targetId` is valid and must never be reported as orphaned.

Do not convert orphan target Reminders to standalone automatically.

## 15. Integrity Severity

Classify:

### Fatal

`orphanStudyBlocks`

Reason: StudyBlocks participate directly in deterministic timeline/planning calculations, so restoring a StudyBlock that references missing course/task data is unsafe.

### Warning

`orphanReminderTargets`

Reason: a Reminder still contains valid title/time/history data, but its navigation/reference is broken. It must be surfaced rather than silently rebound.

Existing severity rules remain unchanged.

Normal Store deletion flows should produce zero new orphanStudyBlocks and zero orphanReminderTargets. The integrity layer is primarily a guard for:

- historical buggy data
- manually edited JSON
- damaged backups
- legacy records

## 16. Backup / Restore Behavior

Do not add silent relationship repair for orphan Reminder targets.

Restore policy remains:

- deterministic schema normalization is allowed
- deterministic legacy DDL linking already supported by existing rules is allowed
- ambiguous entity relationship repair is forbidden

Therefore:

- orphan StudyBlock -> fatal restore issue
- orphan Reminder target -> warning

Task 7G-C does not introduce a migration that guesses replacement targets.

## 17. Resulting Dependency Model

```text
Course
├── CourseSchedule
├── Assignment
│   ├── DDL CalendarMark
│   ├── StudyBlock
│   │   └── Reminder
│   └── Reminder
├── course-owned StudyBlock
│   └── Reminder
└── GroupProject

Standalone Reminder
└── independent
```

Deletion semantics:

```text
Assignment
→ cascade deterministic dependents
→ complete Undo supported

Course
→ cascade deterministic dependents
→ confirmation required
→ no Undo
```

Retiming semantics:

```text
Assignment DDL / StudyBlock start changes
→ relative Reminder triggerAt recalculated by Store
→ Runtime session reconciliation
→ if scheduled && triggerAt <= now
→ immediate delivery
```

## 18. Error Handling

- Missing Assignment on delete returns `null`; no mutation.
- Restore skips entities whose IDs already exist rather than duplicating them.
- Course cascade never guesses CalendarMark ownership.
- Runtime ignores invalid trigger timestamps through existing scheduler/domain parsing behavior.
- Runtime delivery re-reads Reminder status before side effects.
- Integrity reporting never mutates user data.

## 19. Testing Strategy

Keep testing targeted for development speed.

### 19.1 Pure dependency tests

Add a focused test file for `lib/dataDependencies.ts`, approximately 6–8 high-value cases:

1. Assignment snapshot includes Assignment + linked DDL mark + its StudyBlocks.
2. Assignment snapshot includes direct Assignment Reminders and Reminders targeting deleted StudyBlocks.
3. Assignment snapshot does not include unrelated / standalone Reminders.
4. Course cascade selects schedules, assignments, group projects, direct-course StudyBlocks, assignment StudyBlocks, and their Reminders.
5. Course cascade leaves unrelated course data and standalone Reminders untouched.
6. Legacy DDL mark matching remains strict and does not delete unrelated marks.

### 19.2 Store cascade / Undo tests

Add or update focused Store tests, approximately 4–6 cases:

1. `deleteAssignment` removes all dependents atomically.
2. `restoreAssignment(snapshot)` restores original IDs and fields.
3. repeated restore is idempotent.
4. Course delete removes all deterministic dependent StudyBlocks / Reminders.
5. Course delete leaves unrelated / standalone Reminders.

### 19.3 Runtime tests

Add only the minimal pure/helper coverage needed for the new session reconciliation behavior, approximately 3–5 cases:

1. running-session due list includes newly overdue scheduled Reminder.
2. fired/skipped are excluded.
3. initial policy remains distinct from running-session delivery.
4. retimed Reminder that becomes overdue is eligible for immediate delivery.

Avoid heavyweight React timer tests unless the implementation cannot be verified through extracted pure helpers.

### 19.4 Integrity tests

Extend current data-integrity tests with focused cases:

1. missing StudyBlock Assignment -> fatal.
2. missing StudyBlock Course -> fatal.
3. missing Reminder Assignment/StudyBlock/CalendarMark target -> warning.
4. standalone Reminder -> no warning.

### 19.5 Verification commands

During implementation, prefer only directly affected test files plus:

```bash
npm run typecheck
```

Do not run full unit suite, build, or Playwright by default unless a targeted failure or cross-cutting type change makes it necessary.

## 20. Manual Smoke Cases

1. Keep ClassFlow open, create a task DDL + `-60m` Reminder, then move DDL earlier so triggerAt is already past -> Reminder fires immediately.
2. Move a StudyBlock earlier so its relative Reminder becomes overdue -> fires immediately.
3. Set missed policy to `skip`, reload with historical overdue Reminder -> it is skipped, proving initial policy was not bypassed.
4. Delete Assignment with StudyBlocks + direct Reminder + StudyBlock Reminder -> all disappear.
5. Undo Assignment delete -> all entities return with original IDs and Reminder status/history.
6. Delete Course after confirmation -> schedules, assignments, course/group data, dependent StudyBlocks and Reminders disappear; unrelated standalone Reminder remains.
7. Run data-integrity validation against crafted orphan StudyBlock -> fatal.
8. Run validation against orphan Reminder target -> warning.

## 21. Non-Goals

Task 7G-C does not implement:

- recurring Reminder inheritance
- Reminder snooze
- notification sounds
- Reminder priority/tags/search
- Service Worker
- Web Push
- cloud scheduler
- multi-device sync
- Course deletion Undo
- generic dependency graph engine
- Reminder Change Set transaction support
- new Reminder Center UI
- new Assignment Reminder UI
- Kiro Reminder feature expansion

## 22. Acceptance Criteria

Task 7G-C is complete when:

- current-session target retiming can never silently strand a newly overdue scheduled Reminder
- initial missed-reminder policy still governs only pre-session missed reminders
- Assignment delete removes all deterministic StudyBlock / Reminder dependents in one mutation
- Assignment Undo restores the full snapshot with original IDs and history fields
- all existing Assignment delete callers share that contract
- Course delete performs complete deterministic cascade and remains non-undoable
- standalone/unrelated Reminder records are preserved
- data-integrity validation detects orphan StudyBlocks and Reminder targets with the agreed severity
- no browser notification side effects are moved into Store actions
- targeted tests and typecheck pass
- no unrelated Reminder UX or cloud work is added
