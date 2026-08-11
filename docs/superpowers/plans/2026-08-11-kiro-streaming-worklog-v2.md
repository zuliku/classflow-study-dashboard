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
- Consumes: raw assistant `UIMessage.parts`, `KIRO_MUTATING_TOOL_NAMES`, `toolLabel()` and the existing chat-level `streaming` boolean.
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
  turnInFlight: boolean
): KiroAssistantTurnPresentation;

export function formatKiroToolActivityDetail(input: {
  toolName: string;
  status: "working" | "done" | "error";
  input?: unknown;
  output?: unknown;
}): string[];
```

`KiroChatMessageView` gains:

```ts
assistantTurn?: KiroAssistantTurnPresentation;
```

For assistant messages, `KiroChatMessageView.content` becomes the **final-answer text only**. User-message `content` semantics remain unchanged.

#### Cache requirement

The current message-view cache keys only on `parts` / `metadata`. The final assistant view also depends on whether the current turn is still in flight. Extend the cache with an optional status key so the `streaming → ready` transition cannot reuse a stale `answerStreaming/phase` view:

```ts
export function reuseMessageView<V>(
  cache: Map<string, {
    partsRef: unknown;
    metadataRef: unknown;
    statusRef?: unknown;
    view: V;
  }>,
  id: string,
  parts: unknown,
  metadata: unknown,
  build: () => V,
  statusRef?: unknown
): V;
```

Existing callers/tests that omit `statusRef` remain valid.

- [ ] **Step 1: Write the failing presentation tests**

Create `tests/kiroTurnPresentation.test.ts`:

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
    expect(p.answerStreaming).toBe(true);
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

  it("uses chat-level in-flight state for the composing gap after tools", () => {
    const parts = [doneTool("search_assignments", "t1")];
    expect(deriveKiroAssistantTurn(parts, true).phase).toBe("composing");
    expect(deriveKiroAssistantTurn(parts, false).phase).toBe("done");
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

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
```

Expected: FAIL because the new presentation modules do not exist.

- [ ] **Step 3: Implement the safe tool detail formatter**

Use defensive record/array readers only. Required fallback:

```ts
const STATUS_FALLBACK = {
  working: "正在处理…",
  done: "已完成",
  error: "执行未完成",
} as const;
```

Whitelist these facts only:

```text
search_assignments / get_upcoming_assignments:
  data.items or data.assignments array -> 找到 N 个任务

get_week_schedule:
  data.items or data.schedules array -> 读取 N 条课表安排

get_assignment:
  data.title string -> 已读取「title」

apply_change_set:
  data.count or action.changeSet.count finite number -> 完成 N 项修改

successful write tool:
  output.action.title string -> 已处理「title」
```

Never include `errorText`, IDs, storage keys, raw object keys, or `JSON.stringify(output)`. Unknown shapes return only the status fallback.

- [ ] **Step 4: Implement ordered turn derivation**

Rules:

1. Iterate parts in original order.
2. `step-start` increments a `stepIndex`; it is not rendered.
3. Ignore all `reasoning` parts.
4. `tool-*` state mapping:

```ts
if (state === "output-error") status = "error";
else if (state === "output-available") status = "done";
else status = "working";
```

5. `toolKind` is `write` iff `KIRO_MUTATING_TOOL_NAMES` contains the tool name.
6. Find `lastToolPartIndex`.
7. No tools: all visible text is answer text.
8. With tools: trailing text becomes answer only when it is after `lastToolPartIndex` **and** the latest tool is settled (`done`/`error`). Text elsewhere becomes commentary.
9. If a later tool appears, re-derivation moves `lastToolPartIndex` after the provisional answer; the earlier text becomes commentary automatically.
10. Merge adjacent commentary text parts within the same step.
11. Phase:

```ts
if (!turnInFlight) phase = "done";
else if (answer.length > 0) phase = "answering";
else if (hasTools && every tool is done/error) phase = "composing";
else phase = "working";
```

