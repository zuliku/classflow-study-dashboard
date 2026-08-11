# Kiro Provisional Commentary Lookahead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Tool-following text from briefly rendering as a large final answer before a later Tool proves that text is Worklog commentary.

**Architecture:** Keep the existing `KiroAssistantTurnPresentation` shape and UI components unchanged. Add one-block lookahead inside the pure `deriveKiroAssistantTurn()` classifier by reusing `splitKiroStreamingMarkdown()`: Tool-following live text remains provisional until a second block starts, the text part finishes, or the turn settles. A later Tool naturally commits the earlier text as commentary because it is now before the latest Tool.

**Tech Stack:** TypeScript, AI SDK UIMessage parts, existing Kiro presentation model, existing Markdown block splitter, Vitest.

## Global Constraints

- Apply provisional buffering only to live turns that already contain at least one Tool.
- No-Tool replies must continue streaming immediately.
- Do not add timers, debounce logic, protocol sentinels, or new React state.
- Reuse `splitKiroStreamingMarkdown(content, true)`; do not create another paragraph parser.
- Provisional text must contribute to neither `worklog` nor `answer`.
- While provisional text is hidden and all Tools are settled, phase remains `composing`, allowing the existing `正在整理结果…` UI to remain visible.
- If a later Tool arrives, the earlier provisional text becomes ordinary Worklog commentary in one block through the existing part-order scan.
- Once answer commitment occurs, the full trailing text becomes `answer` and normal streaming resumes.
- `state === "done"` on all trailing text parts commits immediately, even if only one paragraph exists.
- `turnInFlight === false` flushes all remaining trailing final text.
- Do not change Tool execution, prompts, smoothStream, client throttle, Stable Blocks/Active Tail rendering, history shape, reasoning visibility, action cards, message editing, Worklog colors, or Worklog density behavior.
- Run only `npx vitest run tests/kiroTurnPresentation.test.ts` and `npm run typecheck` unless a focused failure proves broader verification is required.

---

### Task 1: Add one-block provisional lookahead to assistant-turn classification

**Files:**
- Modify: `lib/ai/presentation/turnPresentation.ts`
- Modify: `tests/kiroTurnPresentation.test.ts`

**Interfaces:**
- Consumes: `splitKiroStreamingMarkdown(content: string, streaming: boolean)` from `lib/ai/streaming/markdownBlocks.ts`.
- Produces: no new public UI type. `deriveKiroAssistantTurn(parts, turnInFlight)` keeps its existing return shape.

- [ ] **Step 1: Add focused failing tests**

Extend `tests/kiroTurnPresentation.test.ts` with these cases using the existing `text`, `toolPart`, and `stepStart` helpers:

```ts
it("Tool 后第一段仍在 streaming → provisional，不提前显示 answer", () => {
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text("我先整理一下今天的安排。", "streaming"),
    ],
    true
  );

  expect(p.answer).toBe("");
  expect(p.phase).toBe("composing");
  expect(p.worklog.filter((b) => b.kind === "commentary")).toHaveLength(0);
});

it("第一段已形成 stable block、第二段尚未开始 → 仍 provisional", () => {
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text("第一段已经完整。\n\n", "streaming"),
    ],
    true
  );

  expect(p.answer).toBe("");
  expect(p.phase).toBe("composing");
});

it("第二段开始 → commit 整个 trailing text，并恢复 answering", () => {
  const trailing = "第一段已经完整。\n\n第二段正在生成";
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text(trailing, "streaming"),
    ],
    true
  );

  expect(p.answer).toBe(trailing);
  expect(p.phase).toBe("answering");
  expect(p.answerStreaming).toBe(true);
});

it("Tool 后单段 text 已 done → 立即 commit answer", () => {
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text("最终只有这一段。", "done"),
    ],
    true
  );

  expect(p.answer).toBe("最终只有这一段。");
  expect(p.phase).toBe("answering");
});

it("provisional text 后出现新 Tool → 该 text 只作为 commentary", () => {
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text("让我再确认一下今天可用的时间。", "done"),
      toolPart("get_week_schedule", "input-available", { input: {} }),
    ],
    true
  );

  expect(p.answer).toBe("");
  expect(
    p.worklog
      .filter((b) => b.kind === "commentary")
      .map((b) => (b as { text: string }).text)
  ).toEqual(["让我再确认一下今天可用的时间。"]) ;
});

it("无 Tool reply 不使用 provisional lookahead，继续即时 streaming", () => {
  const p = deriveKiroAssistantTurn([text("你好，正在回答", "streaming")], true);
  expect(p.answer).toBe("你好，正在回答");
  expect(p.phase).toBe("answering");
});

it("turn settle 会 flush Tool 后剩余 provisional text", () => {
  const p = deriveKiroAssistantTurn(
    [
      toolPart("search_assignments", "output-available", {
        output: { ok: true, data: { items: [] } },
      }),
      stepStart(),
      text("最后只有这一段", "streaming"),
    ],
    false
  );

  expect(p.answer).toBe("最后只有这一段");
  expect(p.phase).toBe("done");
});
```

