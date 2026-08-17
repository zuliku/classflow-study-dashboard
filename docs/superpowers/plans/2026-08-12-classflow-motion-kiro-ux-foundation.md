# ClassFlow Motion and Kiro UX Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` in this session. Every implementation task follows `superpowers:test-driven-development`; do not write production code before its focused test fails for the expected reason.

**Goal:** Ship one coherent UX round that establishes truthful global motion semantics, fixes overlay lifecycle defects, and makes Kiro sending, progress, context locking, conversation switching, and panel transitions feel immediate and legible without changing ClassFlow's warm neutral visual direction.

**Architecture:** Put effective-motion resolution in one pure utility plus one React hook, bootstrap the persisted preference before hydration, and make existing presence consumers use the same answer. Keep the current Kiro session/reducer architecture and message cache intact; expose a sanitized conversation-transition view, add synchronous UI ownership at send time, and animate only structural insertion or surface presence. No animation library, new persisted state, new Context, raw model internals, or broad component rewrite.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zustand persist, Tailwind CSS, AI SDK UI, Vitest, Playwright, Lucide.

**Approved design:** `docs/superpowers/specs/2026-08-12-classflow-motion-kiro-ux-foundation-design.md`

## Non-negotiable constraints

- Preserve the existing palette, typography, radius language, and page layout.
- Do not change the semantic conversation-switch order: stop → save → reset/load.
- Do not create a second Kiro runtime or duplicate `ResizeObserver` / scroll ownership.
- Do not animate per token, chart-layout width, or repeated streaming updates.
- `full` explicitly overrides an OS reduced-motion preference; `system` follows it; `reduced` always reduces.
- A closing overlay must stop intercepting pointer and keyboard input immediately. Focus restore and topmost-Escape behavior must remain correct.
- Test only touched behavior. Replace stale selectors and fixed sleeps only in touched specifications; do not launch the broad suite by default.
- Keep the local preview server alive at handoff.

## Target motion roles

| Role | Duration | Use |
| --- | ---: | --- |
| press | 90ms | button down/up feedback |
| state | 140ms | opacity, icon, border, compact state |
| structure | 200ms | a newly inserted message or action card |
| panel enter | 230ms | sidecar, history, context picker |
| panel exit | 160ms | sidecar, history, context picker |

---

### Task 1: Centralize effective motion and remove the hydration flash

**Files:**

- Create: `lib/motionPreference.ts`
- Create: `hooks/useEffectiveReducedMotion.ts`
- Create: `tests/motionPreference.test.ts`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `components/dashboard/StudyLoadChart.tsx`

**Step 1 — Write the failing unit tests**

Cover all nine preference/system combinations and persisted-state parsing:

```ts
expect(resolveEffectiveReducedMotion("reduced", false)).toBe(true);
expect(resolveEffectiveReducedMotion("full", true)).toBe(false);
expect(resolveEffectiveReducedMotion("system", true)).toBe(true);
expect(readPersistedMotionPreference(JSON.stringify({
  state: { preferences: { motionPreference: "full" } },
}))).toBe("full");
expect(readPersistedMotionPreference("not-json")).toBe("system");
```

Run `npm.cmd exec vitest run tests/motionPreference.test.ts` and confirm it fails because the module does not exist.

**Step 2 — Add the pure resolver and bootstrap source**

`lib/motionPreference.ts` exports:

```ts
export type MotionPreference = "system" | "full" | "reduced";
export const APP_STORAGE_KEY = "classflow-storage-v2";

export function resolveEffectiveReducedMotion(
  preference: MotionPreference,
  systemReduced: boolean
): boolean {
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return systemReduced;
}

export function readPersistedMotionPreference(raw: string | null): MotionPreference;
export const MOTION_BOOTSTRAP_SCRIPT: string;
```

The parser must tolerate absent, partial, corrupt, and legacy payloads and fall back to `system`. The bootstrap script reads the same storage key, resolves `matchMedia("(prefers-reduced-motion: reduce)")`, and writes both `html.dataset.motionPreference` and `html.dataset.motionEffective` before the body paints. It must catch storage/security errors and never throw.

**Step 3 — Add the reactive hook and wire it once**

`useEffectiveReducedMotion` reads `preferences.motionPreference` from `useAppStore`, subscribes to the media query using both modern `addEventListener` and legacy `addListener` fallback, updates the two root datasets, and returns the effective boolean.

In `app/page.tsx`, replace the direct `data-motion` effect with one hook invocation. Use its return value for Recharts (`isAnimationActive={!reducedMotion}` and zero duration when reduced). Apply the same chart rule in `StudyLoadChart.tsx`.

