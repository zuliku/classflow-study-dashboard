# Kiro Streaming Worklog V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Kiro assistant turns around ordered `UIMessage.parts`, add a compact Codex-style worklog, and make long streamed answers visibly smoother without changing Kiro tool semantics or ClassFlow's visual language.

**Architecture:** Preserve AI SDK message-part chronology and derive a pure assistant-turn presentation model (`commentary → tool → commentary → tool → final answer`) before React rendering. Render worklog and final answer as separate layers, then optimize stream cadence with `smoothStream` + `useChat` throttling and optimize Markdown cost with Stable Blocks + Active Tail. Keep business actions, tool execution, message-edit safety, and history persistence independent from the presentation layer.

**Tech Stack:** Next.js 14, React 18, TypeScript, AI SDK `ai@^7.0.58` / `@ai-sdk/react@^4.0.61`, ReactMarkdown, remark-gfm, remark-math, KaTeX, Tailwind CSS, Vitest.

## Global Constraints

- `UIMessage.parts` is the source of truth for assistant-turn chronology; do not flatten all assistant text parts before deriving the worklog.
- Use AI SDK `step-start` as the primary real step boundary; do not invent steps from prose.
- Never render hidden reasoning / chain-of-thought, raw tool arguments, raw tool output JSON, provider metadata, API details, storage keys, or internal IDs as worklog details.
- Intermediate visible model text is retained as low-weight commentary; final answer is a separate surface.
- Final-answer candidate appears immediately after the last settled tool when trailing text begins. If a later tool part arrives, that candidate is deterministically downgraded to commentary.
- Worklog tool rows default to one line; current tool is visually strongest; completed tools remain visible at low weight; safe details expand only from deterministic whitelisted formatters.
- Keep existing Action Cards / Proposal Cards / Task Breakdown Cards factual and unchanged; worklog does not replace them.
- Preserve user-message edit mutation guards against raw tool parts / persisted actions.
- Preserve old conversation compatibility. Historical raw tool calls are not replayed.
- Do not introduce a new blue/purple agent theme. Use existing ClassFlow semantic colors only: `charcoal`, `satin-grey`, `sandrift`, `surface`, `alabaster`, `line`, `line-soft`, `success`, `danger`; Kiro brand color remains limited to existing logo/glow assets.
- Do not show per-step timestamps.
- No new runtime dependencies.
- Streaming cadence target: server `smoothStream` with `Intl.Segmenter("zh", { granularity: "word" })` and initial `delayInMs: 12`; client `experimental_throttle: 50`.
- Active Tail must not run ReactMarkdown / GFM / Math / KaTeX until it becomes stable or streaming finishes.
- Preserve reduced-motion behavior; do not add a typewriter animation.
- Testing stays focused: direct Vitest files + `npm run typecheck`. Do not run full Vitest, build, or Playwright unless a focused failure proves escalation is necessary.

---

### Task 1: Ordered Assistant-Turn Presentation Model + Safe Tool Details

**Files:**
- Create: `lib/ai/presentation/turnPresentation.ts`
- Create: `lib/ai/presentation/toolActivityDetails.ts`
- Create: `tests/kiroTurnPresentation.test.ts`
- Modify: `hooks/useKiroChat.ts`

**Interfaces:**
- Consumes: raw assistant `UIMessage.parts`, `KIRO_MUTATING_TOOL_NAMES`, `toolLabel()`.
- Produces:

```ts
export type KiroTurnPhase = "working" | "composing" | "answering" | "done";

export type KiroWorklogBlock =
  | {
      kind: "commentary";
      id: string;
      text: string;
      streaming: boolean;
      stepIndex: number;
    }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      toolName: string;
      label: string;
      status: "working" | "done" | "error";
      toolKind: "read" | "write";
      safeDetails: string[];
      stepIndex: number;
    };

export interface KiroAssistantTurnPresentation {
  worklog: KiroWorklogBlock[];
  answer: string;
  answerStreaming: boolean;
  hasTools: boolean;
  worklogDone: boolean;
  phase: KiroTurnPhase;
}

export function deriveKiroAssistantTurn(
  parts: unknown[],
  messageStreaming: boolean
): KiroAssistantTurnPresentation;

export function formatKiroToolActivityDetail(input: {
  toolName: string;
  status: "working" | "done" | "error";
  input?: unknown;
  output?: unknown;
}): string[];
```

