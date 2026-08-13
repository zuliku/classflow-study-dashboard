# Settings V4 P5 — Date & Time Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V4 date/time preferences real across ClassFlow UI through one presentation formatter facade, while keeping every persisted local-wall-clock date/time field and native date/time input value unchanged.

**Architecture:** Build a pure `lib/format/dateTime.ts` facade that accepts effective UI locale + date/time preferences and formats `Date`, canonical local date strings (`YYYY-MM-DD`), local time strings (`HH:mm`) and local date-time strings without UTC conversion. A small `useAppDateTimeFormatter()` hook obtains `preferences.dateFormatPreference`, `preferences.timeFormatPreference`, effective locale from P3, and the device's system hour-cycle choice. Components consume this facade instead of calling ad-hoc `date-fns format()`/`toLocale*()` for human-readable UI. Domain serialization helpers (`formatLocalDate`, `formatLocalDateTime`, `combineLocalDateTime`, DDL parsing) remain domain-only and unchanged.

**Tech Stack:** TypeScript, native `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`, existing date-fns for date arithmetic/parsing where already appropriate, React hook, Zustand preferences, Vitest, Playwright.

## Global Constraints

- Requires P3/P4 i18n foundation; effective UI locale is `zh-CN | en-US`.
- Date preference values are exactly `system | iso | mdy | dmy`.
- Time preference values are exactly `system | 24h | 12h`.
- `system` time means follow the device/browser **hour-cycle choice**, but render period text in the active ClassFlow locale. Resolve the system hour cycle separately, then format with effective UI locale.
- No user timezone setting in V4.
- Never call `toISOString()` to implement presentation formatting for local-wall-clock domain values.
- Never rewrite persisted values such as Assignment `ddl`, Reminder `triggerAt`, StudyBlock `date/startTime/endTime`, CalendarMark times, Semester `startDate`, GroupTask `ddl`, CourseSchedule times.
- Native `<input type="date">` and `<input type="time">` remain native. Their underlying `value` stays canonical and is not forced to MDY/DMY/12h strings.
- Do not replace domain helpers just because their names contain `format`: `lib/groupProject.ts::formatLocalDate` and reminder/local serialization helpers are storage semantics, not UI formatting.
- Avoid timezone-sensitive `new Date("YYYY-MM-DD")` parsing where it may be interpreted as UTC. Parse canonical local date parts explicitly or reuse safe project local parsers.
- Testing is targeted: formatter unit tests + one date/time preference E2E + typecheck, plus only affected workspace tests if selectors change.

---

### Task 1: Build the pure date/time formatter facade

**Files:**
- Create: `lib/format/dateTime.ts`
- Create: `lib/format/types.ts` if types would otherwise make `dateTime.ts` unwieldy
- Create: `tests/dateTimeFormat.test.ts`

**Recommended public interface:**

```ts
export interface AppDateTimeFormatContext {
  locale: SupportedLocale;
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
  systemHour12: boolean;
}

export interface AppDateTimeFormatter {
  formatDate(date: Date): string;
  formatTime(date: Date): string;
  formatDateTime(date: Date): string;
  formatLocalDate(value: string): string;
  formatLocalTime(value: string): string;
  formatLocalDateTime(value: string): string;
  formatWeekday(date: Date, width?: "short" | "long"): string;
  formatDateRange(start: Date, end: Date): string;
  formatRelativeDate(date: Date, now?: Date): string;
}

export function createAppDateTimeFormatter(
  context: AppDateTimeFormatContext
): AppDateTimeFormatter;

export function resolveSystemHour12(
  formatter?: Intl.DateTimeFormat
): boolean;
```

- [ ] **Step 1: Write failing tests for explicit date formats** using a local `new Date(2026, 7, 13, 14, 30)`:

```text
iso -> 2026-08-13
mdy -> 08/13/2026
dmy -> 13/08/2026
```

Test both UI locales; explicit date order/separator must not change with language.

- [ ] **Step 2: Test `system` date format** with deterministic locale contexts: `zh-CN` returns a normal Chinese-locale numeric date; `en-US` returns US order. Do not assert browser-specific punctuation beyond the normalized contract if `Intl` differs; prefer `formatToParts`-based assembly for stable tests if needed.

- [ ] **Step 3: Test time formats:**
  - `24h` -> `14:30`, midnight -> `00:05` (use `hourCycle: "h23"` so 24:xx never appears);
  - `12h` + `en-US` -> `2:30 PM`;
  - `12h` + `zh-CN` uses locale-appropriate day period text;
  - `system` follows injected `systemHour12` while preserving active UI locale.

