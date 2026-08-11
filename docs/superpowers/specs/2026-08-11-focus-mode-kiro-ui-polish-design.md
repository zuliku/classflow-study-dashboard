# Focus Mode + Kiro UI Polish Design

Date: 2026-08-11

## Scope

This spec covers five tightly related improvements:

1. Remove the visible double scrollbar from the Kiro model selector while preserving wheel/touchpad scrolling.
2. Restore Upcoming DDL to 3 items per page with pagination.
3. Add a persistent Focus Session domain, runtime, and compact overview entry point.
4. Add Kiro tools for starting/controlling Focus Sessions through natural language.
5. Add safe editing for Kiro user messages.

The implementation must stay low-intrusion: no new large overview card, no full-screen focus modal, no conversation branching, and no full learning analytics feature in V1.

## Existing-code constraints

- The Kiro model menu currently has nested vertical scroll containers; the fix should leave one scroll owner and visually hide its scrollbar.
- `UpcomingDDL` currently renders 4 items per page; V1 should return to 3.
- The overview MiniCalendar already owns the `回到今天` and month-navigation controls; Focus is added in this header row.
- Existing study-load UI represents scheduled course load, not actual study time. Focus history must therefore be a separate data domain.
- Reminder infrastructure may be reused for generic notification delivery helpers, but Focus must not be modeled as a Reminder.
- Kiro currently supports read/write tool flows and user-message rendering, but has no Focus tools and no user-message edit operation.

## 1. Focus entry and overview UI

### Idle state

Add `开始专注` next to `回到今天` in the overview MiniCalendar header.

No persistent focus card or focus statistics are shown before a session starts.

### Setup popover

Clicking `开始专注` opens a small anchored popover attached to the button. It is not a page overlay or full-screen modal.

The popover contains:

- duration presets: 15 / 25 / 30 / 45 / 60 minutes, with 30 minutes selected by default;
- custom duration input;
- one optional relation selector containing grouped Course and Assignment options;
- optional free-text focus note;
- primary `开始专注` action.

Relation semantics:

- no relation: generic Focus Session;
- Course selected: persist `courseId`;
- Assignment selected: persist `assignmentId` and the Assignment's `courseId` when present.

### Active-state button

After a session starts, the same header control becomes a compact timer button, for example:

`● 24:36 · 专注中`

Paused state:

`Ⅱ 24:36 · 已暂停`

Clicking the active-state button opens the same anchored popover in status mode.

Running mode shows target/note if present, remaining time, `暂停`, and `提前结束`.

Paused mode shows target/note if present, remaining time, `继续`, and `提前结束`.

The active Focus Session must continue when navigating away from the overview page.

## 2. FocusSession domain

Use an independent persisted Focus Session domain.

```ts
type FocusSessionStatus = "running" | "paused" | "completed";

type FocusSessionEndReason = "timer" | "manual" | "recovered";

interface FocusSession {
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
  source: "manual" | "kiro";
  createdAt: number;
  updatedAt: number;
}
```

### Invariants

- At most one Focus Session may be `running` or `paused` globally.
- Actual elapsed focus time counts toward study time.
- Paused time never counts.
- Manual early finish records the actual active duration.
- Natural completion records at most `plannedMinutes` even when callbacks run late.
- Running and paused state persists across refreshes.
- A running session continues across page close/reopen based on real wall-clock elapsed time.
- A paused session remains paused indefinitely until resumed or manually finished.
- Completed sessions are historical records and are not removed merely because a related Assignment or Course is later deleted.
- Snapshot labels are retained so historical sessions remain understandable after relation deletion.

### Timing model

Do not increment persisted remaining seconds every second.

Derive current time from timestamps:

```ts
currentActiveMs = status === "running" ? now - activeStartedAt : 0;
elapsedActiveMs = accumulatedActiveMs + currentActiveMs;
remainingMs = Math.max(0, plannedMinutes * 60_000 - elapsedActiveMs);
```

The UI may tick once per second for display, but each tick must not write the main store.

Store duration internally in milliseconds. Round only for presentation.

### Total actual study time

V1 must expose a deterministic aggregate for actual study time even though no new overview statistics card is added:

```ts
totalStudyMs = sum(
  completedFocusSessions.map(session => session.actualActiveMs ?? 0)
);
```

Manual early-finish sessions therefore contribute their actual active duration; naturally/recovered completed sessions contribute their clamped final duration. Running/paused sessions are not persisted into the finalized total until completion, though UI may separately derive their current elapsed value when needed.

Do not mix this value with scheduled course-load statistics.

### Backup compatibility

Add `focusSessions` to persisted application data and backup/restore.

Older backups without this field must restore as an empty array rather than fail.

## 3. Focus Runtime and notifications

Mount a single `FocusRuntime` near the application root. MiniCalendar is only a controller/view and must not own session lifecycle.

Runtime reconciliation runs on:

- app hydration;
- active Focus Session change;
- completion timer firing;
- `visibilitychange` back to visible;
- window focus.

Use one shared pure clock derivation function for both UI and runtime.

### Completion scheduling

Use a completion timeout based on derived remaining time instead of a store-writing one-second interval.

All finishing must pass through one idempotent domain transition. Duplicate timeout/focus/visibility events must not double-complete, double-count, or double-notify.