- `KiroChatMessageView` gains:

```ts
assistantTurn?: KiroAssistantTurnPresentation;
```

- For assistant messages, `KiroChatMessageView.content` becomes the **final-answer text only**. User-message `content` semantics remain unchanged.

- [ ] **Step 1: Write the failing presentation tests**

Create `tests/kiroTurnPresentation.test.ts` with synthetic parts. At minimum include these cases:

```ts
import { describe, expect, it } from "vitest";
import { deriveKiroAssistantTurn } from "@/lib/ai/presentation/turnPresentation";
import { formatKiroToolActivityDetail } from "@/lib/ai/presentation/toolActivityDetails";

const doneTool = (name: string, id: string, output: unknown = { ok: true, data: {} }) => ({
  type: `tool-${name}`,
  toolCallId: id,
  state: "output-available",
  output,
});

describe("deriveKiroAssistantTurn", () => {
  it("preserves commentary/tool order and exposes only trailing post-tool text as answer", () => {
    const parts = [
      { type: "step-start" },
      { type: "text", text: "我先看看今天的任务" },
      doneTool("search_assignments", "t1", { ok: true, data: { items: [{ id: "a1" }] } }),
      { type: "step-start" },
      { type: "text", text: "再确认一下 TCP 抓包" },
      doneTool("get_assignment", "t2", { ok: true, data: { title: "TCP 抓包" } }),
      { type: "step-start" },
      { type: "text", text: "今天建议优先处理 TCP 抓包。", state: "streaming" },
    ];

    const p = deriveKiroAssistantTurn(parts, true);
    expect(p.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool"]);
    expect(p.answer).toBe("今天建议优先处理 TCP 抓包。");
    expect(p.phase).toBe("answering");
    expect(p.worklogDone).toBe(true);
  });

  it("renders a no-tool turn as a normal answer", () => {
    const p = deriveKiroAssistantTurn(
      [{ type: "text", text: "这是普通回答。", state: "streaming" }],
      true
    );
    expect(p.worklog).toEqual([]);
    expect(p.answer).toBe("这是普通回答。");
    expect(p.hasTools).toBe(false);
  });

  it("downgrades a provisional answer to commentary if a later tool arrives", () => {
    const before = [
      doneTool("search_assignments", "t1"),
      { type: "step-start" },
      { type: "text", text: "我再看看本周课表" },
    ];
    expect(deriveKiroAssistantTurn(before, true).answer).toBe("我再看看本周课表");

    const after = [
      ...before,
      { type: "tool-get_week_schedule", toolCallId: "t2", state: "input-available", input: {} },
    ];
    const p = deriveKiroAssistantTurn(after, true);
    expect(p.answer).toBe("");
    expect(p.worklog.some((b) => b.kind === "commentary" && b.text.includes("本周课表"))).toBe(true);
  });

  it("never exposes reasoning parts", () => {
    const p = deriveKiroAssistantTurn(
      [
        { type: "reasoning", text: "hidden chain of thought" },
        { type: "text", text: "用户可见回答" },
      ],
      false
    );
    expect(JSON.stringify(p)).not.toContain("hidden chain of thought");
    expect(p.answer).toBe("用户可见回答");
  });
});

describe("formatKiroToolActivityDetail", () => {
  it("returns safe semantic details instead of raw JSON", () => {
    const details = formatKiroToolActivityDetail({
      toolName: "search_assignments",
      status: "done",
      output: { ok: true, data: { items: [{ id: "secret-internal-id" }, { id: "a2" }] } },
    });
    expect(details.some((x) => x.includes("2"))).toBe(true);
    expect(details.join(" ")).not.toContain("secret-internal-id");
    expect(details.join(" ")).not.toContain("{");
  });

  it("unknown tool falls back to status text only", () => {
    expect(
      formatKiroToolActivityDetail({
        toolName: "unknown_tool",
        status: "done",
        output: { privateValue: "do-not-render" },
      })
    ).toEqual(["已完成"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
```

