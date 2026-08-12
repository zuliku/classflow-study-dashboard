# ClassFlow Motion and Kiro UX Foundation — Design Spec

Date: 2026-08-12
Status: Approved in conversation; pending written-spec review

## 1. Goal

Build the first coherent interaction-motion pass for ClassFlow without changing its warm neutral visual direction. The round focuses on two connected outcomes:

1. make motion preferences and overlay behavior reliable across CSS and JavaScript;
2. make Kiro feel like a legible, responsive agent workspace through immediate submission feedback, stable progress states, visible conversation switching, and restrained panel transitions.

The work also fixes two confirmed interaction bugs and updates only the tests made stale or brittle by this scope.

## 2. Product Principles

- Preserve ClassFlow's existing colors, typography, radii, spacing, and information density.
- Motion explains state, hierarchy, and continuity. It must not decorate every state change.
- The interface must remain understandable without motion. Text, icons, focus, and semantic state remain the source of truth.
- Kiro stays a ClassFlow workspace rather than adopting an external product's brand styling.
- Agent progress must be factual. Do not expose hidden reasoning, raw tool arguments, internal tool names, or invented future steps.
- Existing business semantics take priority over presentation. Animation must not reorder persistence, tool execution, context snapshots, undo, or cleanup.
- Prefer small shared primitives over scattered component-specific timers and media-query checks.

## 3. Scope

### 3.1 Motion foundation

- Normalize motion durations and easings around the current CSS token system.
- Introduce one effective reduced-motion source for React/JavaScript behavior.
- Apply the persisted application preference before React hydration where practical.
- Make overlay presence responsive to the effective motion preference.
- Disable or shorten JavaScript-owned smooth scrolling and chart animation under effective reduced motion.

### 3.2 Kiro interaction polish

- Immediate send acknowledgement and duplicate-submit protection.
- Stable, visible agent phase communication.
- One-time structural entry motion for messages, factual result cards, and final-answer onset.
- Visible and non-destructive conversation-switch feedback.
- Complete presence for Sidecar, Thread Rail, and related mobile panels where they currently mount or swap instantly.
- Clear context-snapshot messaging while a turn is in flight.

### 3.3 Focused defect and test maintenance

- Fix the reduced-motion overlay click-blocking defect.
- Fix Settings intercepting `Ctrl/Cmd+F` while closed.
- Update stale Kiro test IDs and copy in tests touched by this round.
- Replace fixed animation sleeps only in directly affected tests.

## 4. Explicit Non-goals

- No new animation dependency.
- No new color palette, gradients, glassmorphism, or broad visual redesign.
- No replacement of the AI SDK streaming protocol.
- No change to Kiro tool permissions, mutation safety, Action Card provenance, or hidden-reasoning policy.
- No rewrite of message virtualization/caching, Markdown streaming, or the conversation height reconciler.
- No global rebuild of every modal, drawer, list, chart, reminder, or page.
- No full repository E2E cleanup or default full test/build run.
- No conversation branching, persistent raw worklogs, or new Kiro side panel for evidence.
- No broad focus-trap, background-inert, or scroll-lock project unless a narrow fix is required to keep a touched overlay correct.

## 5. Current Architecture and Constraints

### 5.1 Application shell

`app/page.tsx` is a client-side workspace shell driven by Zustand `activeTab`. Workspace navigation is conditional rendering, not Next.js route navigation. `PageTransition` currently remounts by tab and applies an opacity-only entry animation.

The shared workspace header and navigation should remain visually stable. This round does not add directional page slides because they would imply a hierarchy that the flat workspace navigation does not have and can introduce transient overflow.

### 5.2 Existing motion system

`app/globals.css` already defines motion durations, easings, page/list utilities, press feedback, and both OS-level and application-level reduced-motion CSS fallbacks. The gap is not the absence of motion; it is inconsistent ownership:

- some behavior is CSS-owned;
- some components inspect only `html[data-motion]`;
- some inspect only `prefers-reduced-motion`;
- some JavaScript animation, scrolling, and unmount timers ignore both;
- the saved preference is applied after the first React render.

### 5.3 Overlays

`OverlayLayer` owns portal lifecycle, the overlay stack, topmost-only Escape handling, backdrop closure, and focus restoration. `Dialog` and `Drawer` delegate lifecycle to it. `usePresence` currently waits the configured exit duration even when CSS has reduced all visible transitions to effectively zero. During that invisible delay, the full-screen overlay can still intercept input and remain registered in the overlay stack.

The existing z-index/stack order and nested Escape behavior are part of the contract and must remain intact.

### 5.4 Kiro runtime

