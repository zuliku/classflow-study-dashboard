/**
 * Kiro Live Turn Presentation Controller（Streaming UX V2）。
 *
 * 纯 Presentation Model + 单调 lane commit：
 * - 任何已展示给用户的 text 绝不跨视觉通道迁移（Answer ⇄ Commentary 禁止）。
 * - leading text（首个 Tool 之前）：先 provisional（隐藏，UI 显示「正在准备」），
 *   在短暂歧义窗口内发现 Tool → commit commentary；窗口关闭仍未出现 Tool →
 *   commit answer（普通无 Tool 聊天的流式感由此保证）。
 * - trailing text（最后一个 Tool 之后）：沿用 Provisional Lookahead（稳定块 + 第二段已开始 /
 *   单段 done / Turn 结束）→ commit answer；commit 单调，后续新 Tool 不得把已展示文字降级。
 * - answerStreaming 只取决于「被接受为 answer 的 text parts」是否仍有 streaming state，
 *   不再绑定整个 Agent Turn 是否 in-flight。
 *
 * 使用方：useKiroChat 为每个 assistant message 持有一个 LiveTurnCommitState（ref），
 * 每帧 derivation 通过 updateLiveTurnPresentation() 推进；settled 消息复用同一 commit 保证
 * 单调性（fresh state 仅用于测试/静态推导，turnInFlight=false 时同样得到正确结果）。
 */

import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";
import { toolLabel } from "@/lib/ai/tools/formatters";
import { formatKiroToolActivityDetail, formatKiroToolActivityHeadline } from "@/lib/ai/presentation/toolActivityDetails";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

/** leading text 的歧义窗口：窗口内发现 Tool → commentary；窗口关闭仍无 Tool → answer */
export const KIRO_LEADING_SETTLE_GATE_MS = 100;

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

/** 文本展示通道：monotonic（一旦 commit 不可反向变化） */
export type TextLane = "provisional" | "commentary" | "answer";

/**
 * 每个 assistant message 跨渲染持久的 commit 状态。
 * 由 useKiroChat 持有（ref map，message id 为 key）；测试可自行创建并多次调用。
 */
export interface LiveTurnCommitState {
  /** 首个 Tool 之前的 leading text 已 commit 的 lane（null = 仍在 provisional） */
  leadingLane: "commentary" | "answer" | null;
  /** leading provisional 起始时刻（首 token 到达；歧义窗口从此刻起算） */
  leadingProvisionalSinceMs: number | null;
  /** trailing answer 是否已 commit（单调） */
  trailingAnswerCommitted: boolean;
  /** trailing commit 时刻的 lastToolPartIndex：此后所有 text 恒为 answer */
  trailingCommitToolIndex: number;
}

export function createLiveTurnCommitState(): LiveTurnCommitState {
  return {
    leadingLane: null,
    leadingProvisionalSinceMs: null,
    trailingAnswerCommitted: false,
    trailingCommitToolIndex: -1,
  };
}

export interface LiveTurnPresentationOptions {
  now?: () => number;
  settleGateMs?: number;
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

function toolStatusOf(p: { state?: string }): "working" | "done" | "error" {
  if (p.state === "output-error") return "error";
  if (p.state === "output-available") return "done";
  return "working";
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

/** 相邻且属于同一个 step 的 commentary 合并（保持 part 时序） */
function appendCommentary(
  worklog: KiroWorklogBlock[],
  text: string,
  isStreaming: boolean,
  stepIndex: number,
  partIndex: number
): void {
  const last = worklog[worklog.length - 1];
  if (last && last.kind === "commentary" && last.stepIndex === stepIndex) {
    last.text += text;
    if (isStreaming) last.streaming = true;
  } else {
    worklog.push({
      kind: "commentary",
      id: `commentary-${partIndex}`,
      text,
      streaming: isStreaming,
      stepIndex,
    });
  }
}

/**
 * 推进（或首次建立）一个 assistant message 的 live presentation。
 * commit 状态单调：已 commit 的 lane 永不反向变化。
 */
export function updateLiveTurnPresentation(
  commit: LiveTurnCommitState,
  parts: unknown[],
  turnInFlight: boolean,
  options?: LiveTurnPresentationOptions
): KiroAssistantTurnPresentation {
  const now = options?.now ?? Date.now;
  const settleGateMs = options?.settleGateMs ?? KIRO_LEADING_SETTLE_GATE_MS;
  const rawParts = (parts ?? []) as RawPart[];

  let stepIndex = 0;
  let firstToolPartIndex = -1;
  let lastToolPartIndex = -1;
  let lastToolStatus: "working" | "done" | "error" | null = null;

  const trustedWebSources = collectTrustedWebSources(rawParts);

  // 第一遍：定位第一个 / 最后一个 Tool part 与其 settled 状态
  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    if (p?.type === "step-start") continue;
    if (isToolPart(p)) {
      if (firstToolPartIndex < 0) firstToolPartIndex = i;
      lastToolPartIndex = i;
      lastToolStatus = toolStatusOf(p);
    }
  }

  const hasTools = lastToolPartIndex >= 0;
  const hasSettledLastTool = lastToolStatus === "done" || lastToolStatus === "error";

  // ---- Trailing Lookahead（单调）：最后一个 Tool 之后的 text 是否已 commit 为 Final Answer ----
  // 一旦 commit，trailingCommitToolIndex 之后的所有 text 恒为 answer（新 Tool 不得降级）。
  const trailingTextParts =
    lastToolPartIndex >= 0
      ? rawParts
          .slice(lastToolPartIndex + 1)
          .filter((part): part is Extract<RawPart, { type: "text" }> => part?.type === "text")
      : [];
  const trailingText = trailingTextParts.map((part) => part.text ?? "").join("");

  let commitTrailing = commit.trailingAnswerCommitted;
  if (
    !commit.trailingAnswerCommitted &&
    lastToolPartIndex >= 0 &&
    hasSettledLastTool &&
    trailingText.length > 0
  ) {
    // 复用 Stable Block Splitter：第一块已稳定 + 第二块已开始 = lookahead 成立
    const split = splitKiroStreamingMarkdown(trailingText, true);
    const hasOneBlockLookahead = split.stableBlocks.length > 0 && split.tail.trim().length > 0;
    // 单段已完成（不会再出现新段落/新 Tool 的等待理由）
    const trailingTextDone =
      trailingTextParts.length > 0 && trailingTextParts.every((part) => part.state === "done");
    if (hasOneBlockLookahead || trailingTextDone || !turnInFlight) {
      commitTrailing = true;
      commit.trailingAnswerCommitted = true;
      commit.trailingCommitToolIndex = lastToolPartIndex;
    }
  }
  void commitTrailing;

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
      worklog.push(buildToolBlock(p, i, stepIndex, trustedWebSources));
      continue;
    }
    if (p.type !== "text") continue;

