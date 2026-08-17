# Reminder Center Floating Panel + Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Reminder Center from a full-height hard-cut panel into a bounded content-responsive floating panel on desktop and mobile, with presence-aware open/close motion and animated composer expansion/collapse.

**Architecture:** Reuse the existing `OverlayLayer`/`usePresence` lifecycle so closing stays mounted long enough to animate, and keep `ReminderCenter` as the feature owner rather than introducing a new generic panel primitive. Preserve the existing three-region layout contract: fixed header, animated non-scrolling composer, scrollable reminder groups.

**Tech Stack:** Next.js/React, TypeScript, Tailwind CSS, Zustand, existing `OverlayLayer`, `usePresence`, ClassFlow motion tokens, Playwright/Vitest.

## Global Constraints

- Follow `AGENTS.md`; read large files with `rg`/targeted ranges instead of repeatedly loading whole files.
- Scope is Reminder Center presentation/motion only. Do not change Reminder domain models, delivery policies, read/unread semantics, Kiro reminder tools, or Settings V4.
- Desktop and mobile both become bounded floating panels.
- Desktop target: ~400px width; content-responsive height; ~420px minimum; maximum `min(720px, calc(100dvh - 32px))` or equivalent.
- Mobile target: 12px viewport inset on all sides; content-responsive height; ~360px minimum; maximum `calc(100dvh - 24px)`.
- Header and composer stay fixed; only reminder groups scroll once max height is reached.
- Reuse existing motion infrastructure; no new reminder-specific motion preference.
- Reduced Motion must become effectively immediate through existing infrastructure.
- Preserve Escape close, outside-pointer close, header close, focus restoration, reminder navigation, CRUD, and `markAllFiredRemindersRead` behavior.
- Do not default to full `npm test`, full E2E, or build. Use focused validation unless failures require expansion.
- Never use `test.skip`, `describe.skip`, `test.only`, `@ts-ignore`, weakened assertions, or `|| true` to hide failures.

---

### Task 1: Add focused Reminder Center shell regression coverage

**Files:**
- Create or modify: the most appropriate existing Reminder Center Playwright spec if one exists; otherwise create `tests/e2e/reminder-center-floating.spec.ts`
- Read/reuse: `tests/e2e/demoFixtures.ts` when demo data is needed

**Interfaces:**
- Consumes: sidebar/global Reminder action and `data-testid="reminder-center"`
- Produces: regression coverage for bounded geometry, presence-aware close, mobile margins, and composer lifecycle

- [ ] **Step 1: Locate current Reminder Center coverage before creating a new spec**

Run:

```bash
rg -n "reminder-center|提醒中心|新建提醒|关闭提醒中心" tests components
```

If focused coverage already exists, extend it instead of duplicating the same flow.

- [ ] **Step 2: Add a desktop geometry test that fails on the current full-height shell**

At a desktop viewport, open Reminder Center through the visible Reminder global action and assert:

```ts
const panel = page.getByTestId("reminder-center");
const box = await panel.boundingBox();
expect(box).not.toBeNull();
expect(box!.height).toBeLessThan(page.viewportSize()!.height - 20);
expect(box!.width).toBeGreaterThanOrEqual(360);
expect(box!.width).toBeLessThanOrEqual(430);
```

Also assert the panel does not begin at `y = 0` and does not reach the viewport bottom.

- [ ] **Step 3: Add a mobile geometry test that fails on the current full-screen sheet**

Use a narrow viewport (for example 390x844), open Reminder Center, then assert approximately 12px margins with tolerance rather than exact pixels:

```ts
expect(box!.x).toBeGreaterThanOrEqual(8);
expect(box!.y).toBeGreaterThanOrEqual(8);
expect(viewport.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(8);
expect(viewport.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(8);
```

Also assert `document.documentElement.scrollWidth <= viewport.width`.

- [ ] **Step 4: Add an exit-presence test**

Open the panel, click the header close button, immediately assert the panel still exists in a non-interactive/exiting state, then assert it unmounts after the configured exit duration.

Prefer a stable state hook such as `data-state="exiting"` on the panel rather than testing raw opacity timing.

- [ ] **Step 5: Add composer lifecycle coverage**

Open Reminder Center, click `新建提醒`, assert a stable composer test id/state exists, then cancel/close the editor and verify an exiting state is observable before unmount/collapse completes.

Do not use long fixed sleeps. Use state/visibility assertions with Playwright polling.

- [ ] **Step 6: Run only this focused spec and confirm the new geometry/presence assertions fail before implementation**

```bash
npx playwright test tests/e2e/reminder-center-floating.spec.ts
```

If extending an existing spec, run that exact file instead.

---

### Task 2: Replace immediate mount/unmount with OverlayLayer presence and bounded floating geometry