12. `answerStreaming = turnInFlight && answer.length > 0`.
13. `worklogDone = hasTools && (phase === "answering" || phase === "done")`.

- [ ] **Step 5: Wire the presentation into `useKiroChat.ts` with a status-aware view cache**

Update the internal `toView` signature to accept `turnInFlight`:

```ts
function toView(m: UIMessage, turnInFlight: boolean): KiroChatMessageView
```

For assistant messages:

```ts
const assistantTurn = deriveKiroAssistantTurn(parts as unknown[], turnInFlight);
const content = assistantTurn.answer;
const streaming = assistantTurn.answerStreaming;
```

For user messages, keep `messageTextOf(m)` and `streaming: false`.

In the `messages` `useMemo`, calculate the latest user index once. The current assistant turn is any assistant message after that user while chat-level `streaming` is true:

```ts
const currentTurnInFlight = m.role === "assistant" && idx > lastUserIdx && streaming;
const statusRef = currentTurnInFlight ? "live" : "settled";
```

Pass `statusRef` into the extended `reuseMessageView` cache key so a final `streaming → ready` transition rebuilds the last assistant view even if the parts reference itself did not change.

Keep action/proposal/breakdown extraction and mutation detection based on raw parts. Do not modify `onToolCall`, read/write executors, limits, confirmations, Undo, or message-edit guards.

- [ ] **Step 6: Verify**

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

`KiroMessage` gains:

```ts
assistantTurn?: KiroAssistantTurnPresentation;
```

**Migration constraint:** Do not remove the existing `activity` prop from `KiroConversation` yet. Task 5 removes the old scroll signal that still references it, then removes the prop cleanly. Task 2 only stops rendering `KiroActivityTrace`.

- [ ] **Step 1: Extend the pure presentation test with UI-state facts**

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

- [ ] **Step 2: Build `KiroWorklog.tsx` using only existing semantic colors**

Visual contract:

```text
commentary        text-[11px] text-sandrift leading-relaxed line-clamp-2
completed tool    Check + text-[11px] text-satin-grey; no card background
current tool      Loader2 + text-charcoal font-semibold + bg-alabaster/50 + border-line-soft
error tool        existing danger semantic color
connector         border-line-soft only
safe details      text-[10px]/[11px] text-satin-grey, indented
```

Use `Check`, `Loader2`, `CircleAlert`, `ChevronDown` from Lucide. Do not introduce blue/purple classes or a new agent accent token.

Each tool row is a real button with `aria-expanded`. It starts collapsed and renders only `safeDetails`; the component must never inspect raw tool input/output.

Footer rules:

```text
phase=composing                  ● 正在整理结果…
worklogDone && toolCount > 1     ✓ 已完成 N 个步骤
before final answer              border-t border-line-soft
```

Commentary has no logo, no Markdown parser, no streaming cursor, and remains at most two visual lines.

`KiroPendingIndicator` uses the existing Kiro logo/glow and the text `正在处理`; it exists only for the pre-response gap.

- [ ] **Step 3: Integrate structured worklog into `KiroMessage.tsx`**

Keep the existing outer Kiro mark so the assistant turn shows one logo.

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

For Task 2, the final answer still uses `KiroMarkdown`; Task 4 replaces only that renderer.

- [ ] **Step 4: Integrate in `KiroConversation.tsx` and stop displaying the old ActivityTrace**

Pass `view.assistantTurn` into `KiroMessage`.

Update the empty-assistant guard so a live worklog is not discarded:

```ts
const hasWorklog = (view.assistantTurn?.worklog.length ?? 0) > 0;
if (
  !view.content &&
  !hasWorklog &&
  !view.actions?.length &&
  !view.historyActions?.length
) return null;
```

