# Kiro Worklog Density Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Kiro Worklog visual density by auto-collapsing completed work when the final answer starts, removing redundant disclosure affordances, and showing full intermediate commentary when expanded.

**Architecture:** Keep the existing Streaming Worklog V2 presentation model unchanged. Implement density behavior locally in `KiroWorklog`, add one small pure helper for meaningful detail disclosure, and rely on the existing Conversation `ResizeObserver + requestAnimationFrame` height reconciliation for layout changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React, Vitest.

## Global Constraints

- This is a UI-density polish only; do not change tool execution, turn derivation, streaming transport, Stable Blocks / Active Tail, history persistence, or message-edit safety.
- Worklog `working` / `composing` mounts expanded by default.
- First transition into `answering` automatically collapses the Worklog unless the user has already manually toggled it.
- Historical / settled `done` turns mount collapsed by default.
- After one manual group toggle, respect the user's choice for the rest of that mounted turn; do not auto-collapse or auto-expand again.
- Group summary uses a neutral workflow/list icon, not the same green check used by completed tool rows.
- Do not introduce blue/purple agent colors. Use existing ClassFlow semantic colors only.
- Expanded commentary renders fully with `whitespace-pre-wrap break-words`; remove `line-clamp-2` and fixed `max-w-[560px]`.
- Generic fallback safe details (`正在处理…`, `已完成`, `执行未完成`) are not expandable details and must not produce chevrons.
- Components must continue to render only sanitized `safeDetails`; never inspect raw tool input/output in React.
- Do not show per-step timestamps.
- Do not animate measured height / `max-height`; existing global motion and Conversation height reconciliation are sufficient.
- Testing stays focused: `tests/kiroTurnPresentation.test.ts` + `npm run typecheck`. Do not run full Vitest, build, or Playwright unless a focused failure proves escalation necessary.

---

### Task 1: Kiro Worklog Density + Collapse Polish

**Files:**
- Modify: `lib/ai/presentation/toolActivityDetails.ts`
- Modify: `components/kiro/KiroWorklog.tsx`
- Modify: `tests/kiroTurnPresentation.test.ts`

**Interfaces:**
- Consumes: `KiroAssistantTurnPresentation`, `KiroWorklogBlock.safeDetails`, existing ClassFlow semantic Tailwind tokens.
- Produces:

```ts
export function hasMeaningfulKiroToolDetails(details: string[]): boolean;
```

`KiroWorklog` remains:

```tsx
export function KiroWorklog({
  turn,
}: {
  turn: KiroAssistantTurnPresentation;
}): JSX.Element;
```

- [ ] **Step 1: Add failing helper tests**

Extend `tests/kiroTurnPresentation.test.ts` imports:

```ts
import {
  formatKiroToolActivityDetail,
  hasMeaningfulKiroToolDetails,
} from "@/lib/ai/presentation/toolActivityDetails";
```

Add:

```ts
describe("hasMeaningfulKiroToolDetails", () => {
  it("generic fallback details are not expandable", () => {
    expect(hasMeaningfulKiroToolDetails([])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["正在处理…"])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["已完成"])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["执行未完成"])).toBe(false);
  });

  it("deterministic factual details are expandable", () => {
    expect(hasMeaningfulKiroToolDetails(["找到 3 个任务"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["读取 5 条课表安排"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["已读取「TCP 三次握手抓包分析」"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["完成 4 项修改"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["已处理「高等数学作业」"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
```

Expected: FAIL because `hasMeaningfulKiroToolDetails` does not exist yet.

- [ ] **Step 3: Implement meaningful-detail predicate**

In `lib/ai/presentation/toolActivityDetails.ts`, export:

```ts
const GENERIC_TOOL_DETAILS = new Set([
  "正在处理…",
  "已完成",
  "执行未完成",
]);

export function hasMeaningfulKiroToolDetails(details: string[]): boolean {
  return details.some((detail) => !GENERIC_TOOL_DETAILS.has(detail.trim()));
}
```

Keep the existing safe formatter behavior unchanged. Do not remove fallback strings because they are still useful internally; this helper only controls disclosure affordance.

- [ ] **Step 4: Refactor individual Tool Row disclosure semantics**

In `components/kiro/KiroWorklog.tsx`:

1. Import `hasMeaningfulKiroToolDetails`.
2. Replace:

```ts
const expandable = block.safeDetails.length > 0;
```

with:

```ts
const expandable = hasMeaningfulKiroToolDetails(block.safeDetails);
```

3. Do not render a disabled disclosure button for non-expandable rows. Use a shared row body but choose element semantics:
   - expandable → real `<button type="button" aria-expanded={open}>`;
   - non-expandable → non-interactive `<div>` with the same layout classes.
4. Only show `ChevronDown` for expandable rows.
5. Reduce completed `Check` to approximately `w-3 h-3`; keep `text-success`.
6. Completed row remains `text-satin-grey`, no default background/border.
7. Working row remains the visual focus using existing `bg-alabaster/50 border border-line-soft`.
8. Error row keeps existing danger semantics.