`KiroSessionProvider` keeps one session shared by the full workspace and Sidecar. The send path is `KiroComposer` → `KiroSessionProvider` → `useKiroChat`. `KiroConversation` owns sticky-to-bottom behavior through a single `ResizeObserver` plus `requestAnimationFrame` reconciliation path. `KiroStreamingMarkdown` preserves stable completed blocks and an active streaming tail. These performance boundaries must not be weakened by animation.

The conversation transition reducer already protects the semantic order `stop → save → reset/load`. The UI currently exposes only a boolean busy state, so a click can appear to do nothing while the transition is safely running.

## 6. Motion Language

### 6.1 Timing roles

Keep semantic token names and align their values to four roles:

| Role | Target duration | Use |
| --- | ---: | --- |
| Press | 80–100ms | independent button press/release feedback |
| State | 120–150ms | selected state, icon change, agent phase crossfade |
| Structure | 180–220ms | message/card entry, popover, small list change |
| Panel | 220–240ms enter; 140–190ms exit | Sidecar, sheet, dialog, drawer |

Entry uses the existing emphasized/ease-out-like curve, exit uses a shorter ease-in-like curve, and in-place selection/rearrangement uses the standard curve. Exact token values must be centralized rather than copied into consumers.

### 6.2 Motion geometry

- Buttons: color/border change plus existing restrained `scale(0.98)` only for independent action buttons.
- Navigation, date cells, drag handles, resize handles, and layout-stable controls do not scale.
- Page switches: opacity only.
- Popovers: opacity plus no more than 4px vertical movement from the trigger direction.
- Overlay panels: opacity plus 6–12px movement from their physical edge.
- Modal: opacity plus the existing restrained scale/vertical treatment.
- Messages and result cards: opacity plus no more than 4px upward settling.
- Streaming tokens never animate individually.

### 6.3 Effective reduced motion

Add a small shared module/hook with a single rule:

```text
application = reduced  → reduce
application = full     → use standard ClassFlow motion
application = system   → follow prefers-reduced-motion
```

The shared behavior must:

- subscribe to OS media-query changes while the app preference is `system`;
- expose a React value for scroll, chart, presence, and other JavaScript consumers;
- keep `html[data-motion]` as the CSS-facing preference contract;
- avoid different components reimplementing this rule;
- be deterministic and unit-testable through a pure resolver.

Persisted preference application happens through a minimal pre-hydration bootstrap in `app/layout.tsx`. The bootstrap reads only the persisted motion preference, validates the three allowed values, and falls back safely to `system` when data is missing, malformed, or not yet migrated. It must not duplicate the entire Zustand migration pipeline in inline script. `full` explicitly overrides an OS reduced-motion preference; `system` follows the OS.

Under effective reduced motion:

- nonessential transitions/animations resolve immediately;
- looping glow, pulse, spin, and smooth-scroll effects are removed where state remains clear without them;
- focus, visible status text, progress semantics, and controls remain present;
- loaders may retain a static icon plus status text rather than depending on rotation;
- chart transitions are disabled without changing the plotted values.

## 7. Overlay Lifecycle Design

### 7.1 Close behavior

Closing separates three states:

1. **open and interactive**;
2. **exiting and visually present**;
3. **unmounted**.

As soon as close is requested, the overlay root becomes non-interactive (`pointer-events: none`) even if its exit animation remains visible. It must not block the page, accept backdrop input, or behave as the active interaction target while exiting.

In reduced motion, the exit duration resolves to zero and the overlay unmounts on the next React lifecycle opportunity. The overlay stack must release it without a hard-coded 220/260ms delay.

### 7.2 Stack and focus contract

- Opening registers the overlay with its existing ID and z-index.
- Escape closes only the current topmost interactive overlay.
- A nested Confirm closes before its parent Drawer.
- Closing restores focus to the opener after the close request; reduced motion must not delay restoration.
- Existing backdrop semantics remain `target === currentTarget`.
- The implementation must not introduce a period where an exiting overlay remains topmost and prevents shortcuts after it is no longer visible.

### 7.3 Narrow accessibility boundary

This round verifies focus restoration and topmost Escape behavior. A complete focus-trap/background-inert/scroll-lock framework is explicitly deferred because it affects all overlay consumers and deserves a separate audit and plan. Any touched overlay must not regress current keyboard operation.

## 8. Kiro Interaction Design

### 8.1 Submission acknowledgement

`KiroComposer` adds a local submission latch that activates synchronously before calling the async send path. While latched:

- the current submit cannot fire again;
- the composer exposes a visible pending/stopping control state;
- the button transition from Send to Stop is stable and does not change the surrounding geometry;
- the latch is released when runtime streaming/submitted state takes ownership or when send fails before that state is reached.

The latch is presentation protection, not a second chat state machine. Runtime status remains authoritative.

### 8.2 Agent phase line