Expected: FAIL because `turnPresentation.ts` / `toolActivityDetails.ts` do not exist yet.

- [ ] **Step 3: Implement the safe tool detail formatter**

In `lib/ai/presentation/toolActivityDetails.ts`, use defensive record/array readers only. Required behavior:

```ts
const STATUS_FALLBACK = {
  working: "正在处理…",
  done: "已完成",
  error: "执行未完成",
} as const;
```

Whitelist these detail families without serializing arbitrary objects:

```ts
// search_assignments / get_upcoming_assignments:
// if data.items or data.assignments is an array -> `找到 N 个任务`

// get_week_schedule:
// if data.items or data.schedules is an array -> `读取 N 条课表安排`

// get_assignment:
// if data.title is a non-empty string -> `已读取「<title>」`

// apply_change_set:
// if data.count or action.changeSet.count is a finite number -> `完成 N 项修改`

// any successful write tool:
// if output.action.title is a non-empty string -> `已处理「<title>」`
```

Never include `errorText`, IDs, storage keys, raw object keys, or `JSON.stringify(output)` in the returned strings. Unknown shapes return only the status fallback.

- [ ] **Step 4: Implement ordered turn derivation**

In `lib/ai/presentation/turnPresentation.ts`:

1. Iterate parts in original order.
2. Increment `stepIndex` on every `step-start` after the initial step.
3. Ignore `reasoning` parts completely.
4. Treat `tool-*` parts as tool rows. Tool state mapping:

```ts
if (state === "output-error") status = "error";
else if (state === "output-available") status = "done";
else status = "working";
```

5. `toolKind` is `write` iff `KIRO_MUTATING_TOOL_NAMES` includes the tool name.
6. Determine `lastToolPartIndex` from the ordered parts.
7. A trailing text part can become answer text only when:
   - there are no tools in the message; or
   - it appears after the current `lastToolPartIndex`, and the latest tool is settled (`done` or `error`).
8. If a later tool part appears, re-derivation naturally moves `lastToolPartIndex` after the provisional text; that text returns to worklog commentary.
9. Merge adjacent commentary text parts within the same step into one commentary block.
10. Phase rules:

```ts
if (!messageStreaming) phase = "done";
else if (answer.length > 0) phase = "answering";
else if (hasTools && every tool is done/error) phase = "composing";
else phase = "working";
```

`worklogDone = hasTools && (phase === "answering" || phase === "done")`.

- [ ] **Step 5: Wire the presentation into `useKiroChat.ts` without changing tool execution**

Update `toView(m)`:

```ts
const assistantTurn =
  m.role === "assistant"
    ? deriveKiroAssistantTurn(parts as unknown[], streaming)
    : undefined;

const content =
  m.role === "assistant"
    ? assistantTurn?.answer ?? ""
    : messageTextOf(m);
```

Keep current action/proposal/breakdown extraction and mutation detection based on raw parts. Return `assistantTurn` only for assistant views.

Do not modify `onToolCall`, write executors, read executors, limits, confirmation, Undo, or message-edit guards.

- [ ] **Step 6: Run focused verification**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts tests/kiroMessageEditing.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add lib/ai/presentation/turnPresentation.ts lib/ai/presentation/toolActivityDetails.ts hooks/useKiroChat.ts tests/kiroTurnPresentation.test.ts
git commit -m "feat(kiro): derive ordered assistant turn presentation"
```

---

### Task 2: Compact ClassFlow Worklog UI + Final-Answer Separation

**Files:**
- Create: `components/kiro/KiroWorklog.tsx`
- Modify: `components/kiro/KiroMessage.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Optional cleanup only if unused after integration: `components/kiro/KiroActivityTrace.tsx`

**Interfaces:**
- Consumes: `KiroAssistantTurnPresentation` from Task 1.
- Produces:

```tsx
export function KiroWorklog({
  presentation,
  compact,
}: {
  presentation: KiroAssistantTurnPresentation;
  compact?: boolean;
}): JSX.Element | null;

export function KiroPendingIndicator(): JSX.Element;
```

- `KiroMessage` gains:

```ts
assistantTurn?: KiroAssistantTurnPresentation;
```

- [ ] **Step 1: Add minimal UI assertions to the existing pure presentation test**

Do not create a component/E2E harness. Add assertions that the presentation model exposes everything the UI needs:

```ts
it("marks current and completed tools without inventing pending steps", () => {
  const p = deriveKiroAssistantTurn(
    [
      doneTool("search_assignments", "t1"),
      { type: "step-start" },
      { type: "tool-get_assignment", toolCallId: "t2", state: "input-available", input: {} },
    ],
    true
  );
  const tools = p.worklog.filter((b) => b.kind === "tool");
  expect(tools.map((t) => t.status)).toEqual(["done", "working"]);
  expect(tools).toHaveLength(2);
});
```

- [ ] **Step 2: Build `KiroWorklog.tsx` with existing ClassFlow colors only**

Visual contract:

```text
commentary        text-[11px] text-sandrift leading-relaxed line-clamp-2
completed tool    Check icon + text-[11px] text-satin-grey; no card background
current tool      Loader2 + text-charcoal font-semibold + bg-alabaster/50 + border-line-soft
error tool        danger icon/text using existing danger semantic token
connector         border-line-soft only, visually weak
safe details      text-[10px]/[11px] text-satin-grey, indented under the row
```

Use `Check`, `Loader2`, `CircleAlert`, `ChevronDown` from Lucide. Do **not** add blue/purple classes or a new accent variable.

Tool row interaction:

```tsx
<button aria-expanded={expanded} ...>
  ...
</button>
```

- default collapsed;
- current/complete/error rows may be expanded;
- expanded content renders only `safeDetails` already produced by the pure formatter;
- never read `input` / `output` inside the React component.

Worklog footer:

- if `phase === "composing"`: low-weight loader line `正在整理结果…`;
- if `worklogDone && toolCount > 1`: low-weight `已完成 N 个步骤`;
- divider before answer: `border-t border-line-soft`.

`KiroPendingIndicator` is shown only before any visible assistant part exists and uses existing Kiro logo/glow + `正在处理`.

- [ ] **Step 3: Integrate worklog and answer into `KiroMessage.tsx`**

Keep the existing outer assistant row and Kiro mark so the logo appears once per assistant turn.

Inside the assistant content column:

```tsx
{assistantTurn?.hasTools && (
  <KiroWorklog presentation={assistantTurn} />
)}

{content ? (
  <>
    <KiroMarkdown content={content} sources={sources} />
    {streaming && assistantTurn?.phase === "answering" ? <existing cursor /> : null}
  </>
) : null}

{children}
```

For Task 2, final answer may still use existing full `KiroMarkdown`; Task 4 replaces only this renderer.

Do not show a streaming cursor on commentary/tool rows.

- [ ] **Step 4: Remove the old whole-turn ActivityTrace from the normal conversation flow**

In `KiroConversation.tsx`:

- stop rendering the current bottom-level `KiroActivityTrace` worklog;
- pass `view.assistantTurn` into `KiroMessage`;
- show `<KiroPendingIndicator />` only when `turnInFlight` is true and the latest visible assistant view has neither final content nor worklog blocks;
- keep Error Card, Action Cards, Proposal Cards, Task Breakdown Cards, retry/edit/undo flows unchanged.

Update `KiroChatSurface.tsx` to stop passing obsolete `activity` into `KiroConversation` if the prop is removed.

It is acceptable for `useKiroChat` to keep returning the legacy `activity` value temporarily if other code/tests still import it. Do not display two worklogs.

- [ ] **Step 5: Verify only the affected contract and TypeScript**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
npm run typecheck
```

Do not add Playwright for this task.

- [ ] **Step 6: Commit**

```bash
git add components/kiro/KiroWorklog.tsx components/kiro/KiroMessage.tsx components/kiro/KiroConversation.tsx components/kiro/KiroChatSurface.tsx tests/kiroTurnPresentation.test.ts
git commit -m "ui(kiro): add compact ordered agent worklog"
```

---

### Task 3: Server Stream Smoothing + Client Message Throttling

**Files:**
- Modify: `app/api/ai/chat/route.ts`
- Modify: `hooks/useKiroChat.ts`

**Interfaces:**
- Server uses AI SDK `smoothStream` as `streamText.experimental_transform`.
- Client `useChat` uses `experimental_throttle: 50`.

- [ ] **Step 1: Confirm installed APIs before editing**

Inspect the installed package types (or current official AI SDK docs if package types are not locally searchable) and confirm these exact options compile for the repository's versions:

```ts
import { smoothStream } from "ai";