- [ ] **Step 4: Test canonical local-string formatting** without UTC drift:
  - `formatLocalDate("2026-08-13")`;
  - `formatLocalTime("14:30")`;
  - `formatLocalDateTime("2026-08-13T14:30:00")`;
  - invalid strings return a safe unchanged/fallback result according to one explicit rule, never throw the whole UI.

Recommended invalid rule: return the original string unchanged. This preserves diagnosability and avoids inventing a date.

- [ ] **Step 5: Test weekday/date range/relative helpers.** `formatRelativeDate()` can use `Intl.RelativeTimeFormat(locale, { numeric: "auto" })` for yesterday/today/tomorrow and fall back to normal date formatting outside a small ±1-day window.

- [ ] **Step 6: Run only**:

```bash
npx vitest run tests/dateTimeFormat.test.ts
```

Confirm failure before implementation.

- [ ] **Step 7: Implement the formatter.** Explicit date formats should assemble local year/month/day parts directly. For 12/24h use `Intl.DateTimeFormat` with active UI locale and explicit hour-cycle choice. For local date/time strings, parse local components; do not append `Z` or rely on UTC conversion.

- [ ] **Step 8: Run the unit test** until green and commit the pure formatter foundation.

---

### Task 2: Add the React presentation hook and expose real Date/Time settings

**Files:**
- Create: `hooks/useAppDateTimeFormatter.ts`
- Modify: `components/settings/GeneralSettings.tsx`
- Modify: `lib/settingsRegistry.ts`
- Modify: `tests/settingsRegistry.test.ts`
- Modify: `tests/preferences.test.ts` only if option-array coverage needs extension

**Hook behavior:**

```ts
export function useAppDateTimeFormatter(): AppDateTimeFormatter;
```

It consumes:
- `preferences.dateFormatPreference`;
- `preferences.timeFormatPreference`;
- `useI18n().locale`;
- device system hour-cycle resolution.

- [ ] **Step 1: Add registry tests first** for stable ids:

```text
date-format-preference -> general
time-format-preference -> general
```

Search aliases include Chinese and English (`日期`, `date`, `ISO`, `MDY`, `DMY`, `时间`, `time`, `12`, `24`).

- [ ] **Step 2: Implement `useAppDateTimeFormatter`.** Memoize the formatter based on locale/date/time preference and resolved `systemHour12`. The hook does not write to Store.

For system hour-cycle changes there is no widely reliable live browser event separate from locale/settings changes; recompute on mount and when language preference/runtime re-renders. A reload after OS hour-cycle change is acceptable in V1 unless the environment emits `languagechange`.

- [ ] **Step 3: Add Date format row** to `GeneralSettings`:

```text
跟随语言与系统 / Follow language & system
2026-08-13
08/13/2026
13/08/2026
```

Use values `system / iso / mdy / dmy` and row-level reset.

- [ ] **Step 4: Add Time format row**:

```text
跟随系统 / System default
24 小时制 / 24-hour
12 小时制 / 12-hour
```

Use values `system / 24h / 12h` and row-level reset.

- [ ] **Step 5: Keep native setting inputs canonical.** The existing default DDL `<input type="time">` remains `HH:mm`; Semester date input remains `YYYY-MM-DD`, regardless of display preference.

- [ ] **Step 6: Run**:

```bash
npx vitest run tests/dateTimeFormat.test.ts tests/settingsRegistry.test.ts tests/preferences.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit** hook + visible settings.

---

### Task 3: Migrate Settings and App Shell date/time presentation first

**Files:**
- Modify: `components/settings/SemesterSettings.tsx`
- Modify: `components/settings/DataSettings.tsx` / restore/backup subcomponents only where human-readable timestamps are rendered
- Modify: `components/layout/*` only where date/time text is component-owned
- Modify: `app/page.tsx` current-week/date-range display
- Modify: `lib/semester.ts`
- Modify: i18n dictionaries only for static separators/labels if needed

- [ ] **Step 1: Replace human-readable `date-fns format(..., "yyyy年M月d日" / similar)`** in Settings with `useAppDateTimeFormatter()`. Keep native input values unchanged.

- [ ] **Step 2: Move week-range presentation out of `lib/semester.ts`.** `getWeekDateRange()` remains a domain/date-arithmetic helper. Replace UI usage of `formatWeekDateRange()` with:

```ts
const days = getWeekDateRange(semester, currentSemesterWeek);
formatter.formatDateRange(days[0], days[6]);
```

After all consumers are migrated, delete `formatWeekDateRange()` and its presentation-only `format` dependency from `lib/semester.ts` if no other consumer remains. Do not alter `createDefaultSemester`, `getSemesterWeek`, week arithmetic or persisted semester fields.

- [ ] **Step 3: For backup/export timestamps shown to users**, format only the display string. Keep `exportedAt` in backup JSON unchanged.

- [ ] **Step 4: Run scoped audit:**

```bash
rg -n 'format\(|toLocale(Date|Time|String)|Intl\.DateTimeFormat' \
  app/page.tsx components/settings components/layout lib/semester.ts \
  --glob '*.{ts,tsx}'
```

Classify domain serialization vs presentation. Only presentation calls are migrated.

- [ ] **Step 5: Run** `npm run typecheck` plus existing Settings E2E if accessible text changed, then commit this slice.

---

### Task 4: Migrate dashboard, assignment and timetable/timeline human-readable dates/times

**Files:**
- Modify as presentation calls are found:
  - `components/dashboard/AssignmentTable.tsx`
  - `components/dashboard/UpcomingDDL.tsx`
  - `components/dashboard/MiniCalendar.tsx`
  - `components/dashboard/TimetableGrid.tsx`
  - `components/dashboard/TimetableQuickGlance.tsx`
  - `components/assignment/AssignmentPeekPanel.tsx`
  - `components/assignment/QuickAddCard.tsx`
  - `components/drawers/AssignmentDrawer.tsx`
  - `components/timeline/TimelineWorkspace.tsx`
  - `components/timeline/TimelineKeyLane.tsx`
  - `components/timeline/FloatingTimelineDetail.tsx`
  - timetable/date-related modal files reported by audit

- [ ] **Step 1: Audit only these slices:**

```bash
rg -n 'date-fns|format\(|toLocale(Date|Time|String)|Intl\.DateTimeFormat|M月|yyyy|HH:mm|MM/dd|dd/MM' \
  components/dashboard components/assignment components/drawers/AssignmentDrawer.tsx components/timeline components/modals \
  --glob '*.tsx'
```

Use focused reads for large files.

- [ ] **Step 2: Replace UI formatting with the formatter hook.** Examples:
  - DDL display -> `formatLocalDateTime(assignment.ddl)` or separated date/time helpers;
  - schedule time labels -> `formatLocalTime(schedule.startTime)` / end time;
  - calendar headings/weekday display -> `formatWeekday` and current i18n/date helper as appropriate;
  - StudyBlock display -> canonical local date/time through formatter.

- [ ] **Step 3: Do not alter positioning/arithmetic logic.** Timeline and timetable calculations must continue using minutes, dayOfWeek and raw canonical strings. Only text nodes/aria descriptions/tooltips receive formatted output.

- [ ] **Step 4: Keep drag/resize payloads canonical.** A 12-hour display must never cause `startTime`/`endTime` to store AM/PM text.

- [ ] **Step 5: Run representative targeted tests:**

```bash
npx playwright test \
  tests/e2e/timetable-drag.spec.ts \
  tests/e2e/study-block-drag.spec.ts \
  tests/e2e/timeline-v2-visual.spec.ts
npm run typecheck
```

Only run all three if their rendered labels were touched; otherwise run the affected subset.

- [ ] **Step 6: Commit** this high-risk date-presentation migration separately.

---

### Task 5: Migrate reminder/focus/group/Kiro UI timestamps without touching serialization

**Files:**
- Modify: `components/reminders/*.tsx` presentation timestamps
- Modify: `components/focus/*.tsx` display timestamps/durations if calendar-clock text is rendered
- Modify: `components/group/*.tsx` GroupTask DDL display
- Modify: `components/drawers/CourseDetailDrawer.tsx` material/upload date display if human-readable
- Modify: `components/kiro/*.tsx` UI-owned chat/session/worklog timestamps only
- Preserve: `lib/reminders/reminderDomain.ts`
- Preserve: `lib/groupProject.ts::formatLocalDate`
- Preserve: `lib/ddl.ts`
- Preserve: Kiro/tool domain payload time values unless a UI component is rendering them

- [ ] **Step 1: Audit:**

```bash
rg -n 'date-fns|format\(|toLocale(Date|Time|String)|Intl\.DateTimeFormat|HH:mm|yyyy|M月' \
  components/reminders components/focus components/group components/drawers/CourseDetailDrawer.tsx components/kiro \
  --glob '*.tsx'
```

- [ ] **Step 2: Migrate visible Reminder timestamps** through the formatter. Do not change `triggerAt`, `firedAt`, relative-reminder reconciliation or missed-reminder policy logic.

- [ ] **Step 3: Migrate GroupTask DDL and material upload-date display** only. Keep `lib/groupProject.ts::formatLocalDate()` unchanged because it creates canonical local storage strings.

- [ ] **Step 4: Migrate Kiro UI-owned timestamps** such as session-history/worklog time labels. Do not reformat dates embedded inside assistant answers, tool source content or quoted user data.

- [ ] **Step 5: Run only the affected targeted tests**, likely among:

```bash
npx playwright test tests/e2e/kiro-history-ui.spec.ts tests/e2e/group-collaboration.spec.ts
npm run typecheck
```

Do not run unrelated Kiro suites.

- [ ] **Step 6: Commit** this final presentation migration.

---

### Task 6: Add end-to-end Date/Time preference behavior coverage

**Files:**
- Create: `tests/e2e/date-time-preference.spec.ts`
- Modify minimal component test ids only if needed for stable presentation assertions

- [ ] **Step 1: Test date format on a real display surface.** Open Settings -> `通用`, read the current Semester canonical `input[type="date"]` value, choose `DMY`, navigate to `学期与课表`, and assert the human-readable semester overview displays the same date in `DD/MM/YYYY`. Then choose ISO and assert `YYYY-MM-DD`.

Do not assert the native input visually changes order; assert its underlying value remains canonical.

- [ ] **Step 2: Test time format on a real display surface.** Choose `12h`, close Settings, open a timetable/agenda surface with a known demo schedule time and assert product-rendered time contains the locale-appropriate 12h representation. Choose `24h` and assert the same raw schedule renders in `HH:mm` form.

- [ ] **Step 3: Test domain invariance through persisted data.** Before changing date/time preferences, snapshot from localStorage:

```ts
assignments.map(({ id, ddl }) => ({ id, ddl }))
studyBlocks.map(({ id, date, startTime, endTime }) => ...)
reminders.map(({ id, triggerAt }) => ...)
```

After switching all date/time preferences and reloading, assert these canonical values are byte-for-byte unchanged.

- [ ] **Step 4: Test native settings inputs remain canonical:**
  - Semester date input `value` stays `YYYY-MM-DD`;
  - default DDL time input `value` stays `HH:mm` even under 12h display preference.

- [ ] **Step 5: Test system preference deterministically.** For hour-cycle resolution, unit tests are the source of truth because Playwright/OS 12/24 emulation is not portable. E2E only needs to prove the `system` option can be selected/persisted without corrupting data.

- [ ] **Step 6: Run only**:

```bash
npx vitest run tests/dateTimeFormat.test.ts tests/preferences.test.ts
npx playwright test tests/e2e/date-time-preference.spec.ts
npm run typecheck
```

- [ ] **Step 7: Commit** behavior coverage.

---

### Task 7: Presentation/domain boundary audit

**Files:**
- Verify: `components/**/*.tsx`
- Verify: `lib/semester.ts`
- Verify: `lib/ddl.ts`
- Verify: `lib/groupProject.ts`
- Verify: `lib/reminders/reminderDomain.ts`
- Verify: `store/useAppStore.ts`

- [ ] **Step 1: Audit remaining ad-hoc presentation formatters:**

```bash
rg -n 'toLocale(Date|Time|String)|Intl\.DateTimeFormat|format\([^\n]*["'\''](yyyy|MM|dd|HH|M月|d日)' \
  components app/page.tsx --glob '*.{ts,tsx}'