The visible phase vocabulary is concise and factual:

- `正在准备` — submission accepted, before useful runtime progress;
- `正在处理` — active work or tool execution;
- `正在整理回答` — tool work has ended and answer composition is underway;
- completed answer — no persistent completion banner unless a factual result card requires it;
- failure — existing bounded error state with retry/settings actions.

`KiroWorklog` remains collapsible and shows only sanitized commentary and factual tool steps. It must not invent a percentage, total-step count, future step, or completion promise.

Phase changes use a polite live region with deduplicated announcements. Streaming tokens are not announced individually.

### 8.3 One-time structural entry

Apply entry motion only when a stable UI object first appears:

- a submitted user message;
- the assistant-turn shell/pending line;
- a factual Action Card or proposal card;
- the beginning of the final-answer region;
- a new context chip.

The animation key is the stable message/card/context ID. Updating streaming text, tool progress, Markdown blocks, or cached historical rows must not remount or replay the animation.

### 8.4 Conversation switching

Extend the UI-facing transition metadata with a safe presentation phase and target identity. It may expose:

```ts
type ConversationTransitionView = {
  phase: "idle" | "stopping" | "saving" | "loading";
  target: "new" | string | null;
};
```

The reducer and persistence sequence stay authoritative. Presentation behavior:

- the selected target row displays an inline loader/status;
- new/select actions remain disabled against a second transition;
- the history surface does not disappear before acknowledging the click;
- the old conversation remains readable while stopping/saving;
- once loading finishes, the conversation region performs one 140–190ms opacity transition;
- failure leaves the current conversation intact and surfaces a bounded error rather than blanking the transcript.

No crossfade may keep two live Kiro runtimes or duplicate message DOM for streaming turns.

### 8.5 Context snapshot clarity

The send path already freezes the request context. During an in-flight turn:

- existing context chips represent the context used for the current turn;
- add/remove context controls are disabled;
- the context row displays `本轮上下文已锁定 · 回复完成后可为下一条调整`;
- completed/failed turns return context controls to their normal state.

The design does not change prompt construction, context budgets, or automatic/manual context precedence.

### 8.6 Sidecar and Thread Rail presence

- `<768px`: full-screen Kiro uses opacity plus an 8px right-edge transition over the panel token; safe-area behavior remains unchanged.
- `768–1535px`: the right overlay/sheet enters from the right by 8–12px with opacity and exits faster.
- `≥1536px`: docked Kiro avoids animated width on the main layout. The panel content may fade/settle, but the application must not reflow every frame.
- Thread Rail collapsed/expanded presentation keeps the chat column width stable. Because the Rail is absolutely positioned, its local plate/content transition may animate its own width and opacity without changing the chat column or main workspace width.
- Mobile `KiroHistoryPanel` and `KiroContextPicker` use the same 220ms enter / 160ms exit presence contract and immediately release interaction under reduced motion.

## 9. Confirmed Bug Fixes

### 9.1 Invisible overlay input blocking

Root condition: CSS reduces the visible exit to effectively zero while `usePresence` still holds the fixed full-screen root for the nominal exit duration.

Acceptance:

- after Escape/backdrop/close under reduced motion, an underlying control is actionable immediately;
- the closing overlay no longer counts as the topmost interaction blocker;
- nested overlay Escape ordering still passes in normal motion;
- focus returns without waiting for a nominal animation duration.

### 9.2 Settings search shortcut leakage

`SettingsModal` must register or honor its `Ctrl/Cmd+F` shortcut only while the modal is open. When closed, the event must not be prevented, and reopening Settings must not reveal a stale search state created by a closed-modal shortcut.

The existing open-modal behavior remains: the shortcut opens/focuses Settings search.

## 10. Testing Strategy

### 10.1 Unit tests

Add or adjust focused tests for:

- pure effective-motion resolution for `system`, `full`, and `reduced`;
- OS changes while application preference is `system`;
- presence duration resolving to immediate under reduced motion;
- conversation transition view metadata without changing reducer invariants;
- submit latch release on runtime ownership and early failure where practical;
- context UI state indicating that changes apply to the next turn.

### 10.2 Targeted E2E

Prioritize:

- `tests/e2e/overlay-primitives.spec.ts`
  - normal nested Escape order;
  - reduced-motion close immediately releases underlying interaction;
  - focus restores to the opener.
- `tests/e2e/reduced-motion.spec.ts`
  - system/OS reduced behavior remains functional;
  - Kiro scroll and panel behavior do not depend on animation completion.
- Kiro interaction/progress/history specs
  - one submission produces one turn;
  - Send/Stop state responds immediately;
  - phase text reflects actual runtime stages;
  - conversation target shows transition feedback;
  - stale `kiro-activity-trace` IDs/copy are updated to current Worklog/Pending contracts.