    const textValue = p.text ?? "";
    const isStreaming = p.state === "streaming";

    // ---- 已 commit 的 trailing answer（单调最高优先级）----
    // 一旦 trailing commit，trailingCommitToolIndex 之后的所有 text 恒为 answer：
    // 即使之后出现新 Tool「越过」本段，也绝不降级为 commentary。
    if (commit.trailingAnswerCommitted && i > commit.trailingCommitToolIndex) {
      answerTexts.push(textValue);
      if (isStreaming) answerPartStreaming = true;
      continue;
    }

    // ---- leading（首个 Tool 之前）----
    if (firstToolPartIndex < 0 || i < firstToolPartIndex) {
      // 已 commit answer（歧义窗口关闭后）→ 恒为 answer
      if (commit.leadingLane === "answer") {
        answerTexts.push(textValue);
        if (isStreaming) answerPartStreaming = true;
        continue;
      }
      // 已出现 Tool → leading text 证明是旁白（commentary）
      if (hasTools) {
        commit.leadingLane = "commentary";
        appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
        continue;
      }
      // 无 Tool：provisional（隐藏）→ 歧义窗口 / Turn 结束 → commit answer
      if (commit.leadingProvisionalSinceMs === null) {
        commit.leadingProvisionalSinceMs = now();
      }
      const gateElapsed = now() - commit.leadingProvisionalSinceMs >= settleGateMs;
      if (!turnInFlight || gateElapsed) {
        commit.leadingLane = "answer";
        answerTexts.push(textValue);
        if (isStreaming) answerPartStreaming = true;
      }
      continue;
    }

    // ---- trailing（最后一个 Tool 之后、尚未 commit）→ provisional 隐藏 ----
    if (i > lastToolPartIndex) {
      continue;
    }

    // ---- 中间（Tool 之间、未 commit 过）text：恒为 commentary ----
    appendCommentary(worklog, textValue, isStreaming, stepIndex, i);
  }

  const answer = answerTexts.join("");

  let phase: KiroTurnPhase;
  if (!turnInFlight) {
    phase = "done";
  } else if (answer.length > 0) {
    phase = "answering";
  } else if (hasTools && worklog.every((b) => b.kind !== "tool" || b.status !== "working")) {
    phase = "composing";
  } else {
    phase = "working";
  }

  return {
    worklog,
    answer,
    // answerStreaming 只取决于被接受的 answer text parts 是否仍在 streaming（与 Agent Turn in-flight 解耦）
    answerStreaming: turnInFlight && answerPartStreaming,
    hasTools,
    worklogDone: hasTools && (phase === "answering" || phase === "done"),
    phase,
  };
}

/**
 * 静态推导（每次调用使用 fresh commit）。
 * 供 settled 消息 / 测试使用；live turn 必须使用 updateLiveTurnPresentation 持久 commit。
 * 注意：fresh commit + turnInFlight=true + 无 Tool 时，leading text 处于 provisional（gate 语义），
 * 不会立即出现在 answer 中——live 场景请注入时间并推进 commit。
 */
export function deriveKiroAssistantTurn(
  parts: unknown[],
  turnInFlight: boolean
): KiroAssistantTurnPresentation {
  return updateLiveTurnPresentation(createLiveTurnCommitState(), parts, turnInFlight);
}
