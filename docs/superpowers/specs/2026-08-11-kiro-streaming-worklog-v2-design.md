# Kiro Streaming Worklog V2 — Design Spec

Date: 2026-08-11
Status: Design approved in conversation; pending written-spec review

## 1. Goal

Upgrade Kiro's agent streaming UI so a multi-step turn reads like a coherent agent workflow rather than one large assistant paragraph.

The target interaction pattern is inspired by Codex/Claude Code's compact agent progress presentation, while preserving ClassFlow's own visual language.

This work solves two user-visible problems:

1. Multi-step agent output is visually flattened. Intermediate narration such as “我先看看…” / “接下来确认…” is merged into a single Markdown block, so the actual text → tool → text → tool workflow is lost.
2. Streaming feels visibly choppy. Every incoming text update currently causes the growing assistant body to run through the full Markdown/GFM/Math/KaTeX rendering path again.

## 2. Current Root Causes

### 2.1 Chronology is flattened too early

`useKiroChat.ts` currently joins every assistant `text` part into one `content` string. Tool parts are separately projected into `actions` / `KiroActivity`, so the UI loses the original chronological relationship between text and tools.

AI SDK `UIMessage.parts` is the correct rendering source of truth. `step-start` parts provide real multi-step boundaries and should be preserved rather than reconstructed from prose.

### 2.2 Activity Trace is a parallel summary, not the turn itself

`KiroActivityTrace` currently appears as a separate worklog summary below the conversation flow. It can say which tools ran, but cannot faithfully render:

text commentary → tool call → text commentary → tool call → final answer.

### 2.3 Full Markdown is reparsed while the string grows

`KiroMarkdown` runs citation splitting, math normalization, ReactMarkdown, GFM, remark-math, and KaTeX over the full growing answer. This is expensive when the answer is long.

### 2.4 Streaming cadence is provider-driven

The server currently forwards the provider stream directly. The client also renders chat updates without an explicit `useChat` throttle.

## 3. Approved Product Decisions

### 3.1 Compact Worklog

Use a compact Codex-style worklog:

- Current step is the strongest visual element.
- Completed steps remain visible but low-weight.
- Tool step default is one line.
- Clicking a tool step expands deterministic, safe details.
- Never display raw tool input, raw output JSON, provider metadata, or hidden reasoning / chain-of-thought.
- Intermediate assistant narration is retained and inserted between tool steps as low-weight gray commentary.
- Final answer is visually separate from the worklog.
- Do not show per-step timestamps in V1; they add noise without helping the learning workflow.
- Do not add a second whole-worklog collapse interaction in V1. Only individual tool rows need expandable details.

Example:

```text
Kiro

  我先看看今天最需要关注的任务
  ✓ 查看近期 DDL

  再确认一下「TCP 抓包」
  ● 正在读取任务详情…

  顺便看看本周课程安排
  ✓ 查看课表

  ✓ 已完成 3 个步骤
  ─────────────────

  今天建议优先处理「TCP 抓包」……
```

### 3.2 Intermediate narration stays, but is demoted

Intermediate narration remains visible to retain the feeling of an agent working step by step, but it is not rendered as a normal assistant answer.

Presentation:

- 11–12 px equivalent.
- `text-sandrift` / `text-satin-grey` hierarchy.
- No separate Kiro logo per narration fragment.
- No streaming cursor.
- No full Markdown pipeline.
- Preserve line breaks but keep the surface visually compact.
- Default visual clamp is two lines per commentary fragment; the full text stays in the DOM for accessibility and may be exposed via native title on desktop.
- Do not expose or derive hidden reasoning. Only render actual visible model `text` parts.

### 3.3 Tool rows

Default row:

```text
✓ 查看近期 DDL
● 正在读取任务详情…
○ 查看课表
```

Rules:

- completed: check icon + low-weight text;
- working: spinner/status mark + `text-charcoal`, may use a subtle ClassFlow surface;
- error: danger semantic color;
- pending is shown only when a real part/state exists; do not invent planned steps from model intent;
- click row to expand safe details;
- detail formatter is deterministic and whitelisted per tool family;
- unknown/unformatted tools fall back to status-only detail rather than raw JSON.

### 3.4 Final answer starts immediately

When the post-tool text-only step begins, render it immediately below the worklog as the answer candidate. Do not wait for the entire response to finish.

The worklog freezes above it and becomes lower visual weight.

Because AI SDK does not label a step as “final” before the step finishes, this classification is provisional:

- no tool calls in the whole turn → all assistant text is the normal final answer;
- after at least one completed tool step, a new text-only current step is treated as the final-answer candidate immediately;
- if that same step later emits a tool call, downgrade that text to worklog commentary and continue the workflow;
- this downgrade is expected to be rare and must not corrupt message order or tool execution state.

