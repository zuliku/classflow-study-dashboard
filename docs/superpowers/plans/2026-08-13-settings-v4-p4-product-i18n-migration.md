# Settings V4 P4 — Product i18n Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the bilingual migration started in P3 so all core ClassFlow workspaces and product-owned UI chrome render coherently in `zh-CN` and `en-US`, while preserving every piece of user/domain/AI content verbatim.

**Architecture:** Reuse the P3 typed dictionaries and `useI18n()`/pure translator interfaces. Migrate by vertical workspace slices so each commit is reviewable and the application remains usable throughout. Translation occurs at presentation boundaries only; stable ids/enums/domain values stay language-neutral. For pure helpers that generate UI labels, pass a `TranslateFn` or return semantic codes for the component to translate—never import React context into pure domain modules.

**Tech Stack:** Existing P3 i18n layer, React/TypeScript, Zustand, Vitest/Playwright. No new localization dependency.

## Global Constraints

- Requires P3 complete.
- Translate product-owned copy only.
- Never translate or mutate: course names/codes/teachers/classrooms, task titles/descriptions/tags, group/project/member names, material/file names, user profile text, Kiro user messages, Kiro assistant/model output, web-search snippets/citations, provider/model IDs, file contents, generated documents/images.
- Do not change command/store ids, route/tab ids, enum values, backup schema or serialized domain strings.
- When a product label contains user content, translate only the template, e.g. `为《{course}》新建任务` -> `New task for “{course}”`; the inserted value is untouched.
- Do not convert business logic into locale-specific string comparisons. Branch on ids/enums, then translate labels.
- Date/time formatting is P5. P4 may translate static words around dates/times but must not add new ad-hoc date formatting.
- Source audits may leave Chinese in comments, fixtures, `zh-CN` dictionaries and user/demo content. Product literals in runtime UI should move to dictionaries.
- Keep tasks small. Large files such as `app/page.tsx`, `AssignmentTable.tsx`, `MiniCalendar.tsx`, `TimetableGrid.tsx`, `TimelineWorkspace.tsx`, and Kiro workspace files must be read with `rg`/focused ranges rather than whole-file rereads.
- Do not run full E2E/build by default.

---

### Task 1: Translate Overview and dashboard chrome

**Files:**
- Modify: `app/page.tsx` for Overview-owned headings/actions/empty states/stat labels only
- Modify: `components/dashboard/TimetableQuickGlance.tsx`
- Modify: `components/dashboard/UpcomingDDL.tsx`
- Modify: `components/dashboard/StudyLoadChart.tsx`
- Modify: `components/dashboard/AssignmentTable.tsx` for shared table labels/status/action chrome
- Modify: `components/dashboard/MiniCalendar.tsx` for calendar chrome/static labels only
- Modify: i18n message dictionaries
- Create/Modify: `tests/e2e/i18n-workspaces.spec.ts`

- [ ] **Step 1: Add an English Overview smoke case first.** Switch to explicit English using the real Settings control from P3, close Settings, then assert representative product-owned labels are English: Overview header, first-run/getting-started actions or populated-dashboard section titles, task/status table headers. The demo course/task names must remain their original fixture text.

- [ ] **Step 2: Run only**:

```bash
npx playwright test tests/e2e/i18n-workspaces.spec.ts
```

Confirm the new Overview assertions fail.

- [ ] **Step 3: Audit runtime Chinese in the slice:**

```bash
rg -n '[\p{Han}]' app/page.tsx components/dashboard --glob '*.tsx'
```

Classify hits before editing: product copy -> dictionary; comments -> leave; fixture/user-data fallback or intentional data values -> leave/handle by semantics.

- [ ] **Step 4: Migrate Overview copy** through `useI18n()`. Translate headings, buttons, empty-state explanations, accessibility labels, chart legend labels that represent ClassFlow statuses, and toast/confirmation copy authored by the product.