Do not inspect raw tool input/output.

- [ ] **Step 5: Add whole-Worklog collapse state**

Update imports to include `useEffect`, `useRef` and neutral Lucide icon `ListTree` (preferred; use the closest installed equivalent only if `ListTree` is unavailable).

Inside `KiroWorklog`:

```ts
const [expanded, setExpanded] = useState(
  turn.phase === "working" || turn.phase === "composing"
);
const userToggledRef = useRef(false);
const prevPhaseRef = useRef(turn.phase);
```

Add an effect with these exact semantics:

```ts
useEffect(() => {
  const prev = prevPhaseRef.current;
  prevPhaseRef.current = turn.phase;

  if (userToggledRef.current) return;

  if (prev !== "answering" && turn.phase === "answering") {
    setExpanded(false);
  }
}, [turn.phase]);
```

Initial state already gives:
- `working` / `composing` → expanded;
- `answering` / `done` → collapsed.

Group toggle:

```ts
const toggleExpanded = () => {
  userToggledRef.current = true;
  setExpanded((value) => !value);
};
```

Do not reset `userToggledRef` on every streamed rerender.

- [ ] **Step 6: Replace the old summary row with a group disclosure button**

Compute:

```ts
const toolBlocks = turn.worklog.filter(
  (block): block is Extract<KiroWorklogBlock, { kind: "tool" }> => block.kind === "tool"
);
const toolCount = toolBlocks.length;
const completedToolCount = toolBlocks.filter(
  (block) => block.status === "done" || block.status === "error"
).length;
```

Summary copy:

```ts
const summaryLabel =
  turn.phase === "working" || turn.phase === "composing"
    ? completedToolCount > 0
      ? `正在执行 · 已完成 ${completedToolCount} 个步骤`
      : "正在执行"
    : `已完成 ${toolCount} 个步骤`;
```

Do not render `5 / 8` while executing because the final tool count is not known in advance.

Render one group button whenever `toolCount > 0`:

```tsx
<button
  type="button"
  onClick={toggleExpanded}
  aria-expanded={expanded}
  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-sandrift hover:bg-alabaster/60 transition-colors"
>
  <ListTree className="w-3.5 h-3.5 shrink-0 text-sandrift" aria-hidden="true" />
  <span>{summaryLabel}</span>
  <ChevronDown
    className={cn(
      "ml-auto w-3 h-3 shrink-0 text-sandrift transition-transform duration-[var(--motion-fast)]",
      expanded && "rotate-180"
    )}
    aria-hidden="true"
  />
</button>
```

Do not use a green `Check` for the group summary.

- [ ] **Step 7: Make expanded commentary complete and use available width**

Replace the Worklog root:

```tsx
<div data-testid="kiro-worklog" className="space-y-1 min-w-0 w-full">
```

Remove `max-w-[560px]`.

When `expanded === true`, render the existing ordered blocks. Commentary becomes:

```tsx
<p
  key={block.id}
  className="text-[11px] text-sandrift leading-relaxed whitespace-pre-wrap break-words"
>
  {block.text}
</p>
```

Remove `line-clamp-2`.

When `expanded === false`, do not render commentary or tool rows; render only the group summary.

For `turn.phase === "composing"`, keep `正在整理结果…` only inside the expanded content. Do not duplicate it in the collapsed summary.

When a group is collapsed and later manually re-expanded, individual tool detail rows may return to their component default closed state; preserving per-tool open state across group collapse is not required.

- [ ] **Step 8: Keep final-answer divider independent of expanded state**

The divider remains visible whenever:

```ts
turn.worklog.length > 0 && turn.answer.length > 0
```

It must appear below the summary button and above the final answer whether the Worklog is expanded or collapsed.

Use the existing:

```tsx
<div className="border-t border-line-soft my-1.5" aria-hidden="true" />
```

Do not add animated height transitions.

- [ ] **Step 9: Focused verification**

Run:

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
npm run typecheck
```

Do not run full Vitest, build, or Playwright unless one of these focused checks exposes a real cross-module regression.

Manual code review checklist:

```text
working/composing mount -> expanded
answering mount -> collapsed
working -> answering -> auto-collapse once
manual toggle before answering -> later answering does not override user choice
done historical turn -> collapsed
summary uses neutral ListTree-style icon, not green Check
expanded commentary has no line-clamp and no 560px width cap
generic fallback detail -> no chevron
factual safe detail -> chevron + expandable detail
final-answer divider survives collapsed state
no blue/purple classes introduced
```

- [ ] **Step 10: Commit**

```bash
git add \
  components/kiro/KiroWorklog.tsx \
  lib/ai/presentation/toolActivityDetails.ts \
  tests/kiroTurnPresentation.test.ts

git commit -m "ui(kiro): polish worklog density and disclosure"
```