Stop rendering `<KiroActivityTrace ... />` in the conversation body. Keep the `activity` prop temporarily because the existing `scrollSignal` still reads it until Task 5.

Show `<KiroPendingIndicator />` only when `turnInFlight` is true and the tail has no visible assistant surface:

```ts
const tail = messages[messages.length - 1];
const tailHasAssistantSurface =
  tail?.role === "assistant" &&
  (
    tail.content.length > 0 ||
    (tail.assistantTurn?.worklog.length ?? 0) > 0 ||
    (tail.actions?.length ?? 0) > 0 ||
    (tail.historyActions?.length ?? 0) > 0
  );
const showPending = turnInFlight && !tailHasAssistantSurface;
```

Keep Error Card, Action Cards, Proposal Cards, Task Breakdown Cards, retry/edit/undo behavior unchanged.

- [ ] **Step 5: Verify**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
npm run typecheck
```

No component/E2E harness is required.

- [ ] **Step 6: Commit**

```bash
git add components/kiro/KiroWorklog.tsx components/kiro/KiroMessage.tsx components/kiro/KiroConversation.tsx tests/kiroTurnPresentation.test.ts
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

Check local package types first. The expected supported shapes are:

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

Do not upgrade dependencies and do not cast the complete options object to `any`.

- [ ] **Step 2: Add server smoothing**

In `app/api/ai/chat/route.ts`, add `smoothStream` to the existing `ai` import and define:

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

Keep `guardStream(result.stream)` and existing timeout/error normalization. Do not build a second transform that buffers tool events.

- [ ] **Step 3: Add client throttling**

In the existing `useChat({...})` call:

```ts
experimental_throttle: 50,
```

Do not add a custom token queue, `setInterval`, or rAF text buffer.

- [ ] **Step 4: Verify compile only**

This is SDK configuration wiring, so do not create a fake unit test for constants:

```bash
npm run typecheck
```

If compilation rejects an option, inspect the installed package type definition and fix the actual API usage. Do not bypass it with broad casts.

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
- Reuse: `components/kiro/KiroMarkdown.tsx`, `components/kiro/KiroCitation.tsx`

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

- [ ] **Step 1: Write failing splitter tests**