No custom hidden reasoning protocol or brittle text sentinel is introduced.

## 4. Turn Presentation Model

Introduce a pure presentation layer that derives ordered blocks from `UIMessage.parts`.

Suggested types:

```ts
export type KiroTurnBlock =
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
  worklog: KiroTurnBlock[];
  answer: string;
  answerStreaming: boolean;
  hasTools: boolean;
  worklogDone: boolean;
}
```

Exact internal names may vary, but the boundary is mandatory:

`UIMessage.parts` → pure presentation derivation → UI.

Do not make React components re-interpret raw Tool JSON independently.

### Step derivation

1. Read parts in their original order.
2. Use `step-start` as the primary real step boundary.
3. Preserve text/tool order within a step.
4. Ignore `reasoning` parts for user-facing worklog content.
5. Tool semantic labels continue to come from the centralized Kiro tool formatter registry.
6. Write action cards remain factual result UI and are not replaced by worklog rows.

## 5. Safe Tool Detail Contract

Expanded worklog details are not a generic JSON viewer.

Create a deterministic formatter boundary such as:

```ts
formatKiroToolActivityDetail(toolName, input, output): string[]
```

Rules:

- output is sanitized before reaching the component;
- only explicitly whitelisted user-facing facts may appear;
- never display IDs unless the ID itself is meaningful to the user;
- never display storage keys, file paths, API details, provider metadata, raw schemas, or raw serialized objects;
- Change Set may show a deterministic modified-item count;
- write tools may show the affected entity title / operation using existing factual action results;
- read tools may show safe counts or short result summaries when their output shape is known;
- fallback is a simple status line (e.g. “已完成读取”) rather than guessed details.

## 6. Streaming Performance Architecture

Use all three approved layers.

### 6.1 Server smoothing

The installed AI SDK supports `smoothStream`.

Apply it to `streamText` using locale-aware Chinese segmentation:

```ts
const zhSegmenter = new Intl.Segmenter("zh", { granularity: "word" });

experimental_transform: smoothStream({
  chunking: zhSegmenter,
  delayInMs: 12,
})
```

12 ms is the initial tuning target, not a product-visible contract. If targeted profiling shows unnecessary latency, tune within roughly 8–20 ms.

Non-text events (tool calls / step events) must remain immediate; do not buffer tools behind visual smoothing.

### 6.2 Client throttling

Configure `useChat` with an initial target:

```ts
experimental_throttle: 50
```

This caps UI message/data update frequency to approximately 20 updates per second while preserving responsive tool events.

Do not implement an additional homegrown token queue unless the SDK throttle proves insufficient in profiling.

### 6.3 Stable Blocks + Active Tail

Final-answer Markdown rendering is split into:

- **Stable blocks:** completed Markdown blocks rendered with the existing full `KiroMarkdown` pipeline and memoized/frozen.
- **Active tail:** only the currently incomplete trailing block updates during streaming and uses a lightweight renderer.

The lightweight tail:

- preserves whitespace / line breaks;
- may use the existing citation segment parser so a complete citation can still render as a citation pill;
- does not run ReactMarkdown, remark-gfm, remark-math, or KaTeX while incomplete;
- does not try to render incomplete Markdown syntax as formatting;
- promotes to full Markdown when the block becomes stable or when streaming finishes.

### Stable-boundary rules

Create a pure block splitter. Minimum required behavior:

- blank-line boundary outside fenced code / display math;
- closed fenced code block may become stable;
- do not split while a triple-backtick fence remains open;
- do not split while display math remains open;
- final streaming tail stays mutable;
- on stream completion, promote all remaining tail text to full Markdown.

The splitter must be deterministic and unit-testable. It does not need to be a second Markdown parser.

## 7. Scroll Behavior

Keep the current sticky-to-bottom semantics:

- when user remains near the bottom, follow streaming output;
- once the user scrolls upward, stop forcing them down;
- show the existing “回到底部” control when sufficiently far away.

Current code has both a content-length/phase-driven rAF scroll trigger and a `ResizeObserver`. V2 should converge on one height-driven scheduling path where possible:

- `ResizeObserver` + a single rAF scheduler owns streaming height reconciliation;
- conversation switch may still explicitly jump to the bottom;
- user-triggered “回到底部” may still use smooth scrolling when motion is not reduced;
- no per-token smooth scrolling queue.

Do not rewrite scrolling unrelated to Kiro streaming.

## 8. Visual Design and Color Consistency

The generated concept mockup is a layout reference only. **Do not copy its blue/purple palette.**

Kiro Streaming V2 must use the existing ClassFlow semantic design system.

### Required palette hierarchy

- primary text / current tool: `text-charcoal` / existing dark charcoal;
- secondary text: `text-satin-grey`;
- commentary / tertiary text: `text-sandrift`;
- background emphasis: `bg-surface`, `bg-alabaster` with restrained opacity;
- borders / timeline: `border-line`, `border-line-soft`;
- success: existing `text-success`, not bright green;
- error: existing `text-danger`, `bg-danger-bg`, `border-danger-border`;
- Kiro brand color comes only from the existing Kiro logo assets and existing Kiro glow treatment;
- do not introduce a new blue/purple “agent accent” token for worklog state.

### Component hierarchy

- Kiro logo appears once for the assistant turn, aligned with the worklog/final-answer document flow.
- Worklog is not a stack of large cards.
- Current tool may use one subtle rounded surface to create focus.
- Completed steps should visually recede.
- Timeline connector, if used, must be `line-soft` and very weak.
- Final answer uses the existing `--kiro-output-font-size` and Kiro Markdown typography.
- Divider before final answer uses `border-line-soft`.

## 9. Relationship to Existing Components

### `KiroActivityTrace`

V2 supersedes its “whole turn summary at the bottom” role.

It may be removed after the new worklog is integrated, or temporarily become a compatibility wrapper during migration. Do not keep two simultaneous worklog UIs.

### `KiroMessage`

Remains the top-level assistant turn surface, but should receive structured worklog + final-answer presentation rather than one flattened content string.

### Action Cards / Proposals / Task Breakdown

Remain factual UI and continue to appear after/with the final answer according to existing semantics. Worklog rows do not replace them.

### User Message Edit

Must continue to inspect raw tool parts / persisted actions for mutation safety. The visual presentation refactor must not weaken edit suffix guards.

## 10. Conversation History

V2 does not need to persist raw tool input/output to reproduce the worklog.

For the first implementation, historical persistence remains conservative:

- persisted assistant `content` should represent the user-facing final answer, not a concatenation of all intermediate commentary;
- existing persisted Action Cards remain unchanged;
- an assistant message that has no final-answer text but does contain persisted Action Cards must still be retained by `sanitizeConversation` rather than being filtered out;
- old conversations load normally;
- raw tool calls are never replayed;
- persisting the full safe read-tool worklog across reload is explicitly deferred unless it can be added as a small optional sanitized field without complicating the core streaming rollout.

This keeps the first rollout focused on live agent legibility and performance.

## 11. Accessibility and Motion

- Worklog state is understandable without color alone: icon + text state.
- Expandable tool rows use real buttons and `aria-expanded`.
- Progress changes use polite live-region behavior; do not announce every text token.
- Respect the existing `data-motion="reduced"` behavior.
- No blinking typewriter animation; streaming smoothness comes from data cadence and rendering efficiency.

## 12. Testing Strategy

Keep tests focused and cheap.

Required pure tests:

1. turn-block derivation preserves text/tool ordering and `step-start` grouping;
2. no-tool turn becomes a normal final answer;
3. completed tool steps + new text-only step produces an immediate final-answer candidate;
4. if that candidate later gains a tool, it is downgraded to commentary without losing order;
5. reasoning parts never appear in worklog;
6. safe tool detail formatter never falls back to raw JSON;
7. Stable Blocks splitter freezes complete blocks and leaves only the incomplete tail mutable;
8. open code fence / display math is not split early;
9. history sanitization retains tool-only assistant messages when they contain persisted action facts.

Integration verification should normally be limited to the directly affected Kiro tests plus `npm run typecheck`.

Do not default to the full Vitest suite, production build, or Playwright unless a targeted failure requires escalation.

## 13. Performance Acceptance Criteria

The implementation should be considered successful when:

- a tool-heavy turn visibly presents real step order instead of one large intermediate paragraph;
- completed steps stay legible but subdued;
- the current step is obvious at a glance;
- final answer begins streaming immediately under the frozen worklog;
- long final answers no longer run the full Markdown/KaTeX pipeline over the entire growing string on every visible update;
- user scrolling upward is not fought by auto-scroll;
- no raw chain-of-thought, tool JSON, or sensitive implementation detail is exposed;
- ClassFlow's warm neutral visual language remains intact.

## 14. Non-goals

- Do not expose chain-of-thought or reasoning parts.
- Do not redesign Kiro Composer, header, model selector, context strip, or action cards unless required for compatibility.
- Do not introduce a new agent color theme.
- Do not add a terminal/log console.
- Do not create a generic raw Tool inspector.
- Do not replace AI SDK streaming with a custom protocol unless the documented SDK primitives prove insufficient.
- Do not add elaborate animation to mask rendering problems.