- `tests/e2e/settings.spec.ts`
  - closed Settings does not intercept `Ctrl/Cmd+F`;
  - open Settings focuses its search;
  - touched geometry assertions wait on visible/stable state rather than a fixed animation delay.

### 10.3 Test cleanup boundary

Replace `waitForTimeout` only in specs changed by this round. Prefer semantic visibility, attributes, target geometry through `expect.poll`, or explicit transition state. Do not delete a test merely because it is slow; delete only a demonstrably duplicate case whose contract is already covered by a clearer maintained spec.

Development verification normally consists of:

```text
npm run typecheck
npx vitest run <directly affected unit test files>
npx playwright test <directly affected E2E specs>
```

Do not default to `npm test`, the full Playwright suite, or `npm run build`. Escalate only when a shared primitive change has an unclear blast radius or targeted evidence indicates a wider regression.

## 11. Implementation Boundaries

The likely file groups are:

### Motion and overlay foundation

- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- a new focused motion preference module/hook under `lib/`
- `lib/usePresence.ts`
- `components/ui/OverlayLayer.tsx`
- `components/ui/Select.tsx`
- JavaScript animation consumers touched by the final plan

### Kiro interaction

- `components/kiro/KiroComposer.tsx`
- `components/kiro/KiroConversation.tsx`
- `components/kiro/KiroWorklog.tsx`
- `components/kiro/KiroSessionProvider.tsx`
- `components/kiro/KiroThreadRail.tsx`
- `components/kiro/KiroThreadRow.tsx`
- `components/kiro/KiroContextBar.tsx`
- `components/kiro/KiroSidecar.tsx`
- the existing conversation transition and presentation modules

### Confirmed bug and tests

- `components/settings/SettingsModal.tsx`
- affected motion, overlay, Kiro, and Settings tests only

The implementation plan may split these into parallel tasks only when ownership does not overlap. Shared primitives and provider contracts are integrated by the primary flow before UI consumers are distributed.

## 12. Failure and Recovery Behavior

- Motion bootstrap failure falls back to `system` and must not block rendering.
- Media-query APIs being unavailable fall back to non-reduced behavior unless application preference explicitly says `reduced`.
- A send rejected before runtime ownership clears the submit latch and preserves the draft or existing error handling.
- A conversation-switch failure preserves the current transcript and returns controls to an actionable state.
- A panel interrupted during exit resolves to the latest requested open state; stale timers must not unmount a reopened panel.
- Reduced motion never waits on `transitionend` or animation completion to make the UI functional.

## 13. Acceptance Criteria

The round is complete when:

- ClassFlow's visible palette and overall layout direction remain unchanged;
- normal motion feels consistent across press, local state, panel, and Kiro structural changes;
- effective reduced motion is shared across CSS-facing preference and touched JavaScript consumers;
- no invisible closing overlay blocks input under reduced motion;
- Settings no longer intercepts `Ctrl/Cmd+F` while closed;
- one Kiro submission cannot create an accidental duplicate turn during the runtime status handoff;
- Kiro presents clear factual prepare/work/compose states without raw internals;
- history switching visibly acknowledges the selected target without changing persistence order;
- context behavior clearly communicates the current-turn snapshot boundary;
- Sidecar and Rail transitions preserve responsive breakpoints and do not animate main-layout width at desktop docked sizes;
- streaming performance keeps stable message identity and the single height reconciliation path;
- targeted type, unit, and E2E checks pass;
- the latest local preview is opened and inspected at desktop, narrow/mobile, keyboard, and reduced-motion states;
- the completed code round is committed and pushed after final verification.

## 14. Reference Context

The design borrows interaction principles, not visual branding, from these primary sources:

- Kiro's official Agent Focus and chat/autopilot documentation: persistent agent state, interruptibility, and on-demand auxiliary detail.
- Linear's official design and Peek documentation: calm navigation, stable workspace context, and lightweight detail surfaces.
- Atlassian, Material, and IBM Carbon motion guidance: short feedback timings, shorter exits, and purposeful movement.
- W3C WCAG 2.2 guidance for Animation from Interactions: nonessential interaction animation must be suppressible without losing function or state.

Sources:

- https://kiro.dev/blog/introducing-agent-focus/
- https://kiro.dev/docs/chat/
- https://kiro.dev/docs/chat/autopilot/
- https://linear.app/now/behind-the-latest-design-refresh
- https://linear.app/docs/peek
- https://atlassian.design/foundations/motion
- https://atlassian.design/foundations/motion/applying-motion
- https://m1.material.io/motion/duration-easing.html
- https://carbondesignsystem.com/elements/motion/overview/
- https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions
