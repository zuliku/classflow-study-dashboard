/**
 * Kiro Live Turn Presentation Controller（Streaming UX V3 + V4 Progressive Worklog）。
 *
 * 纯 Presentation Model + 显式 Final Answer Boundary + 单调 lane commit：
 *
 * 【Agent 执行过程 ≠ Final Answer】是核心不变量：
 * - begin_final_answer（内部控制信号）之前：任何 text = commentary（Worklog），Tool = Worklog Tool Row；
 * - begin_final_answer 之后：任何 text = Final Answer（永久，不依赖任何时间窗口）；
 * - reasoning 永远不可见；
 * - 已 commit 的 lane 永不反向变化。
 *
 * V4（Progressive Worklog）：begin_final_answer 前 = execution channel——
 * 模型产生的 execution text 在 live 阶段立即作为 Worklog commentary 展示，
 * 绝不等待未来 Tool 出现才证明它是 commentary。
 *
 * Legacy fallback（模型不遵守协议时）：
 * A. 无 Tool 且无 boundary → live 期间立即作为 commentary 展示；Turn 真正结束（settled）后
 *    整段 text 恢复为普通 Answer（compatibility fallback，不反向影响正常 Agent progress）。
 * B. 有 Tool 且无 boundary → 保留 Provisional Lookahead（稳定块 + 第二段 / 单段 done / settled）
 *    单调 commit 为 Answer；Tool 之间 / 之前 text 恒为 commentary。
 *
 * 禁止任何基于时间的 lane 猜测（不再有 settle gate / timer）。
 *
 * 使用方：useKiroChat 为每个 assistant message 持有一个 LiveTurnCommitState（ref），
 * 每帧 derivation 通过 updateLiveTurnPresentation() 推进；settled 消息复用同一 commit 保证单调性。
 */

import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";
import { toolLabel } from "@/lib/ai/tools/formatters";
import { formatKiroToolActivityDetail, formatKiroToolActivityHeadline } from "@/lib/ai/presentation/toolActivityDetails";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";
import { isKiroFinalAnswerToolName } from "@/lib/ai/tools/finalAnswer";
import { resolveToolOutcomeStatus } from "@/lib/ai/presentation/toolOutcome";
import { bumpStreamPerf, addStreamPerfChars } from "@/lib/ai/perf/streamPerf";

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
      headline?: string | null;
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

/**
 * 每个 assistant message 跨渲染持久的 commit 状态。
 * 由 useKiroChat 持有（ref map，message id 为 key）；测试可自行创建并多次调用。
 * 只保留「单调性」所需的 commit：boundary 本身来自 parts（tool-begin_final_answer），无需额外状态。
 */
export interface LiveTurnCommitState {
  /** trailing answer 是否已 commit（legacy fallback B：单调） */
  trailingAnswerCommitted: boolean;
  /** trailing commit 时刻的 lastBusinessToolPartIndex：此后所有 text 恒为 answer */
  trailingCommitToolIndex: number;
}

export function createLiveTurnCommitState(): LiveTurnCommitState {
  return {
    trailingAnswerCommitted: false,
    trailingCommitToolIndex: -1,
  };
}

type RawPart =
  | { type: "step-start" }
  | { type: "reasoning" }
  | { type: "text"; text?: string; state?: string }
  | {
      type: string;
      toolCallId?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };

function isToolPart(p: RawPart): p is { type: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown } {
  return typeof p.type === "string" && p.type.startsWith("tool-");
}

function toolNameOf(p: { type: string }): string {
  return p.type.slice("tool-".length);
}

/**
 * V2.3：Tool 状态 = 统一 outcome helper。
 * output-available + output.ok === false → error（红色失败），不是绿色 ✓。
 */
function toolStatusOf(p: { state?: string; output?: unknown }): "working" | "done" | "error" {
  return resolveToolOutcomeStatus({ state: p.state, output: p.output });
}

/** Task 17B：Trusted Web Source Lookup（仅 title / domain 两个安全字段；raw URL/html/rawContent 不进 lookup） */
function collectTrustedWebSources(
  rawParts: RawPart[]
): Map<string, { title: string; domain: string }> {
  const trustedWebSources = new Map<string, { title: string; domain: string }>();
  for (const p of rawParts) {
    if (!isToolPart(p)) continue;
    if (toolNameOf(p) !== "web_search") continue;
    if (toolStatusOf(p) !== "done") continue;
    const data = (p.output as { ok?: boolean; data?: { results?: unknown[] } } | null)?.data;
    const results = data?.results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      const rec = r as { sourceId?: unknown; title?: unknown; domain?: unknown } | null;
      if (typeof rec?.sourceId !== "string" || !rec.sourceId) continue;
      trustedWebSources.set(rec.sourceId, {
        title: typeof rec.title === "string" ? rec.title : "",
        domain: typeof rec.domain === "string" ? rec.domain : "",
      });
    }
  }
  return trustedWebSources;
}

