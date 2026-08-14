# Reminder Center Floating Panel + Motion Design

Date: 2026-08-14
Status: Approved design, pending implementation plan
Scope: Reminder Center presentation and transition behavior only

## 1. Goal

Convert the current full-height Reminder Center into a bounded, content-responsive floating panel on both desktop and mobile, and remove the current hard-cut open/close behavior.

The result should feel like a lightweight global Reminder Center attached to the sidebar action, not a full-height drawer or full-screen sheet.

This change must preserve Reminder domain semantics, reminder delivery/runtime behavior, CRUD behavior, unread/read behavior, navigation targets, and Settings V4 work.

## 2. Current Problems

Current `components/reminders/ReminderCenter.tsx` has two structural causes for the observed UX:

1. The panel uses `fixed inset-y-0`, so desktop naturally fills the entire viewport height.
2. The component returns `null` immediately when `isOpen` becomes false, so CSS transitions cannot render an exit state.

The repository already has a shared overlay lifecycle abstraction in `OverlayLayer`, backed by `usePresence`, and shared motion tokens in `app/globals.css`. The Reminder Center should reuse those foundations rather than invent another animation lifecycle.

## 3. Chosen Interaction Model

### 3.1 Desktop

Use a floating panel positioned immediately to the right of the desktop sidebar.

Target behavior:

- Width: approximately 400px.
- Horizontal origin remains aligned with the existing sidebar offsets:
  - medium desktop / icon rail: around `left-16`
  - full desktop sidebar: around `left-56`
- Vertical position: visually centered within the available viewport rather than pinned from top to bottom.
- Height: content-responsive.
- Minimum height: approximately 420px, subject to final fit with the existing header and empty states.
- Maximum height: `min(720px, calc(100dvh - 32px))` or equivalent bounded implementation.
- Once content exceeds the max height, only the scrollable Reminder Center content region scrolls.
- Header remains fixed inside the panel.
- Inline composer remains fixed above the scrollable list while open.

The empty state should therefore render as a compact medium-sized panel instead of an almost empty full-height rail.

### 3.2 Mobile

Mobile should use the same floating-panel product model rather than retain a full-screen sheet.

Target behavior:

- 12px horizontal viewport inset.
- 12px vertical viewport inset.
- Width: `calc(100vw - 24px)`.
- Height: content-responsive.
- Minimum height: approximately 360px.
- Maximum height: `calc(100dvh - 24px)`.
- Rounded panel corners: approximately 18–20px, consistent with the existing ClassFlow visual language.
- When content exceeds the max height, only the list region scrolls.
- Header and composer stay visible.

The implementation must not create horizontal viewport overflow at narrow widths.

## 4. Open / Close Motion

The existing immediate `if (!isOpen) return null` lifecycle must be replaced by a presence-aware lifecycle so the panel stays mounted during exit.

Preferred foundation: reuse `OverlayLayer` or the underlying existing presence infrastructure. Do not create a second bespoke overlay stack or global animation state.

### Desktop motion

Open:

- opacity: 0 → 1
- translateX: approximately -6px → 0
- scale: approximately 0.992 → 1
- duration: about 200–220ms
- easing: existing emphasized/standard ClassFlow motion token

Close:

- opacity: 1 → 0
- translateX: 0 → approximately -4px
- scale: 1 → approximately 0.994
- duration: about 150–170ms

The exit should be slightly faster than the entrance.

### Mobile motion

Open:

- opacity: 0 → 1
- translateY: approximately 6px → 0
- scale: approximately 0.985 → 1
- duration: about 200ms

Close:

- opacity: 1 → 0
- translateY: 0 → approximately 4px
- scale: 1 → approximately 0.99
- duration: about 150ms

The mobile motion should feel like a lightweight local floating surface, not a bottom sheet.

## 5. Overlay / Dismissal Semantics

Preserve the existing Reminder Center dismissal behavior:

- Escape closes the Reminder Center.
- Pointer press outside the panel closes it.
- Header close button closes it.
- Reminder navigation may close it when navigating to the corresponding entity/workspace.

Prefer consolidating outside-click and Escape handling through the existing `OverlayLayer` semantics when feasible, rather than keeping duplicate document/window listeners inside `ReminderCenter`.

Do not change unread/read semantics:

- Opening the Reminder Center continues to call `markAllFiredRemindersRead` as today.
- Closing the panel must not mutate Reminder domain state.

## 6. Composer Motion

The current inline composer is conditionally mounted with `{editor && (...)}`, which hard-cuts open and closed.

Add a bounded enter/exit transition for the composer using existing project primitives where possible, preferably `ExitCollapse` / existing presence behavior.

Target transition:

- height / grid-row expansion-collapse
- opacity transition
- very small vertical offset if useful
- duration approximately the existing `--motion-base`
- no exaggerated scale or spring effect

The composer transition must not cause the entire floating panel to jump off-screen. The outer panel may grow/shrink naturally within its max-height boundary; once max-height is reached, the list region should give up space and scroll rather than overflow the viewport.

## 7. Internal Layout Contract

The Reminder Center should keep three vertical regions:

1. Header — non-scrolling, `shrink-0`.
2. Composer — conditionally present, non-scrolling, animated.
3. Reminder groups — `flex-1 min-h-0 overflow-y-auto`.

This contract is important for bounded height behavior.

Existing Upcoming and History cards, reminder row enter/exit behavior, action buttons, empty states, and list grouping should remain visually and behaviorally unchanged unless a tiny spacing adjustment is required for the new bounded shell.

## 8. Motion Preference / Reduced Motion

The implementation must respect the project’s existing motion preference system.

Do not add a reminder-specific Reduced Motion setting.

When effective motion is reduced:

- panel enter/exit should become effectively immediate via existing global motion rules / tokens;
- composer transition should likewise reduce to near-zero duration;
- layout and dismissal behavior must remain identical.

## 9. Architecture Boundaries

Primary expected file:

- `components/reminders/ReminderCenter.tsx`

Potentially reused / minimally adjusted infrastructure:

- `components/ui/OverlayLayer.tsx`
- `components/ui/ExitCollapse.tsx`
- `app/globals.css`

Do not modify unless required:

- `components/reminders/ReminderRuntime.tsx`
- `components/reminders/ReminderViewport.tsx`
- reminder domain/store semantics
- reminder delivery policy
- Kiro reminder tools
- Settings V4 implementation

Avoid adding a new generic panel primitive unless the existing OverlayLayer composition proves genuinely insufficient. YAGNI: this task should remain a focused Reminder Center shell refactor.

## 10. Accessibility

The Reminder Center remains a dialog-like global action surface.

Implementation should preserve or improve:

- accessible close button label;
- Escape dismissal;
- outside-pointer dismissal;
- focus restoration through existing overlay infrastructure where reused;
- no interaction with the exiting panel once `open` is false;
- no hidden-but-interactive exiting content.

If `OverlayLayer` is adopted directly, use `role="dialog"` and an appropriate accessible label/title context for the Reminder Center panel.

## 11. Verification Scope

Prefer focused verification only.

At minimum validate:

- desktop opening renders a bounded floating panel rather than `inset-y-0` full height;
- mobile opening keeps 12px-ish viewport margins and no horizontal overflow;
- empty Reminder Center remains compact within min/max bounds;
- large reminder lists hit max-height and scroll only in the list region;
- open animation is visible under full/system motion;
- close animation renders before unmount;
- Reduced Motion removes perceptible transition without changing behavior;
- Escape, outside click, and header close all still work;
- opening still marks fired unread reminders read;
- composer enter and exit animate without layout overflow;
- reminder CRUD and navigation behavior remain intact.

Do not default to the full repository test suite or full build for this UI-only task unless a focused failure requires broader diagnosis.

## 12. Non-Goals

This task does not:

- redesign Reminder domain models;
- change Reminder timing or delivery policies;
- redesign Reminder cards or list information architecture;
- change Sidebar navigation semantics;
- create new Reminder settings;
- add cloud/account behavior;
- modify Settings V4 work;
- convert Reminder Center into a generic reusable drawer/modal framework.

## 13. Success Criteria

The task is complete when:

- desktop and mobile both use a bounded, content-responsive floating Reminder Center;
- reasonable min/max height limits prevent both tiny awkward panels and full-height takeover;
- overflowing reminder content scrolls internally;
- opening and closing are no longer hard cuts;
- the composer also has smooth bounded enter/exit motion;
- existing Reminder behavior and domain semantics are preserved;
- existing ClassFlow motion/reduced-motion infrastructure is reused instead of duplicated.
