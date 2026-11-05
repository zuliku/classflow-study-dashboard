# Kiro Streaming UX V5 — Live Turn Focus & Reading Stability

Date: 2026-11-05
Status: Design approved in conversation; implementing

## 1. Background

Kiro already has a mature streaming runtime:

- server-side final-answer smoothing (`textOnlySmoothStream`) with bounded debt;
- client 24ms `useChat` throttle;
- incremental Markdown block scanning and promotion-stable DOM;
- worklog memoization, sticky-bottom scrolling, and a 1Hz tool heartbeat.

The remaining gaps are product-level, not raw throughput:

1. **Focus**: while the final answer streams, the full worklog stays expanded above it. On tool-heavy turns the answer starts far below the fold. ChatGPT / Claude collapse the execution trace when the answer begins.
2. **Liveness**: during reasoning there is no visible, trustworthy status. `reasoningSummary` exists but the conversation row only considers `worklog`, so reasoning-only turns show the generic “正在准备” shell.
3. **Status specificity**: the run header says “正在执行” even when a concrete tool is active. ChatGPT shows “Searching the web”; Claude shows the current tool/action.
4. **Caret placement**: the streaming caret is a sibling after the Markdown block, so it often sits on a new line instead of at the true end of the text.
5. **Reading stability**: when the user scrolls up during streaming, the “back to bottom” button gives no signal that new content arrived below.
6. **Churn**: `reasoningSummary` contains a changing character count, so the worklog timeline is re-rendered for every reasoning token even though nothing visible needs to change.

## 2. Product references (online research)

- Chrome AI docs: render streamed Markdown with a streaming-aware parser, stabilize completed blocks, and avoid re-parsing the whole response.
- “Streaming UI Patterns That Don't Break” (Prompt Bench): stable auto-scroll is a three-state model (anchored / drifted-up / jumped-back); show a jump-to-bottom pill when drifted; do not fight the user.
- Jens Fischer, “Streaming UX”: stream tool calls as they are decided; the status line is doing most of the work; a tool call with no feedback feels broken.
- Claude extended thinking / AI Elements Reasoning: open while thinking, collapse when the answer starts, show “Thought for Xs”; never render raw chain-of-thought.
- ChatGPT: one compact live status row, subtle shimmer, elapsed time, and a completed trace that recedes once the answer begins.

ClassFlow keeps its own warm-neutral visual language. No new agent accent color, no typewriter effect, no fake reasoning text.

## 3. Decisions

### 3.1 Answer-start focus

When the turn enters the answer lane (`composing` after `begin_final_answer`, or `answering`), collapse the worklog once.

- Do not override a manual toggle: `userToggledRef` wins.
- If a provisional answer is later downgraded back to commentary (`working`), re-expand the worklog.
- Do not force-collapse on completion (`done`); the existing “no layout jump at finish” invariant remains.
- `DisclosureRegion` owns the height animation; no new motion primitive.

### 3.2 Reasoning status

- Presentation exposes a stable label (“正在思考”), not a per-token character count.
- The Agent Run header owns the label and its 1Hz elapsed timer; reasoning-only turns render a compact, non-collapsible status row.
- The message/worklog does not re-render per token; raw reasoning text is still never rendered.
- A reasoning-only live turn is a visible assistant row (not the generic pending shell).

### 3.3 Active status

- Derive the active tool label from the last `working` worklog row.
- Header copy becomes “正在{label}” (e.g. “正在搜索网络”, “正在浏览工作区”).
- GUI desktop activity keeps priority: “正在操作电脑”.
- Reasoning-only: “正在思考”; Final Answer streaming: “正在回答”.
- Header elapsed timer is a leaf component; `aria-live` only covers the status text, not the timer.
- Active status text uses a restrained warm-neutral shimmer; reduced motion renders it static.
- When there is no Timeline (reasoning-only / plan-only), the header renders as a static status row without a no-op disclosure control.

### 3.4 Inline caret

- `KiroStreamingMarkdown` owns the caret while streaming.
- Text blocks receive `data-kiro-stream-cursor`; CSS appends an inline caret to the last paragraph/heading/list item/table cell, so it follows the true text end.
- Open code fences and display math render a real caret span inside their stable-geometry fallback.
- No caret on commentary/tool rows or completed answers.

### 3.5 Reading stability

- The scroll reconciler tracks content height while the user is drifted up.
- If height grows during an in-flight turn, the jump-to-bottom control gains a small “new content” dot.
- Returning to the bottom (scroll or click) clears it.
- Auto-scroll remains direct `scrollTop` assignment; no smooth queue during streaming.

## 4. Non-goals

- No raw chain-of-thought or hidden reasoning.
- No new custom streaming protocol; AI SDK remains the transport.
- No change to tool execution, trust boundaries, or persistence.
- No elaborate animation to hide layout work.
- No full-screen redesign of the composer or run header.

## 5. Testing

- Pure: active tool label resolver.
- Component: header shows the active tool label; worklog auto-collapses on answer start and respects manual toggles; reasoning status renders and timers are isolated; caret ownership follows the last streaming block.
- E2E: reasoning → commentary → boundary → final answer; final answer is visible, worklog is collapsed, caret appears while streaming and disappears when settled.
- E2E: user scrolls up during streaming; new content surfaces the jump-to-bottom dot without moving the reading position.
- Run affected Vitest files, typecheck, and the new E2E spec.