```

Move user-visible hits to the facade. Do not migrate calculations/parsers.

- [ ] **Step 2: Audit accidental UTC conversion near domain times:**

```bash
rg -n 'toISOString\(' components lib store --glob '*.{ts,tsx}'
```

Existing `toISOString()` may be legitimate for true epoch/metadata timestamps; classify each hit. There must be no new use converting local-wall-clock DDL/Reminder/StudyBlock/CourseSchedule values for display.

- [ ] **Step 3: Verify canonical helpers remain unchanged** for data semantics:
  - `lib/ddl.ts` local DDL combine/parse;
  - `lib/reminders/reminderDomain.ts` local trigger serialization;
  - `lib/groupProject.ts::formatLocalDate`;
  - store persistence/backup schemas.

- [ ] **Step 4: Manual smoke** all four explicit combinations most likely to expose bugs:
  - Chinese + ISO + 24h;
  - Chinese + DMY + 12h;
  - English + MDY + 12h;
  - English + ISO + 24h.

Check Settings, Overview, one task DDL, timetable, timeline StudyBlock, Reminder Center, group task and Kiro history timestamp.

- [ ] **Step 5: Do not run** full test/build unless targeted validation exposes a broader regression.

## P5 Completion Contract

P5 is complete when:
- Date/Time rows are visible and real;
- explicit date and 12/24h formats affect ClassFlow-rendered text globally;
- system options resolve through locale/device conventions;
- native date/time inputs remain canonical/native;
- persisted local-wall-clock business values do not change when display preferences change;
- UI components no longer hand-roll human-readable date/time formatting where the facade covers it;
- no timezone setting or timezone conversion semantics have been introduced.

## Deferred

- User-selectable timezone.
- Custom DatePicker/TimePicker matching display format exactly.
- Calendar system selection.
- First-day-of-week preference.
- Cloud/device timezone conflict policy (Account & Cloud Sync phase).
