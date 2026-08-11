/**
 * Kiro Assistant Turn Presentation（Streaming Worklog V2）。
 *
 * 纯 Presentation Model：基于真实 UIMessage.parts 顺序扫描，
 * 把 commentary → tool → commentary → tool → final answer 的时序
 * 原样保留给 UI，不再把整个 Turn 的文本提前压平成一大段。
 *
 * - step-start 是真实 step boundary（自身不渲染）
 * - reasoning 完全忽略（绝不进入 worklog / answer）
 * - Provisional Lookahead：最后一个 Tool 之后的 trailing text 先暂存，
 *   只有「第一段已稳定 + 第二段已开始」或「单段已 done」或「Turn 结束」才 commit
 *   为 Final Answer；否则隐藏（不进 answer 也不进 commentary）。
 *   这样 Tool 后的文字不会先以大字号 answer 出现、随后因新 Tool 突变成 commentary。
 */

import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";
import { toolLabel } from "@/lib/ai/tools/formatters";
import { formatKiroToolActivityDetail } from "@/lib/ai/presentation/toolActivityDetails";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

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

type RawPart =
  | { type: "step-start" }
  | { type: "reasoning" }
  | { type: "text"; text?: string; state?: string }
  | {
      type: string;
      toolCallId?: string;
      state?: string;
      output?: unknown;
      errorText?: string;
    };

function isToolPart(p: RawPart): p is { type: string; toolCallId?: string; state?: string; output?: unknown } {
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

export function deriveKiroAssistantTurn(
  parts: unknown[],
  turnInFlight: boolean
): KiroAssistantTurnPresentation {
  const rawParts = (parts ?? []) as RawPart[];

  let stepIndex = 0;
  let lastToolPartIndex = -1;
  let lastToolStatus: "working" | "done" | "error" | null = null;

  // 第一遍：定位最后一个 Tool part 与其 settled 状态（决定哪些 text 是 answer candidate）
  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    if (p?.type === "step-start") continue;
    if (isToolPart(p)) {
      lastToolPartIndex = i;
      lastToolStatus = toolStatusOf(p);
    }
  }

  const hasSettledLastTool = lastToolStatus === "done" || lastToolStatus === "error";

  // ---- Provisional Lookahead：只对「当前 Turn 已存在 Tool」的 trailing text 生效 ----
  // 收集最后一个 Tool 之后的所有 text part（保持原始顺序）
  const trailingTextParts =
    lastToolPartIndex >= 0
      ? rawParts
          .slice(lastToolPartIndex + 1)
          .filter((part): part is Extract<RawPart, { type: "text" }> => part?.type === "text")
      : [];
  const trailingText = trailingTextParts.map((part) => part.text ?? "").join("");

  let commitTrailingAnswer = false;
  if (lastToolPartIndex >= 0 && hasSettledLastTool && trailingText.length > 0) {
    // 复用 Stable Block Splitter：第一块已稳定 + 第二块已开始 = lookahead 成立
    const split = splitKiroStreamingMarkdown(trailingText, true);
    const hasOneBlockLookahead = split.stableBlocks.length > 0 && split.tail.trim().length > 0;
    // 单段已完成（不会再出现新段落/新 Tool 的等待理由）
    const trailingTextDone =
      trailingTextParts.length > 0 && trailingTextParts.every((part) => part.state === "done");
    commitTrailingAnswer = hasOneBlockLookahead || trailingTextDone || !turnInFlight;
  }

  // 第二遍：构建 worklog（commentary / tool）+ 提取 answer
  const worklog: KiroWorklogBlock[] = [];
  let answerTexts: string[] = [];
  let answerStreaming = false;

  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    if (!p || typeof p.type !== "string") continue;
    if (p.type === "step-start") {
      stepIndex += 1;
      continue;
    }
    if (p.type === "reasoning") continue;

    if (isToolPart(p)) {
      const toolName = toolNameOf(p);
      const status = toolStatusOf(p);
      const isWrite = (KIRO_MUTATING_TOOL_NAMES as string[]).includes(toolName);
      const block: KiroWorklogBlock = {
        kind: "tool",
        id: `tool-${p.toolCallId ?? `${toolName}-${i}`}`,
        toolCallId: p.toolCallId ?? "",
        toolName,
        label: toolLabel(toolName),
        status,
        toolKind: isWrite ? "write" : "read",
        safeDetails: formatKiroToolActivityDetail(toolName, status, p.output),
        stepIndex,
      };
      worklog.push(block);
      continue;
    }

    if (p.type === "text") {
      const textValue = p.text ?? "";
      const isStreaming = p.state === "streaming";
      const afterLatestTool = lastToolPartIndex >= 0 && i > lastToolPartIndex;
      // 没有任何 Tool：所有可见 text 都是普通最终回答（立即流式）；
      // 有 Tool：只有「位于最后一个 Tool 之后 且 已 settled 且 lookahead 成立」的 trailing text 才是最终回答
      const isAnswerText =
        lastToolPartIndex < 0 ? true : afterLatestTool && hasSettledLastTool && commitTrailingAnswer;
      if (isAnswerText) {
        answerTexts.push(textValue);
        if (isStreaming) answerStreaming = true;
        continue;
      }
      // Provisional：Tool 后文字尚未 commit（不能确认是 Final Answer 还是后续旁白）→ 完全隐藏。
      // 新 Tool 出现后 lastToolPartIndex 前移，本段自然走下方 commentary 合并逻辑。
      if (afterLatestTool && hasSettledLastTool && !commitTrailingAnswer) {
        continue;
      }
      // 普通旁白：相邻且属于同一个 step 的 commentary 合并
      const last = worklog[worklog.length - 1];
      if (last && last.kind === "commentary" && last.stepIndex === stepIndex) {
        last.text += textValue;
        if (isStreaming) last.streaming = true;
      } else {
        worklog.push({
          kind: "commentary",
          id: `commentary-${i}`,
          text: textValue,
          streaming: isStreaming,
          stepIndex,
        });
      }
    }
  }

  const answer = answerTexts.join("");
  const hasTools = lastToolPartIndex >= 0;

  let phase: KiroTurnPhase;
  if (!turnInFlight) {
    phase = "done";
  } else if (answer.length > 0) {
    phase = "answering";
  } else if (hasTools && worklog.every((b) => b.kind !== "tool" || (b.status !== "working"))) {
    phase = "composing";
  } else {
    phase = "working";
  }

  return {
    worklog,
    answer,
    answerStreaming: turnInFlight && answer.length > 0,
    hasTools,
    worklogDone: hasTools && (phase === "answering" || phase === "done"),
    phase,
  };
}