### Completion delivery

Live natural completion:

- persist completed session first;
- show in-app completion toast;
- play one short local best-effort sound;
- send Browser Notification only when permission is already granted and existing notification preferences allow it.

Focus never requests notification permission itself.

Manual early finish:

- persist actual active duration;
- show a lightweight confirmation toast;
- no completion sound;
- no Browser Notification.

Recovered completion after full application restart/re-hydration:

- finalize the overdue running session at its planned duration;
- show an in-app completion message on reopen;
- do not backfill an old sound or Browser Notification.

A paused session never schedules a completion timeout.

## 4. Kiro x Focus

Add the following bounded Focus tools:

- `get_focus_status` (read)
- `start_focus_session` (write)
- `pause_focus_session` (write)
- `resume_focus_session` (write)
- `finish_focus_session` (write)

All write tools call the same Focus domain actions used by the UI.

### Start contract

Suggested input:

```ts
{
  plannedMinutes: number;
  assignmentId?: string;
  courseId?: string;
  note?: string;
}
```

Domain validation must reject invalid durations, missing targets, inconsistent Assignment/Course relations, and a second active session.

### Natural-language policy

Explicit present-tense commands start immediately without another confirmation, for example:

- `开始专注 30 分钟`
- `帮我专注统计学作业 30 分钟`
- `现在开始一个 25 分钟专注`

If required information is missing, Kiro asks for it instead of choosing a default silently.

Planning/discussion statements do not start a session, for example:

- `我晚上准备专注统计学`
- `今天应该专注多久？`

When Course/Assignment references are ambiguous, Kiro must ask the user to disambiguate rather than guess.

If a session is already active, `start_focus_session` fails with a bounded domain error rather than replacing the session.

Focus write tools are not undoable in V1.

### Kiro result cards

Successful Focus actions should render fact-based result cards from tool results for start/pause/resume/finish. LLM prose must not be the source of truth for timer facts.

## 5. Kiro user-message editing

Add an Edit action next to Copy on user messages.

Use inline editing inside the message bubble, not a dialog.

Recommended interaction:

- Edit switches the bubble to an autosizing textarea.
- `Esc` cancels.
- `Ctrl/Cmd + Enter` saves and resends.
- Enter inserts a newline.
- Unchanged text exits edit mode without a new model request.
- Empty text cannot be submitted.

### Regeneration semantics

Editing a user message replaces that message and truncates the conversation suffix after it. The revised message is then sent again and Kiro regenerates from that point.

Do not create branch/version-tree UI in V1.

The regenerated turn uses current ClassFlow context/data rather than replaying a historical data snapshot.

### Safety guard

Editing is allowed only when all conditions hold:

- no current submitted/streaming generation conflicts with the edit;
- the target message is text-only;
- the suffix from that user message to the current end of the conversation contains no executed mutating/write tool calls.

The suffix rule is required because truncating chat history must never hide already-executed state mutations.

If a suffix contains a write tool, show the Edit action disabled with an explanatory tooltip telling the user to send a new corrective instruction instead.

Messages with attachments are not editable in V1 because the original local File payload is not guaranteed to remain available for faithful resend.

Submit-time safety must be rechecked even if the Edit button was previously enabled.

## 6. UI polish included in this scope

### Kiro model selector

Replace the nested scroll ownership with one actual vertical scroll container.

Hide the visible scrollbar while preserving mouse-wheel, touchpad, and keyboard/accessibility scrolling.

Do not change model ordering/provider-logo behavior as part of this task.

### Upcoming DDL

Set the page size to 3 items.

Keep the existing pagination controls and avoid adding an internal scrollbar.

Update stale comments/tests that still describe a different page size.

## 7. Failure behavior

Focus domain actions should expose bounded errors for at least:

- active session already exists;
- no active session;
- pause requested when already paused;
- resume requested when not paused;
- invalid duration;
- target not found;
- Assignment/Course relation mismatch.

UI and Kiro translate these into concise user-facing messages. No caller may bypass the domain invariants.

Notification/sound failures are best-effort side-effect failures and must never prevent Focus completion persistence.

## 8. Testing strategy

Prefer narrow deterministic tests and typecheck over a broad full-suite run.

Required targeted coverage:

- pure focus clock derivation;
- pause/resume elapsed-time accounting;
- manual early finish;
- natural completion clamping;
- refresh/re-hydration recovery;
- paused reload behavior;
- one-active-session invariant;
- total actual study-time aggregation;
- idempotent completion/deduplication;
- Kiro Focus tool validation and state transitions;
- message-edit suffix truncation;
- message-edit write-tool safety guard;
- attachment edit guard;
- model-selector single-scroll behavior where practical;
- Upcoming DDL page-size regression.

Each implementation task should run only its focused tests plus `npm run typecheck` unless the changed surface requires more.

## 9. Explicitly out of scope for V1

- full study analytics dashboard;
- permanent `今日专注 / 本周专注` overview cards;
- Focus modeled as Reminder;
- Service Worker/background push guarantees while ClassFlow is fully closed;
- global floating timer/sidebar timer/browser-title countdown;
- multiple simultaneous Focus Sessions;
- Focus undo/time-travel;
- conversation branch trees;
- editing attachment-bearing Kiro messages;
- broad unrelated refactors.
