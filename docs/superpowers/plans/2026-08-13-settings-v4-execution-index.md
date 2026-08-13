# Settings V4 Implementation Execution Index

> **For agentic workers:** This file is the required entry point for the Settings V4 implementation plans. Execute the phase plans in order. Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Do not implement multiple phases in one unreviewed batch.

**Approved design:** `docs/superpowers/specs/2026-08-13-settings-v4-productization-design.md`

## Execution Order

1. `2026-08-13-settings-v4-p1-ia-preferences.md`
2. `2026-08-13-settings-v4-p2-theme-foundation.md`
3. `2026-08-13-settings-v4-p3-i18n-foundation-shell.md`
4. `2026-08-13-settings-v4-p4-product-i18n-migration.md`
5. `2026-08-13-settings-v4-p5-date-time-presentation.md`

Do not start the next phase until the current phase's Completion Contract and targeted verification pass.

## Dependency Graph

```text
P1 IA + preference schema
 │
 ├──> P2 Theme runtime
 │
 └──> P3 i18n runtime + shell
           │
           └──> P4 product i18n migration
                    │
                    └──> P5 date/time presentation
```

P5 intentionally runs after P4 so its formatter can rely on the stable effective locale and migrate final human-readable date/time surfaces without competing with broad copy migration.

## Mandatory Self-Review Corrections

These rules supersede any ambiguous example command inside an individual phase plan.

### 1. Never swallow test failures

Do not use `|| true`, redirected failure suppression, `test.skip`, weakened assertions, or equivalent mechanisms.

Where P4 mentions an optional `tests/assignmentActions.test.ts`, first check whether it exists. If it exists, run it normally and require green; if it does not exist, omit that test command and continue with the listed focused E2E/typecheck. Example:

```bash
if [ -f tests/assignmentActions.test.ts ]; then
  npx vitest run tests/assignmentActions.test.ts
fi
```

If the test exists and fails, the phase is blocked until the failure is understood/fixed.

### 2. Audit all callers before changing command/i18n function signatures

Before P3 changes any signatures for `getCommands`, `getContextCommands`, `getAssignmentContextCommands`, `buildPalette`, `GROUP_LABELS`/group-label accessors, run:

```bash
rg -n 'getCommands|getContextCommands|getAssignmentContextCommands|buildPalette|GROUP_LABELS' . \
  --glob '*.{ts,tsx}' \
  --glob '!node_modules/**' \
  --glob '!.next/**'
```

Update every real caller in the same task. Do not rely on only the files named in the plan. `npm run typecheck` is the final guard, not the discovery mechanism.

### 3. Use simple audits for date/time presentation

For P5, prefer several readable searches over one fragile mega-regex. Run, as needed:

```bash
rg -n 'toLocaleDateString|toLocaleTimeString|toLocaleString|Intl\.DateTimeFormat' app components lib --glob '*.{ts,tsx}'
rg -n 'date-fns|\bformat\(' app components lib --glob '*.{ts,tsx}'
rg -n 'toISOString\(' components lib store --glob '*.{ts,tsx}'
```

Classify every hit before editing. Presentation formatting migrates to the V4 formatter; domain serialization/parsing stays untouched.

### 4. Read large files narrowly

For large files (`app/page.tsx`, `AssignmentTable.tsx`, `MiniCalendar.tsx`, `TimetableGrid.tsx`, `TimelineWorkspace.tsx`, large Kiro files), use `rg` plus focused line ranges. Do not repeatedly load entire files unless necessary.

### 5. Targeted validation only

Default verification is the exact unit/E2E files named by the current task plus `npm run typecheck` where specified. Do not default to:

```text
npm test
npm run test:e2e
npm run build
```

Escalate only when a focused failure indicates a broader regression.

### 6. Small validation fixes are allowed; scope expansion is not

If a targeted test exposes a stale selector/copy assertion, small focus/Escape race, obvious pre-existing UI regression, or small type/test setup issue, fix it and report under `Fixed During Validation`.

If the fix requires store schema migration beyond the approved additive preferences, core business algorithm changes, broad E2E rewrites, or cross-module architecture changes, stop and report it under `Remaining` instead of silently expanding scope.

## Phase Gates

### P1 Gate — Settings structure is truthful

- V4 visible IA is in place.
- `account-sync` exists but is hidden and has no fake page.
- Focus Settings page is removed; Focus runtime remains.
- Task and Notifications are separate.
- Global modified workspace/dots are gone; row-level resets remain.
- Theme/Language/Date/Time values are safely persisted but their controls remain hidden until their runtime phases.

### P2 Gate — Theme is real

- Theme setting is visible only after runtime is functional.
- System/light/dark work immediately and persist.
- No first-paint light flash.
- Light palette remains materially unchanged.
- Dark mode covers core UI with usable contrast.
- Course/data colors are not rewritten.

### P3 Gate — Language foundation is real

- System/Chinese/English setting is visible and functional.
- Settings, navigation, shell and Command Center are bilingual.
- `<html lang>` tracks effective locale.
- Dictionaries are type-complete.
- User content remains unchanged.

### P4 Gate — Product UI is bilingual

- Every top-level workspace has coherent Chinese/English product chrome.
- Remaining runtime Chinese literals are classified exceptions, not accidental product copy.
- Kiro/user/source content is never translated.
- No logic branches on translated strings.

### P5 Gate — Date/time is presentation-only

- Date/time format settings are visible and functional.
- Explicit display formats work across representative surfaces.
- Native date/time input values remain canonical.
- Assignment DDL, StudyBlock times and Reminder trigger times remain byte-for-byte unchanged when presentation settings change.
- No timezone semantics are introduced.

## Agent Final Report for Each Phase

Use the repository convention:

```text
Changed
Preserved
Fixed During Validation
Verified
Remaining
```

Include the focused commands actually run. Do not claim full-suite/build coverage if it was intentionally skipped.