**Step 4 — Make CSS respect explicit full motion**

Replace unconditional OS media overrides with selectors that exclude `html[data-motion-preference="full"]`. Keep an explicit effective-reduced override keyed by `html[data-motion-effective="reduced"]`. Normalize the timing variables to the approved 90 / 140 / 200 / 230ms roles while retaining existing easing names.

**Step 5 — Verify and commit**

Run:

```powershell
npm.cmd exec vitest run tests/motionPreference.test.ts tests/preferences.test.ts
npm.cmd run typecheck
git diff --check
```

Commit: `feat: unify effective motion preferences`

---

### Task 2: Make overlay exit non-blocking and scope Settings shortcuts

**Files:**

- Modify: `lib/usePresence.ts`
- Modify: `components/ui/OverlayLayer.tsx`
- Modify: `components/settings/SettingsModal.tsx`
- Modify: `tests/e2e/overlay-primitives.spec.ts`
- Modify: `tests/e2e/settings.spec.ts`
- Modify: `tests/e2e/reduced-motion.spec.ts`

**Step 1 — Add failing browser assertions**

Add compact cases that:

- set motion preference to reduced, close a dialog, and immediately click the control behind it;
- close a nested overlay, press Escape immediately, and verify the remaining top overlay closes;
- close Settings, press Ctrl/Cmd+F, and verify Settings does not reopen and no hidden search state is created;
- verify the element focused before opening Settings receives focus after close.

Use state or locator assertions; do not add `waitForTimeout`.

**Step 2 — Update presence semantics**

`usePresence(open, duration)` consumes `useEffectiveReducedMotion`. On close it sets `visible=false`; when reduced it unmounts without a timer, otherwise it unmounts after `duration`. Clear stale timers/rAFs during rapid reopen.

`OverlayLayer` must use `open`, not delayed `mounted`, as interaction ownership:

```tsx
useEffect(() => {
  if (!open) return;
  pushOverlay(overlayId, stackZ);
  return () => popOverlay(overlayId);
}, [open, overlayId, stackZ]);

<div className={cn(
  "ux-overlay",
  visible ? "opacity-100" : "opacity-0",
  !open && "pointer-events-none",
  className
)} />
```

The Escape listener is also active only while `open`; the exit visual may remain mounted but cannot consume input.

**Step 3 — Guard Settings global search**

The Settings Ctrl/Cmd+F listener must return early unless `isOpen` is true, and its effect dependencies must include `isOpen`. Preserve the existing native-search exception and Settings search focus behavior while open.

**Step 4 — Run targeted checks and commit**

```powershell
npm.cmd run typecheck
npm.cmd exec playwright test tests/e2e/overlay-primitives.spec.ts tests/e2e/settings.spec.ts tests/e2e/reduced-motion.spec.ts --project=chromium --workers=1
git diff --check
```

Commit: `fix: make overlay exits non-blocking`

---

### Task 3: Give Kiro immediate send ownership and truthful phases

**Files:**

- Modify: `components/kiro/KiroComposer.tsx`
- Modify: `components/kiro/KiroContextBar.tsx`
- Modify: `components/kiro/KiroWorklog.tsx`
- Modify: `components/kiro/KiroActionCard.tsx`
- Modify: `tests/e2e/kiro-agent-progress.spec.ts`
- Modify: `tests/e2e/kiro-chat.spec.ts`

**Step 1 — Replace stale Kiro progress assertions first**

Remove the obsolete `kiro-activity-trace` selector and the obsolete `正在思考` copy. Assert the public phase vocabulary instead:

- send ownership appears immediately (`正在准备` or Stop control in the same tick);
- pending content uses `正在准备`;
- active work uses `正在处理`;
- composing uses `正在整理回答`;
- the phase region is polite `aria-live` and never exposes tool JSON or invented totals.

Keep existing API stubs and replace fixed response sleeps with request/response or locator-driven gates.

**Step 2 — Add a synchronous local submission latch**

In `KiroComposer`, add `submitting`. Set it before awaiting `onSend`, reject double submission using the local value, and release it only after the runtime has visibly taken ownership or the send returned/failed. The send/stop slot retains its exact geometry. While the latch owns the turn, show a disabled preparing control with `Loader2`; once `streaming` is true show the existing Stop control.

`canSend` includes `!submitting`. Context add/remove controls, attachment removal, model selection, and web-search changes that would affect the outgoing turn are disabled for `submitting || streaming`.

**Step 3 — Make context locking explicit**

Extend `KiroContextBar` with `locked?: boolean`. Disabled removal controls retain visible chips and the bar displays exactly:

`本轮上下文已锁定 · 回复完成后可为下一条调整`

Pass the same lock state through Composer and prevent opening the context picker during the turn.

**Step 4 — Normalize phase and structural entry copy**

`KiroPendingIndicator` renders `正在准备`; active worklog renders `正在处理`; composing renders `正在整理回答`. The phase container is `role="status" aria-live="polite" aria-atomic="true"` and keeps a stable footprint. Add `animate-enter` only to newly mounted `KiroActionCard`; never key it by partial content.

**Step 5 — Run focused checks and commit**

```powershell
npm.cmd run typecheck
npm.cmd exec playwright test tests/e2e/kiro-agent-progress.spec.ts tests/e2e/kiro-chat.spec.ts --project=chromium --workers=1
git diff --check
```

Commit: `feat: clarify Kiro turn ownership and phases`

---

### Task 4: Expose a safe conversation-transition view and acknowledge the target

**Files:**

- Modify: `lib/ai/history/conversationTransition.ts`
- Modify: `tests/conversationTransition.test.ts`
- Modify: `components/kiro/KiroSessionProvider.tsx`
- Modify: `components/kiro/KiroThreadRow.tsx`
- Modify: `components/kiro/KiroThreadRail.tsx`
- Modify: `components/kiro/KiroHistoryPanel.tsx`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `tests/e2e/kiro-history-ui.spec.ts`

**Step 1 — Write failing reducer-view tests**

Add a pure sanitized projection:

```ts
export type ConversationTransitionView = {
  phase: "idle" | "stopping" | "saving" | "loading";
  target: "new" | string | null;
};
```

Test that internal `switching` projects to public `loading`, a load target keeps its conversation id through every phase, a new target projects as `new`, and idle has `target:null`. Run `npm.cmd exec vitest run tests/conversationTransition.test.ts` and confirm the missing export failure.

**Step 2 — Publish the view without changing transition effects**

Add `conversationTransition` to Kiro session meta/actions while retaining `conversationTransitioning` for compatibility. Derive it from the existing reducer state. Do not alter `finishConversationTransition`, cache refs, save order, or runtime construction.

**Step 3 — Acknowledge target rows**

Extend `KiroThreadRow` with `transitioning?: boolean`. A target row shows a compact `Loader2` and `正在切换`; non-target rows remain disabled without a spinner. Thread Rail and History Panel determine the target from `conversationTransition.target`.

History Panel no longer disappears at row click. It remembers that it initiated the request, remains visible during stopping/saving/loading, then closes once the transition returns to idle. Replace the current 250ms E2E sleep with the target-row indicator and loaded transcript assertion.

**Step 4 — Crossfade the transcript once per loaded target**

Key one conversation surface boundary by `currentConversationId ?? "new"` and apply a single structure-level fade on mount. Do not key message rows by content and do not replay animation as assistant text streams.

**Step 5 — Verify and commit**

```powershell
npm.cmd exec vitest run tests/conversationTransition.test.ts tests/kiroHistory.test.ts
npm.cmd run typecheck
npm.cmd exec playwright test tests/e2e/kiro-history-ui.spec.ts --project=chromium --workers=1
git diff --check
```

Commit: `feat: surface Kiro conversation transitions`

---

### Task 5: Give Kiro panels real enter/exit presence

**Files:**

- Modify: `components/kiro/KiroSidecar.tsx`
- Modify: `components/kiro/KiroSessionProvider.tsx`
- Modify: `components/kiro/KiroWorkspace.tsx`
- Modify: `components/kiro/KiroHistoryPanel.tsx`
- Modify: `components/kiro/KiroComposer.tsx`
- Modify: `components/kiro/KiroContextPicker.tsx`
- Modify: `components/kiro/KiroThreadRail.tsx`
- Modify: `app/globals.css`
- Modify: `tests/e2e/kiro-history-ui.spec.ts`
- Modify: `tests/e2e/kiro-chat.spec.ts`

**Step 1 — Add behavior-driven panel assertions**

Assert that history/context/sidecar roots remain briefly mounted with `data-state="closed"` under full motion, become non-interactive at close, then unmount; under reduced motion they unmount effectively immediately. Assert a docked sidecar never applies a width transition to the main workspace.

**Step 2 — Keep presence owners mounted**

- Render `KiroSidecar open={sidecarOpen && activeTab !== "kiro"}` from the provider unconditionally; the sidecar owns `usePresence(open, 160)` and returns null only after exit.
- Render `KiroHistoryPanel open={historyOpen}` from Workspace unconditionally; its root owns presence and pointer-event state.
- Render `KiroContextPicker open={pickerOpen}` from Composer unconditionally; outside-click and Escape listeners are active only while open.