- [ ] **Step 5: Preserve data labels.** If Recharts receives user/course names, pass them unchanged. Status series like `已完成 / 进行中 / 待完成` are product enum labels and should use translated labels; their numeric/color data stays unchanged.

- [ ] **Step 6: Re-run the focused E2E** and `npm run typecheck`.

- [ ] **Step 7: Commit** Overview/dashboard translation.

---

### Task 2: Translate Tasks, Assignment surfaces, reminders and focus chrome

**Files:**
- Modify: `components/assignment/AssignmentsWorkspace.tsx`
- Modify: `components/assignment/QuickAddCard.tsx`
- Modify: `components/assignment/AssignmentContextMenu.tsx`
- Modify: `components/assignment/AssignmentPeekPanel.tsx`
- Modify: `components/drawers/AssignmentDrawer.tsx`
- Modify: task-related portions of `components/dashboard/AssignmentTable.tsx` if still untranslated
- Modify: `components/reminders/*.tsx`
- Modify: `components/focus/*.tsx`
- Modify: `lib/assignmentActions.ts` only where product-authored display/toast/confirm strings are generated
- Modify: i18n dictionaries
- Modify: focused task/reminder tests if they assert product copy

- [ ] **Step 1: Extend `i18n-workspaces.spec.ts`** with an English Tasks smoke: workspace title/view controls, quick-add action, one context-menu action, one Assignment Drawer field/action and Reminder/Focus product chrome. Assert the selected assignment title itself remains unchanged.

- [ ] **Step 2: Run only the i18n workspace spec** and confirm failure.

- [ ] **Step 3: Audit with focused grep:**

```bash
rg -n '[\p{Han}]' components/assignment components/drawers/AssignmentDrawer.tsx components/reminders components/focus lib/assignmentActions.ts --glob '*.{ts,tsx}'
```

- [ ] **Step 4: Translate enum display labels, empty states, tooltips, buttons, toasts and confirmations.** Branch on stable values (`priority`, `status`, view id, reminder status) and call `t`; never compare against translated labels.

- [ ] **Step 5: For pure action factories**, pass `TranslateFn` from callers or return stable result codes that callers translate. Keep action semantics/delete/undo/stale checks exactly the same.

- [ ] **Step 6: Keep task title/description/tags/subtasks/note contents verbatim.** Kiro handoff prompts that include user data are not translated unless the surrounding product instruction is a UI-only label; do not alter AI behavior in this task.

- [ ] **Step 7: Run targeted behavior coverage:**

```bash
npx vitest run tests/assignmentActions.test.ts 2>/dev/null || true
npx playwright test tests/e2e/i18n-workspaces.spec.ts tests/e2e/task-defaults.spec.ts
npm run typecheck
```

If `tests/assignmentActions.test.ts` does not exist, omit that command rather than creating a meaningless test solely for naming symmetry. Do not use shell `|| true` in the final implementation run; this plan line means check existence first, then run if present.

- [ ] **Step 8: Commit** Tasks/Assignment/Reminder/Focus translation.

---

### Task 3: Translate Timetable, Timeline and calendar chrome

**Files:**
- Modify: `components/dashboard/TimetableGrid.tsx`
- Modify: `components/dashboard/MiniCalendar.tsx`
- Modify: `components/timeline/TimelineWorkspace.tsx`
- Modify: `components/timeline/TimelineKeyLane.tsx`
- Modify: `components/timeline/TimelineUnscheduledShelf.tsx`
- Modify: `components/timeline/FloatingTimelineDetail.tsx`
- Modify: timetable/timeline modal files under `components/modals/` as reported by the scoped audit
- Modify: i18n dictionaries
- Modify: focused timetable/timeline E2E selectors only where copy changes

- [ ] **Step 1: Add English smoke assertions** for Time/Timeline workspace title, week navigation, unscheduled shelf/empty state, event-type labels and full-timetable modal actions. Course names and study-block titles remain unchanged.