experimental_transform: smoothStream({
  chunking: new Intl.Segmenter("zh", { granularity: "word" }),
  delayInMs: 12,
})
```

and:

```ts
useChat({
  experimental_throttle: 50,
  ...
})
```

Do not upgrade AI SDK packages.

- [ ] **Step 2: Add server smoothing**

In `app/api/ai/chat/route.ts`, add `smoothStream` to the existing `ai` import and define a reusable module-level segmenter:

```ts
const KIRO_STREAM_SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });
```

Add to the existing `streamText` call:

```ts
experimental_transform: smoothStream({
  chunking: KIRO_STREAM_SEGMENTER,
  delayInMs: 12,
}),
```

Keep `guardStream(result.stream)` exactly after `streamText`; do not replace timeout/error normalization. Do not buffer tool events manually.

- [ ] **Step 3: Add client throttling**

In `hooks/useKiroChat.ts`, add to the current `useChat({...})` options:

```ts
experimental_throttle: 50,
```

Do not add a custom token queue, `setInterval`, or requestAnimationFrame text buffer.

- [ ] **Step 4: Verify compile only**

This task is SDK wiring, so no artificial unit test is required. Run:

```bash
npm run typecheck
```

If TypeScript rejects either SDK option, stop and inspect the installed package type definition before changing the design. Do not solve a type mismatch by casting the whole options object to `any`.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai/chat/route.ts hooks/useKiroChat.ts
git commit -m "perf(kiro): smooth and throttle streamed chat updates"
```

---

### Task 4: Stable Markdown Blocks + Lightweight Active Tail

**Files:**
- Create: `lib/ai/streaming/markdownBlocks.ts`
- Create: `components/kiro/KiroStreamingMarkdown.tsx`
- Create: `tests/kiroMarkdownBlocks.test.ts`
- Modify: `components/kiro/KiroMessage.tsx`
- Reuse without changing semantics: `components/kiro/KiroMarkdown.tsx`, `components/kiro/KiroCitation.tsx`

**Interfaces:**

```ts
export interface KiroMarkdownStreamSplit {
  stableBlocks: string[];
  tail: string;
}

export function splitKiroStreamingMarkdown(
  content: string,
  streaming: boolean
): KiroMarkdownStreamSplit;

export function KiroStreamingMarkdown({
  content,
  streaming,
  sources,
}: {
  content: string;
  streaming: boolean;
  sources?: KiroSourceMeta[];
}): JSX.Element;
```

- [ ] **Step 1: Write failing block-splitter tests**