Every surface exposes `data-state={open ? "open" : "closed"}`. Use transform + opacity only. At the 1536px docked breakpoint, sidecar opening may snap the flex allocation but must not transition width, margin, grid columns, or main layout geometry.

**Step 3 — Polish Thread Rail structure without layout motion**

Keep the existing overlay rail architecture. Add a 200ms opacity/translate entry for expanded content and a 140ms state transition for the plate/chevron; do not animate the chat column width.

**Step 4 — Verify and commit**

```powershell
npm.cmd run typecheck
npm.cmd exec playwright test tests/e2e/kiro-history-ui.spec.ts tests/e2e/kiro-chat.spec.ts --project=chromium --workers=1
git diff --check
```

Commit: `feat: add Kiro surface presence transitions`

---

### Task 6: Make structural message entry one-shot

**Files:**

- Modify: `lib/useEnterOnAdd.ts`
- Create: `lib/addedIds.ts`
- Create: `tests/addedIds.test.ts`
- Modify: `components/kiro/KiroConversation.tsx`

**Step 1 — Test the pure ID diff**

Create `getAddedIds(previous, current)` and cover initial render, one insertion, reorder, removal/re-addition, and unchanged lists. Initial render returns no added ids. Re-addition after removal counts as new.

**Step 2 — Expire transient entry ownership**

Refactor `useEnterOnAdd` to use the pure diff and replace the permanent accumulating set with a transient set cleared after the structure duration (or immediately under reduced motion). Ensure a subsequent genuinely new id can animate and old ids do not remain flagged forever.

**Step 3 — Animate only appended message shells**

Feed stable message ids into the hook in `KiroConversation`. Pass an `entering` boolean to the existing memoized row and apply `animate-enter` only at the row shell. Do not include message text/tool content in the key or memo comparison.

**Step 4 — Verify and commit**

```powershell
npm.cmd exec vitest run tests/addedIds.test.ts
npm.cmd run typecheck
git diff --check
```

Commit: `feat: make Kiro structural entry animation one-shot`

---

### Task 7: Main-flow integration, local preview, targeted regression, and push

**Files:**

- Modify only files required by failures found in the scoped checks.
- Update the approved design document only if implementation materially diverged; otherwise leave it unchanged.

**Step 1 — Reconcile subagent work**

Review every task diff for file overlap, stale comments, duplicated motion detection, and accidental UI/theme drift. Confirm there is one effective-motion hook, one Kiro runtime, one transcript scroll observer, and one transition reducer.

**Step 2 — Run static and focused automated gates**

```powershell
npm.cmd run typecheck
npm.cmd exec vitest run tests/motionPreference.test.ts tests/conversationTransition.test.ts tests/addedIds.test.ts tests/preferences.test.ts tests/kiroHistory.test.ts
npm.cmd exec playwright test tests/e2e/overlay-primitives.spec.ts tests/e2e/settings.spec.ts tests/e2e/reduced-motion.spec.ts tests/e2e/kiro-agent-progress.spec.ts tests/e2e/kiro-chat.spec.ts tests/e2e/kiro-history-ui.spec.ts --project=chromium --workers=1
git diff --check
```

Do not run the repository-wide Vitest/Playwright suite unless a focused failure shows that shared behavior needs wider coverage.

**Step 3 — Preview the latest working tree**

Use the running local server at `http://localhost:3001`. Inspect at minimum:

1. Overview navigation and chart motion in full/reduced modes.
2. Settings open/search/close/focus restore and post-close Ctrl/Cmd+F.
3. Kiro empty → send → prepare → work → compose → final states.
4. Kiro context add/remove before send and locked state during the turn.
5. History target acknowledgment and transcript switch.
6. Context picker/history/sidecar enter and exit on desktop; reduced-motion close behavior.

Capture screenshots only if they help compare a visual defect. Keep the preview server running.

**Step 4 — Independent review**

Run one spec-compliance review against the approved design, then one code-quality review against the actual diff. Fix P0/P1 findings and repeat the affected focused checks.

**Step 5 — Final Git gates and push**

```powershell
git status --short --branch
git diff --check
git diff --cached --check
git fetch origin main
```

If `origin/main` advanced, rebase only after confirming the worktree is clean and re-run affected checks. Create one final integration/fix commit if needed, then:

```powershell
git push origin main
```

Report the pushed commit, exact focused checks, preview URL, any intentionally deferred items, and keep the local preview process alive.
