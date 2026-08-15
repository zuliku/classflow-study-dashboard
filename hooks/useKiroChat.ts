"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useChat, UIMessage } from "@ai-sdk/react";
import { AIProviderId, AICustomConfig } from "@/lib/ai/providers/types";
import { KiroReasoningEffort } from "@/lib/ai/reasoning/types";
import { KiroResponsePreference } from "@/lib/ai/responsePreference";
import { KiroBaseContext } from "@/lib/ai/context/types";
import { KiroPromptContextRef } from "@/lib/ai/context/contextSelection";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { KiroComputerTurnSnapshot, KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";
import { ComputerActionFact, ComputerCapability, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/adapters/factory";
import { isComputerToolName, ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { ComputerApprovalRequest, ComputerApprovalDecision, ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import {
  KiroAgentTask,
  createAgentTask,
  taskStepForToolCall,
  completeTaskStep,
  failTaskStep,
  toolStepLabel,
  KiroComputerChange,
} from "@/lib/ai/computer/task";
import {
  ComputerTaskCheckpoint,
  createTaskCheckpoint,
  appendInverseToCheckpoint,
  applyInverseToAdapter,
  ComputerInverseOperation,
} from "@/lib/ai/computer/checkpoints";
import { sessionRuleForRequest, workspaceRuleForRequest } from "@/lib/ai/computer/approval";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import { relocateFile } from "@/lib/ai/computer/filesystem/relocate";
import { updateArtifactLocation } from "@/lib/ai/computer/artifacts/service";
import { undoDocumentRevisionRuntime } from "@/lib/ai/computer/documentRevisionUndo";
import {
  loadWorkspaceInstructionsForTurn,
  KiroWorkspaceInstructionsContext,
} from "@/lib/ai/computer/knowledge/instructions";
import { markWorkspaceKnowledgeDirty } from "@/lib/ai/computer/knowledge/service";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { getSessionWebSearchApiKey } from "@/lib/ai/web/credentials";
import { getSessionWebPdfVisionApiKey } from "@/lib/ai/web/vision/credentials";
import { normalizeWebPdfVisionModel } from "@/lib/ai/web/vision/models";
import { KiroWebSearchResult } from "@/lib/ai/web/types";
import { normalizeAIError, AIError } from "@/lib/ai/errors";
import { buildBaseContext } from "@/lib/ai/context/buildBaseContext";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { resolveContextRefs, refsForPrompt, dedupeContextRefs } from "@/lib/ai/context/contextSelection";
import { turnPerf, turnPerfPreflightDelay, turnPerfPreflightFail, sleepTurnPerf } from "@/lib/ai/perf/turnPerf";
import { KiroContextRef } from "@/lib/ai/context/types";
import { executeKiroReadTool, ReadToolResult } from "@/lib/ai/tools/read/executor";
import { executeReadMaterial } from "@/lib/ai/tools/read/material";
import {
  executeQueryLearningHistory,
  executeSummarizeLearningHistory,
} from "@/lib/ai/tools/read/history";
import { executeGetLearningAnalytics } from "@/lib/ai/tools/read/analytics";
import { executeGetLearningOutlook } from "@/lib/ai/tools/read/outlook";
import { MAX_DOCUMENT_READS_PER_TURN } from "@/lib/ai/attachments/limits";
import { KiroAttachment, KiroDocumentContext, KiroAttachmentView } from "@/lib/ai/attachments/types";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import { formatVisionMimeTypes } from "@/lib/ai/attachments/imageMime";
import { preprocessVisionImage } from "@/lib/ai/attachments/preprocessImage";
import { resolveVisionTurnBudget, sumVisionBytes, isVisionTurnWithinBudget } from "@/lib/ai/attachments/visionBudget";
import { getKiroProject } from "@/lib/ai/projects/db";
import { listProjectFiles } from "@/lib/ai/projects/files/db";
import { toProjectTurnContext } from "@/lib/ai/projects/prompt";
import { executeReadProjectFile } from "@/lib/ai/tools/read/projectFile";
import { executeReadProjectVisual } from "@/lib/ai/tools/read/projectVisual";
import { executeSearchProjectFile } from "@/lib/ai/tools/read/projectFileSearch";
import { createVisionTurnRuntimeBudget, VisionTurnRuntimeLedger } from "@/lib/ai/attachments/visionTurnRuntimeBudget";
import { projectFileSourceId, upsertProjectFileSource } from "@/lib/ai/citations/sources";
import { getActiveModelName } from "@/lib/ai/providers/registry";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { isDestructiveWriteTool, KiroUndoEntry, KiroWriteApi, WriteToolResult } from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { KIRO_WRITE_TOOL_SCHEMAS } from "@/lib/ai/tools/write/schemas";
import { createKiroWriteApi } from "@/lib/ai/tools/write/api";
import { isClassFlowMutationTool, VISUAL_PROPOSAL_REQUIRED_CODE, VISUAL_PROPOSAL_REQUIRED_MESSAGE } from "@/lib/ai/visual/guard";
import { VisualActionProposal } from "@/lib/ai/visual/types";
import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";
import { actionToastMessage, toolLabel } from "@/lib/ai/tools/formatters";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { hasExplicitMemoryIntent } from "@/lib/ai/memory/manager";
import { KIRO_MEMORY_TOOL_NAMES, KIRO_MEMORY_TOOL_SCHEMAS } from "@/lib/ai/memory/tools";
import { MAX_MEMORIES } from "@/lib/ai/memory/types";
import { PersistedActionView, PersistedAttachmentView, KiroConversationRecord, KiroConversationSummary, PersistedSourceMeta, PersistedComputerTaskView } from "@/lib/ai/history/types";
import {
  getUserMessageEditBlockReason,
  messageHasMutatingToolCalls,
  truncateBeforeEditedUserMessage,
  UserMessageEditBlockReason,
} from "@/lib/ai/history/messageEditing";
import { StudyPlanProposal } from "@/lib/planning/studyPlanner";
import { TaskBreakdownProposal } from "@/lib/tasks/taskBreakdown";
import { budgetAttachments } from "@/lib/ai/contextBudget/attachmentBudget";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";
import { KiroTurnContextSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { buildTurnSourceRegistry, materialSourceId } from "@/lib/ai/citations/sources";
import { enrichWebSourcePages } from "@/lib/ai/citations/sourceRegistry";
import { renderPdfPages, selectScannedPdfPages, allocateVisionPages, extractExplicitPages } from "@/lib/ai/attachments/pdfVision";
import { MAX_SCANNED_PDF_PAGES_PER_TURN, MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN } from "@/lib/ai/attachments/limits";
import { getFileBlob } from "@/lib/fileStorage";
import {
  deriveKiroAssistantTurn,
  KiroAssistantTurnPresentation,
} from "@/lib/ai/presentation/turnPresentation";
import {
  updateLiveTurnPresentation,
  createLiveTurnCommitState,
  LiveTurnCommitState,
} from "@/lib/ai/presentation/liveTurnPresentation";
import {
  isKiroFinalAnswerToolName,
} from "@/lib/ai/tools/finalAnswer";
import { CURRENT_DOCUMENT_AUTHORING_VERSION } from "@/lib/ai/computer/documents/authoring/protocol";
import {
  advanceDocumentFailureFuse,
  DocumentFailureFuseState,
} from "@/lib/ai/computer/documents/failureFuse";
import { resolveToolOutcomeStatus } from "@/lib/ai/presentation/toolOutcome";

/** 每回合工具调用上限：Read ≤ 12，Write ≤ 8 */
export const MAX_READ_TOOL_CALLS_PER_TURN_UI = 12;
export const MAX_WRITE_TOOL_CALLS_PER_TURN = 8;

/**
 * 客户端流式节流（Streaming UX V2 Phase 4 + V4.4/V4.4.1 定标）：
 * server smoothing 按需送达；客户端每 throttleMs 合并一次 React 更新，
 * 避免逐 token 重渲染 + 50ms 成块跳字。单一 cadence owner（不叠第三层节流）。
 * V4.4.1 定标结论：24ms 保留为 production default；
 * NEXT_PUBLIC_KIRO_CLIENT_THROTTLE_MS 仅允许 dev A/B（16/20/24），
 * 非法值（NaN/越界/0/负数）一律回落 24。
 */
function resolveClientThrottleMs(): number {
  const raw = process.env.NEXT_PUBLIC_KIRO_CLIENT_THROTTLE_MS;
  if (raw == null || raw === "") return 24;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  if (n !== 16 && n !== 20 && n !== 24) return 24;
  return n;
}

export const KIRO_CLIENT_STREAM_THROTTLE_MS = resolveClientThrottleMs();

// V4.4.1：dev/test 验证 runtime constant 是否真的生效（test-only global 存在时才暴露）
if (typeof window !== "undefined") {
  const g = window as unknown as { __kiroStreamPerf?: unknown; __kiroClientThrottleMs?: number };
  if (g.__kiroStreamPerf !== undefined) {
    g.__kiroClientThrottleMs = KIRO_CLIENT_STREAM_THROTTLE_MS;
  }
}

/**
 * Turn Execution Lifecycle（Streaming UX V3 Phase 3）：
 * 取代「chat.status === ready → done」的假 settled：
 * - executing：请求已发出 / 正在流式
 * - awaiting-tool-result：client 工具执行中 / 审批等待中（tool part 未回填）
 * - awaiting-continuation：tool output 已回填，SDK 自动续跑即将/正在发起（瞬时 ready 窗口）
 * - settled：真正结束（唯一允许 Worklog 自动折叠 / 显示操作栏的状态）
 */
export type KiroTurnExecutionState =
  | "executing"
  | "awaiting-tool-result"
  | "awaiting-continuation"
  | "settled";

/** 统一 Message 视图模型：UI 组件只消费它，不依赖 Provider 原始结构 */
export interface KiroChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
  /** 真实 Write Tool 结果（Action Card 事实来源，模型不得生成） */
  actions?: KiroActionResultView[];
  /** 历史恢复的 Action Card 事实 UI（展示用，canUndo 恒 false） */
  historyActions?: PersistedActionView[];
  /** 本 Turn 文档来源（Citation 校验与展示；不含正文） */
  sources?: KiroSourceMeta[];
  /** 该 User Turn 绑定的附件（chips 展示；File 对象不进入 Chat state） */
  attachments?: KiroAttachmentView[];
  /** Kiro propose_study_plan 的真实结果（Proposal Card 事实来源；模型不得生成） */
  proposals?: StudyPlanProposal[];
  /** Kiro propose_task_breakdown 的真实结果（Task Breakdown Proposal Card 事实来源；模型不得生成） */
  breakdowns?: TaskBreakdownProposal[];
  /** Kiro propose_study_rebalance 的真实结果（Rebalance Proposal Card 事实来源；模型不得生成） */
  rebalanceProposals?: import("@/lib/planning/studyRebalance").StudyRebalanceProposal[];
  /** Kiro propose_visual_actions 的真实结果（Visual Action Proposal Card 事实来源；模型不得生成） */
  visualActionProposals?: VisualActionProposal[];
  /** Task 7：User Message 是否可编辑（attachment/history metadata 最终绑定后计算） */
  canEdit?: boolean;
  /** 历史恢复消息只参与整段会话淡入，不播放逐条结构动画。 */
  restored?: boolean;
  /** 不可编辑原因（canEdit=false 时） */
  editDisabledReason?: UserMessageEditBlockReason;
  /** 是否可以「重新生成」：仅 live 且该轮无 Write Tool Call 的最后一条 */
  canRegenerate: boolean;
  /** Task 1（Worklog V2）：Assistant Turn 有序 Presentation（commentary → tool → … → final answer） */
  assistantTurn?: KiroAssistantTurnPresentation;
  /** Computer Agent 主 Task（live：绑定本 assistant 消息的 toolCallIds；Part 3） */
  computerTask?: KiroAgentTask;
  /** 历史恢复的 Computer Task 展示事实（无 checkpoint → 不能 Undo） */
  historyComputerTask?: PersistedComputerTaskView;
}

export interface KiroActionResultView {
  toolCallId: string;
  action: Extract<WriteToolResult, { ok: true }>["action"];
}

/** Activity Trace 视图模型（真实工具调用，用户语义标签） */
export interface KiroActivityStep {
  label: string;
  status: "working" | "done" | "error";
  kind: "read" | "write";
  message?: string;
  /** Change Set：内部操作数（展示「正在检查 N 项修改 / 完成 N 项修改」） */
  count?: number;
}

/** Agent 执行阶段（从真实 Runtime 推导，不展示隐藏思维链） */
export type KiroAgentPhase = "thinking" | "reading" | "acting" | "composing" | "done" | "error";

export interface KiroActivity {
  visible: boolean;
  phase: KiroAgentPhase;
  steps: KiroActivityStep[];
  done: boolean;
}

interface ToolCallPart {
  type: string; // `tool-${toolName}`（客户端序列化格式）
  toolCallId: string;
  toolName?: string;
  state?: "streaming" | "output-available" | "output-error";
  errorText?: string;
  output?: unknown;
  input?: unknown;
}

/** 从 UI tool part 提取工具名（type 前缀 `tool-`） */
function toolNameOf(part: ToolCallPart): string {
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.toolName ?? part.type;
}

/** Message View 增量缓存（Task 13 + Worklog V2）：parts/metadata/statusRef 引用未变 → 复用旧 view 对象 */
export function reuseMessageView<V>(
  cache: Map<string, { partsRef: unknown; metadataRef: unknown; statusRef?: unknown; view: V }>,
  id: string,
  parts: unknown,
  metadata: unknown,
  build: () => V,
  statusRef?: unknown
): V {
  const hit = cache.get(id);
  if (hit && hit.partsRef === parts && hit.metadataRef === metadata && hit.statusRef === statusRef) {
    return hit.view;
  }
  const view = build();
  cache.set(id, { partsRef: parts, metadataRef: metadata, statusRef, view });
  return view;
}

/** thin alias（Task 7：mutating detection 已移至 lib/ai/history/messageEditing，保持旧 import 兼容） */
export function messageHasWriteToolCalls(m: Pick<UIMessage, "parts">): boolean {
  return messageHasMutatingToolCalls(m as { parts?: { type: string }[] });
}

function isRestoredMessage(m: Pick<UIMessage, "metadata">): boolean {
  return (m.metadata as Record<string, string> | undefined)?.restored === "1";
}

/** UIMessage 文本（v5 无 content 字段；text parts 拼接） */
function messageTextOf(m: { parts?: unknown[] }): string {
  return (m.parts ?? [])
    .filter(
      (p): p is { type: string; text?: string } =>
        typeof p === "object" && p !== null && (p as { type?: string }).type === "text"
    )
    .map((p) => p.text ?? "")
    .join("");
}

/** 判断上一轮能否安全 regenerate：最后一条 assistant 无 Write Tool 且非历史恢复 */
export function lastTurnCanRegenerate(messages: Pick<UIMessage, "role" | "parts" | "metadata">[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if ((m.parts ?? []).some((p) => typeof p.type === "string" && p.type.startsWith("tool-"))) {
      return !messageHasWriteToolCalls(m as UIMessage) && !isRestoredMessage(m);
    }
    return !isRestoredMessage(m);
  }
  return false;
}

function toView(
  m: UIMessage,
  turnInFlight: boolean,
  commit?: LiveTurnCommitState
): KiroChatMessageView {
  const parts = (m.parts ?? []) as unknown as (ToolCallPart | { type: "text"; text: string; state?: string })[];
  const restored = isRestoredMessage(m);

  // Worklog V2：Assistant 的 content 只代表最终回答；worklog 保留真实 part 时序（commentary/tool）
  let content: string;
  let streaming: boolean;
  let assistantTurn: KiroAssistantTurnPresentation | undefined;
  if (m.role === "assistant") {
    // Streaming UX V2：live turn 走单调 lane controller（commit 持久化）；
    // 无 commit（非 assistant 或未初始化）时回退静态推导（settled 结果一致）
    assistantTurn = commit
      ? updateLiveTurnPresentation(commit, m.parts ?? [], turnInFlight)
      : deriveKiroAssistantTurn(m.parts ?? [], turnInFlight);
    content = assistantTurn.answer;
    streaming = assistantTurn.answerStreaming;
  } else {
    content = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    streaming = parts.some((p) => p.type === "text" && p.state === "streaming");
  }

  // 真实 Write Tool 结果（ok:true 且带 action）→ Action Card 数据
  // Memory 工具只发 Toast，不生成 Action Card
  const actions: KiroActionResultView[] = [];
  const proposals: StudyPlanProposal[] = [];
  const breakdowns: TaskBreakdownProposal[] = [];
  const rebalanceProposals: import("@/lib/planning/studyRebalance").StudyRebalanceProposal[] = [];
  const visualActionProposals: VisualActionProposal[] = [];
  for (const p of parts) {
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
    // Streaming UX V3：begin_final_answer 是内部控制信号（不产生 Action Card / Proposal）
    if (isKiroFinalAnswerToolName(p.type.slice("tool-".length))) continue;
    const tp = p as ToolCallPart;
    if (toolNameOf(tp) === "propose_study_plan") {
      const output = tp.output as ReadToolResult<unknown> | undefined;
      if (output && output.ok === true) {
        const data = output.data as { items?: StudyPlanProposal[] } | undefined;
        if (data?.items) proposals.push(...data.items);
      }
      continue;
    }
    if (toolNameOf(tp) === "propose_task_breakdown") {
      const output = tp.output as ReadToolResult<unknown> | undefined;
      if (output && output.ok === true) {
        const data = output.data as { proposal?: TaskBreakdownProposal } | undefined;
        if (data?.proposal) breakdowns.push(data.proposal);
      }
      continue;
    }
    if (toolNameOf(tp) === "propose_study_rebalance") {
      const output = tp.output as ReadToolResult<unknown> | undefined;
      if (output && output.ok === true) {
        const data = output.data as
          | { proposal?: import("@/lib/planning/studyRebalance").StudyRebalanceProposal }
          | undefined;
        if (data?.proposal) rebalanceProposals.push(data.proposal);
      }
      continue;
    }
    if (toolNameOf(tp) === "propose_visual_actions") {
      const output = tp.output as ReadToolResult<unknown> | undefined;
      if (output && output.ok === true) {
        const data = output.data as { proposal?: VisualActionProposal } | undefined;
        if (data?.proposal) visualActionProposals.push(data.proposal);
      }
      continue;
    }
    if ((KIRO_MEMORY_TOOL_NAMES as string[]).includes(toolNameOf(tp))) continue;
    const output = tp.output as WriteToolResult | undefined;
    if (output && output.ok === true && output.action) {
      actions.push({ toolCallId: tp.toolCallId, action: output.action as KiroActionResultView["action"] });
    }
  }

  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content,
    streaming,
    actions: actions.length > 0 ? actions : undefined,
    proposals: proposals.length > 0 ? proposals : undefined,
    breakdowns: breakdowns.length > 0 ? breakdowns : undefined,
    rebalanceProposals: rebalanceProposals.length > 0 ? rebalanceProposals : undefined,
    visualActionProposals: visualActionProposals.length > 0 ? visualActionProposals : undefined,
    restored,
    // 历史恢复消息：禁止重新生成；live 且有 Write Tool Call 的轮次同样禁止
    canRegenerate: !restored && !messageHasWriteToolCalls(m),
    assistantTurn,
  };
}

/** deriveActivity 的宽松输入形状（UIMessage 兼容；测试友好） */
export interface ActivitySourceMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: { type: string; text?: string; state?: string; toolCallId?: string; output?: unknown; errorText?: string }[];
}

/**
 * 从最新 assistant 消息推导本轮真实工具调用（只显示用户语义标签）与 Agent 执行阶段。
 * 阶段为确定性推导：thinking（无任何输出）/ reading / acting / composing / done / error。
 * 只展示用户可理解的 Tool semantic label 与真实执行结果，绝不展示 chain-of-thought。
 */
export function deriveActivity(messages: ActivitySourceMessage[], status: string): KiroActivity {
  const hasError = status === "error";
  const submitted = status === "submitted";
  const streaming = status === "streaming" || submitted;

  // 当前轮 = 最后一条 user 消息之后的 assistant 消息（避免把已完成旧轮的 Tool parts 算进来）
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const inFlight = messages.slice(lastUserIdx + 1);
  let target: ActivitySourceMessage | null = null;
  for (let i = inFlight.length - 1; i >= 0; i--) {
    const m = inFlight[i];
    if (m.role !== "assistant") continue;
    if ((m.parts ?? []).some((p) => typeof p.type === "string" && p.type.startsWith("tool-"))) {
      target = m;
      break;
    }
    if ((m.parts ?? []).some((p) => p.type === "text")) {
      target = m;
      break;
    }
  }

  // Streaming UX V3：begin_final_answer 是内部控制信号，不计入 Activity steps
  const toolParts = target
    ? (((target.parts ?? []).filter(
        (p) =>
          typeof p.type === "string" &&
          p.type.startsWith("tool-") &&
          !isKiroFinalAnswerToolName(p.type.slice("tool-".length))
      ) as unknown) as ToolCallPart[])
    : [];
  const textStarted =
    !!target && (target.parts ?? []).some((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0);

  const steps: KiroActivityStep[] = toolParts.map((p) => {
    const name = toolNameOf(p);
    const isWrite = (KIRO_MUTATING_TOOL_NAMES as string[]).includes(name);
    const isChangeSet = name === "apply_change_set";
    // V2.3：统一 outcome helper（output-available + ok:false → error，与 Worklog 同一规则）
    const outcome = resolveToolOutcomeStatus({ state: p.state, output: p.output });
    if (outcome === "done") {
      // Change Set：输出中带真实 count（不展示 tool name / JSON）
      if (isChangeSet) {
        const out = p.output as
          | { data?: { count?: number }; action?: { changeSet?: { count?: number } } }
          | undefined;
        const count = out?.data?.count ?? out?.action?.changeSet?.count;
        return {
          label: count ? `完成 ${count} 项修改` : "完成整组修改",
          status: "done" as const,
          kind: "write" as const,
          count,
        };
      }
      return { label: toolLabel(name), status: "done" as const, kind: isWrite ? "write" : "read" };
    }
    if (outcome === "error") {
      if (isChangeSet) {
        return { label: "未执行修改", status: "error" as const, kind: "write" as const, message: p.errorText, count: 0 };
      }
      return { label: toolLabel(name), status: "error", kind: isWrite ? "write" : "read", message: p.errorText };
    }
    if (isChangeSet) {
      // working：工具 input 已含 actions（流式完成前即可展示「正在检查 N 项修改」）
      const input = p.input as { actions?: unknown[] } | undefined;
      const count = input?.actions?.length;
      return { label: count ? `正在检查 ${count} 项修改` : "正在检查修改", status: "working" as const, kind: "write" as const, count };
    }
    return { label: toolLabel(name), status: "working", kind: isWrite ? "write" : "read" };
  });

  const hasWorkingWrite = steps.some((s) => s.status === "working" && s.kind === "write");
  const hasWorkingRead = steps.some((s) => s.status === "working" && s.kind === "read");
  const workingPhase: KiroAgentPhase = hasWorkingWrite ? "acting" : "reading";

  // 出错：有真实步骤保留 error trace；无步骤交给现有 Error Card（Progress 不重复错误内容）
  if (hasError) {
    return steps.length > 0
      ? { visible: true, phase: "error", steps, done: true }
      : { visible: false, phase: "error", steps: [], done: true };
  }

  if (submitted) {
    // 请求已发出但尚无任何内容 → thinking（修复 submitted 阶段空白；UI 延迟 ~300ms 显示）
    if (target === null) return { visible: true, phase: "thinking", steps: [], done: false };
    if (toolParts.length === 0) return { visible: true, phase: "thinking", steps: [], done: false };
    return { visible: true, phase: workingPhase, steps, done: false };
  }

  if (streaming && toolParts.length > 0) {
    if (hasWorkingWrite || hasWorkingRead) return { visible: true, phase: workingPhase, steps, done: false };
    // 工具全部完成：文本未开始 → composing；文本已开始 → 保留完成摘要（低权重）
    if (!textStarted) return { visible: true, phase: "composing", steps, done: false };
    return { visible: true, phase: "done", steps, done: true };
  }

  if (streaming) {
    // 无工具轮：首 token 前 → thinking
    return { visible: true, phase: "thinking", steps: [], done: false };
  }

  // ready：本轮有真实工具 → 完成摘要；无工具 → 隐藏
  if (toolParts.length > 0) return { visible: true, phase: "done", steps, done: true };
  return { visible: false, phase: "done", steps: [], done: true };
}

type ToolOutput = { ok: boolean; code?: string; message?: string; data?: unknown; action?: unknown };

/**
 * V4.6 Turn Handoff：Send click 瞬间同步冻结的 Turn Intent。
 * 之后所有异步 preflight（Project / Workspace / Vision）只是 enrichment，
 * 请求体（provider/model/reasoning/webSearch/computer/context）一律来自这里。
 */
export interface KiroTurnIntentSnapshot {
  provider: AIProviderId;
  model: string;
  custom: AICustomConfig;
  reasoningEffort: KiroReasoningEffort;
  responsePreference: KiroResponsePreference;
  webSearch: {
    enabled: boolean;
    credentialMode: string;
    apiKey?: string;
  };
  webPdfVision: {
    enabled: boolean;
    model?: string;
    apiKey?: string;
  };
  baseContext: KiroBaseContext;
  contextRefs: KiroPromptContextRef[];
  computerSnapshot: KiroComputerTurnSnapshot;
  projectId: string | null;
  conversationSummary: { text: string; throughMessageId: string } | undefined;
  memoryIndex: { id: string; title: string; category: string; scope: string; scopeId?: string }[];
}

/** Pending executable（Part 3）：真正可执行的请求只存在于 useKiroChat refs（runtime store 只存 UI 展示） */
interface PendingComputerExecution {
  request: ComputerApprovalRequest;
  toolName: string;
  toolCallId: string;
  input: unknown;
  frozenSnapshot: KiroComputerTurnSnapshot;
}

/**
 * Kiro Chat runtime（Task 3）：Read + Write client-side tools。
 * 安全链：LLM → Tool Call → Client Validation → Existing ClassFlow Action → Tool Result。
 * 高风险工具（delete_*）强制 Confirm；普通编辑直接执行；成功写操作注册一次性 Undo。
 */
export function useKiroChat({
  autoRefs,
  manualRefs,
  entryRefs,
  suppressedAutoKeys,
  attachments,
  conversationSummary,
  conversationId,
  projectId,
}: {
  autoRefs: KiroContextRef[];
  manualRefs: KiroContextRef[];
  entryRefs: KiroContextRef[];
  suppressedAutoKeys: string[];
  attachments: KiroAttachment[];
  /** 当前 Conversation Summary（若有）：随 Turn Snapshot 冻结，作为 Model Context 的一部分 */
  conversationSummary?: KiroConversationSummary | null;
  /** Part 3：当前会话 id（Task/Audit 记录用；useKiroChat 不拥有会话生命周期） */
  conversationId?: string | null;
  /** Projects V1.2：当前 Conversation 所属 Project（null = 未归类）；Send boundary 读取并冻结 Project Instructions */
  projectId?: string | null;
}) {
  const enabled = useAISettingsStore((s) => s.enabled);
  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);
  // Kiro Computer Agent V1：推理投入随 Turn Snapshot 冻结（Composer/Settings 共用同一 store）
  const reasoningEffort = useAISettingsStore((s) => s.reasoningEffort);
  // Intelligence V2 Task 1：回答偏好随 Turn Snapshot 冻结（Turn 中途改设置不影响当前 Turn）
  const responsePreference = useKiroPreferencesStore((s) => s.responsePreference);
  // Task 14：Kiro Search（联网搜索）——随 Turn Snapshot 冻结；Key 不进 Store
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const webSearchCredentialMode = useKiroPreferencesStore((s) => s.webSearchCredentialMode);
  // Task 19C1：扫描 Web PDF Vision 设置（Key 独立 session 存储，不进 Store）
  const webPdfVisionEnabled = useKiroPreferencesStore((s) => s.webPdfVisionEnabled);
  const webPdfVisionModel = useKiroPreferencesStore((s) => s.webPdfVisionModel);

  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  // Part 3：会话 id 供 Task/Audit 使用（KiroSessionProvider 传入；ref 避免重建 callback）
  const conversationIdRef = useRef<string | null>(conversationId ?? null);
  conversationIdRef.current = conversationId ?? null;
  // Projects V1.2：当前 Project id（Send boundary 读取；ref 避免 callback 重建）
  const projectIdRef = useRef<string | null>(projectId ?? null);
  projectIdRef.current = projectId ?? null;

  const capabilities = getModelCapabilities({ provider, model, custom });
  const visionEnabled = capabilities.vision;

  // ---- Long-term Memory（Task 9）：跨会话稳定偏好；独立于业务 Write ----
  const memory = useKiroMemory();

  // 发送瞬间绑定的附件快照：按 user message 顺序消费（File 不进入 Chat state）
  const snapshotQueueRef = useRef<KiroAttachmentView[][]>([]);

  // ---- Turn Context Snapshot（Task 7 关键修复）----
  // 一个 User Turn 内 Prompt Context 保持不变（附件/Context 冻结，即使 Composer 已清空）；
  // 下一 Turn 重新快照（数据 freshness 与 turn consistency 同时成立）。
  const turnSnapshotRef = useRef<Record<string, unknown> | null>(null);

  // ---- Turn Source Registry（Task 11）：本 Turn 文档来源（Citation 校验/展示；不含正文）----
  const [sources, setSources] = useState<KiroSourceMeta[]>([]);
  const turnSourcesRef = useRef<KiroSourceMeta[]>([]);

  // ---- Scanned PDF Vision（Task 12）：发送时渲染的页面图 manifest（只存 metadata，不含 base64）----
  const [preparingVision, setPreparingVision] = useState(false);
  const visionPagesRef = useRef<{ sourceId: string; page: number; fileName: string; attachmentId: string }[]>([]);
  // V4.6：Turn Intent 是否已同步冻结（Send click 瞬间；preflight 期间 UI 依此解锁下一 Turn preferences）
  const [turnIntentFrozen, setTurnIntentFrozen] = useState(false);

  /** read_material 成功后把资料注册进本 Turn Source Registry（sourceId = material-<id>，绝不使用 storageKey） */
  const registerMaterialSource = useCallback(
    (data: { materialId?: string; title?: string; pages?: { page: number }[] }, input: unknown) => {
      const parsed = input as { courseId?: string } | null;
      const courseId = parsed?.courseId ?? "";
      const materialId = data.materialId ?? "";
      if (!materialId) return;
      const course = useAppStore.getState().courses.find((c) => c.id === courseId);
      const meta: KiroSourceMeta = {
        sourceId: materialSourceId(materialId),
        name: data.title ?? "课程资料",
        source: "course-material",
        courseName: course?.name,
        availablePages:
          Array.isArray(data.pages) && data.pages.length > 0 ? data.pages.map((p) => p.page) : undefined,
      };
      if (!turnSourcesRef.current.some((s) => s.sourceId === meta.sourceId)) {
        turnSourcesRef.current = [...turnSourcesRef.current, meta];
        setSources(turnSourcesRef.current);
      }
    },
    []
  );

  /** V1.3A：read_project_file 成功后注册 Project File Source（sourceId = project-file-<id>，绝不使用 storageKey）。
   *  V1.3B：upsert + merge（availablePages union，unique + sort asc，绝不产生 duplicate source row）。 */
  const registerProjectFileSource = useCallback((data: { projectFileId: string; name: string; pages?: { page: number }[] }) => {
    turnSourcesRef.current = upsertProjectFileSource(turnSourcesRef.current, data);
    setSources(turnSourcesRef.current);
  }, []);

  const buildTurnSnapshot = (
    intent: KiroTurnIntentSnapshot,
    turnAttachments: KiroAttachment[],
    projectContext?: KiroProjectTurnContext
  ): Record<string, unknown> => {
    const contexts = buildDocumentContexts(turnAttachments);
    const budgeted = budgetAttachments(contexts, DEFAULT_CONTEXT_BUDGET.attachmentBudgetTokens).attachments;
    // 文本文档 Source Registry：availablePages 只取预算后实际发送的页码（模型不能引用不可见页面）
    const textRegistry = buildTurnSourceRegistry(budgeted).sources;
    // 扫描 PDF Source：sourceId 接在文本文档之后；availablePages 只含实际渲染发送的页面
    const scannedDocs = turnAttachments.filter(isScannedAttachment);
    const scannedRegistry: KiroSourceMeta[] = scannedDocs.map((a, i) => {
      const pages = visionPagesRef.current.filter((vp) => vp.attachmentId === a.id).map((vp) => vp.page);
      return {
        sourceId: `doc-${textRegistry.length + i + 1}`,
        name: a.name,
        source: a.source === "material" ? "course-material" : "chat",
        courseName: a.source === "material" ? (a as Extract<KiroAttachment, { source: "material" }>).courseName : undefined,
        availablePages: pages.length > 0 ? pages : undefined,
      };
    });
    const registry = [...textRegistry, ...scannedRegistry];
    const byName = new Map(registry.map((s) => [s.name, s.sourceId]));
    const attachmentsContext = budgeted.map((a) => ({
      name: a.name,
      type: a.type,
      text: a.text,
      // Page metadata 必须贯通到请求体（Citation 的页码约束来源）
      pages: a.pages,
      sourceId: byName.get(a.name) ?? "",
      source: a.source === "course-material" ? ("course-material" as const) : ("chat" as const),
      truncated: a.truncated ?? false,
      budgetTruncated: a.budgetTruncated ?? false,
      courseName: a.courseName,
    }));
    // 冻结本 Turn 的 Source Registry（read_material 之后还会追加 material 来源）
    turnSourcesRef.current = registry;
    setSources(registry);
    // V4.6：请求体全部来自 frozen Turn Intent（Send click 瞬间），enrichment 只补
    // projectContext / computerWorkspaceInstructions / vision 等 send-time 物化内容
    return {
      provider: intent.provider,
      model: intent.model,
      apiKey: getSessionApiKey(intent.provider),
      customConfig: intent.custom,
      responsePreference: intent.responsePreference,
      // Task 14：联网搜索配置（Server Key 永远不进入 Browser；仅 BYOK 带用户 Key）
      webSearchConfig: intent.webSearch,
      // Task 19C1：扫描 Web PDF Vision 配置（Provider 固定 OpenCode Go；不发送 provider/baseURL/transport）。
      // Key 缺失仍可发送 enabled/model（19C2 负责 missing key → Vision unavailable → Tavily fallback）
      webPdfVisionConfig: intent.webPdfVision,
      baseContext: intent.baseContext,
      contextRefs: intent.contextRefs,
      attachmentsContext,
      // 扫描 PDF 页面图 manifest（Task 12）：只含 sourceId/page/文件名映射，不含 base64
      visionPages: visionPagesRef.current,
      conversationSummary: intent.conversationSummary,
      // 长期学习记忆 Index（不含 content；memoryEnabled=false 时为空数组）
      memoryIndex: intent.memoryIndex,
      // Kiro Computer Agent V1：推理投入冻结——Store 保存 requested preference；
      // 发送瞬间按当前 provider/model/custom capability 归一为 effective
      // （与 UI 显示值一致；Server 仍会二次 normalize，此为 trust boundary 之外的防御）。
      reasoningEffort: resolveEffectiveReasoningEffort({
        provider: intent.provider,
        model: intent.model,
        custom: intent.custom,
        requested: intent.reasoningEffort,
      }),
      // Computer Turn Snapshot（冻结意图；只含逻辑元数据，live grants/rules 不入请求）
      computerSnapshot: intent.computerSnapshot,
      // Projects V1.2：Project Instructions 随 Turn 冻结（Send boundary 读取；
      // continuation 复用 turnSnapshotRef，streaming 中编辑 Project 只影响下一 Turn）
      projectContext,
    };
  };

  // 每轮请求体引用：优先使用当前 Turn Snapshot（冻结）；无快照时回退实时 body
  const bodyRef = useRef<Record<string, unknown>>({});
  const requestBody = (): Record<string, unknown> => turnSnapshotRef.current ?? bodyRef.current;
  const buildSnapshotRef = useRef(buildTurnSnapshot);
  buildSnapshotRef.current = buildTurnSnapshot;

  // Computer Turn Snapshot（send 边界冻结；只读逻辑元数据，绝不包含 adapterRef/handle/path/token）
  const buildComputerSnapshot = (): KiroComputerTurnSnapshot => {
    const cs = useKiroComputerStore.getState();
    const ws = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId) ?? null;
    return {
      enabled: cs.computerEnabled,
      workspaceId: cs.activeWorkspaceId,
      agentMode: cs.agentMode,
      roots: ws
        ? ws.roots.map((r) => ({ id: r.id, label: r.label, access: r.access }))
        : [],
      // V2.3：Document Authoring Protocol（新 Client 明确发送 2；旧 bundle 缺失 → server 按 legacy V1）
      documentAuthoringVersion: CURRENT_DOCUMENT_AUTHORING_VERSION,
    };
  };

  // ============================================================
  // V4.6 Turn Handoff：Turn Intent 同步冻结（Send click 瞬间）
  //
  // 原则：用户点击 Send 的那个瞬间就定义了「这一轮使用什么配置」。
  // captureTurnIntent 必须纯同步（第一个 await 之前）——Project DB / Workspace /
  // Vision preflight 只是 enrichment，绝不能反过来推迟模型/推理/范围冻结。
  // 之后 UI 修改 Model / Reasoning / Web Search / Agent Mode 只影响下一 Turn。
  // ============================================================

  const captureTurnIntent = (): KiroTurnIntentSnapshot => ({
    provider,
    model,
    custom,
    reasoningEffort,
    responsePreference,
    webSearch: {
      enabled: webSearchEnabled,
      credentialMode: webSearchCredentialMode,
      ...(webSearchCredentialMode === "byok" && getSessionWebSearchApiKey()
        ? { apiKey: getSessionWebSearchApiKey() }
        : {}),
    },
    webPdfVision: {
      enabled: webPdfVisionEnabled,
      model: normalizeWebPdfVisionModel(webPdfVisionModel),
      ...(getSessionWebPdfVisionApiKey() ? { apiKey: getSessionWebPdfVisionApiKey() } : {}),
    },
    baseContext: buildBaseContext(),
    contextRefs: refsForPrompt(
      dedupeContextRefs(
        resolveContextRefs(autoRefs, manualRefs, entryRefs, suppressedAutoKeys),
        useAppStore.getState().currentSemesterWeek
      )
    ),
    computerSnapshot: buildComputerSnapshot(),
    projectId: projectIdRef.current,
    conversationSummary: conversationSummary
      ? { text: conversationSummary.text, throughMessageId: conversationSummary.throughMessageId }
      : undefined,
    memoryIndex: memory.activeIndex.map((m) => ({
      id: m.id,
      title: m.title,
      category: m.category,
      scope: m.scope,
      scopeId: m.scopeId,
    })),
  });
  // V4.6：captureTurnIntent 经 ref 调用（sendWithAttachments 稳定 callback 读取最新 settings）
  const captureIntentRef = useRef(captureTurnIntent);
  captureIntentRef.current = captureTurnIntent;


  const readCounterRef = useRef(0);
  const documentReadCounterRef = useRef(0);
  /** V1.3B：当前 User Turn 的 Vision Runtime Ledger（Send boundary 初始化；continuation 共享；下一 Send 重建） */
  const turnVisionBudgetRef = useRef<VisionTurnRuntimeLedger | null>(null);
  /** V1.3B：当前 User Turn 文本（read_project_visual 页选择依据；下轮 Send 覆盖） */
  const latestUserTextRef = useRef("");
  const writeCounterRef = useRef(0);
  const limitReachedRef = useRef(false);
  const undoRegistryRef = useRef(new Map<string, KiroUndoEntry>());
  /** Task B V1.1：当前 User Turn Send 时冻结的 ready image attachment IDs（Runtime Source of Truth）。
   *  - Guard 依据：length > 0 即本轮包含图片来源（直接写操作 → VISUAL_PROPOSAL_REQUIRED）
   *  - propose_visual_actions 的 sourceAttachmentIds 只从这里取（模型无法提供）
   *  - 生命周期：新 User Turn 冻结新 snapshot / reset / session transition 时替换；continuation 期间不清空 */
  const turnImageAttachmentIdsRef = useRef<string[]>([]);
  // Kiro Computer Agent V1：每 Turn 独立的 Computer 调用限制（read <= 12 / mutation <= 6）
  const computerCountersRef = useRef({ readCount: 0, mutationCount: 0 });

  // ---- Computer Agent Task Runtime（Part 3）：Task 绑定 owning assistant message 的 toolCallIds ----
  const [tasksState, setTasksState] = useState<Map<string, KiroAgentTask>>(new Map());
  const tasksRef = useRef<Map<string, KiroAgentTask>>(new Map());
  const activeTaskRef = useRef<KiroAgentTask | null>(null);
  const checkpointsRef = useRef<Map<string, ComputerTaskCheckpoint>>(new Map());
  const pendingExecutionsRef = useRef<Map<string, PendingComputerExecution>>(new Map());
  const oneShotApprovalsRef = useRef<ComputerOneShotApproval[]>([]);
  // Task 状态版本（undo/approval 后递增）：历史保存 snapshot 需要感知（任务状态变化也落盘）
  const [computerVersion, setComputerVersion] = useState(0);

  const setPendingApproval = useKiroComputerRuntimeStore((s) => s.setPendingApproval);
  const pendingApproval = useKiroComputerRuntimeStore((s) => s.pendingApproval);

  // V2.7.2：approval 超时自动取消（默认 3 分钟）——审批挂起不能永久阻塞 Tool Call
  //（用户忽略弹窗 / 页面在后台 / 旧 bundle 死锁等场景下，Kiro 必须最终收到确定结果）。
  const APPROVAL_TIMEOUT_MS = 3 * 60 * 1000;
  const approvalTimeoutTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearApprovalTimeout = useCallback((approvalId: string) => {
    const t = approvalTimeoutTimersRef.current.get(approvalId);
    if (t) {
      clearTimeout(t);
      approvalTimeoutTimersRef.current.delete(approvalId);
    }
  }, []);

  // ---- History Restore（Part 3）：显示-only Computer Task 事实（无 checkpoint / Undo）----
  const restoredComputerTasksRef = useRef(new Map<string, PersistedComputerTaskView>());

  // 历史恢复的展示数据（Action Cards / 附件 chips / Citation 来源）——不是可执行 Tool state
  const restoredActionsRef = useRef(new Map<string, PersistedActionView[]>());
  const restoredAttachmentsRef = useRef(new Map<string, PersistedAttachmentView[]>());
  const restoredSourcesRef = useRef(new Map<string, KiroSourceMeta[]>());

  // Message View 增量缓存：parts/metadata 引用未变 → 复用 view 对象（streaming 时旧消息不重算）
  const viewCacheRef = useRef(
    new Map<string, { partsRef: unknown; metadataRef: unknown; statusRef?: unknown; view: KiroChatMessageView }>()
  );

  // Streaming UX V2：Live Turn Presentation commit 状态（assistant message id → commit）。
  // 单调 lane：已 commit 的文字绝不跨视觉通道迁移；settled 消息复用同一 commit 保证不回流。
  const liveTurnCommitsRef = useRef(new Map<string, LiveTurnCommitState>());
  const getOrCreateLiveTurnCommit = useCallback((messageId: string): LiveTurnCommitState => {
    let commit = liveTurnCommitsRef.current.get(messageId);
    if (!commit) {
      commit = createLiveTurnCommitState();
      liveTurnCommitsRef.current.set(messageId, commit);
    }
    return commit;
  }, []);

  // ---- Turn Execution Lifecycle（Streaming UX V3 Phase 3）----
  // 真实生命周期，不再用 timer 补偿 SDK 的瞬时 ready：
  // - 每次 addToolOutput 完成 tool output 后，SDK 的 sendAutomaticallyWhen 会立即发起续跑请求，
  //   但在续跑请求（status→submitted）真正开始前 status 会瞬时保持 ready。
  //   用 pendingAutoContinueRef 覆盖该窗口（SDK 保证会自动续跑；limitReached 时不续跑）。
  // - status 回到 submitted/streaming 或 error → 清除标记（续跑已开始 / 请求已结束）。
  const pendingAutoContinueRef = useRef(false);
  /** 用户 Stop 的 turn message id：其遗留的 pending tool part 不再视为 in-flight */
  const stoppedTurnMessageIdRef = useRef<string | null>(null);

  const consumeUndo = useCallback((toolCallId: string) => {
    const entry = undoRegistryRef.current.get(toolCallId);
    if (entry && !entry.used) {
      entry.used = true;
      undoRegistryRef.current.delete(toolCallId);
      entry.undo();
    }
  }, []);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: bodyRef.current,
    }),
    // Streaming UX V2 Phase 4：24ms 客户端节流（SDK 内建；不引入手写 queue / rAF / debounce）
    experimental_throttle: KIRO_CLIENT_STREAM_THROTTLE_MS,
    onError: () => {
      // error 状态由 useChat 内部维护；归一化在下方派生
    },
    onToolCall: ({ toolCall }) => {
      const { toolName, toolCallId, input } = toolCall as {
        toolName: string;
        toolCallId: string;
        input: unknown;
      };
      // V4.6：真实 tool 时间点（test-only；不记录 tool 内容）
      turnPerf("toolCallReceived", toolCallId);
      turnPerf("toolExecutionStart", toolCallId);

      const failOutput = (code: string, message: string) =>
        emitToolOutput(toolName, toolCallId, { ok: false, code, message } as ToolOutput);

      // ---- Final Answer Boundary（Streaming UX V3 Phase 1）----
      // 内部控制信号：不执行、不计入 quota、不进 worklog/audit；直接回填 ok:true 让模型继续输出正文。
      if (isKiroFinalAnswerToolName(toolName)) {
        emitToolOutput(toolName, toolCallId, { ok: true, data: {} });
        return;
      }
      // 协议 invariant：boundary 已出现（最后一条 assistant 消息含 begin_final_answer）→
      // 后续业务 Tool Call 是协议错误，不继续作为正常 Agent 流程执行。
      const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
      const finalAnswerAlreadyStarted = !!lastAssistant &&
        ((lastAssistant.parts ?? []) as { type?: string }[]).some(
          (p) => typeof p.type === "string" && p.type === "tool-begin_final_answer"
        );
      if (finalAnswerAlreadyStarted) {
        failOutput("FINAL_ANSWER_ALREADY_STARTED", "Final Answer 已开始，本轮不再执行新的工具调用。");
        return;
      }

      // ---- 循环保护 ----
      if (limitReachedRef.current) {
        failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮操作上限，请换个问法。");
        return;
      }

      // ---- read_material（重量级，单独限制）----
      if (toolName === "read_material") {
        documentReadCounterRef.current += 1;
        if (documentReadCounterRef.current > MAX_DOCUMENT_READS_PER_TURN) {
          failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮资料读取上限。");
          return;
        }
        // Browser 异步执行（IndexedDB Blob → 提取）；完成后回传 Tool Output
        void executeReadMaterial(input, useAppStore.getState()).then((result) => {
          if (result.ok) {
            registerMaterialSource(
              result.data as { materialId?: string; title?: string; pages?: { page: number }[] },
              input
            );
          }
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        });
        return;
      }

      // ---- read_project_file（V1.3A）：与 read_material 共享重型文档 quota；frozen index + 跨项目双重检查 ----
      if (toolName === "read_project_file") {
        documentReadCounterRef.current += 1;
        if (documentReadCounterRef.current > MAX_DOCUMENT_READS_PER_TURN) {
          failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮资料读取上限。");
          return;
        }
        const frozenProjectContext = turnSnapshotRef.current?.projectContext as
          | KiroProjectTurnContext
          | undefined;
        void executeReadProjectFile(input, frozenProjectContext).then((result) => {
          // V1.3B：只有真实 Evidence（text 非空 或 pages 有内容）才注册 Citation；
          // image / scanned PDF 只返回 visualRequired，不注册（后续 read_project_visual 再注册）
          if (result.ok && (result.data.text || (result.data.pages && result.data.pages.length > 0))) {
            registerProjectFileSource({
              projectFileId: result.data.projectFileId,
              name: result.data.name,
              pages: result.data.pages,
            });
          }
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        });
        return;
      }

      // ---- read_project_visual（V1.3B）：与 read_material/read_project_file 共享重型文档 quota；
      // 使用 frozen Turn 模型 + frozen project index + 共享 Vision Ledger ----
      if (toolName === "read_project_visual") {
        documentReadCounterRef.current += 1;
        if (documentReadCounterRef.current > MAX_DOCUMENT_READS_PER_TURN) {
          failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮资料读取上限。");
          return;
        }
        const snapshot = turnSnapshotRef.current as (Record<string, unknown> & {
          projectContext?: KiroProjectTurnContext;
          provider?: string;
          model?: string;
          apiKey?: string;
          customConfig?: unknown;
        }) | null;
        const frozenProjectContext = snapshot?.projectContext;
        const frozenTurn = {
          provider: snapshot?.provider ?? "opencode-go",
          model: snapshot?.model ?? "",
          apiKey: snapshot?.apiKey,
          customConfig: snapshot?.customConfig,
        };
        const ledger = turnVisionBudgetRef.current ?? createVisionTurnRuntimeBudget({});
        turnVisionBudgetRef.current = ledger;
        void executeReadProjectVisual(input, {
          frozenProjectContext,
          frozenTurn,
          ledger,
          latestUserText: latestUserTextRef.current,
        }).then((result) => {
          if (result.ok && (result.data.text || (result.data.pages && result.data.pages.length > 0))) {
            registerProjectFileSource({
              projectFileId: result.data.projectFileId,
              name: result.data.name,
              pages: result.data.pages,
            });
          }
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        });
        return;
      }

      // ---- search_project_file（V1.4）：与 read 系列共享重型文档 quota；frozen project index；
      // 只注册真实 Evidence 页（TXT/DOCX 无页码 → 不设 availablePages；matches 为空 → 不注册）----
      if (toolName === "search_project_file") {
        documentReadCounterRef.current += 1;
        if (documentReadCounterRef.current > MAX_DOCUMENT_READS_PER_TURN) {
          failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮资料读取上限。");
          return;
        }
        const snapshot = turnSnapshotRef.current as (Record<string, unknown> & {
          projectContext?: KiroProjectTurnContext;
        }) | null;
        const frozenProjectContext = snapshot?.projectContext;
        void executeSearchProjectFile(input, { frozenProjectContext }).then((result) => {
          if (result.ok && result.data.matches.length > 0) {
            registerProjectFileSource({
              projectFileId: result.data.projectFileId,
              name: result.data.name,
              // PDF：实际返回的匹配页；TXT/DOCX：无页码（注册 source 但不伪造 availablePages）
              pages: result.data.kind === "pdf" ? (result.data.matches as { page: number }[]) : undefined,
            });
          }
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        });
        return;
      }

      // ---- Learning History（Part 2）：Browser 异步执行 IndexedDB 查询；只读 ----
      if (toolName === "query_learning_history" || toolName === "summarize_learning_history") {
        void (async () => {
          const result =
            toolName === "query_learning_history"
              ? await executeQueryLearningHistory(input)
              : await executeSummarizeLearningHistory(input);
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        })();
        return;
      }

      // ---- Canonical Analytics（Part 2）：Browser 异步执行，与 UI 同源；只读 ----
      if (toolName === "get_learning_analytics") {
        void (async () => {
          const result = await executeGetLearningAnalytics(input);
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        })();
        return;
      }

      // ---- Canonical Outlook（Part 3）：Browser 异步执行，与 UI 同源；只读 ----
      if (toolName === "get_learning_outlook") {
        void (async () => {
          const result = await executeGetLearningOutlook(input);
          emitToolOutput(toolName, toolCallId, result as ToolOutput);
        })();
        return;
      }

      // ---- Memory Tools（Task 9）：Browser 执行 IndexedDB；独立于业务 Write ----
      if ((KIRO_MEMORY_TOOL_NAMES as string[]).includes(toolName)) {
        void (async () => {
          const output = await runMemoryTool(toolName, input, toolCallId);
          emitToolOutput(toolName, toolCallId, output);
        })();
        return;
      }

      // ---- Computer Tools（Part 2/3）：Browser Executor + Frozen Turn intent + Live security state ----
      // ask → approval-required：不执行 IO、不 addToolOutput（Tool Call 保持 pending）；
      // 用户决策后 resume 同一条 exact call（同一 sandbox/policy/grant 检查）。
      if (isComputerToolName(toolName)) {
        void runComputerToolCall(toolName, toolCallId, input);
        return;
      }

      // ---- Change Set（Task 8）：多写事务，全部合法才全部提交 ----
      if (toolName === "apply_change_set") {
        // Task B Visual Turn Mutation Guard：截图来源的写操作必须先 propose_visual_actions
        if (turnImageAttachmentIdsRef.current.length > 0) {
          failOutput(VISUAL_PROPOSAL_REQUIRED_CODE, VISUAL_PROPOSAL_REQUIRED_MESSAGE);
          return;
        }
        const parsed = KIRO_WRITE_TOOL_SCHEMAS.apply_change_set.safeParse(input);
        if (!parsed.success) {
          failOutput("INVALID_INPUT", "Change Set 输入不合法。");
          return;
        }
        // 内部 mutation 计入本轮 Write 上限（不能绕过限制）
        writeCounterRef.current += parsed.data.actions.length;
        if (writeCounterRef.current > MAX_WRITE_TOOL_CALLS_PER_TURN) {
          limitReachedRef.current = true;
          failOutput("WRITE_TOOL_LIMIT_REACHED", "已达到本轮修改上限，请分步进行。");
          return;
        }
        void (async () => {
          const result = await executeChangeSet({
            actions: parsed.data.actions,
            summary: parsed.data.summary,
            state: useAppStore.getState(),
            api: createKiroWriteApi({
              toolCallId,
              pushToast,
              registerUndo: (id, undo) => {
                undoRegistryRef.current.set(id, { toolCallId: id, used: false, undo });
              },
              onCancelOutput: (msg) => failOutput("USER_CANCELLED", msg),
            }),
            toolCallId,
            confirm: (req) =>
              new Promise<boolean>((resolve) => {
                confirmRequest({
                  title: req.title,
                  description: req.description as React.ReactNode,
                  confirmLabel: req.confirmLabel,
                  danger: req.danger,
                  onConfirm: () => resolve(true),
                  onCancel: () => resolve(false),
                });
              }),
          });
          const output: WriteToolResult =
            result.ok
              ? {
                  ok: true,
                  data: { count: result.changeSet.count },
                  action: {
                    tool: "apply_change_set",
                    entityType: "change-set",
                    entityId: toolCallId,
                    title: result.changeSet.summary,
                    operation: "update",
                    canUndo: true,
                    changeSet: {
                      count: result.changeSet.count,
                      summary: result.changeSet.summary,
                      actions: result.changeSet.actions,
                    },
                  },
                }
              : {
                  ok: false,
                  code: result.code as WriteToolResult extends infer T ? (T extends { ok: false; code: infer C } ? C : never) : never,
                  message: result.message,
                  details: result.details,
                  // 事务失败必须明确「实际写入数」（Preflight / 回滚后恒为 0）
                  applied: result.applied,
                  failedActionIndex: result.failedActionIndex,
                };
          if (result.ok) {
            pushToast({
              message: `已完成 ${result.changeSet.count} 项修改`,
              actionLabel: "撤销",
              onAction: () => consumeUndo(toolCallId),
            });
          }
          emitToolOutput(toolName, toolCallId, output);
        })();
        return;
      }

      // ---- Write Tools ----
      if ((KIRO_WRITE_TOOL_NAMES as string[]).includes(toolName)) {
        // Task B Visual Turn Mutation Guard：截图来源的写操作必须先 propose_visual_actions
        if (turnImageAttachmentIdsRef.current.length > 0 && isClassFlowMutationTool(toolName)) {
          failOutput(VISUAL_PROPOSAL_REQUIRED_CODE, VISUAL_PROPOSAL_REQUIRED_MESSAGE);
          return;
        }
        writeCounterRef.current += 1;
        if (writeCounterRef.current > MAX_WRITE_TOOL_CALLS_PER_TURN) {
          limitReachedRef.current = true;
          failOutput("WRITE_TOOL_LIMIT_REACHED", "已达到本轮修改上限，请分步进行。");
          return;
        }

        // 受限 API：只暴露白名单 action；禁止 setState
        const api = createKiroWriteApi({
          toolCallId,
          pushToast,
          registerUndo: (id, undo) => {
            undoRegistryRef.current.set(id, { toolCallId: id, used: false, undo });
          },
          onCancelOutput: (msg) => failOutput("USER_CANCELLED", msg),
        });

        // 高风险工具：强制用户确认（Risk 由 ClassFlow 决定）
        if (isDestructiveWriteTool(toolName)) {
          const state = useAppStore.getState();
          const entityLabel =
            toolName === "delete_assignment"
              ? (() => {
                  const a = state.assignments.find((x) => x.id === (input as { assignmentId?: string }).assignmentId);
                  return a ? `「${a.title}」` : "该任务";
                })()
              : toolName === "delete_schedule"
              ? (() => {
                  const s = state.schedules.find((x) => x.id === (input as { scheduleId?: string }).scheduleId);
                  const c = s ? state.courses.find((x) => x.id === s.courseId) : null;
                  return c ? `《${c.name}》的排课` : "该排课";
                })()
              : "该项";
          confirmRequest({
            title: toolName === "delete_assignment" ? `删除任务 ${entityLabel}？` : `删除排课 ${entityLabel}？`,
            description: "Kiro 将删除该项，删除后可通过「撤销」恢复。",
            confirmLabel: "删除",
            danger: true,
            onConfirm: () => runWriteTool(toolName, toolCallId, input, api),
            onCancel: () => failOutput("USER_CANCELLED", "用户取消了操作。"),
          });
          return;
        }

        // 普通写操作：直接执行
        runWriteTool(toolName, toolCallId, input, api);
        return;
      }

      // ---- Read Tools ----
      readCounterRef.current += 1;
      if (readCounterRef.current > MAX_READ_TOOL_CALLS_PER_TURN_UI) {
        limitReachedRef.current = true;
        failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮读取上限，请换个问法。");
        return;
      }
      // 每次执行读取最新 Store（Data Freshness）；Turn-level trusted context（V1.1：frozen image IDs）
      const result = executeKiroReadTool(toolName, input, useAppStore.getState(), {
        visualSourceAttachmentIds: turnImageAttachmentIdsRef.current,
      });
      emitToolOutput(toolName, toolCallId, result as ToolOutput);
    },
    sendAutomaticallyWhen: ({ messages }) =>
      !limitReachedRef.current && lastAssistantMessageIsCompleteWithToolCalls({ messages }),
  });

  // Streaming UX V3 Phase 3：Turn Execution Lifecycle 的清除逻辑（submitted/streaming/error →
  // 续跑已开始 / 请求已结束，awaiting-continuation 标记作废）。
  useEffect(() => {
    if (chat.status === "submitted" || chat.status === "streaming" || chat.status === "error") {
      pendingAutoContinueRef.current = false;
    }
  }, [chat.status]);

  /** 统一 Tool Output 回填：完成后标记 awaiting-continuation（SDK 将自动续跑；limitReached 不续跑） */
  const emitToolOutput = useCallback(
    (tool: string, toolCallId: string, output: unknown) => {
      // V4.6：真实 tool 时间点（test-only；不记录 tool 内容）
      turnPerf("toolExecutionComplete", toolCallId);
      turnPerf("addToolOutput", toolCallId);
      if (!limitReachedRef.current) pendingAutoContinueRef.current = true;
      chat.addToolOutput({
        tool: tool as never,
        toolCallId,
        output,
        options: { body: requestBody() },
      });
    },
    [chat]
  );

  // ---- Turn Execution State（Streaming UX V3 Phase 3）----
  // 真实生命周期（不再用 chat.status === ready 直接判 settled）：
  // - executing：请求已发出 / 正在流式（parts 仍在到达）
  // - awaiting-tool-result：status ready 但最后一条 assistant 消息仍有未回填的 Tool part
  //   （client 工具执行中 / 审批等待中）——前提是该 turn 未被用户 Stop
  // - awaiting-continuation：tool output 已回填，SDK 自动续跑请求即将/正在发起（消除瞬时 ready）
  // - settled：真正结束（无 pending tool、无计划续跑、非 executing）
  const turnExecution = useMemo<KiroTurnExecutionState>(() => {
    if (chat.status === "submitted" || chat.status === "streaming") return "executing";
    if (chat.status === "error") return "settled";
    // ready：
    if (pendingAutoContinueRef.current) return "awaiting-continuation";
    let lastUserIdx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const live = chat.messages[chat.messages.length - 1] as UIMessage | undefined;
    if (live && live.role === "assistant" && chat.messages.length - 1 > lastUserIdx) {
      const hasPendingToolPart = ((live.parts ?? []) as { type?: string; state?: string }[]).some(
        (p) =>
          typeof p.type === "string" &&
          p.type.startsWith("tool-") &&
          p.state !== "output-available" &&
          p.state !== "output-error"
      );
      if (hasPendingToolPart) {
        return stoppedTurnMessageIdRef.current === live.id ? "settled" : "awaiting-tool-result";
      }
    }
    return "settled";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, chat.messages]);
  const turnInFlight = turnExecution !== "settled";

  /** 执行 Write Tool：preflight + mutation + Undo 注册 + Toast + addToolOutput */
  const runWriteTool = useCallback(
    (toolName: string, toolCallId: string, input: unknown, api: KiroWriteApi) => {
      const result = executeKiroWriteTool(toolName, input, api, toolCallId);
      if (result.ok) {
        pushToast({
          message: actionToastMessage(result.action),
          actionLabel: result.action.canUndo ? "撤销" : undefined,
          onAction: result.action.canUndo ? () => consumeUndo(toolCallId) : undefined,
        });
      }
      emitToolOutput(toolName, toolCallId, result as ToolOutput);
    },
    [chat, consumeUndo, pushToast, emitToolOutput]
  );

  // ==================== Computer Agent Task / Approval / Undo Runtime（Part 3） ====================

  /** 更新 Task 渲染状态（ref + state 同源） */
  const updateTasks = useCallback(() => {
    tasksRef.current = new Map(tasksRef.current);
    setTasksState(tasksRef.current);
  }, []);

  /** 当前 Turn 的主 Task（第一个 Computer tool call 时创建；绑定其 toolCallIds）。
   *  V2.8.1：同一轮对话（同一 User Message）跨 SSE 请求的多个 Computer 工具必须共享同一个 Task——
   *  即使 activeTaskRef 被 turn 间隙的 finalize 清空，也按 userMessageId 复用已有 Task，
   *  Task Card 才能聚合展示「删除 N 个文件」的完整变更。 */
  const ensureActiveTask = useCallback((): KiroAgentTask => {
    let task = activeTaskRef.current;
    if (task) return task;
    const lastUser = [...latestChatRef.current.messages].reverse().find((m) => m.role === "user");
    const userMessageId = lastUser?.id ?? "";
    // 复用同一 User Message 已存在的 Task（工具链跨请求分裂修复）
    const existing = userMessageId
      ? Array.from(tasksRef.current.values()).find((t) => t.userMessageId === userMessageId)
      : undefined;
    if (existing) {
      activeTaskRef.current = existing;
      return existing;
    }
    task = createAgentTask({
      userMessageId,
      conversationId: conversationIdRef.current,
      title: "工作区文件操作",
    });
    activeTaskRef.current = task;
    tasksRef.current.set(task.id, task);
    updateTasks();
    return task;
  }, [updateTasks]);

  /** 显示下一个 pending approval（队列单例展示；可执行请求仍留在 refs） */
  const advancePendingApproval = useCallback(() => {
    const next = pendingExecutionsRef.current.values().next().value as PendingComputerExecution | undefined;
    setPendingApproval(next ? next.request : null);
  }, [setPendingApproval]);

  /** approval-required：保持 Tool Call pending（不 addToolOutput）；Task step → awaiting_permission */
  const handleApprovalRequired = useCallback(
    (
      request: ComputerApprovalRequest,
      toolName: string,
      toolCallId: string,
      input: unknown,
      frozenSnapshot: KiroComputerTurnSnapshot
    ) => {
      pendingExecutionsRef.current.set(request.id, { request, toolName, toolCallId, input, frozenSnapshot });
      if (!useKiroComputerRuntimeStore.getState().pendingApproval) {
        setPendingApproval(request);
      }
      const task = tasksRef.current.get(request.taskId);
      if (task) {
        const step = taskStepForToolCall(task, toolCallId, toolStepLabel(toolName));
        step.status = "awaiting_permission";
        task.status = "awaiting_permission";
        updateTasks();
      }
    },
    [setPendingApproval, updateTasks]
  );

  /** completed attempt：只有 completed.output 进入 addToolOutput；runtime 事实进 checkpoint/task */
  const applyCompletedAttempt = useCallback(
    (attempt: ComputerExecutionAttempt, toolName: string, toolCallId: string, taskId: string) => {
      if (attempt.kind !== "completed") return;
      const { output, runtime } = attempt;
      const task = tasksRef.current.get(taskId);
      if (task) {
        // 确保 step 与 toolCallId 已注册（读/写/失败都计入；Task 绑定 owning message 的事实来源）
        taskStepForToolCall(task, toolCallId, toolStepLabel(toolName));
        if (output.ok && runtime) {
          let cp = checkpointsRef.current.get(taskId);
          if (!cp) {
            cp = createTaskCheckpoint(taskId);
            checkpointsRef.current.set(taskId, cp);
          }
          if (runtime.inverse) appendInverseToCheckpoint(cp, runtime.inverse);
          task.changes.push(runtime.change);
          if (cp.inverses.length > 0 && !task.undoUsed) {
            task.canUndo = true;
          }
          // 保持当前状态（新 task 默认 running）；审批 resume 场景从 awaiting 回到 running
          if (task.status === "awaiting_permission") {
            task.status = "running";
          }
          completeTaskStep(task, toolCallId);
          const change = runtime.change;
          void appendComputerAuditEntry({
            id: `audit-${crypto.randomUUID()}`,
            timestamp: new Date().toISOString(),
            taskId,
            conversationId: conversationIdRef.current,
            toolCallId,
            toolName,
            capability: capabilityForChange(change),
            decision: "auto",
            outcome: "executed",
            workspaceId: change.workspaceId,
            workspaceLabel: change.workspaceLabel,
            rootId: change.rootId,
            rootLabel: change.rootLabel,
            relativePath: change.relativePath,
            verification: "passed",
          });
        } else if (!output.ok) {
          failTaskStep(task, toolCallId);
          // V2.7.2：失败/拒绝也写 Audit（decision=none, outcome=failed）——所有拒绝路径可诊断，
          // 避免「删除没生效但无任何记录」的盲区（PERMISSION_DENIED/INVALID_INPUT/上限/异常等）
          const failedChange = (attempt as { runtime?: { change?: KiroComputerChange } }).runtime?.change;
          void appendComputerAuditEntry({
            id: `audit-${crypto.randomUUID()}`,
            timestamp: new Date().toISOString(),
            taskId,
            conversationId: conversationIdRef.current,
            toolCallId,
            toolName,
            capability: failedChange ? capabilityForChange(failedChange) : capabilityForToolName(toolName),
            decision: "none",
            outcome: "failed",
            workspaceId: failedChange?.workspaceId ?? "",
            workspaceLabel: failedChange?.workspaceLabel ?? "",
            rootId: failedChange?.rootId,
            rootLabel: failedChange?.rootLabel,
            relativePath: failedChange?.relativePath,
            verification: "failed",
          });
        } else {
          completeTaskStep(task, toolCallId);
        }
        updateTasks();
      }
      emitToolOutput(toolName, toolCallId, output as ToolOutput);
    },
    [updateTasks, emitToolOutput]
  );

  /** 执行 Computer Tool Call（onToolCall / approval resume 共用入口） */
  const runComputerToolCall = useCallback(
    async (toolName: string, toolCallId: string, input: unknown) => {
      const snapshot = (turnSnapshotRef.current as Record<string, unknown> | null)
        ?.computerSnapshot as KiroComputerTurnSnapshot | undefined;
      const frozenSnapshot = snapshot ?? buildComputerSnapshot();
      const taskId = ensureActiveTask().id;

      // V2.3 Client Second Guard：fuse 已触发（stale Server 仍发来 document 工具）→ 不执行 IO
      if (
        (toolName === "create_document" || toolName === "update_document") &&
        documentToolFailureRef.current.blocked
      ) {
        const output: ToolOutput = {
          ok: false,
          code: "DOCUMENT_CREATION_BLOCKED",
          message: "本轮文档创建已停止，请不要继续重试。",
        };
        applyCompletedAttempt({ kind: "completed", output } as ComputerExecutionAttempt, toolName, toolCallId, taskId);
        return;
      }

      const attempt = await executeKiroComputerTool({
        toolName,
        toolCallId,
        toolInput: input,
        context: {
          // Frozen intent：本 Turn 发送时的 workspace / agentMode
          turnSnapshot: frozenSnapshot,
          // Live security state：实时 rules / grants（撤销立即生效）
          liveWorkspaces: useKiroComputerStore.getState().workspaces,
          livePermissionRules: useKiroComputerStore.getState().permissionRules,
          taskId,
        },
        counters: computerCountersRef.current,
        oneShotApprovals: oneShotApprovalsRef.current,
      });
      if (attempt.kind === "approval-required") {
        handleApprovalRequired(attempt.request, toolName, toolCallId, input, frozenSnapshot);
        return;
      }
      // V2.3：推进 fuse（schema 失败最多 1 次 retry；render/verify 硬失败首次即熔断）
      if (toolName === "create_document" || toolName === "update_document") {
        if (attempt.kind === "completed" && attempt.output.ok === false) {
          advanceDocumentFailureFuse(documentToolFailureRef.current, attempt.output);
        }
      }
      applyCompletedAttempt(attempt, toolName, toolCallId, taskId);
    },
    [buildComputerSnapshot, ensureActiveTask, handleApprovalRequired, applyCompletedAttempt]
  );

  /**
   * 用户审批决策（ComputerApprovalDialog）：
   * deny → USER_CANCELLED Tool Output；allow-* → 建立规则后 resume 同一条 exact call
   *（同一 frozen snapshot + live rules/grants；executor 内重复完整 policy 求值）。
   *
   * V2.7 生命周期：决策被接受 → 立即从 UI queue 移除当前 approval（不等 IO 完成）；
   * resume 包 try/catch/finally——异常归一化为 Tool Output ok:false（Task step → error），
   * 绝不残留 stale pendingApproval / busy Dialog。
   */
  const handleApprovalDecision = useCallback(
    async (
      approvalId: string,
      decision: ComputerApprovalDecision,
      opts?: { timedOut?: boolean }
    ) => {
      const pending = pendingExecutionsRef.current.get(approvalId);
      if (!pending) {
        // V2.7 stale approval 防御：ref 中不存在该 request → 推进队列并恢复 UI，绝不残留 Dialog
        advancePendingApproval();
        return;
      }
      pendingExecutionsRef.current.delete(approvalId);
      clearApprovalTimeout(approvalId);
      const { request, toolName, toolCallId, input, frozenSnapshot } = pending;
      const taskId = request.taskId;

      // V2.7：决策被接受 → 立即关闭当前 approval / 显示下一条（后台 resume，不阻塞 UI）
      advancePendingApproval();

      if (decision === "deny" || opts?.timedOut) {
        const task = tasksRef.current.get(taskId);
        if (task) {
          const step = task.steps.find((s) => s.toolCallId === toolCallId);
          if (step) {
            step.status = "cancelled";
            step.completedAt = new Date().toISOString();
          }
          task.status = "cancelled";
          updateTasks();
        }
        void appendComputerAuditEntry({
          id: `audit-${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          taskId,
          conversationId: conversationIdRef.current,
          toolCallId,
          toolName,
          capability: request.capability,
          decision: opts?.timedOut ? "timeout" : "deny",
          outcome: "denied",
          workspaceId: request.workspaceId,
          workspaceLabel: request.workspaceLabel,
          rootId: request.rootId,
          rootLabel: request.rootLabel,
          relativePath: request.relativePath,
        });
        emitToolOutput(toolName, toolCallId, {
          ok: false,
          code: "USER_CANCELLED",
          message: opts?.timedOut ? "审批超时未响应，操作已自动取消。" : "用户拒绝了此操作。",
        } as ToolOutput);
        return;
      }

      if (decision === "allow-once") {
        oneShotApprovalsRef.current.push({
          approvalId,
          toolCallId,
          capability: request.capability,
          workspaceId: request.workspaceId,
          rootId: request.rootId,
          relativePath: request.relativePath,
        });
      } else if (decision === "allow-session") {
        useKiroComputerStore.getState().upsertPermissionRule(sessionRuleForRequest(request));
      } else if (decision === "allow-workspace") {
        useKiroComputerStore.getState().upsertPermissionRule(workspaceRuleForRequest(request));
      }

      try {
        // Resume EXACT Tool Call（same sandbox/policy/grant checks）
        const attempt = await executeKiroComputerTool({
          toolName,
          toolCallId,
          toolInput: input,
          context: {
            turnSnapshot: frozenSnapshot,
            liveWorkspaces: useKiroComputerStore.getState().workspaces,
            livePermissionRules: useKiroComputerStore.getState().permissionRules,
            taskId,
          },
          counters: computerCountersRef.current,
          oneShotApprovals: oneShotApprovalsRef.current,
        });
        if (attempt.kind === "approval-required") {
          handleApprovalRequired(attempt.request, toolName, toolCallId, input, frozenSnapshot);
          return;
        }
        void appendComputerAuditEntry({
          id: `audit-${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          taskId,
          conversationId: conversationIdRef.current,
          toolCallId,
          toolName,
          capability: request.capability,
          decision,
          outcome: "executed",
          workspaceId: request.workspaceId,
          workspaceLabel: request.workspaceLabel,
          rootId: request.rootId,
          rootLabel: request.rootLabel,
          relativePath: request.relativePath,
          verification: "passed",
        });
        applyCompletedAttempt(attempt, toolName, toolCallId, taskId);
      } catch (error) {
        // V2.7：resume 异常 → 归一化为 Tool Output ok:false（绝不 Unhandled Rejection / 卡 Dialog）
        const output: ToolOutput =
          error instanceof ComputerError
            ? { ok: false, code: error.code, message: error.message }
            : {
                ok: false,
                code: "UNKNOWN",
                message: error instanceof Error ? error.message : "审批后执行失败",
              };
        const task = tasksRef.current.get(taskId);
        if (task) {
          failTaskStep(task, toolCallId);
          updateTasks();
        }
        emitToolOutput(toolName, toolCallId, output);
        void appendComputerAuditEntry({
          id: `audit-${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          taskId,
          conversationId: conversationIdRef.current,
          toolCallId,
          toolName,
          capability: request.capability,
          decision,
          outcome: "error",
          workspaceId: request.workspaceId,
          workspaceLabel: request.workspaceLabel,
          rootId: request.rootId,
          rootLabel: request.rootLabel,
          relativePath: request.relativePath,
          verification: "failed",
        });
      } finally {
        // 兜底：任何路径都推进队列，确保 UI 不残留 stale approval
        advancePendingApproval();
      }
    },
    [advancePendingApproval, applyCompletedAttempt, handleApprovalRequired, failTaskStep, updateTasks, emitToolOutput, clearApprovalTimeout]
  );

  // V2.7.2：approval 超时自动取消（3 分钟）——审批挂起不能永久阻塞 Tool Call
  //（用户忽略弹窗 / 页面后台 / 旧 bundle 死锁等场景，Kiro 必须最终收到确定结果）。
  useEffect(() => {
    if (!pendingApproval) return;
    if (approvalTimeoutTimersRef.current.has(pendingApproval.id)) return;
    const timer = setTimeout(() => {
      approvalTimeoutTimersRef.current.delete(pendingApproval.id);
      void handleApprovalDecision(pendingApproval.id, "deny", { timedOut: true });
    }, APPROVAL_TIMEOUT_MS);
    approvalTimeoutTimersRef.current.set(pendingApproval.id, timer);
    return () => {
      clearTimeout(timer);
      approvalTimeoutTimersRef.current.delete(pendingApproval.id);
    };
  }, [pendingApproval, handleApprovalDecision]);

  /** Task-level Undo（session runtime only）：reverse order + 每条 verified；失败 → undo_failed */
  const undoTask = useCallback(
    async (taskId: string) => {
      const cp = checkpointsRef.current.get(taskId);
      const task = tasksRef.current.get(taskId);
      if (!cp || !task || cp.used) return; // single-use
      cp.used = true;
      task.undoUsed = true;
      task.canUndo = false;
      updateTasks();
      let outcome: "undone" | "undo_failed" = "undone";
      try {
        for (const inverse of [...cp.inverses].reverse()) {
          const ws = useKiroComputerStore
            .getState()
            .workspaces.find((w) => w.id === inverse.workspaceId);
          if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "工作区不存在");
          // V3 Part 1：inverse 执行一旦开始（即使最后 undo_failed），对应 Workspace best-effort dirty
          // （部分 Undo 可能已改变文件系统）
          void markWorkspaceKnowledgeDirty(ws.id).catch(() => undefined);
          // V2：move-back / restore-document-revision 是特殊 inverse（多 store），单独 orchestration
          if (inverse.type === "move-back") {
            await undoMoveBack(ws, inverse);
            continue;
          }
          if (inverse.type === "restore-document-revision") {
            // V2 Part 2.1：委托给可测试的 runtime helper（事实重读 + 安全补偿）
            const root = ws.roots.find((r) => r.id === inverse.rootId);
            if (!root) throw new ComputerError("ROOT_NOT_FOUND", "根目录不存在");
            const io = getComputerAdapterForAdapterRef(root.adapterRef);
            await undoDocumentRevisionRuntime({ io, inverse });
            continue;
          }
          const root = ws.roots.find((r) => r.id === inverse.rootId);
          if (!root) throw new ComputerError("ROOT_NOT_FOUND", "工作区根不存在");
          const io = getComputerAdapterForAdapterRef(root.adapterRef);
          await applyInverseToAdapter(io, inverse);
        }
      task.status = "undone";
    } catch {
      task.status = "undo_failed";
      outcome = "undo_failed";
    }
    updateTasks();
    setComputerVersion((v) => v + 1);
      const capability = task.changes.length > 0 ? capabilityForChange(task.changes[0]) : "fs.modify";
      void appendComputerAuditEntry({
        id: `audit-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        taskId,
        conversationId: conversationIdRef.current,
        toolCallId: task.changes[0]?.toolCallId ?? "",
        toolName: "undo",
        capability,
        decision: "none",
        outcome,
        workspaceId: task.changes[0]?.workspaceId ?? "",
        workspaceLabel: task.changes[0]?.workspaceLabel ?? "",
        rootId: task.changes[0]?.rootId,
        rootLabel: task.changes[0]?.rootLabel,
        relativePath: task.changes[0]?.relativePath,
        verification: outcome === "undone" ? "passed" : "failed",
      });
    },
    [updateTasks]
  );

  /** Turn 结束（streaming false）→ 收尾 active task（failed / cancelled / completed） */
  const finalizeActiveTask = useCallback(() => {
    const task = activeTaskRef.current;
    if (!task) return;
    // Approval 未决（客户端 tool 处理间隙 status 可能闪 ready）：等用户决策后再收尾
    if (pendingExecutionsRef.current.size > 0) return;
    activeTaskRef.current = null;
    if (task.status === "running" || task.status === "awaiting_permission") {
      const hasFailed = task.steps.some((s) => s.status === "failed");
      const hasCancelled = task.steps.some((s) => s.status === "cancelled");
      task.status = hasFailed ? "failed" : hasCancelled ? "cancelled" : "completed";
    }
    task.completedAt = task.completedAt ?? new Date().toISOString();
    updateTasks();
  }, [updateTasks]);

  // Turn 结束（turnExecution === settled）→ finalize active task。
  // V2.8.1：工具链跨 SSE 请求的间隙（status 闪 ready）turnExecution 是 awaiting-tool-result /
  // awaiting-continuation——此时绝不 finalize，保证同一轮多个 Computer 工具共享同一个 Task，
  // Task Card 聚合展示完整变更（如「删除 N 个文件」）。
  useEffect(() => {
    if (turnExecution !== "settled") return;
    finalizeActiveTask();
  }, [turnExecution, finalizeActiveTask]);

  // Unmount：清除 stale approvals（approval 不能在新会话继续执行）
  useEffect(() => {
    return () => {
      pendingExecutionsRef.current.clear();
      setPendingApproval(null);
    };
  }, [setPendingApproval]);

  /** 当前用户 Turn 的文本（Memory Intent 守卫使用：只能来自当前 User Message，附件/摘要不算） */
  const latestUserText = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.role !== "user") continue;
      return ((m.parts ?? []) as { type?: string; text?: string }[])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join(" ");
    }
    return "";
  }, [chat.messages]);

  /**
   * Memory Tool 执行（Browser）：save 受 Explicit Intent 守卫；memoryEnabled=false 拒绝读写。
   * 输出安全：不返回完整大对象。
   */
  const runMemoryTool = useCallback(
    async (toolName: string, input: unknown, toolCallId: string): Promise<WriteToolResult> => {
      if (!memory.memoryEnabled) {
        return { ok: false, code: "MEMORY_DISABLED" as never, message: "Kiro 记忆已关闭，可在设置中重新开启。" };
      }
      if (toolName === "search_memories") {
        const parsed = KIRO_MEMORY_TOOL_SCHEMAS.search_memories.safeParse(input);
        if (!parsed.success) return { ok: false, code: "INVALID_INPUT" as never, message: "搜索条件不合法。" };
        const results = await memory.search(parsed.data);
        return {
          ok: true,
          data: results.map((m) => ({
            id: m.id,
            title: m.title,
            content: m.content,
            category: m.category,
            scope: m.scope,
            scopeId: m.scopeId,
            tags: m.tags ?? [],
            updatedAt: m.updatedAt,
          })),
          action: { tool: "search_memories", entityType: "memory" as never, entityId: "", title: "学习偏好", operation: "read" as never, canUndo: false },
        };
      }
      if (toolName === "save_memory") {
        const parsed = KIRO_MEMORY_TOOL_SCHEMAS.save_memory.safeParse(input);
        if (!parsed.success) return { ok: false, code: "INVALID_INPUT" as never, message: "记忆内容不合法。" };
        // Explicit Intent Guard：附件/摘要/历史都不能触发保存，只有当前用户消息
        if (!hasExplicitMemoryIntent(latestUserText)) {
          return { ok: false, code: "EXPLICIT_MEMORY_INTENT_REQUIRED" as never, message: "你没有明确要求记住这条内容，因此没有保存。" };
        }
        const result = await memory.save(parsed.data);
        if (!result.created) {
          if (result.code === "MEMORY_DISABLED") {
            return { ok: false, code: "MEMORY_DISABLED" as never, message: "记忆功能已关闭，在设置中开启后可保存偏好。" };
          }
          if (result.code === "MEMORY_SENSITIVE_CONTENT") {
            return { ok: false, code: "MEMORY_SENSITIVE_CONTENT" as never, message: "内容包含敏感信息，无法保存。" };
          }
          if (result.code === "MEMORY_LIMIT_REACHED") {
            return { ok: false, code: "MEMORY_LIMIT_REACHED" as never, message: `记忆数量已达上限（${MAX_MEMORIES} 条）。` };
          }
          pushToast({ message: "这条偏好之前已经记住了。" });
          return {
            ok: true,
            data: { id: result.memory.id, deduplicated: true },
            action: { tool: "save_memory", entityType: "memory" as never, entityId: result.memory.id, title: result.memory.title, operation: "create" as never, canUndo: false },
          };
        }
        pushToast({ message: `Kiro 已记住：${result.memory.title}` });
        return {
          ok: true,
          data: {
            id: result.memory.id,
            title: result.memory.title,
            category: result.memory.category,
            scope: result.memory.scope,
            scopeId: result.memory.scopeId,
          },
          action: { tool: "save_memory", entityType: "memory" as never, entityId: result.memory.id, title: result.memory.title, operation: "create" as never, canUndo: false },
        };
      }
      if (toolName === "update_memory") {
        const parsed = KIRO_MEMORY_TOOL_SCHEMAS.update_memory.safeParse(input);
        if (!parsed.success) return { ok: false, code: "INVALID_INPUT" as never, message: "更新内容不合法。" };
        const result = await memory.update(parsed.data.memoryId, {
          title: parsed.data.title,
          content: parsed.data.content,
          category: parsed.data.category,
          scope: parsed.data.scope,
          scopeId: parsed.data.scopeId,
          tags: parsed.data.tags,
        });
        if (!result.ok) {
          if (result.code === "MEMORY_SENSITIVE_CONTENT") return { ok: false, code: "MEMORY_SENSITIVE_CONTENT" as never, message: "内容包含敏感信息，无法保存。" };
          return { ok: false, code: "NOT_FOUND" as never, message: "未找到对应记忆。" };
        }
        pushToast({ message: "记忆已更新" });
        return {
          ok: true,
          data: { id: parsed.data.memoryId },
          action: { tool: "update_memory", entityType: "memory" as never, entityId: parsed.data.memoryId, title: "学习偏好", operation: "update" as never, canUndo: false },
        };
      }
      if (toolName === "delete_memory") {
        const parsed = KIRO_MEMORY_TOOL_SCHEMAS.delete_memory.safeParse(input);
        if (!parsed.success) return { ok: false, code: "INVALID_INPUT" as never, message: "参数不合法。" };
        await memory.remove(parsed.data.memoryId);
        pushToast({ message: "记忆已删除" });
        return {
          ok: true,
          data: { id: parsed.data.memoryId },
          action: { tool: "delete_memory", entityType: "memory" as never, entityId: parsed.data.memoryId, title: "学习偏好", operation: "delete" as never, canUndo: false },
        };
      }
      return { ok: false, code: "UNSUPPORTED" as never, message: `未知记忆工具：${toolName}` };
    },
    [memory, latestUserText, pushToast]
  );

  // send 依赖用稳定子项（chat.sendMessage 为 useChat 内 useCallback），
  // 避免 chat 对象每次 token 变化导致 send 引用变化
  const chatSendMessage = chat.sendMessage;

  // V2.3：Document Failure Fuse（每 Turn 重置；与 read/write counter 同一生命周期）
  const documentToolFailureRef = useRef<DocumentFailureFuseState>({ schemaFailures: 0, hardFailure: false, blocked: false });
  const resetDocumentFailureFuse = useCallback(() => {
    documentToolFailureRef.current = { schemaFailures: 0, hardFailure: false, blocked: false };
  }, []);

  const sendWithAttachments = useCallback(
    async (text: string, turnAttachments: KiroAttachment[]): Promise<boolean> => {
      const v = text.trim();
      if (!v || !enabled) return false;
      readCounterRef.current = 0;
      documentReadCounterRef.current = 0;
      writeCounterRef.current = 0;
      limitReachedRef.current = false;
      resetDocumentFailureFuse();
      visionPagesRef.current = [];
      // V1.3B：新 User Turn 重置（真实字节在 vision payload 就绪后初始化；continuation 不得重置）
      latestUserTextRef.current = v;
      turnVisionBudgetRef.current = null;

      // ============================================================
      // V4.6 Turn Handoff：Turn Intent 在第一个 await 之前同步冻结。
      // Send click 瞬间的 provider/model/reasoning/webSearch/computer/context
      // = 本轮配置；之后 UI 修改设置只影响下一 Turn。
      // ============================================================
      turnPerf("sendClaim");
      const conversationIdAtSend = conversationIdRef.current;
      setTurnIntentFrozen(false);
      const intent = captureIntentRef.current();
      setTurnIntentFrozen(true);
      turnPerf("intentFrozen");

      // Vision MIME gate（Phase 3.3A）：以 frozen intent 的模型能力校验
      const userImages = turnAttachments.filter(
        (a): a is Extract<KiroAttachment, { source: "local" }> =>
          a.source === "local" && a.kind === "image" && a.status === "ready"
      );
      const intentCapabilities = getModelCapabilities({
        provider: intent.provider,
        model: intent.model,
        custom: intent.custom,
      });
      const visionEnabledForIntent = intentCapabilities.vision;
        // Task B V1.1：冻结本 Turn 真实 ready image IDs（Guard 与 propose_visual_actions 共用同一事实；下轮 Send 覆盖）
        turnImageAttachmentIdsRef.current = userImages.map((a) => a.id);
      if (
        intentCapabilities.vision &&
        intentCapabilities.visionMimeTypes &&
        userImages.some((a) => !isVisionMimeSupported(intentCapabilities, a.file.type, a.file.name))
      ) {
        const modelName = getActiveModelName({
          provider: intent.provider,
          model: intent.model,
          customModel: intent.custom.model,
        });
        const formats = formatVisionMimeTypes(intentCapabilities.visionMimeTypes);
        pushToast({
          message: `${modelName} 当前仅支持 ${formats} 图片，请转换后重试。`,
          type: "error",
        });
        setTurnIntentFrozen(false);
        return false; // Prompt 保留，不静默丢图
      }

      // ---- V4.6 并行 preflight：Project / Workspace Instructions / Vision（互相独立）----
      // prepareVisionPayload 内部保持「用户图片优先 → PDF 剩余预算」的既有依赖语义。
      let preflightFailed = false;
      let visionFailed = false;

      /** Vision 输入准备（共享一次 preparingVision 状态，单一 try/finally）：
       * 用户图片优先（不能静默丢弃）→ 统一 Turn 预算 → 扫描 PDF 只用剩余额度。 */
      const prepareVisionPayload = async (): Promise<{ pageFiles: File[]; preparedImageFiles: File[] }> => {
        const delay = turnPerfPreflightDelay("vision");
        if (delay > 0) await sleepTurnPerf(delay);
        if (turnPerfPreflightFail("vision")) {
          pushToast({ message: "图片处理失败，请重新添加或换一张图片后重试。", type: "error" });
          visionFailed = true;
          return { pageFiles: [], preparedImageFiles: [] };
        }
        const scanned = turnAttachments.filter(isScannedAttachment);
        const pageFiles: File[] = [];
        const preparedImageFiles: File[] = [];
        const renderedPageCountByAttachment = new Map<string, number>();
        const visionPrepPending = scanned.length > 0 || (visionEnabledForIntent && userImages.length > 0);
        if (!visionPrepPending) return { pageFiles, preparedImageFiles };
        setPreparingVision(true);
        try {
          // A. 用户图片 Send-time 预处理：失败（decode/编码/超限）→ 整个 Send 不执行
          if (visionEnabledForIntent && userImages.length > 0) {
            for (const a of userImages) {
              try {
                const prepared = await preprocessVisionImage(a.file);
                preparedImageFiles.push(prepared.file);
              } catch {
                pushToast({ message: "图片处理失败，请重新添加或换一张图片后重试。", type: "error" });
                visionFailed = true; // Prompt 与附件保留
                return { pageFiles, preparedImageFiles };
              }
            }
          }

          // B. 统一 Turn 预算：用户图片优先，PDF 只拿剩余额度
          const userImageBytes = sumVisionBytes(preparedImageFiles);
          const budget = resolveVisionTurnBudget({ userImageBytes });
          if (budget.overBudget) {
            pushToast({ message: "图片总量过大，请减少图片数量后重试。", type: "error" });
            visionFailed = true; // 用户图片不能被静默删除
            return { pageFiles, preparedImageFiles };
          }

          // C. 扫描 PDF：在 pdfBudgetBytes 内渲染；每份 scanned PDF 至少 1 页
          if (scanned.length > 0) {
            if (budget.pdfBudgetBytes === 0) {
              // budget exhaustion ≠ 文件损坏：明确区分提示
              pushToast({ message: "视觉附件总量过大，请减少图片或扫描 PDF 后重试。", type: "error" });
              visionFailed = true;
              return { pageFiles, preparedImageFiles };
            }
            const textCount = buildDocumentContexts(turnAttachments).length;
            const explicit = extractExplicitPages(v).flatMap((r) => {
              const arr: number[] = [];
              for (let p = r.start; p <= r.end; p++) arr.push(p);
              return arr;
            });
            const allocations =
              scanned.length > 1
                ? allocateVisionPages(
                    scanned.map((a) => ({
                      pageCount:
                        a.source === "local"
                          ? (a.extracted?.pageCount ?? 1)
                          : (a.pdfVision?.pageCount ?? 1),
                      explicitPages: explicit,
                    })),
                    MAX_SCANNED_PDF_PAGES_PER_TURN
                  )
                : scanned.map((a) =>
                    selectScannedPdfPages({
                      userText: v,
                      pageCount:
                        a.source === "local"
                          ? (a.extracted?.pageCount ?? 1)
                          : (a.pdfVision?.pageCount ?? 1),
                    })
                  );

            let remainingVisionBytes = budget.pdfBudgetBytes;
            for (let i = 0; i < scanned.length; i++) {
              const a = scanned[i];
              const sourceId = `doc-${textCount + i + 1}`;
              const pages = allocations[i].pages;
              if (pages.length === 0) continue;
              let blob: Blob | null = null;
              if (a.source === "local") {
                blob = a.file;
              } else {
                const material = useAppStore
                  .getState()
                  .courses.find((c) => c.id === a.courseId)
                  ?.materials.find((m) => m.id === a.materialId);
                if (material?.storageKey) blob = await getFileBlob(material.storageKey);
              }
              if (!blob) continue;
              // 统一预算内渲染（renderPdfPages 内部按 maxBytes 保留完整页面）
              const rendered = await renderPdfPages(blob, pages, sourceId, {
                maxBytes: remainingVisionBytes,
              });
              for (const r of rendered) {
                pageFiles.push(r.file);
                remainingVisionBytes -= r.size;
                renderedPageCountByAttachment.set(a.id, (renderedPageCountByAttachment.get(a.id) ?? 0) + 1);
                // visionPagesRef 只记录真正进入 FileList 的页面（citation/source 忠实反映模型所见）
                visionPagesRef.current.push({
                  sourceId,
                  page: r.page,
                  fileName: r.file.name,
                  attachmentId: a.id,
                });
              }
            }
            // 每份 scanned PDF 至少 1 页：预算裁掉整份文档时不得静默假装已发送
            const missingPdf = scanned.some((a) => (renderedPageCountByAttachment.get(a.id) ?? 0) === 0);
            if (missingPdf) {
              pushToast({ message: "视觉附件过多，部分扫描 PDF 无法加入本次请求，请减少附件或指定更少页数。", type: "error" });
              visionFailed = true;
              return { pageFiles, preparedImageFiles };
            }
          }
        } finally {
          setPreparingVision(false);
        }
        return { pageFiles, preparedImageFiles };
      };

      turnPerf("preflightStart");
      const [projectContext, computerWorkspaceInstructions, visionPayload] = await Promise.all([
        // 1) Project Instructions + Files index（Send boundary 读取最新 record；绝不 stale preload）
        (async (): Promise<KiroProjectTurnContext | undefined> => {
          const delay = turnPerfPreflightDelay("project");
          if (delay > 0) await sleepTurnPerf(delay);
          if (turnPerfPreflightFail("project")) {
            pushToast({ message: "无法加载项目设置，请重试。", type: "error" });
            preflightFailed = true;
            return undefined;
          }
          const projectIdNow = intent.projectId;
          if (!projectIdNow) return undefined;
          try {
            const [projectRecord, projectFiles] = await Promise.all([
              getKiroProject(projectIdNow),
              listProjectFiles(projectIdNow),
            ]);
            if (!projectRecord) {
              pushToast({ message: "无法加载项目设置，请重试。", type: "error" });
              preflightFailed = true;
              return undefined;
            }
            return toProjectTurnContext(
              projectRecord,
              projectFiles.map((f) => ({
                id: f.id,
                name: f.name,
                kind: f.kind,
                sizeBytes: f.sizeBytes,
              }))
            );
          } catch {
            pushToast({ message: "无法加载项目设置，请重试。", type: "error" });
            preflightFailed = true;
            return undefined;
          }
        })(),
        // 2) Workspace Instructions：目标 workspace/root identity 用 frozen snapshot；
        //    live grants/rules 按安全需要读取最新权限事实（Server 会再次基于 frozen snapshot 归一化）
        (async (): Promise<KiroWorkspaceInstructionsContext | undefined> => {
          const delay = turnPerfPreflightDelay("workspace");
          if (delay > 0) await sleepTurnPerf(delay);
          if (turnPerfPreflightFail("workspace")) {
            pushToast({ message: "无法读取工作区指令，请重试。", type: "error" });
            preflightFailed = true;
            return undefined;
          }
          const frozenComputerSnapshot = intent.computerSnapshot;
          if (!(frozenComputerSnapshot && frozenComputerSnapshot.enabled)) return undefined;
          try {
            return await loadWorkspaceInstructionsForTurn({
              snapshot: frozenComputerSnapshot,
              liveWorkspaces: useKiroComputerStore.getState().workspaces,
              livePermissionRules: useKiroComputerStore.getState().permissionRules,
              getAdapter: getComputerAdapterForAdapterRef,
            });
          } catch {
            pushToast({ message: "无法读取工作区指令，请重试。", type: "error" });
            preflightFailed = true;
            return undefined;
          }
        })(),        // 3) Vision（内部保持用户图片 → PDF 预算的既有依赖；只与 1/2 并行）
        prepareVisionPayload(),
      ]);
      turnPerf("preflightEnd");
      if (preflightFailed || visionFailed) {
        setTurnIntentFrozen(false);
        return false;
      }
      // V4.6 preparation generation：preflight 期间 conversation 已切换到另一个会话 → 丢弃结果，不 commit。
      // 第一条消息的 transient conversation id 在 send 内创建（null → 新 id）属正常，不丢弃。
      if (
        conversationIdAtSend != null &&
        conversationIdRef.current !== conversationIdAtSend
      ) {
        turnPerf("preparationDiscarded");
        setTurnIntentFrozen(false);
        return false;
      }

      // ---- Turn Context Snapshot：全部来自 frozen intent + enrichment ----
      const baseTurnSnapshot = buildSnapshotRef.current(intent, turnAttachments, projectContext);
      turnSnapshotRef.current = {
        ...baseTurnSnapshot,
        ...(computerWorkspaceInstructions ? { computerWorkspaceInstructions } : {}),
      };
      turnPerf("turnSnapshotCommitted");
      // V1.3B：Vision Ledger 用「真正进入 FileList」的字节初始化
      //（user images 优先；scanned attachment pages 从 total/pdf 预算中扣掉；
      //  后续 read_project_visual 看到的是本 Turn 真实剩余额度）
      turnVisionBudgetRef.current = createVisionTurnRuntimeBudget({
        initialUserImageBytes: sumVisionBytes(visionPayload.preparedImageFiles),
        initialPdfBytes: sumVisionBytes(visionPayload.pageFiles),
        initialPdfPages: visionPayload.pageFiles.length,
      });
      // Computer 调用限制 / 新 Turn Task 重置（冻结意图配套；历史 Task 仍保留展示）
      computerCountersRef.current = { readCount: 0, mutationCount: 0 };
      activeTaskRef.current = null;

      // 附件快照绑定到该 User Turn（发送后 Composer 清空，旧消息不受影响）
      const snapshot: KiroAttachmentView[] = turnAttachments
        .filter((a) => a.status === "ready")
        .map((a) =>
          a.source === "local"
            ? {
                id: a.id,
                source: "local" as const,
                kind: a.kind,
                name: a.name,
                size: a.size,
                status: "ready" as const,
                // Task B：真实缩略图透出（local image ready 后已生成 data URL）
                thumbnail:
                  a.kind === "image" && typeof (a as { thumbnail?: string }).thumbnail === "string"
                    ? (a as { thumbnail: string }).thumbnail
                    : undefined,
              }
            : {
                id: a.id,
                source: "material" as const,
                kind: a.kind,
                name: a.name,
                status: "ready" as const,
                courseName: a.courseName,
              }
        );
      // Task 7：每次 live user send 都 push 一项（即使 []），否则 text-only 与 attachment turn 位置错配
      snapshotQueueRef.current.push(snapshot);

      // D. composition invariant：最终视觉二进制总字节必须 <= Turn 预算
      //（不应依赖中间 allocator；正常不会触发，但作为组合边界必须有最终 guard）
      const finalVisionBytes =
        sumVisionBytes(visionPayload.pageFiles) + sumVisionBytes(visionPayload.preparedImageFiles);
      if (!isVisionTurnWithinBudget(finalVisionBytes)) {
        pushToast({ message: "视觉附件总量过大，请减少附件后重试。", type: "error" });
        setTurnIntentFrozen(false);
        return false;
      }

      // 图片：扫描 PDF 页面图（固定在前） + 预处理后的用户图片 → 一个 FileList（deterministic 顺序）
      let files: FileList | undefined;
      if (
        (visionEnabledForIntent && visionPayload.preparedImageFiles.length > 0) ||
        visionPayload.pageFiles.length > 0
      ) {
        if (typeof DataTransfer !== "undefined") {
          const dt = new DataTransfer();
          visionPayload.pageFiles.forEach((f: File) => dt.items.add(f));
          visionPayload.preparedImageFiles.forEach((f: File) => dt.items.add(f));
          files = dt.files;
        }
      }

      chatSendMessage(
        { text: v, files },
        { body: requestBody() }
      );
      turnPerf("chatSendMessage");
      return true;
    },
    [chatSendMessage, enabled, pushToast]
  );

  // 普通发送：使用 Composer 当前附件（sendWithAttachments 内部不闭包读取附件，编辑场景可传 []）
  const send = useCallback(
    async (text: string): Promise<boolean> => sendWithAttachments(text, attachments),
    [sendWithAttachments, attachments]
  );

  /**
   * Task 7：编辑 User Message 并重新发送（不做 conversation branch）。
   * 提交时重新做全部 guard（不能只信 UI）：trim / 空文本 / 内容未变 / in-flight / target 附件 / suffix write。
   * 成功后：删除目标及其后整个 suffix → 清理 restored maps / view cache / turn sources / vision pages /
   * live snapshot queue 裁剪 → 保留 prefix 之前的 undoRegistry → sendWithAttachments(revisedText, [])。
   */
  const editAndResend = useCallback(
    async (messageId: string, text: string): Promise<boolean> => {
      const v = text.trim();
      if (!v || !enabled) return false;
      const all = latestChatRef.current.messages as UIMessage[];
      const targetIdx = all.findIndex((m) => m.id === messageId && m.role === "user");
      const target = targetIdx === -1 ? null : all[targetIdx];
      const targetText = target ? messageTextOf(target) : "";
      if (target && v === targetText.trim()) return true; // 内容未变：不请求模型

      // Streaming UX V3：真实 turn lifecycle 决定可编辑性（awaiting-tool-result / awaiting-continuation 同样锁定）
      const inFlight = turnInFlight;
      const suffix = targetIdx >= 0 ? all.slice(targetIdx) : [];
      // target 附件：live → snapshot queue 对应项；restored → restoredAttachmentsRef
      let targetHasAttachments = false;
      if (target) {
        if (isRestoredMessage(target)) {
          targetHasAttachments = (restoredAttachmentsRef.current.get(target.id)?.length ?? 0) > 0;
        } else {
          const liveBefore = all.slice(0, targetIdx).filter((m) => m.role === "user" && !isRestoredMessage(m)).length;
          targetHasAttachments = (snapshotQueueRef.current[liveBefore]?.length ?? 0) > 0;
        }
      }

      const blockReason = getUserMessageEditBlockReason({
        target: target ? { text: targetText, hasAttachments: targetHasAttachments } : null,
        suffixAssistantMessages: suffix.filter((m) => m.role === "assistant").map((m) => ({
          id: m.id,
          parts: (m.parts ?? []) as unknown[],
        })),
        restoredWriteMessageIds: suffix
          .filter((m) => isRestoredMessage(m) && (restoredActionsRef.current.get(m.id)?.length ?? 0) > 0)
          .map((m) => m.id),
        streaming: inFlight,
      });
      if (blockReason) return false;

      const prefix = truncateBeforeEditedUserMessage(all, messageId);
      if (!prefix) return false;

      // 清理被删除 suffix 的展示数据
      const removedIds = new Set(suffix.map((m) => m.id));
      removedIds.forEach((id) => {
        restoredActionsRef.current.delete(id);
        restoredAttachmentsRef.current.delete(id);
        restoredSourcesRef.current.delete(id);
        viewCacheRef.current.delete(id);
      });
      // live snapshot queue 裁剪到 prefix 中 live user message 数量
      const liveUserCount = prefix.filter((m) => m.role === "user" && !isRestoredMessage(m)).length;
      if (snapshotQueueRef.current.length > liveUserCount) {
        snapshotQueueRef.current = snapshotQueueRef.current.slice(0, liveUserCount);
      }
      // 当前 turn 文档来源 / 扫描页缓存一并清理
      turnSourcesRef.current = [];
      setSources([]);
      visionPagesRef.current = [];
      viewCacheRef.current.clear();
      liveTurnCommitsRef.current.clear();
      stoppedTurnMessageIdRef.current = null;
      pendingAutoContinueRef.current = false;
      // 保留 prefix 之前的 undoRegistry（不 clear）
      chat.setMessages(prefix);

      return sendWithAttachments(v, []);
    },
    [enabled, chat, sendWithAttachments]
  );

  // retry/newChat/loadConversation 使用稳定子项时，必须经 ref 读取最新 chat
  // （否则闭包会捕获创建时刻的旧 messages / 旧 regenerate）
  const latestChatRef = useRef(chat);
  latestChatRef.current = chat;

  const retry = useCallback(() => {
    if (!enabled) return;
    const c = latestChatRef.current;
    // Defense in depth：含 Write Tool 的轮次或历史恢复轮次禁止 regenerate（即使 UI 误调用）
    if (!lastTurnCanRegenerate(c.messages)) {
      const lastAssistant = [...c.messages].reverse().find((m) => m.role === "assistant");
      const hasComputerMutation =
        !!lastAssistant &&
        ((lastAssistant.parts ?? []) as { type?: string }[]).some((p) =>
          typeof p.type === "string" && p.type.startsWith("tool-")
            ? (KIRO_MUTATING_TOOL_NAMES as string[]).includes(p.type.slice("tool-".length))
            : false
        );
      pushToast({
        message: hasComputerMutation
          ? "该回复已修改工作区文件，不能直接重新生成。"
          : "操作结果已保留，可以继续向 Kiro 提问。",
        type: "info",
      });
      return;
    }
    readCounterRef.current = 0;
    documentReadCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    resetDocumentFailureFuse();
    void c.regenerate({ body: requestBody() });
  }, [enabled, pushToast]);

  /** stale approval / 本会话 task 状态清理（newChat / loadConversation 共用；不清理已完成任务展示？） */
  const clearComputerSessionState = useCallback(
    (keepRestored: boolean) => {
      pendingExecutionsRef.current.clear();
      oneShotApprovalsRef.current = [];
      for (const t of Array.from(approvalTimeoutTimersRef.current.values())) clearTimeout(t);
      approvalTimeoutTimersRef.current.clear();
      setPendingApproval(null);
      activeTaskRef.current = null;
      checkpointsRef.current = new Map();
      tasksRef.current = new Map();
      setTasksState(new Map());
      computerCountersRef.current = { readCount: 0, mutationCount: 0 };
      if (!keepRestored) restoredComputerTasksRef.current = new Map();
    },
    [setPendingApproval]
  );

  const newChat = useCallback(() => {
    clearComputerSessionState(false);
    chat.setMessages([]);
    readCounterRef.current = 0;
    documentReadCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    undoRegistryRef.current.clear();
    snapshotQueueRef.current = [];
    restoredActionsRef.current.clear();
    restoredAttachmentsRef.current.clear();
    restoredSourcesRef.current.clear();
    viewCacheRef.current.clear();
    liveTurnCommitsRef.current.clear();
    stoppedTurnMessageIdRef.current = null;
    pendingAutoContinueRef.current = false;
    resetDocumentFailureFuse();
    turnSourcesRef.current = [];
    setSources([]);
    visionPagesRef.current = [];
  }, [chat.setMessages, clearComputerSessionState, resetDocumentFailureFuse]);

  /**
   * 恢复历史对话（Task 6 / Part 3）：
   * 只恢复 user/assistant 文本与展示事实（不重放 Tool Call）；Computer Task 以
   * restoredComputerTasksRef 恢复（display-only，无 checkpoint → 不能 Undo）。
   * 恢复的消息标记 restored → 禁止重新生成 / 撤销。
   */
  const loadConversation = useCallback(
    (record: KiroConversationRecord) => {
      const actionsMap = new Map<string, PersistedActionView[]>();
      const attachmentsMap = new Map<string, PersistedAttachmentView[]>();
      const sourcesMap = new Map<string, KiroSourceMeta[]>();
      const computerTasksMap = new Map<string, PersistedComputerTaskView>();
      const restored: UIMessage[] = record.messages.map((pm) => {
        if (pm.attachments && pm.attachments.length > 0) attachmentsMap.set(pm.id, pm.attachments);
        if (pm.actions && pm.actions.length > 0) actionsMap.set(pm.id, pm.actions);
        if (pm.sources && pm.sources.length > 0) sourcesMap.set(pm.id, pm.sources);
        if (pm.computerTask) computerTasksMap.set(pm.id, pm.computerTask);
        return {
          id: pm.id,
          role: pm.role,
          parts: [{ type: "text", text: pm.content }],
          metadata: { restored: "1" },
        };
      });
      clearComputerSessionState(true);
      restoredComputerTasksRef.current = computerTasksMap;
      restoredActionsRef.current = actionsMap;
      restoredAttachmentsRef.current = attachmentsMap;
      restoredSourcesRef.current = sourcesMap;
      viewCacheRef.current.clear();
      liveTurnCommitsRef.current.clear();
      stoppedTurnMessageIdRef.current = null;
      pendingAutoContinueRef.current = false;
      resetDocumentFailureFuse();
      readCounterRef.current = 0;
      documentReadCounterRef.current = 0;
      writeCounterRef.current = 0;
      limitReachedRef.current = false;
      undoRegistryRef.current.clear();
      snapshotQueueRef.current = [];
      turnSourcesRef.current = [];
      setSources([]);
      chat.setMessages(restored);
    },
    [chat.setMessages, clearComputerSessionState]
  );

  // Task 14/15A：从真实 tool-web_search output 注册可信 Web Source（只存 metadata，不存 snippet）。
  // 模型正文里的 [[source:web-99]] 不会自动生成来源；同一 sourceId 只保留一份 metadata（确定性 Map 去重）。
  // Task 19B：read_web_source 成功输出 availablePages → 只对已注册 web source 做页码 enrichment
  //（不覆盖 url/title/domain；模型不能凭空增加页码）。
  useEffect(() => {
    const additions = new Map<string, KiroSourceMeta>();
    for (const m of chat.messages) {
      if (m.role !== "assistant") continue;
      for (const p of (m.parts ?? []) as { type?: string; output?: unknown }[]) {
        if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
        if (p.type.slice("tool-".length) !== "web_search") continue;
        const output = p.output as { ok?: boolean; data?: { results?: KiroWebSearchResult[] } } | null;
        if (!output?.ok || !Array.isArray(output.data?.results)) continue;
        for (const r of output.data.results) {
          if (!r.sourceId) continue;
          additions.set(r.sourceId, {
            sourceId: r.sourceId,
            name: r.title || r.domain || "网页来源",
            source: "web",
            url: r.url,
            domain: r.domain,
            publishedAt: r.publishedAt,
          });
        }
      }
    }

    // Task 19B：收集 read_web_source 成功输出的可信 availablePages
    const readPages: { sourceId: string; availablePages: number[] }[] = [];
    for (const m of chat.messages) {
      if (m.role !== "assistant") continue;
      for (const p of (m.parts ?? []) as { type?: string; output?: unknown }[]) {
        if (typeof p.type !== "string" || p.type.slice("tool-".length) !== "read_web_source") continue;
        const output = p.output as {
          ok?: boolean;
          data?: { sources?: { sourceId?: string; availablePages?: number[] }[] };
        } | null;
        if (!output?.ok || !Array.isArray(output.data?.sources)) continue;
        for (const s of output.data.sources) {
          if (s.sourceId && Array.isArray(s.availablePages) && s.availablePages.length > 0) {
            readPages.push({ sourceId: s.sourceId, availablePages: s.availablePages });
          }
        }
      }
    }

    if (additions.size === 0 && readPages.length === 0) return;
    const known = new Set(turnSourcesRef.current.map((s) => s.sourceId));
    const fresh = Array.from(additions.values()).filter((a) => !known.has(a.sourceId));

    // Task 19B1：不可变 enrichment（纯函数；不修改任何已有对象；无变化 → 同一引用）
    const base: readonly KiroSourceMeta[] = fresh.length > 0 ? [...turnSourcesRef.current, ...fresh] : turnSourcesRef.current;
    const next = enrichWebSourcePages(base, readPages);

    if (next === turnSourcesRef.current) return; // 无变化：不触发无意义 setSources
    turnSourcesRef.current = next;
    setSources(next);
  }, [chat.messages]);

  const normalizedError: AIError | null = chat.error ? normalizeAIError(chat.error) : null;
  const streaming = chat.status === "streaming" || chat.status === "submitted";

  const activity = useMemo(
    () => deriveActivity(chat.messages as ActivitySourceMessage[], chat.status),
    [chat.messages, chat.status]
  );

  // 用户消息按顺序消费发送时绑定的附件快照（仅 live 消息消费 live queue；restored 只使用 restoredAttachmentsRef）；
  // 并在 attachment/history 绑定后计算 canEdit（Task 7）
  const messages = useMemo(() => {
    const queue = snapshotQueueRef.current;
    let qi = 0;
    // Worklog V2：最后一条 user 之后、turn 尚未 settled 的 assistant 消息 = 当前 Turn in-flight
    let lastUserIdx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    return chat.messages.map((m, idx) => {
      // 增量缓存：parts/metadata/statusRef 引用未变 → 复用 view
      //（live→settled 时即使 parts 引用不变，statusRef 也会变化，避免缓存返回过期 phase）
      const partsRef = (m.parts ?? []) as unknown;
      const metadataRef = m.metadata ?? null;
      const currentTurnInFlight = m.role === "assistant" && idx > lastUserIdx && turnInFlight;
      const statusRef: string = currentTurnInFlight ? "live" : "settled";
      const commit = m.role === "assistant" ? getOrCreateLiveTurnCommit(m.id) : undefined;
      let view = reuseMessageView(viewCacheRef.current, m.id, partsRef, metadataRef, () =>
        toView(m, currentTurnInFlight, commit),
        statusRef
      );

      // ---- 附加展示数据（有需要才复制出新对象；否则直接复用缓存 view）----
      let needsAttach = false;
      if (m.role === "user") {
        const restored = isRestoredMessage(m);
        if (!restored && qi < queue.length) {
          const snapshot = queue[qi];
          qi += 1;
          if (snapshot.length > 0) {
            view = { ...view, attachments: snapshot };
            needsAttach = true;
          }
        }
        // 历史恢复的附件 chips（仅展示：临时文件标记未保留）
        const restoredAtts = restoredAttachmentsRef.current.get(m.id);
        if (restoredAtts && restoredAtts.length > 0 && !view.attachments) {
          view = {
            ...view,
            attachments: restoredAtts.map((a) => ({
              id: a.id,
              source: a.source,
              kind: a.kind as KiroAttachmentView["kind"],
              name: a.name,
              size: a.size,
              status: "ready" as const,
              courseName: a.courseName,
              courseId: a.courseId,
              materialId: a.materialId,
              tempNotRetained: a.tempNotRetained,
            })),
          };
          needsAttach = true;
        }
      }
      // 历史恢复的 Action Cards（展示事实，canUndo 恒 false）
      const restoredActs = restoredActionsRef.current.get(m.id);
      if (restoredActs && restoredActs.length > 0) {
        view = { ...view, historyActions: restoredActs };
        needsAttach = true;
      }
      // Computer Agent Task（Part 3）：live task 绑定 owning assistant message（toolCallIds 相交）；
      // 历史恢复 → display-only（无 checkpoint，不能 Undo）
      if (m.role === "assistant") {
        const ids = new Set(
          ((m.parts ?? []) as unknown as ToolCallPart[])
            .filter((p) => typeof p.type === "string" && p.type.startsWith("tool-") && p.toolCallId)
            .map((p) => p.toolCallId)
        );
        let attachedTask: KiroAgentTask | undefined;
        if (ids.size > 0) {
          for (const t of Array.from(tasksRef.current.values())) {
            if (t.toolCallIds.some((id) => ids.has(id))) {
              attachedTask = t;
              break;
            }
          }
        }
        const restoredTask = restoredComputerTasksRef.current.get(m.id);
        if (attachedTask || restoredTask) {
          view = { ...view, computerTask: attachedTask, historyComputerTask: restoredTask };
          needsAttach = true;
        }
      }
      // 历史恢复的 Citation 来源（展示 metadata；正文不落库）
      const restoredSrcs = restoredSourcesRef.current.get(m.id);
      if (restoredSrcs && restoredSrcs.length > 0) {
        view = { ...view, sources: restoredSrcs };
        needsAttach = true;
      }
      // Task 7：User Message 编辑安全（attachment/history 绑定完成后计算；turn in-flight 一律不可编辑）
      if (m.role === "user") {
        const targetAttachments =
          isRestoredMessage(m)
            ? (restoredAttachmentsRef.current.get(m.id)?.length ?? 0) > 0
            : (view.attachments?.length ?? 0) > 0;
        const blockReason = getUserMessageEditBlockReason({
          target: { text: messageTextOf(m), hasAttachments: targetAttachments },
          suffixAssistantMessages: chat.messages.slice(idx + 1).map((s) => ({
            id: s.id,
            parts: (s.parts ?? []) as unknown[],
          })),
          restoredWriteMessageIds: chat.messages
            .slice(idx + 1)
            .filter((s) => isRestoredMessage(s) && (restoredActionsRef.current.get(s.id)?.length ?? 0) > 0)
            .map((s) => s.id),
          streaming,
        });
        view = { ...view, canEdit: !streaming && blockReason === null, editDisabledReason: blockReason ?? undefined };
        needsAttach = true;
      }
      // 附加后的对象写回缓存（下一 token 直接复用，避免每次重建）
      if (needsAttach) {
        viewCacheRef.current.set(m.id, { partsRef, metadataRef, statusRef, view });
      }
      return view;
    });
    // tasksState：task 状态变化（undo/approval/complete）需要重算消息绑定
    // turnExecution：真实 turn lifecycle（Streaming UX V3 Phase 3）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, turnExecution, tasksState]);

  /** Stop：清除 stale approvals（旧 Approval 不能在新会话执行）；awaiting task → cancelled */
  const handleStop = useCallback(() => {
    pendingExecutionsRef.current.clear();
    oneShotApprovalsRef.current = [];
    for (const t of Array.from(approvalTimeoutTimersRef.current.values())) clearTimeout(t);
    approvalTimeoutTimersRef.current.clear();
    setPendingApproval(null);
    // 用户 Stop：该 turn 遗留的 pending tool part 不再视为 in-flight（真 settled）
    const lastMsg = latestChatRef.current.messages[latestChatRef.current.messages.length - 1] as UIMessage | undefined;
    stoppedTurnMessageIdRef.current = lastMsg?.role === "assistant" ? lastMsg.id : null;
    pendingAutoContinueRef.current = false;
    const task = activeTaskRef.current;
    if (task && (task.status === "awaiting_permission" || task.status === "running")) {
      task.status = "cancelled";
      task.completedAt = new Date().toISOString();
      updateTasks();
    }
    void chat.stop();
  }, [chat, setPendingApproval, updateTasks]);

  return {
    messages,
    status: chat.status,
    streaming,
    /** 真实 Turn lifecycle（executing / awaiting-tool-result / awaiting-continuation / settled） */
    turnExecution,
    /** 派生：turn 是否仍在进行（turnExecution !== settled）——操作栏 / Worklog 折叠的依据 */
    turnInFlight,
    error: normalizedError,
    activity,
    /** 本 Turn 的文档来源（Citation 渲染用；不含正文） */
    sources,
    /** 扫描 PDF 页面渲染中（Send 禁用 + 「正在准备扫描 PDF…」） */
    preparingVision,
    /** V4.6：Send 已 claim 且 Turn Intent 已同步冻结（preflight 进行中；下一 Turn preferences 可编辑） */
    turnIntentFrozen,
    send,
    retry,
    stop: handleStop,
    newChat,
    loadConversation,
    editAndResend,
    configured: enabled,
    consumeUndo,
    visionEnabled,
    /** Computer Agent Part 3：approval 决策 / Task Undo（UI 入口） */
    resolveApproval: handleApprovalDecision,
    undoTask,
    /** Computer Task 状态版本（历史保存 signal：undo/approval 后变化） */
    computerVersion,
  };
}

/** Computer change 类型 → capability（Audit metadata 用） */
function capabilityForChange(change: {
  resourceType: "directory" | "text" | "document";
  operation: "create" | "modify" | "move" | "rename" | "delete";
}): ComputerCapability {
  if (change.operation === "move" || change.operation === "rename") return "fs.move";
  if (change.operation === "delete") return "fs.delete";
  if (change.resourceType === "document") return "document.create";
  if (change.resourceType === "directory") return "fs.create";
  return change.operation === "modify" ? "fs.modify" : "fs.create";
}

/** 失败 Audit 用：无 runtime.change 时按 toolName 映射 capability */
function capabilityForToolName(toolName: string): ComputerCapability {
  switch (toolName) {
    case "create_text_file":
    case "create_directory":
      return "fs.create";
    case "patch_text_file":
      return "fs.modify";
    case "delete_file":
      return "fs.delete";
    case "rename_file":
    case "move_file":
      return "fs.move";
    case "create_document":
      return "document.create";
    case "update_document":
      return "document.modify";
    default:
      return "fs.read";
  }
}

/**
 * V2：move-back Undo（双 root orchestration）。
 * resolve live Workspace → toRoot（当前文件位置）→ fromRoot（原位置）→ verified relocate 回原位置
 * → verify 原位置存在 + 现位置不存在 → Artifact Registry 位置还原。
 */
async function undoMoveBack(
  ws: KiroWorkspaceMeta,
  inverse: Extract<ComputerInverseOperation, { type: "move-back" }>
): Promise<void> {
  const toRoot = ws.roots.find((r) => r.id === inverse.toRootId);
  if (!toRoot) throw new ComputerError("ROOT_NOT_FOUND", "移动目标根目录不存在");
  const fromRoot = ws.roots.find((r) => r.id === inverse.fromRootId);
  if (!fromRoot) throw new ComputerError("ROOT_NOT_FOUND", "原位置根目录不存在");
  const sourceAdapter = getComputerAdapterForAdapterRef(toRoot.adapterRef);
  const destAdapter = getComputerAdapterForAdapterRef(fromRoot.adapterRef);
  if (toRoot.adapterRef === fromRoot.adapterRef) {
    await sourceAdapter.move(inverse.toPath, inverse.fromPath);
  } else {
    await relocateFile({
      source: sourceAdapter,
      sourcePath: inverse.toPath,
      destination: destAdapter,
      destinationPath: inverse.fromPath,
    });
  }
  // verify：原位置存在 + 现位置不存在（relocateFile/adapter.move 已内部校验；这里再显式确认）
  const original = await destAdapter.stat(inverse.fromPath);
  if (!original || original.kind !== "file") {
    throw new ComputerError("VERIFICATION_FAILED", "撤销移动校验失败：原位置文件不存在");
  }
  const moved = await sourceAdapter.stat(inverse.toPath);
  if (moved !== null) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销移动校验失败：移动目标仍存在");
  }
  // Artifact Registry 位置还原（保持 id/revision）
  if (inverse.artifactId) {
    try {
      await updateArtifactLocation(inverse.artifactId, inverse.fromRootId, inverse.fromPath);
    } catch {
      throw new ComputerError("VERIFICATION_FAILED", "撤销完成，但 Artifact Registry 位置未还原。");
    }
  }
}



/** 本地文档附件 → 传给模型的文档 Context（含 sourceId；截断明确标注） */
function buildDocumentContexts(attachments: KiroAttachment[]): KiroDocumentContext[] {
  const contexts: KiroDocumentContext[] = [];
  for (const a of attachments) {
    if (a.source === "local") {
      if (a.kind === "image" || a.status !== "ready" || !a.extracted || !a.extracted.text) continue;
      contexts.push({
        attachmentId: a.id,
        name: a.name,
        type: a.kind,
        text: a.extracted.text,
        source: "chat",
        truncated: a.extracted.truncated,
        pages: a.extracted.pages,
      });
    }
  }
  // 分配本 Turn 稳定 sourceId（doc-1…；顺序与发送顺序一致）
  return contexts.map((c, i) => ({ ...c, sourceId: `doc-${i + 1}` }));
}

/** 扫描型 PDF（Task 12）：本地 extracted.possiblyScanned / 课程资料 pdfVision.scanned */
function isScannedAttachment(a: KiroAttachment): boolean {
  if (a.source === "local") return a.kind === "pdf" && a.extracted?.possiblyScanned === true;
  return a.pdfVision?.scanned === true;
}




