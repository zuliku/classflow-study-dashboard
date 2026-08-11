# Kiro Worklog Density Polish — Design Spec

Date: 2026-08-11
Status: Approved in conversation; pending written-spec review

## Goal

Polish the already-implemented Kiro Streaming Worklog V2 so multi-tool turns stay readable without occupying excessive vertical space. This is a UI-density refinement only; it does not change tool execution, turn derivation, streaming transport, Markdown rendering, or history semantics.

## Current Problems Confirmed in Code

1. Every completed tool row uses a green `Check`, and the summary row `已完成 N 个步骤` also uses the same `Check`, so the visual language repeats the same success symbol too often.
2. The whole Worklog cannot currently collapse; only individual tool-detail rows can expand/collapse.
3. Commentary uses `line-clamp-2` and the Worklog container uses `max-w-[560px]`, so longer intermediate narration is truncated even when there is enough horizontal space.
4. Tool rows show a chevron whenever `safeDetails.length > 0`, but the safe-detail formatter always returns fallback rows such as `已完成` / `正在处理…` / `执行未完成`. This makes nearly every tool look expandable even when there is no meaningful detail.

## Approved Interaction Model

### 1. Whole Worklog collapse behavior

Use a single group-level disclosure control.

State rules:

- `working` or `composing` → expanded by default.
- First transition into `answering` → automatically collapse the Worklog.
- A settled historical / `done` turn → collapsed by default.
- After the user manually toggles the Worklog once, respect the user choice for the rest of that mounted turn; do not auto-collapse or auto-expand again.
- Collapsing hides commentary rows and tool rows, but keeps the group summary visible.
- Expanding restores the exact existing worklog order and per-tool detail states.

The group summary becomes the main disclosure button:

```text
≋ 已完成 8 个步骤                         ˅
```

During active execution, when collapsed manually:

```text
≋ 正在执行 · 已完成 5 / 8 个步骤          ˅
```

Do not invent pending steps. If total tool count is not known yet, use only facts already present in the current presentation, e.g. `正在执行 · 已完成 5 个步骤`.

### 2. Summary icon

Do not use the green `Check` icon for the group summary.

Use a neutral workflow/list-style Lucide icon such as `ListTree` (preferred) or the closest existing lightweight equivalent available in the installed Lucide version.

Visual semantics:

- group summary icon: `text-sandrift`;
- completed individual tool: existing success check, reduced visual weight;
- current tool: loader + `text-charcoal`;
- error tool: existing danger semantic color.

No new blue/purple accent token.

### 3. Commentary width and truncation

When the Worklog is expanded:

- remove `line-clamp-2` from commentary;
- render the full visible model commentary;
- use `whitespace-pre-wrap break-words`;
- keep `text-[11px] text-sandrift leading-relaxed`;
- do not run Markdown parsing;
- do not add a cursor;
- do not add a separate logo.

Remove the fixed `max-w-[560px]` restriction from the Worklog. Let it use the available width of the existing assistant-message column (`min-w-0 flex-1` / conversation max width already constrains the layout).

The global collapse behavior is now the density mechanism, so commentary should not be hard-truncated just to save vertical space.

### 4. Meaningful tool-detail disclosure only

A tool row should show a chevron only when it has meaningful deterministic details.

Fallback status strings are not expandable details:

- `正在处理…`
- `已完成`
- `执行未完成`

Introduce a small pure predicate at the presentation/UI boundary, e.g.:

```ts
export function hasMeaningfulKiroToolDetails(details: string[]): boolean;
```

It returns `false` when the detail list is empty or contains only the generic fallback for the current status; it returns `true` for whitelisted facts such as:

- `找到 3 个任务`
- `读取 5 条课表安排`
- `已读取「TCP 三次握手抓包分析」`
- `完成 4 项修改`
- `已处理「高等数学作业」`

The component must continue to render only already-sanitized `safeDetails`; it must not inspect raw tool input/output.

### 5. Individual tool-row visual weight

Completed rows should recede further:

- keep success semantics but reduce icon size slightly (around `w-3 h-3`);
- keep text at `text-[11px] text-satin-grey`;
- no background for completed rows unless hovered and expandable;
- current working row remains the strongest element using the existing `bg-alabaster/50 border-line-soft` treatment;
- error row keeps existing danger treatment.

Do not add timestamps.

### 6. Group summary placement

When expanded, place the summary after the worklog steps, immediately before the existing final-answer divider.

When collapsed, the summary is the only Worklog element rendered before the divider/final answer.

The final-answer divider remains `border-line-soft` and must continue to appear when an answer exists.

### 7. Motion

Use only lightweight existing motion tokens:

- chevron rotation;
- optional opacity transition.

Do not animate `max-height`, measured height, or per-row entrance on collapse/expand. The existing Conversation `ResizeObserver + rAF` scroll reconciliation should naturally respond to the height change.

Respect `data-motion="reduced"` automatically through existing global motion rules.

## Component Boundary

Primary change target:

- `components/kiro/KiroWorklog.tsx`

Optional pure helper location:

- `lib/ai/presentation/toolActivityDetails.ts`, if the meaningful-detail predicate belongs next to safe-detail semantics;
- otherwise keep a tiny predicate in `KiroWorklog.tsx` if no other consumer needs it.

Do not modify unless typecheck proves necessary:

- `lib/ai/presentation/turnPresentation.ts`
- `hooks/useKiroChat.ts`
- `components/kiro/KiroConversation.tsx`
- streaming transport / Markdown / history code.

## State Handling Detail

Recommended local state in `KiroWorklog`:

```ts
const [expanded, setExpanded] = useState(
  turn.phase === "working" || turn.phase === "composing"
);
const userToggledRef = useRef(false);
const prevPhaseRef = useRef(turn.phase);
```

Effect rules:

- if user has manually toggled → do nothing;
- if previous phase was not `answering` and current phase becomes `answering` → `setExpanded(false)`;
- if a freshly mounted historical turn is `done` → initial state is collapsed;
- active `working/composing` mount → initial state is expanded.

Do not reset the user's manual choice on every streamed re-render.

## Accessibility

- Group summary is a real `button` with `aria-expanded`.
- Per-tool rows remain real buttons only when they have meaningful expandable details.
- Non-expandable tool rows should not be disabled buttons with misleading disclosure semantics; render them as non-interactive rows or buttons without disclosure only if existing structure requires it.
- State must remain understandable by icon + text, not color alone.

## Focused Testing

Prefer a very small pure/helper test rather than adding a React test harness.

Required checks:

1. generic fallback detail arrays are not considered expandable;
2. whitelisted factual detail arrays are expandable;
3. existing Kiro turn-presentation tests remain green;
4. `npm run typecheck` passes.

Do not run the full Vitest suite, build, or Playwright unless a focused failure proves broader verification is necessary.