**Files:**
- Modify: `components/reminders/ReminderCenter.tsx`
- Reuse: `components/ui/OverlayLayer.tsx`
- Read only unless a real defect is found: `lib/usePresence.ts`

**Interfaces:**
- Consumes: `useReminderCenterStore().isOpen`, `close`, existing `OverlayLayer` render state `{ visible }`
- Produces: presence-aware `ReminderCenter` panel with stable `data-state="entering|open|exiting"` or equivalent observable state

- [ ] **Step 1: Remove the feature-local immediate-unmount lifecycle**

Remove the early:

```ts
if (!isOpen) return null;
```

and replace the outer shell with `OverlayLayer` so the panel remains mounted through exit.

Use a unique overlay id such as:

```tsx
overlayId="reminder-center"
```

Use the existing stack level around the current `z-[70]` semantic. Preserve topmost Escape behavior and focus restoration through `OverlayLayer`.

- [ ] **Step 2: Consolidate outside-click and Escape handling**

Remove the manual `window.addEventListener("keydown", ...)` and `document.addEventListener("pointerdown", ...)` listeners if `OverlayLayer` fully replaces them.

Configure:

```tsx
closeOnBackdrop
onOpenChange={(next) => {
  if (!next) close();
}}
```

The overlay backdrop should remain visually transparent unless a minimal existing surface effect is explicitly desired by the approved spec; this is a local floating center, not a modal takeover.

- [ ] **Step 3: Implement desktop bounded placement**

Preserve sidebar-relative horizontal offsets while replacing `inset-y-0` with vertical centering/bounds. A valid implementation may use the overlay as the positioning container and the panel classes equivalent to:

```text
md:left-16 xl:left-56
md:w-[400px]
md:min-h-[420px]
md:max-h-[min(720px,calc(100dvh-32px))]
```

Use a layout that centers the panel vertically within the viewport and keeps it safely inside top/bottom margins.

Do not hardcode 100vh; use `dvh`-safe sizing where viewport height is involved.

- [ ] **Step 4: Implement mobile bounded placement**

At `< md`, panel target geometry is equivalent to:

```text
left-3 right-3 top-3 bottom-auto
w-auto
min-h-[360px]
max-h-[calc(100dvh-24px)]
rounded-[18px-20px]
```

Vertically center or otherwise place within the 12px top/bottom viewport inset while keeping content-responsive height. Do not revert to a full-screen sheet.

- [ ] **Step 5: Preserve internal three-region layout**

The final panel remains:

```text
flex flex-col overflow-hidden
Header: shrink-0
Composer: shrink-0 / animated
Groups: flex-1 min-h-0 overflow-y-auto
```

The list, not the entire browser page, must scroll after the max-height is reached.

- [ ] **Step 6: Add panel motion using existing motion tokens**

Desktop visible state should approximate:

```text
opacity 0 -> 1
translateX(-6px) -> 0
scale(.992) -> 1
200-220ms
```

Desktop exit should approximate:

```text
opacity 1 -> 0
translateX(0) -> -4px
scale(1) -> .994
150-170ms
```

Mobile visible state should approximate:

```text
opacity 0 -> 1
translateY(6px) -> 0
scale(.985) -> 1
~200ms
```

Mobile exit should approximate:

```text
opacity 1 -> 0
translateY(0) -> 4px
scale(1) -> .99
~150ms
```

Use existing CSS variable easing/timing conventions and responsive Tailwind classes. Avoid spring libraries or new dependencies.

Expose a stable test state on the panel, for example:

```tsx
data-state={isOpen ? (visible ? "open" : "entering") : "exiting"}
```

When `open` is false during presence exit, ensure the panel cannot receive pointer input.

- [ ] **Step 7: Preserve open side effects exactly**

The existing effect:

```ts
if (!isOpen) return;
useAppStore.getState().markAllFiredRemindersRead(formatLocalDateTime(new Date()));
```

must continue to fire on opening, not on exit presence.

- [ ] **Step 8: Run the focused Reminder Center spec**

```bash
npx playwright test tests/e2e/reminder-center-floating.spec.ts
```

(or the existing file you extended).

Fix only issues directly exposed by this shell change.

---

### Task 3: Add presence-aware composer expansion/collapse without changing CRUD semantics

**Files:**
- Modify: `components/reminders/ReminderCenter.tsx`
- Reuse: `lib/usePresence.ts`
- Reuse as appropriate: `components/ui/ExitCollapse.tsx`

**Interfaces:**
- Consumes: existing `editor`, `draft`, `startCreate`, `startEdit`, `cancelEditor`, `saveDraft`
- Produces: composer presence state that retains the last editor contents through exit long enough to animate

- [ ] **Step 1: Introduce composer presence**