- [ ] **Step 2: Audit large files with line-focused grep** rather than full reads:

```bash
rg -n '[\p{Han}]' components/dashboard/TimetableGrid.tsx components/dashboard/MiniCalendar.tsx components/timeline components/modals --glob '*.tsx'
```

- [ ] **Step 3: Translate static weekday/month/action/type labels** through message keys where they are product-owned strings. Do **not** solve locale-specific date formatting here; if a date-fns format string is human-readable, leave it for P5 unless only a surrounding static label changes.

- [ ] **Step 4: Keep scheduling semantics untouched:** dayOfWeek remains 1–7, local `HH:mm` storage remains unchanged, drag/resize/selection behavior is not refactored.

- [ ] **Step 5: Run targeted tests:**

```bash
npx playwright test \
  tests/e2e/i18n-workspaces.spec.ts \
  tests/e2e/timetable-drag.spec.ts \
  tests/e2e/timeline-v2-visual.spec.ts
npm run typecheck
```

Do not update drag assertions unless accessible product labels genuinely changed.

- [ ] **Step 6: Commit** timetable/timeline/calendar translation.

---

### Task 4: Translate Courses, Group Collaboration, Analytics and remaining common modals/drawers

**Files:**
- Modify: `app/page.tsx` for courses/analytics workspace-owned copy not handled in Task 1
- Modify: `components/drawers/CourseDetailDrawer.tsx`
- Modify: `components/group/*.tsx`
- Modify: remaining course/import/add/conflict/file-preview modals in `components/modals/*.tsx`
- Modify: relevant dashboard analytics/card copy
- Modify: i18n dictionaries
- Modify: focused E2E if accessible names change

- [ ] **Step 1: Extend the English workspace smoke** to cover:
  - Courses: workspace title, add/import/material actions;
  - Analytics: product status/metric labels;
  - Group: workspace title, create/manage/task/member action chrome;
  - one Course Drawer and one representative modal.

Assert course/project/member/material names stay exactly as fixture/user content.

- [ ] **Step 2: Audit:**

```bash
rg -n '[\p{Han}]' app/page.tsx components/group components/drawers/CourseDetailDrawer.tsx components/modals --glob '*.tsx'
```

- [ ] **Step 3: Translate product copy** and semantic enum labels. Keep file type extensions, course codes and real metadata unchanged.

- [ ] **Step 4: Preserve import/parsing/data behavior.** Do not translate CSV/JSON field semantics, imported source content, or persisted schedule data. Error codes may map to translated product explanations, but raw import error details remain available.

- [ ] **Step 5: Run only relevant tests:**

```bash
npx playwright test \
  tests/e2e/i18n-workspaces.spec.ts \
  tests/e2e/group-collaboration.spec.ts \
  tests/e2e/drawer-content.spec.ts
npm run typecheck
```

- [ ] **Step 6: Commit** Courses/Analytics/Group/common overlays translation.

---

### Task 5: Translate main Kiro workspace chrome while preserving conversation and source content

**Files:**
- Modify as reported by audit: `components/kiro/*.tsx`
- Modify Kiro UI-only helpers under `lib/ai/ui/*` or adjacent presentation helpers if they return hardcoded product labels
- Modify Kiro error/status presentation mapping where stable codes exist
- Modify: i18n dictionaries
- Modify: targeted Kiro E2E selectors only where product chrome names change

**Strict boundary:**

```text
Translate:
- New chat / history / menus / composer placeholders
- attachment buttons / tooltips
- thinking/worklog/status chrome
- agent progress labels
- empty states / retry / stop / copy / regenerate-style product actions

Do not translate:
- user message body
- assistant/model message body
- Markdown/KaTeX content
- tool arguments/results that are source/domain content
- web snippets/citation titles
- file contents/names
- provider/model names
```