Create `tests/kiroMarkdownBlocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

describe("splitKiroStreamingMarkdown", () => {
  it("freezes complete blank-line-delimited blocks and keeps only the trailing block mutable", () => {
    const r = splitKiroStreamingMarkdown(
      "第一段。\n\n### 原因\n1. 截止时间最近\n2. 当前进度较低\n\n接下来可以",
      true
    );
    expect(r.stableBlocks).toEqual([
      "第一段。",
      "### 原因\n1. 截止时间最近\n2. 当前进度较低",
    ]);
    expect(r.tail).toBe("接下来可以");
  });

  it("does not split inside an open fenced code block", () => {
    const r = splitKiroStreamingMarkdown(
      "```ts\nconst a = 1;\n\nconst b = 2;",
      true
    );
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toContain("const b = 2");
  });

  it("promotes a closed fenced code block", () => {
    const r = splitKiroStreamingMarkdown(
      "```ts\nconst a = 1;\n```\n继续输入",
      true
    );
    expect(r.stableBlocks[0]).toContain("```ts");
    expect(r.tail).toBe("继续输入");
  });

  it("does not split while display math is open", () => {
    const r = splitKiroStreamingMarkdown("$$\na^2 + b^2\n\n", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toContain("a^2 + b^2");
  });

  it("promotes all remaining text when streaming finishes", () => {
    const r = splitKiroStreamingMarkdown("最后一段没有空行", false);
    expect(r.stableBlocks).toEqual(["最后一段没有空行"]);
    expect(r.tail).toBe("");
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/kiroMarkdownBlocks.test.ts
```

Expected: FAIL because the splitter does not exist.

- [ ] **Step 3: Implement the deterministic splitter**

`markdownBlocks.ts` uses a line scanner, not a second Markdown parser.

Track:

```ts
let inFence = false;
let inDisplayMath = false;
```

Rules:

- a line whose trimmed text starts with triple backticks toggles `inFence`;
- outside a fence, an odd number of unescaped `$$` delimiters toggles `inDisplayMath`;
- blank lines become stable boundaries only when both states are false;
- closing a fenced block may create a stable boundary at the closing line even without a following blank line;
- closing display math may create a stable boundary at the closing delimiter line;
- when `streaming === false`, all text is returned as stable blocks and `tail === ""`;
- remove only separator blank lines between blocks; preserve block-internal newlines;
- empty/whitespace-only content returns `{ stableBlocks: [], tail: "" }`.

- [ ] **Step 4: Build `KiroStreamingMarkdown.tsx`**

Implementation structure:

```tsx
const StableMarkdownBlock = React.memo(function StableMarkdownBlock(...) {
  return <KiroMarkdown content={content} sources={sources} />;
});
```

`KiroStreamingMarkdown`:

1. `useMemo` the split result from `content` and `streaming`.
2. Render each stable block through `StableMarkdownBlock`.
3. Render the mutable tail with a lightweight renderer only.

Active Tail rules:

- use `splitCitationSegments(tail)` so a fully closed citation marker can still render as `KiroCitation`;
- plain tail text uses `whitespace-pre-wrap`, the same `--kiro-output-font-size`, and line-height `1.74`;
- do not call `KiroMarkdown`, ReactMarkdown, remark-gfm, remark-math, or KaTeX for the tail;
- incomplete `**`, backticks, headings, tables, formulas remain visible source text until promoted;
- keep existing final streaming cursor outside this component or render one simple cursor at the tail end; do not add a character-by-character animation.

Use a wrapper such as:

```tsx
<div className="space-y-[0.8em]">
  {stableBlocks.map(...) }
  {tail && <KiroActiveTail ... />}
</div>
```

Tune only spacing needed to avoid visible double margins; do not redesign the existing Markdown typography.

- [ ] **Step 5: Replace only final-answer rendering in `KiroMessage.tsx`**

Replace:

```tsx
<KiroMarkdown content={content} sources={sources} />
```

with:

```tsx
<KiroStreamingMarkdown
  content={content}
  streaming={!!streaming}
  sources={sources}
/>
```

Do not use this renderer for user messages or worklog commentary.

- [ ] **Step 6: Verify**

```bash
npx vitest run tests/kiroMarkdownBlocks.test.ts tests/kiroTurnPresentation.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add lib/ai/streaming/markdownBlocks.ts components/kiro/KiroStreamingMarkdown.tsx components/kiro/KiroMessage.tsx tests/kiroMarkdownBlocks.test.ts
git commit -m "perf(kiro): render stable markdown blocks with active tail"
```

---

### Task 5: Single Height-Driven Streaming Scroll Scheduler

**Files:**
- Modify: `components/kiro/KiroConversation.tsx`

**Interfaces:**
- Keeps current `scrollRef`, `contentRef`, `stickToBottomRef`, `showScrollBtn` semantics.
- Streaming height reconciliation is owned by one `ResizeObserver` + one rAF scheduler.

- [ ] **Step 1: Inspect the existing scroll paths before editing**

Identify and preserve these user-facing rules:

- distance `< 80px` means sticky-to-bottom;
- distance `> 160px` shows the existing “回到底部” button;
- conversation switch explicitly jumps to bottom;
- user click on “回到底部” may use smooth scroll unless reduced motion is active.

The duplicate path to remove is the streaming `scrollSignal` effect driven by content length/activity changes. Do not remove the conversation-switch effect.

- [ ] **Step 2: Converge streaming height handling on one scheduler**

Keep one rAF ref and one helper:

```ts
const scheduleHeightReconcile = React.useCallback(() => {
  if (rafRef.current !== null) return;
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    syncScrollState();
  });
}, [syncScrollState]);
```

`ResizeObserver` calls only this scheduler.

Remove the effect whose dependency is a string based on `tail.content.length`, `activity.steps.length`, phase, etc. New message insertion / answer growth / worklog expansion / Action Card growth all change container height and are therefore handled by `ResizeObserver`.

Do not introduce `scrollIntoView` per token or smooth auto-scroll during streaming.

- [ ] **Step 3: Keep explicit non-streaming jumps separate**

Conversation mount/switch may still schedule one direct `el.scrollTop = el.scrollHeight` rAF. User “回到底部” continues to call `scrollTo({ behavior: reduced ? "auto" : "smooth" })`.

- [ ] **Step 4: Verify compile and inspect the diff for accidental scroll behavior changes**

```bash
npm run typecheck
```

No new E2E is required unless the refactor exposes a focused reproducible scroll regression.

- [ ] **Step 5: Commit**

```bash
git add components/kiro/KiroConversation.tsx
git commit -m "perf(kiro): unify streaming scroll reconciliation"
```

---

### Task 6: History Compatibility, Action-Only Turn Retention, and Final Integration Gate

**Files:**
- Modify: `lib/ai/history/sanitize.ts`
- Create: `tests/kiroStreamingHistory.test.ts`
- Optional cleanup if no imports remain: `components/kiro/KiroActivityTrace.tsx`
- Optional cleanup if legacy-only and no imports/tests rely on it: `deriveActivity` code in `hooks/useKiroChat.ts`

**Interfaces:**
- Persisted assistant `content` is already `KiroChatMessageView.content`, which after Task 1 means final-answer text only.
- Assistant turns with factual action cards but no final text must still be retained.
- Old persisted assistant messages restore as text-only UIMessage and therefore derive as ordinary no-tool final answers.

- [ ] **Step 1: Write failing history tests**

Create `tests/kiroStreamingHistory.test.ts` and call the existing `sanitizeConversation()` directly.

Use a minimal valid `KiroChatMessageView` fixture and verify:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import type { KiroChatMessageView } from "@/hooks/useKiroChat";

function assistant(patch: Partial<KiroChatMessageView>): KiroChatMessageView {
  return {
    id: "a1",
    role: "assistant",
    content: "",
    streaming: false,
    canRegenerate: false,
    ...patch,
  };
}

const baseInput = (messages: KiroChatMessageView[]) => ({
  id: "c1",
  title: "测试",
  createdAt: "2026-08-11T00:00:00.000Z",
  provider: "custom",
  model: "test",
  messages,
  manualRefs: [],
  entryRefs: [],
});

describe("Kiro streaming history", () => {
  it("persists final answer content without intermediate commentary", () => {
    const record = sanitizeConversation(
      baseInput([
        assistant({
          content: "最终回答",
          assistantTurn: {
            worklog: [{ kind: "commentary", id: "c", text: "我先看看", streaming: false, stepIndex: 0 }],
            answer: "最终回答",
            answerStreaming: false,
            hasTools: true,
            worklogDone: true,
            phase: "done",
          },
        }),
      ])
    );
    expect(record.messages[0].content).toBe("最终回答");
    expect(record.messages[0].content).not.toContain("我先看看");
  });

  it("retains an assistant turn that has an action card but no final text", () => {
    const record = sanitizeConversation(
      baseInput([
        assistant({
          content: "",
          actions: [
            {
              toolCallId: "t1",
              action: {
                tool: "update_assignment",
                entityType: "assignment",
                entityId: "a1",
                title: "TCP 抓包",
                operation: "update",
                canUndo: false,
              } as never,
            },
          ],
        }),
      ])
    );
    expect(record.messages).toHaveLength(1);
    expect(record.messages[0].actions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify the action-only retention test fails on the old filter**

```bash
npx vitest run tests/kiroStreamingHistory.test.ts
```

Expected before the fix: action-only assistant message is filtered out by the existing content-only assistant filter.

- [ ] **Step 3: Fix the persistence filter only**

In `sanitizeConversation.ts`, replace the current assistant inclusion predicate with behavior equivalent to:

```ts
.filter(
  (m) =>
    m.role === "user" ||
    m.content.length > 0 ||
    (m.actions?.length ?? 0) > 0 ||
    (m.historyActions?.length ?? 0) > 0
)
```

Do not persist worklog raw input/output. Do not add raw tool parts to IndexedDB.

Existing `content: clampContent(m.content)` now naturally persists the final answer only.

- [ ] **Step 4: Remove obsolete presentation code only when proven unused**

Search imports after Tasks 1–5.

If `KiroActivityTrace.tsx` has no runtime imports, delete it.

If `deriveActivity` / `KiroActivity` are no longer consumed anywhere except legacy tests, either:

- keep the exported pure function temporarily for compatibility; or
- remove it and update only the directly affected legacy test.

Do not combine this cleanup with unrelated Kiro refactors.

- [ ] **Step 5: Run the final focused integration gate**

```bash
npx vitest run \
  tests/kiroTurnPresentation.test.ts \
  tests/kiroMarkdownBlocks.test.ts \
  tests/kiroStreamingHistory.test.ts \
  tests/kiroMessageEditing.test.ts

npm run typecheck
```

Do **not** run full `npm test`, `npm run build`, or Playwright unless one of the focused checks exposes a concrete cross-module failure that cannot be diagnosed otherwise.

- [ ] **Step 6: Manual smoke checklist in dev only if convenient**

This is not a required automated E2E. If a dev server is already running, verify one multi-tool turn and one no-tool turn:

```text
multi-tool:
- commentary and tools alternate in real order
- current tool is strongest
- completed tools remain low weight
- safe detail expansion works
- final answer begins streaming immediately after tool work
- no blue/purple worklog styling appears

no-tool:
- normal answer renders directly
- no empty worklog is shown

long answer:
- earlier Markdown blocks stop visually changing
- only the active tail updates
- scrolling follows only when the user remains at the bottom
```

Do not start Playwright solely for this checklist.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/history/sanitize.ts tests/kiroStreamingHistory.test.ts
git add -u components/kiro/KiroActivityTrace.tsx hooks/useKiroChat.ts
git commit -m "fix(kiro): preserve streaming turn history compatibility"
```

If no cleanup files were removed/changed, stage only the history/test files.

---

## Dependency Order

```text
Task 1  Ordered presentation + safe detail formatter
   ↓
Task 2  Worklog UI integration
   ↓
Task 3  Stream smoothing + client throttle
   ↓
Task 4  Stable Blocks + Active Tail
   ↓
Task 5  Scroll scheduler consolidation
   ↓
Task 6  History compatibility + cleanup + final gate
```

Task 3 is technically independent after the current AI SDK types are confirmed, but keep the order above so UI chronology is correct before tuning cadence.

## Final Success Criteria

- A Kiro multi-tool turn is visually readable as `commentary → tool → commentary → tool → final answer`.
- Intermediate narration remains visible but low-weight and never forms one large Markdown paragraph.
- Tool rows are chronological, current step is visually strongest, completed steps remain visible, and only safe deterministic details are expandable.
- Final answer begins streaming immediately after the latest settled tool and is downgraded correctly if a later tool arrives.
- No hidden reasoning / raw tool JSON / raw IDs are exposed.
- No new blue/purple agent UI palette is introduced.
- Provider chunk cadence is smoothed server-side; React chat updates are throttled to 50 ms.
- Stable Markdown blocks stop re-parsing while only Active Tail remains mutable.
- Streaming scroll has one height-driven reconciliation path and respects manual upward scrolling.
- Existing Action Cards, Undo, confirmation, proposal UI, citations, message editing, and historical conversations remain functional.
- Focused Vitest files and `npm run typecheck` pass; full suite/build/E2E remain unnecessary unless a focused failure requires escalation.