Use the existing `usePresence(Boolean(editor), duration)` or an equivalent existing project primitive.

Because `editor` becomes `null` immediately on cancel/save, retain the last non-null editor mode while exit is mounted. A small local snapshot is acceptable, for example conceptually:

```ts
const composerPresence = usePresence(editor !== null, 180);
const lastEditorRef = useRef<NonNullable<typeof editor> | null>(null);
if (editor) lastEditorRef.current = editor;
const renderedEditor = editor ?? lastEditorRef.current;
```

Do not retain or clone Reminder domain data outside what is already needed to render the closing composer.

- [ ] **Step 2: Wrap the composer in a bounded collapse/fade shell**

Render while `composerPresence.mounted && renderedEditor` and transition grid rows/height plus opacity. Reuse `ExitCollapse` only if it cleanly supports both the required enter and exit states; `ExitCollapse` is exit-only today, so do not misuse it for entry.

A direct local wrapper is acceptable:

```text
present: grid-rows-[1fr] opacity-100 translate-y-0
hidden/exiting: grid-rows-[0fr] opacity-0 -translate-y-1
```

Inner content must use `min-h-0 overflow-hidden`.

- [ ] **Step 3: Add stable composer test state**

Use a `data-testid` such as `reminder-composer` and `data-state="entering|open|exiting"` so tests do not need to infer animation from pixels.

During exit, hidden composer controls must not remain focusable; use `inert` on the inner wrapper if needed, following the existing `ExitCollapse` pattern.

- [ ] **Step 4: Preserve existing composer CRUD behavior**

Do not change:

- validation text or rules;
- future-time requirement;
- standalone create/update semantics;
- scheduled-only edit semantics;
- `addReminder`, `updateReminder`, or `deleteReminder` calls.

Only presentation lifecycle changes.

- [ ] **Step 5: Verify max-height interaction**

With the composer open, the panel must remain within its max height. The list region should contract and become scrollable rather than pushing the panel beyond viewport bounds.

- [ ] **Step 6: Run focused tests again**

```bash
npx playwright test tests/e2e/reminder-center-floating.spec.ts
```

---

### Task 4: Focused regression and responsive smoke validation

**Files:**
- Modify tests only if assertions reveal a genuine current-contract mismatch caused by this task.

**Interfaces:**
- Produces: final confidence that presentation changed while Reminder behavior remained stable

- [ ] **Step 1: Run TypeScript check**

```bash
npm run typecheck
```

- [ ] **Step 2: Run the focused Reminder Center E2E file**

```bash
npx playwright test tests/e2e/reminder-center-floating.spec.ts
```

If an existing Reminder spec was extended, run that exact file instead.

- [ ] **Step 3: Run any existing reminder-focused unit/view tests discovered by `rg`**

Use:

```bash
rg -n "ReminderCenter|reminderCenter|markAllFiredRemindersRead|reminderCenterView" tests --glob '*.{test,spec}.{ts,tsx}'
```

Run only the directly relevant files returned.

- [ ] **Step 4: Manual desktop smoke**

Verify at a normal desktop viewport:

- panel has top and bottom air instead of spanning the full viewport;
- empty center looks intentionally compact;
- opening/closing animates smoothly;
- outside click, Escape, and X close it;
- reopening after close works without stale composer state;
- long lists scroll internally;
- header and composer remain visible while the list scrolls.

- [ ] **Step 5: Manual mobile smoke**

Verify around 390px width:

- ~12px margins on all sides;
- no horizontal overflow;
- no full-screen sheet behavior;
- mobile open/close motion uses the subtle vertical origin;
- composer does not push the panel beyond viewport bounds.

- [ ] **Step 6: Reduced Motion smoke**

Set the existing effective motion preference to reduced and verify panel/composer transitions become effectively immediate without changing dismissal/layout behavior.

- [ ] **Step 7: Commit**

Prefer one focused implementation commit unless tests require a separate tiny follow-up:

```bash
git add components/reminders/ReminderCenter.tsx tests/e2e/reminder-center-floating.spec.ts
git commit -m "refactor(reminders): float reminder center with presence motion"
```

Do not include unrelated Settings/Kiro/DOCX changes.

## Completion Report

Use the project report format:

**Changed**
- bounded desktop/mobile floating geometry
- presence-aware panel open/close
- composer enter/exit lifecycle
- focused test coverage

**Preserved**
- Reminder runtime/delivery
- CRUD/validation
- unread/read semantics
- navigation targets
- Kiro reminder tools

**Fixed During Validation**
- list only small directly exposed issues; otherwise `None`

**Verified**
- exact commands actually run and their results

**Remaining**
- `None` if complete, otherwise concrete unresolved items

**Commit**
- SHA + message