function buildToolBlock(
  p: { type: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown },
  index: number,
  stepIndex: number,
  trustedWebSources: Map<string, { title: string; domain: string }>
): Extract<KiroWorklogBlock, { kind: "tool" }> {
  const toolName = toolNameOf(p);
  const status = toolStatusOf(p);
  const isWrite = (KIRO_MUTATING_TOOL_NAMES as string[]).includes(toolName);
  return {
    kind: "tool",
    id: `tool-${p.toolCallId ?? `${toolName}-${index}`}`,
    toolCallId: p.toolCallId ?? "",
    toolName,
    label: toolLabel(toolName),
    headline: formatKiroToolActivityHeadline({
      toolName,
      status,
      input: p.input,
      output: p.output,
      trustedWebSources,
    }),
    status,
    toolKind: isWrite ? "write" : "read",
    safeDetails: formatKiroToolActivityDetail(toolName, status, p.output),
    stepIndex,
  };
}

/**
 * V4：commentary identity 按 text part（而不是 step）。
 * 同一个真实 text part 的持续 delta → 更新同一个 commentary block；
 * 新的 text part / 新的 SDK step → 新 block。
 * id = commentary-${stepIndex}-${partIndex}（AI SDK v7 text part 无稳定 id，
 * 由 presentation adapter 用 parts 数组位置派生稳定 identity——同一 streaming part 位置不变）。
 */
function appendCommentary(
  worklog: KiroWorklogBlock[],
  text: string,
  isStreaming: boolean,
  stepIndex: number,
  partIndex: number
): void {
  const id = `commentary-${stepIndex}-${partIndex}`;
  const existing = worklog.find(
    (b): b is Extract<KiroWorklogBlock, { kind: "commentary" }> => b.kind === "commentary" && b.id === id
  );
  if (existing) {
    existing.text += text;
    if (isStreaming) existing.streaming = true;
  } else {
    worklog.push({
      kind: "commentary",
      id,
      text,
      streaming: isStreaming,
      stepIndex,
    });
  }
}

/**
 * 推进（或首次建立）一个 assistant message 的 live presentation。
 * commit 状态单调：已 commit 的 lane 永不反向变化；boundary 由 parts 中的
 * tool-begin_final_answer 决定，不依赖任何时间窗口。
 */