- [ ] **Step 1: Add English Kiro chrome smoke** to `i18n-workspaces.spec.ts`: switch to Kiro, assert history/new-chat/composer/menu product labels are English, then inject/use a known fixture user/assistant message and assert message text itself is unchanged.

- [ ] **Step 2: Audit with grep:**

```bash
rg -n '[\p{Han}]' components/kiro lib/ai/ui --glob '*.{ts,tsx}'
```

Use focused ranges in the larger Kiro files.

- [ ] **Step 3: Move product-owned Kiro chrome to i18n keys.** Keep network/API/domain responses out of dictionaries.

- [ ] **Step 4: For status maps**, prefer stable status/code -> message-key mappings. Never branch on already translated strings.

- [ ] **Step 5: Preserve Kiro history, formula rendering, agent controls and transaction behavior.** This task is presentation-only.

- [ ] **Step 6: Run focused tests:**

```bash
npx playwright test \
  tests/e2e/i18n-workspaces.spec.ts \
  tests/e2e/kiro-history-ui.spec.ts \
  tests/e2e/kiro-interactions.spec.ts \
  tests/e2e/kiro-typography.spec.ts
npm run typecheck
```

If a Kiro test is extremely long and none of its asserted chrome changed, omit it and document why in the final report; do not default to all Kiro E2E.

- [ ] **Step 7: Commit** Kiro chrome translation separately.

---

### Task 6: Product-wide i18n audit and final bilingual smoke

**Files:**
- Verify: `app/page.tsx`
- Verify: `components/**/*.tsx`
- Verify: UI-facing helpers under `lib/**/*.ts`
- Verify: `lib/i18n/messages/*`
- Verify: `tests/e2e/i18n-workspaces.spec.ts`

- [ ] **Step 1: Run a product-code Chinese-literal audit:**

```bash
rg -n '[\p{Han}]' app/page.tsx components lib \
  --glob '*.{ts,tsx}' \
  --glob '!lib/i18n/messages/zh-CN.ts' \
  --glob '!lib/dev/**'
```

Review results, do not blindly replace them. Allowed categories:
- developer comments;
- test/demo/user fixture content;
- bilingual search aliases;
- intentionally untranslated proper nouns/source content;
- domain parsing literals that are not UI.

Every remaining runtime product-owned display string must move to the dictionary.

- [ ] **Step 2: Run a reverse audit for suspicious English UI literals** in components that bypass dictionaries. Focus on common action words (`Settings`, `Delete`, `Save`, `Cancel`, `Search`, `New`, `Retry`) and move product copy to keys while leaving technical/provider terms intact.

- [ ] **Step 3: Run dictionary/type coverage:**

```bash
npx vitest run tests/i18n.test.ts
npm run typecheck
```

- [ ] **Step 4: Run only the bilingual smoke and a compact representative regression set:**

```bash
npx playwright test \
  tests/e2e/language-preference.spec.ts \
  tests/e2e/i18n-workspaces.spec.ts \
  tests/e2e/settings.spec.ts \
  tests/e2e/responsive.spec.ts
```

- [ ] **Step 5: Manual bilingual walkthrough** at desktop and mobile widths. In English, visit every top-level workspace and open Settings, Command Center, one task drawer, one course drawer, one modal, Reminder Center and Kiro. Confirm no obvious Chinese product chrome remains. Switch back to Chinese and ensure layout still fits.

- [ ] **Step 6: Do not run** full suite/build unless a focused failure justifies it.

## P4 Completion Contract

P4 is complete when:
- every core workspace supports coherent Simplified Chinese and English product chrome;
- changing language does not modify user/domain/AI content;
- no business logic depends on translated strings;
- no route changes were introduced;
- typed dictionary coverage remains complete;
- remaining Chinese source literals are classified non-product-copy exceptions.

## Deferred

- Traditional Chinese.
- Locale-specific URL/SEO routing.
- ICU plural/gender framework unless future copy requires it.
- Translation of external/provider/model/source content.
- Date/time formatting behavior (P5).
