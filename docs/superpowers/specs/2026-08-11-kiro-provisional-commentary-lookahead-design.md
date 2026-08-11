# Kiro Provisional Commentary Lookahead — Design Spec

Date: 2026-08-11
Status: Approved in conversation; pending written-spec review

## Goal

Eliminate the visible style flip where text after a Tool first appears as a normal final answer and is later reclassified into small Worklog commentary when another Tool Call arrives.

## Current Root Cause

`deriveKiroAssistantTurn()` currently treats any trailing text after the latest settled Tool as final-answer text immediately. If a later Tool part appears, that same text is reclassified as commentary on the next render. The UI therefore shows a large answer paragraph first, then moves/shrinks it into the Worklog.

## Approved Interaction

Use provisional text classification after Tools:

1. A Tool settles.
2. New trailing text starts streaming.
3. That text is provisional and is not rendered as final-answer Markdown yet.
4. While provisional, the Worklog remains in `composing` and shows the existing `正在整理结果…` state.
5. If a later Tool part appears, the provisional text is now definitively commentary and appears once, as the normal small Worklog commentary block.
6. If no later Tool appears and the first paragraph/block becomes stable, keep one-block lookahead before committing the answer.
7. Once the first stable block exists and a second block has started, commit the entire trailing text as the final answer and resume normal streaming from that point onward.
8. If the trailing text part reaches `state === "done"` before a second block starts, commit it immediately as the final answer; do not wait for an artificial timer.
9. A no-Tool assistant reply continues streaming immediately exactly as today.

## Stable Boundary

Reuse the existing pure helper:

```ts
splitKiroStreamingMarkdown(content, true)
```

Do not create a second paragraph parser.

Final-answer commitment rule for a Tool-bearing live turn:

```ts
const split = splitKiroStreamingMarkdown(trailingText, true);
const hasOneBlockLookahead = split.stableBlocks.length > 0 && split.tail.trim().length > 0;
const trailingTextDone = trailingTextParts.length > 0 && trailingTextParts.every((part) => part.state === "done");
const commitAnswer = hasOneBlockLookahead || trailingTextDone || !turnInFlight;
```

Interpretation:

- first paragraph is still being generated → provisional, hidden from final answer;
- first paragraph ended but second block has not started → still provisional;
- second block begins → first paragraph has been looked ahead past, commit the full trailing text and continue streaming normally;
- model ends the text part after only one paragraph → commit immediately;
- turn settles → commit all remaining trailing text.

## Commentary Commit Rule

Text before a later Tool part is no longer provisional: the presence of that later Tool proves the preceding text belongs to the agent workflow.

That text should be inserted into `worklog` as commentary in one committed block. It must not be shown token-by-token before its classification is known.

No timing debounce is used. Classification is based only on actual UIMessage parts and stable block boundaries.

## Presentation Model

Keep `KiroAssistantTurnPresentation` shape unchanged unless implementation proves a tiny explicit provisional field is necessary. Preferred implementation keeps provisional text internal to `deriveKiroAssistantTurn()`:

- provisional trailing text contributes neither to `worklog` nor `answer`;
- `phase` remains `composing` while Tools are settled and provisional text is uncommitted;
- after answer commitment, `phase` becomes `answering` and `answerStreaming` resumes normal behavior;
- once the turn is settled, `phase` is `done` and all final text is visible.

## Worklog UI

No new UI component is required.

During provisional text:

```text
✓ 读取任务详情
● 正在整理结果…
```

If a new Tool appears:

```text
让我再确认今天可用的学习时间。
● 查询可用学习时间…
```

If it becomes the final answer:

```text
[ListTree] 已完成 N 个步骤
────────────────
今天建议这样安排：

首先……
```

The existing Worklog auto-collapse-on-`answering` behavior remains unchanged. Because `answering` starts only after commitment, the Worklog must not collapse prematurely while provisional text is being generated.

## No-Tool Replies

For assistant turns with no Tool parts:

- do not apply provisional buffering;
- all visible text is still the final answer immediately;
- preserve current streaming responsiveness.

## Safety / Scope

Do not change:

- Tool execution;
- prompts;
- `smoothStream`;
- client throttle;
- Stable Blocks / Active Tail renderer semantics;
- history persistence shape;
- reasoning visibility;
- action cards;
- message edit safety;
- Worklog colors or density rules.

No hidden reasoning is exposed. Only visible `text` parts participate.

## Known Trade-off

The one-block lookahead is a UI heuristic, not a protocol-level guarantee that no future Tool can ever appear after several polished paragraphs. It is intentionally chosen because it removes the common early style flip while keeping final-answer latency low. Do not add timers or protocol sentinels to chase the extremely rare late-tool case in this task.

## Focused Tests

Extend `tests/kiroTurnPresentation.test.ts` with pure cases:

1. settled Tool + streaming first paragraph only → `answer === ""`, `phase === "composing"`;
2. first paragraph stable but second block not started → still provisional;
3. second block starts → answer commits and `phase === "answering"`;
4. trailing text `state === "done"` with one paragraph → answer commits;
5. provisional text followed by a new Tool → text appears as commentary, never answer;
6. no-Tool streaming reply → answer remains immediate;
7. settled turn (`turnInFlight=false`) flushes remaining final text.

Run only the focused test plus `npm run typecheck`. Do not run full Vitest, build, or Playwright unless a focused failure proves escalation is necessary.