export function updateLiveTurnPresentation(
  commit: LiveTurnCommitState,
  parts: unknown[],
  turnInFlight: boolean
): KiroAssistantTurnPresentation {
  bumpStreamPerf("presentationCalls");
  addStreamPerfChars("presentationParts", (parts ?? []).length);
  const rawParts = (parts ?? []) as RawPart[];

  let stepIndex = 0;
  let finalAnswerPartIndex = -1;
  let firstBusinessToolIndex = -1;
  let lastBusinessToolIndex = -1;
  let lastBusinessToolStatus: "working" | "done" | "error" | null = null;

  const trustedWebSources = collectTrustedWebSources(rawParts);

  // 第一遍：定位 Final Answer Boundary 与业务 Tool 位置（begin_final_answer 是控制信号，不算业务 Tool）
  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    if (p?.type === "step-start") continue;
    if (!isToolPart(p)) continue;
    if (isKiroFinalAnswerToolName(toolNameOf(p))) {
      if (finalAnswerPartIndex < 0) finalAnswerPartIndex = i;
      continue;
    }
    if (firstBusinessToolIndex < 0) firstBusinessToolIndex = i;
    lastBusinessToolIndex = i;
    lastBusinessToolStatus = toolStatusOf(p);
  }

  const hasBusinessTools = lastBusinessToolIndex >= 0;
  const hasSettledLastBusinessTool =
    lastBusinessToolStatus === "done" || lastBusinessToolStatus === "error";

  // ---- Legacy fallback B：Trailing Lookahead（单调）----
  // 无 boundary 且存在业务 Tool 时：最后一个业务 Tool 之后的 text 在
  // 「稳定块 + 第二段已开始 / 单段 done / settled」后 commit 为 Answer，commit 后单调。
  const trailingTextParts =
    lastBusinessToolIndex >= 0
      ? rawParts
          .slice(lastBusinessToolIndex + 1)
          .filter((part): part is Extract<RawPart, { type: "text" }> => part?.type === "text")
      : [];
  const trailingText = trailingTextParts.map((part) => part.text ?? "").join("");

  if (
    finalAnswerPartIndex < 0 &&
    !commit.trailingAnswerCommitted &&
    lastBusinessToolIndex >= 0 &&
    hasSettledLastBusinessTool &&
    trailingText.length > 0 &&
    // V4：live 期间 trailing 恒为 execution commentary（begin_final_answer 前 = execution channel）；
    // 只有 Turn 真正 settled 才把 trailing 恢复为普通 Answer（legacy fallback，不破坏 V4 渐进展示）。
    !turnInFlight
  ) {
    const split = splitKiroStreamingMarkdown(trailingText, true);
    const hasOneBlockLookahead = split.stableBlocks.length > 0 && split.tail.trim().length > 0;
    const trailingTextDone =
      trailingTextParts.length > 0 && trailingTextParts.every((part) => part.state === "done");
    if (hasOneBlockLookahead || trailingTextDone || !turnInFlight) {
      commit.trailingAnswerCommitted = true;
      commit.trailingCommitToolIndex = lastBusinessToolIndex;
    }
  }

  // 第二遍：构建 worklog（commentary / tool）+ 提取 answer（lane-aware）
  const worklog: KiroWorklogBlock[] = [];
  const answerTexts: string[] = [];
  let answerPartStreaming = false;

  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    if (!p || typeof p.type !== "string") continue;
    if (p.type === "step-start") {
      stepIndex += 1;
      continue;
    }
    if (p.type === "reasoning") continue;

    if (isToolPart(p)) {
      // 控制信号本身不进入 Worklog（V4.1：无 milestone / 无 Tool Row / 无 Action Card；
      // phase 由 boundary 后的 composing 表达）
      if (isKiroFinalAnswerToolName(toolNameOf(p))) {
        continue;
      }
      worklog.push(buildToolBlock(p, i, stepIndex, trustedWebSources));
      continue;
    }
    if (p.type !== "text") continue;

    const textValue = p.text ?? "";
    const isStreaming = p.state === "streaming";

    // ---- 显式 Boundary（协议通道）----
    if (finalAnswerPartIndex >= 0) {
      if (i > finalAnswerPartIndex) {
        // boundary 后：Final Answer（永久）
        answerTexts.push(textValue);
        if (isStreaming) answerPartStreaming = true;
      } else {
        // boundary 前：永久属于 Worklog
        appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
      }
      continue;
    }

    // ---- 已 commit 的 trailing answer（legacy 单调最高优先级）----
    // 一旦 trailing commit，trailingCommitToolIndex 之后的所有 text 恒为 answer：
    // 即使之后出现新 Tool「越过」本段，也绝不降级为 commentary。
    if (commit.trailingAnswerCommitted && i > commit.trailingCommitToolIndex) {
      answerTexts.push(textValue);
      if (isStreaming) answerPartStreaming = true;
      continue;
    }

    // ---- legacy fallback A：无业务 Tool 且无 boundary ----
    if (firstBusinessToolIndex < 0) {
      if (!turnInFlight) {
        // settled：compatibility fallback——整段 text 恢复为普通 Answer
        answerTexts.push(textValue);
        if (isStreaming) answerPartStreaming = true;
      } else {
        // V4：live 期间立即作为 Worklog commentary 展示（execution channel，不等待 Tool）
        appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
      }
      continue;
    }

    // ---- leading（首个业务 Tool 之前）→ 恒为 commentary ----
    if (i < firstBusinessToolIndex) {
      appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
      continue;
    }

    // ---- trailing（最后一个业务 Tool 之后、尚未 commit）----
    if (i > lastBusinessToolIndex) {
      // V4：begin_final_answer 前 = execution channel——trailing 也立即作为 commentary 展示；
      // trailing commit（lookahead / 单段 done / settled）成立后由上方「已 commit」分支接管为 Answer。
      appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
      continue;
    }

    // ---- 中间（业务 Tool 之间、未 commit 过）text：恒为 commentary ----
    appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
  }

  const answer = answerTexts.join("");

  let phase: KiroTurnPhase;
  if (!turnInFlight) {
    phase = "done";
  } else if (answer.length > 0) {
    phase = "answering";
  } else if (
    // boundary 已到、Final Answer 未开始 → 正在整理回答（V4.1：无 milestone，由 phase 表达）
    finalAnswerPartIndex >= 0 ||
    (hasBusinessTools && worklog.every((b) => b.kind !== "tool" || b.status !== "working"))
  ) {
    phase = "composing";
  } else {
    phase = "working";
  }

  return {
    worklog,
    answer,
    // answerStreaming 只取决于被接受的 answer text parts 是否仍在 streaming（与 Agent Turn in-flight 解耦）
    answerStreaming: turnInFlight && answerPartStreaming,
    hasTools: hasBusinessTools,
    worklogDone: hasBusinessTools && (phase === "answering" || phase === "done"),
    phase,
  };
}

/**
 * 静态推导（每次调用使用 fresh commit）。
 * 供 settled 消息 / 测试使用；live turn 必须使用 updateLiveTurnPresentation 持久 commit。
 * 注意：fresh commit + turnInFlight=true + 无 Tool 且无 boundary 时，text 处于 provisional
 * （fallback A），不会出现在 answer 中——live 场景必须等 turn 真正 settled。
 */
export function deriveKiroAssistantTurn(
  parts: unknown[],
  turnInFlight: boolean
): KiroAssistantTurnPresentation {
  return updateLiveTurnPresentation(createLiveTurnCommitState(), parts, turnInFlight);
}