Create `tests/kiroMarkdownBlocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

describe("splitKiroStreamingMarkdown", () => {
  it("freezes complete blank-line blocks and keeps only the trailing block mutable", () => {
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
    const r = splitKiroStreamingMarkdown("```ts\nconst a = 1;\n\nconst b = 2;", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toContain("const b = 2");
  });

  it("promotes a closed fenced code block", () => {
    const r = splitKiroStreamingMarkdown("```ts\nconst a = 1;\n```\n继续输入", true);
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

- [ ] **Step 3: Implement the deterministic line scanner**

Track:

```ts
let inFence = false;
let inDisplayMath = false;
```

Rules:

- a trimmed line starting with triple backticks toggles `inFence`;
- outside a fence, an odd number of unescaped `$$` delimiters toggles `inDisplayMath`;
- blank lines are stable boundaries only when both states are false;
- closing a fenced block may create a stable boundary on its closing line without waiting for a blank line;
- closing display math may create a stable boundary on its closing line;
- when `streaming === false`, all non-empty text is stable and `tail === ""`;
- strip only separator blank lines between blocks; preserve block-internal newlines;
- whitespace-only content returns `{ stableBlocks: [], tail: "" }`.

This is not a second Markdown parser.

- [ ] **Step 4: Build `KiroStreamingMarkdown.tsx`**

Use:

```tsx
const StableMarkdownBlock = React.memo(function StableMarkdownBlock(...) {
  return <KiroMarkdown content={content} sources={sources} />;
});
```

`KiroStreamingMarkdown` memoizes the split, renders stable blocks with full `KiroMarkdown`, and renders the mutable tail with a lightweight renderer.

Active Tail rules:

- use existing `splitCitationSegments(tail)` so a closed citation can still become `KiroCitation`;
- plain tail text uses `whitespace-pre-wrap`, `var(--kiro-output-font-size)`, line-height `1.74`, and `text-charcoal`;
- never call `KiroMarkdown`, ReactMarkdown, remark-gfm, remark-math, or KaTeX for the tail;
- incomplete Markdown syntax remains visible source text until promotion;
- no character-by-character animation.

Use stable keys that do not change when later blocks are appended, e.g. `key={`${index}:${block.length}`}`. Existing stable block props should remain referentially unchanged so `React.memo` can skip their re-render.

- [ ] **Step 5: Replace only final-answer rendering in `KiroMessage.tsx`**

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
- Modify: `components/kiro/KiroChatSurface.tsx`

**Interfaces:**
- Keeps current `scrollRef`, `contentRef`, `stickToBottomRef`, `showScrollBtn` semantics.
- Streaming height reconciliation is owned by one `ResizeObserver` + one rAF scheduler.
- This task finally removes the now-obsolete `activity` prop from `KiroConversation`.

- [ ] **Step 1: Preserve existing scroll thresholds and explicit jumps**

Do not change:

```text
distance < 80px     sticky-to-bottom
distance > 160px    show “回到底部”
conversation switch direct jump to bottom
manual “回到底部” may smooth-scroll unless reduced motion is active
```

- [ ] **Step 2: Replace duplicate streaming scheduling with one helper**

Keep one rAF ref and use:

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

`ResizeObserver` calls only this helper.

Delete the streaming `scrollSignal` effect based on tail content length, Activity phase/steps, etc. Message insertion, answer growth, worklog expansion, and result-card growth all change wrapper height and are handled by `ResizeObserver`.

Do not add per-token `scrollIntoView` or streaming smooth scroll.

- [ ] **Step 3: Remove the obsolete Activity prop after `scrollSignal` is gone**

In `KiroConversation.tsx`:

- remove `activity` from props;
- remove the `KiroActivity` type import if no longer used.

In `KiroChatSurface.tsx`, stop passing `chat.activity` to `KiroConversation`.

It is fine for `useKiroChat` to keep exporting legacy `activity` temporarily; Task 6 decides whether it is safe to remove.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

No E2E is required unless this focused refactor creates a reproducible scroll regression.

- [ ] **Step 5: Commit**

```bash
git add components/kiro/KiroConversation.tsx components/kiro/KiroChatSurface.tsx
git commit -m "perf(kiro): unify streaming scroll reconciliation"
```

---

### Task 6: History Compatibility, Action-Only Retention, Cleanup, and Final Gate

**Files:**
- Modify: `lib/ai/history/sanitize.ts`
- Create: `tests/kiroStreamingHistory.test.ts`
- Delete only if no imports remain: `components/kiro/KiroActivityTrace.tsx`
- Modify `hooks/useKiroChat.ts` only if removing legacy `deriveActivity` / `activity` is proven safe by repository search and typecheck.

**Interfaces:**
- Persisted assistant `content` is `KiroChatMessageView.content`, which after Task 1 is final-answer text only.
- Assistant turns with action cards but no final text remain persisted.
- Old persisted assistant messages restore as text-only UIMessage and derive as ordinary no-tool final answers.

- [ ] **Step 1: Write failing history tests**

Create `tests/kiroStreamingHistory.test.ts`:

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
  it("persists final answer without intermediate commentary", () => {
    const record = sanitizeConversation(
      baseInput([
        assistant({
          content: "最终回答",
          assistantTurn: {
            worklog: [
              { kind: "commentary", id: "c", text: "我先看看", streaming: false, stepIndex: 0 },
            ],
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

- [ ] **Step 2: Run and verify RED for action-only retention**

```bash
npx vitest run tests/kiroStreamingHistory.test.ts
```

Expected before the fix: action-only assistant message is filtered out by the current content-only assistant predicate.

- [ ] **Step 3: Fix the persistence filter only**

Use behavior equivalent to:

```ts
.filter(
  (m) =>
    m.role === "user" ||
    m.content.length > 0 ||
    (m.actions?.length ?? 0) > 0 ||
    (m.historyActions?.length ?? 0) > 0
)
```

Do not persist worklog raw input/output or raw tool parts. Existing `content: clampContent(m.content)` now persists final answer only.

- [ ] **Step 4: Remove obsolete Activity code only when repository search proves no runtime consumers remain**

Search for `KiroActivityTrace`, `deriveActivity`, `KiroActivity`, and `.activity` consumers.

- If `KiroActivityTrace.tsx` has no imports, delete it.
- If `deriveActivity` / `KiroActivity` are still used by legacy tests or another runtime surface, keep them; unused compatibility code is preferable to breaking unrelated behavior in this task.
- If they have zero consumers, remove the dead code and the `activity` field from the `useKiroChat` return object.

Do not refactor unrelated Kiro runtime code.

- [ ] **Step 5: Run the final focused gate**

```bash
npx vitest run \
  tests/kiroTurnPresentation.test.ts \
  tests/kiroMarkdownBlocks.test.ts \
  tests/kiroStreamingHistory.test.ts \
  tests/kiroMessageEditing.test.ts

npm run typecheck
```

Do not run full `npm test`, `npm run build`, or Playwright unless one focused check exposes a concrete cross-module failure that cannot be diagnosed otherwise.

- [ ] **Step 6: Manual dev smoke only if a dev server is already available**

Verify one multi-tool turn, one no-tool turn, and one long Markdown answer:

```text
multi-tool:
- commentary/tool order matches real execution
- current tool strongest; completed tools low weight
- safe detail expansion never shows raw JSON/IDs
- final answer starts immediately after tool work
- no blue/purple worklog styling

no-tool:
- normal answer renders directly
- no empty worklog

long answer:
- earlier Markdown blocks remain visually stable
- only Active Tail changes
- auto-scroll follows only while user remains at bottom
```

Do not start Playwright solely for this smoke check.

- [ ] **Step 7: Commit**

Stage only files actually touched, then:

```bash
git commit -m "fix(kiro): preserve streaming turn history compatibility"
```

---

## Dependency Order

```text
Task 1  Ordered presentation + safe tool details
   ↓
Task 2  Compact worklog UI
   ↓
Task 3  Server smoothing + client throttle
   ↓
Task 4  Stable Blocks + Active Tail
   ↓
Task 5  Scroll scheduler consolidation
   ↓
Task 6  History compatibility + cleanup + final gate
```

Task 3 is technically independent after the installed AI SDK API is confirmed, but keep this order so chronology is corrected before cadence tuning.

## Final Success Criteria

- A Kiro multi-tool turn reads as `commentary → tool → commentary → tool → final answer` in real order.
- Intermediate narration remains visible but low-weight and never forms one giant Markdown paragraph.
- Tool rows are chronological; current tool is strongest; completed tools remain visible; expandable details are deterministic and safe.
- Final answer begins streaming immediately after the latest settled tool and downgrades correctly if a later tool arrives.
- The composing gap after tool completion is driven by chat-level in-flight state, not text-part state alone.
- No hidden reasoning, raw tool JSON, raw IDs, or provider internals are exposed.
- No new blue/purple agent palette is introduced.
- Provider text cadence is smoothed server-side and React message updates are throttled to 50 ms.
- Stable Markdown blocks stop re-parsing while only Active Tail remains mutable.
- Streaming scroll uses one height-driven reconciliation path and respects manual upward scrolling.
- Existing Action Cards, Undo, confirmations, proposals, citations, message-edit safety, and old conversations remain functional.
- Focused Vitest files and `npm run typecheck` pass; full suite/build/E2E remain unnecessary unless a focused failure requires escalation.