Keep existing tests. If an older test expects a single streaming paragraph after a settled Tool to be immediately `answer`, update that expectation to the approved provisional behavior rather than deleting coverage.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
```

Expected: the new provisional cases fail because the current classifier immediately commits trailing text after a settled Tool.

- [ ] **Step 3: Import the existing stable-block splitter**

In `lib/ai/presentation/turnPresentation.ts` add:

```ts
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";
```

Do not move or duplicate the splitter.

- [ ] **Step 4: Compute trailing Tool-following text before the visible-part scan**

After the first pass has found `lastToolPartIndex` / `lastToolStatus`, derive only the text parts after the latest Tool:

```ts
const trailingTextParts =
  lastToolPartIndex >= 0
    ? rawParts
        .slice(lastToolPartIndex + 1)
        .filter(
          (part): part is Extract<RawPart, { type: "text" }> =>
            part?.type === "text"
        )
    : [];

const trailingText = trailingTextParts
  .map((part) => part.text ?? "")
  .join("");

const hasSettledLastTool =
  lastToolStatus === "done" || lastToolStatus === "error";
```

For Tool-bearing turns only, compute commitment:

```ts
let commitTrailingAnswer = false;

if (lastToolPartIndex >= 0 && hasSettledLastTool && trailingText.length > 0) {
  const split = splitKiroStreamingMarkdown(trailingText, true);
  const hasOneBlockLookahead =
    split.stableBlocks.length > 0 && split.tail.trim().length > 0;
  const trailingTextDone =
    trailingTextParts.length > 0 &&
    trailingTextParts.every((part) => part.state === "done");

  commitTrailingAnswer =
    hasOneBlockLookahead || trailingTextDone || !turnInFlight;
}
```

Do not use punctuation, timeouts, token counts, or string-length thresholds.

- [ ] **Step 5: Change the second-pass text classification minimally**

Keep the no-Tool path exactly immediate.

For `p.type === "text"`, use these semantics:

```ts
const afterLatestTool =
  lastToolPartIndex >= 0 && i > lastToolPartIndex;

const isAnswerText =
  lastToolPartIndex < 0
    ? true
    : afterLatestTool && hasSettledLastTool && commitTrailingAnswer;
```

If `isAnswerText`, keep the existing answer accumulation.

Before falling through to commentary, add the provisional skip:

```ts
if (afterLatestTool && hasSettledLastTool && !commitTrailingAnswer) {
  continue;
}
```

This is essential: provisional text must be invisible, not rendered as commentary token-by-token.

Text that occurs before a later/latest Tool continues through the existing commentary merge path unchanged; therefore when a new Tool arrives, the previously provisional text naturally becomes a committed commentary block.

- [ ] **Step 6: Preserve phase semantics**

Do not add a new phase.

The existing phase logic should produce:

- Tool working → `working`;
- all Tools settled + provisional trailing text hidden + no committed answer → `composing`;
- committed answer while live → `answering`;
- settled turn → `done`.

`answerStreaming` remains:

```ts
turnInFlight && answer.length > 0
```

No new `provisionalText` field is required.

- [ ] **Step 7: Run focused GREEN verification**

```bash
npx vitest run tests/kiroTurnPresentation.test.ts
npm run typecheck
```

Both must pass.

Do not run full Vitest, build, or Playwright unless one of these focused checks reveals a real cross-module problem.

- [ ] **Step 8: Self-review the behavior boundaries**

Confirm in the diff:

1. No-Tool reply is unchanged and streams immediately.
2. Tool + first live paragraph is absent from both `answer` and commentary.
3. A blank-line stable first block alone is still provisional.
4. Starting a second block commits the full trailing text.
5. `state === "done"` commits a one-paragraph answer immediately.
6. A later Tool reclassifies the earlier text only as commentary.
7. `turnInFlight=false` flushes the remaining text.
8. Reasoning remains ignored.
9. No React component, Worklog styling, streaming transport, or history code changed.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/presentation/turnPresentation.ts tests/kiroTurnPresentation.test.ts
git commit -m "fix(kiro): defer tool-following text classification"
```
