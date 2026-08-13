"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useChat, UIMessage } from "@ai-sdk/react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerActionFact, ComputerCapability } from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { executeKiroComputerTool, getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { isComputerToolName, ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { ComputerApprovalRequest, ComputerApprovalDecision, ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import {
  KiroAgentTask,
  createAgentTask,
  taskStepForToolCall,
  completeTaskStep,
  failTaskStep,
  toolStepLabel,
} from "@/lib/ai/computer/task";
import {
  ComputerTaskCheckpoint,
  createTaskCheckpoint,
  appendInverseToCheckpoint,
  applyInverseToAdapter,
} from "@/lib/ai/computer/checkpoints";
import { sessionRuleForRequest, workspaceRuleForRequest } from "@/lib/ai/computer/approval";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
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
import { resolveContextRefs, refsForPrompt, dedupeContextRefs } from "@/lib/ai/context/contextSelection";
import { KiroContextRef } from "@/lib/ai/context/types";
import { executeKiroReadTool, ReadToolResult } from "@/lib/ai/tools/read/executor";
import { executeReadMaterial } from "@/lib/ai/tools/read/material";
import { MAX_MATERIAL_READS_PER_TURN } from "@/lib/ai/attachments/limits";
import { KiroAttachment, KiroDocumentContext, KiroAttachmentView } from "@/lib/ai/attachments/types";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { isDestructiveWriteTool, KiroUndoEntry, KiroWriteApi, WriteToolResult } from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { KIRO_WRITE_TOOL_SCHEMAS } from "@/lib/ai/tools/write/schemas";
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

/** 每回合工具调用上限：Read ≤ 12，Write ≤ 8 */
export const MAX_READ_TOOL_CALLS_PER_TURN_UI = 12;
export const MAX_WRITE_TOOL_CALLS_PER_TURN = 8;

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

function toView(m: UIMessage, turnInFlight: boolean): KiroChatMessageView {
  const parts = (m.parts ?? []) as unknown as (ToolCallPart | { type: "text"; text: string; state?: string })[];
  const restored = isRestoredMessage(m);

  // Worklog V2：Assistant 的 content 只代表最终回答；worklog 保留真实 part 时序（commentary/tool）
  let content: string;
  let streaming: boolean;
  let assistantTurn: KiroAssistantTurnPresentation | undefined;
  if (m.role === "assistant") {
    assistantTurn = deriveKiroAssistantTurn(m.parts ?? [], turnInFlight);
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
  for (const p of parts) {
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
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

  const toolParts = target
    ? (((target.parts ?? []).filter(
        (p) => typeof p.type === "string" && p.type.startsWith("tool-")
      ) as unknown) as ToolCallPart[])
    : [];
  const textStarted =
    !!target && (target.parts ?? []).some((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0);

  const steps: KiroActivityStep[] = toolParts.map((p) => {
    const name = toolNameOf(p);
    const isWrite = (KIRO_MUTATING_TOOL_NAMES as string[]).includes(name);
    const isChangeSet = name === "apply_change_set";
    if (p.state === "output-available") {
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
    if (p.state === "output-error") {
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

  const buildTurnSnapshot = (turnAttachments: KiroAttachment[]): Record<string, unknown> => {
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
    return {
      provider,
      model,
      apiKey: getSessionApiKey(provider),
      customConfig: custom,
      responsePreference,
      // Task 14：联网搜索配置（Server Key 永远不进入 Browser；仅 BYOK 带用户 Key）
      webSearchConfig: {
        enabled: webSearchEnabled,
        credentialMode: webSearchCredentialMode,
        ...(webSearchCredentialMode === "byok" && getSessionWebSearchApiKey()
          ? { apiKey: getSessionWebSearchApiKey() }
          : {}),
      },
      // Task 19C1：扫描 Web PDF Vision 配置（Provider 固定 OpenCode Go；不发送 provider/baseURL/transport）。
      // Key 缺失仍可发送 enabled/model（19C2 负责 missing key → Vision unavailable → Tavily fallback）
      webPdfVisionConfig: {
        enabled: webPdfVisionEnabled,
        model: normalizeWebPdfVisionModel(webPdfVisionModel),
        ...(getSessionWebPdfVisionApiKey()
          ? { apiKey: getSessionWebPdfVisionApiKey() }
          : {}),
      },
      baseContext: buildBaseContext(),
      contextRefs: refsForPrompt(
        dedupeContextRefs(
          resolveContextRefs(autoRefs, manualRefs, entryRefs, suppressedAutoKeys),
          useAppStore.getState().currentSemesterWeek
        )
      ),
      attachmentsContext,
      // 扫描 PDF 页面图 manifest（Task 12）：只含 sourceId/page/文件名映射，不含 base64
      visionPages: visionPagesRef.current,
      conversationSummary: conversationSummary
        ? { text: conversationSummary.text, throughMessageId: conversationSummary.throughMessageId }
        : undefined,
      // 长期学习记忆 Index（不含 content；memoryEnabled=false 时为空数组）
      memoryIndex: memory.activeIndex.map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category,
        scope: m.scope,
        scopeId: m.scopeId,
      })),
      // Kiro Computer Agent V1：推理投入冻结（capability-driven；不支持时 server 归一为 default）
      reasoningEffort,
      // Computer Turn Snapshot（冻结意图；只含逻辑元数据，live grants/rules 不入请求）
      computerSnapshot: buildComputerSnapshot(),
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
    };
  };

  const readCounterRef = useRef(0);
  const materialReadCounterRef = useRef(0);
  const writeCounterRef = useRef(0);
  const limitReachedRef = useRef(false);
  const undoRegistryRef = useRef(new Map<string, KiroUndoEntry>());
  // Kiro Computer Agent V1：每 Turn 独立的 Computer 调用限制（read <= 12 / mutation <= 6）
  const computerCountersRef = useRef({ readCount: 0, mutationCount: 0 });

  // ---- Computer Agent Task Runtime（Part 3）：Task 绑定 owning assistant message 的 toolCallIds ----
  const [tasksState, setTasksState] = useState<Map<string, KiroAgentTask>>(new Map());
  const tasksRef = useRef<Map<string, KiroAgentTask>>(new Map());
  const activeTaskRef = useRef<KiroAgentTask | null>(null);
  const checkpointsRef = useRef<Map<string, ComputerTaskCheckpoint>>(new Map());
  const pendingExecutionsRef = useRef<Map<string, PendingComputerExecution>>(new Map());
  const oneShotApprovalsRef = useRef<ComputerOneShotApproval[]>([]);

  const setPendingApproval = useKiroComputerRuntimeStore((s) => s.setPendingApproval);

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
    // Worklog V2 Task 3：客户端 50ms 节流（SDK 内建；不引入手写 queue / rAF / debounce）
    experimental_throttle: 50,
    onError: () => {
      // error 状态由 useChat 内部维护；归一化在下方派生
    },
    onToolCall: ({ toolCall }) => {
      const { toolName, toolCallId, input } = toolCall as {
        toolName: string;
        toolCallId: string;
        input: unknown;
      };

      const failOutput = (code: string, message: string) =>
        chat.addToolOutput({
          tool: toolName as never,
          toolCallId,
          output: { ok: false, code, message } as ToolOutput,
          options: { body: requestBody() },
        });

      // ---- 循环保护 ----
      if (limitReachedRef.current) {
        failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮操作上限，请换个问法。");
        return;
      }

      // ---- read_material（重量级，单独限制）----
      if (toolName === "read_material") {
        materialReadCounterRef.current += 1;
        if (materialReadCounterRef.current > MAX_MATERIAL_READS_PER_TURN) {
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
          chat.addToolOutput({
            tool: toolName as never,
            toolCallId,
            output: result as ToolOutput,
            options: { body: requestBody() },
          });
        });
        return;
      }

      // ---- Memory Tools（Task 9）：Browser 执行 IndexedDB；独立于业务 Write ----
      if ((KIRO_MEMORY_TOOL_NAMES as string[]).includes(toolName)) {
        void (async () => {
          const output = await runMemoryTool(toolName, input, toolCallId);
          chat.addToolOutput({
            tool: toolName as never,
            toolCallId,
            output,
            options: { body: requestBody() },
          });
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
            api: buildWriteApi({
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
          chat.addToolOutput({
            tool: toolName as never,
            toolCallId,
            output,
            options: { body: requestBody() },
          });
        })();
        return;
      }

      // ---- Write Tools ----
      if ((KIRO_WRITE_TOOL_NAMES as string[]).includes(toolName)) {
        writeCounterRef.current += 1;
        if (writeCounterRef.current > MAX_WRITE_TOOL_CALLS_PER_TURN) {
          limitReachedRef.current = true;
          failOutput("WRITE_TOOL_LIMIT_REACHED", "已达到本轮修改上限，请分步进行。");
          return;
        }

        // 受限 API：只暴露白名单 action；禁止 setState
        const api = buildWriteApi({
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
      // 每次执行读取最新 Store（Data Freshness）
      const result = executeKiroReadTool(toolName, input, useAppStore.getState());
      chat.addToolOutput({
        tool: toolName as never,
        toolCallId,
        output: result as ToolOutput,
        options: { body: requestBody() },
      });
    },
    sendAutomaticallyWhen: ({ messages }) =>
      !limitReachedRef.current && lastAssistantMessageIsCompleteWithToolCalls({ messages }),
  });

  /** 执行 Write Tool：preflight + mutation + Undo 注册 + Toast + addToolOutput */
  const runWriteTool = useCallback(
    (toolName: string, toolCallId: string, input: unknown, api: ReturnType<typeof buildWriteApi>) => {
      const result = executeKiroWriteTool(toolName, input, api, toolCallId);
      if (result.ok) {
        pushToast({
          message: actionToastMessage(result.action),
          actionLabel: result.action.canUndo ? "撤销" : undefined,
          onAction: result.action.canUndo ? () => consumeUndo(toolCallId) : undefined,
        });
      }
      chat.addToolOutput({
        tool: toolName as never,
        toolCallId,
        output: result as ToolOutput,
        options: { body: requestBody() },
      });
    },
    [chat, consumeUndo, pushToast]
  );

  // ==================== Computer Agent Task / Approval / Undo Runtime（Part 3） ====================

  /** 更新 Task 渲染状态（ref + state 同源） */
  const updateTasks = useCallback(() => {
    tasksRef.current = new Map(tasksRef.current);
    setTasksState(tasksRef.current);
  }, []);

  /** 当前 Turn 的主 Task（第一个 Computer tool call 时创建；绑定其 toolCallIds） */
  const ensureActiveTask = useCallback((): KiroAgentTask => {
    let task = activeTaskRef.current;
    if (task) return task;
    const lastUser = [...latestChatRef.current.messages].reverse().find((m) => m.role === "user");
    task = createAgentTask({
      userMessageId: lastUser?.id ?? "",
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
          task.status = "running";
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
        } else {
          completeTaskStep(task, toolCallId);
        }
        updateTasks();
      }
      latestChatRef.current.addToolOutput({
        tool: toolName as never,
        toolCallId,
        output: output as ToolOutput,
        options: { body: requestBody() },
      });
    },
    [updateTasks]
  );

  /** 执行 Computer Tool Call（onToolCall / approval resume 共用入口） */
  const runComputerToolCall = useCallback(
    async (toolName: string, toolCallId: string, input: unknown) => {
      const snapshot = (turnSnapshotRef.current as Record<string, unknown> | null)
        ?.computerSnapshot as KiroComputerTurnSnapshot | undefined;
      const frozenSnapshot = snapshot ?? buildComputerSnapshot();
      const taskId = ensureActiveTask().id;
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
      applyCompletedAttempt(attempt, toolName, toolCallId, taskId);
    },
    [buildComputerSnapshot, ensureActiveTask, handleApprovalRequired, applyCompletedAttempt]
  );

  /**
   * 用户审批决策（ComputerApprovalDialog）：
   * deny → USER_CANCELLED Tool Output；allow-* → 建立规则后 resume 同一条 exact call
   *（同一 frozen snapshot + live rules/grants；executor 内重复完整 policy 求值）。
   */
  const handleApprovalDecision = useCallback(
    async (approvalId: string, decision: ComputerApprovalDecision) => {
      const pending = pendingExecutionsRef.current.get(approvalId);
      if (!pending) return;
      pendingExecutionsRef.current.delete(approvalId);
      const { request, toolName, toolCallId, input, frozenSnapshot } = pending;
      const taskId = request.taskId;

      if (decision === "deny") {
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
          decision: "deny",
          outcome: "denied",
          workspaceId: request.workspaceId,
          workspaceLabel: request.workspaceLabel,
          rootId: request.rootId,
          rootLabel: request.rootLabel,
          relativePath: request.relativePath,
        });
        advancePendingApproval();
        latestChatRef.current.addToolOutput({
          tool: toolName as never,
          toolCallId,
          output: { ok: false, code: "USER_CANCELLED", message: "用户拒绝了此操作。" } as ToolOutput,
          options: { body: requestBody() },
        });
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
      advancePendingApproval();
    },
    [advancePendingApproval, applyCompletedAttempt, handleApprovalRequired]
  );

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
    activeTaskRef.current = null;
    if (task.status === "running" || task.status === "awaiting_permission") {
      const hasFailed = task.steps.some((s) => s.status === "failed");
      const hasCancelled = task.steps.some((s) => s.status === "cancelled");
      task.status = hasFailed ? "failed" : hasCancelled ? "cancelled" : "completed";
    }
    task.completedAt = task.completedAt ?? new Date().toISOString();
    updateTasks();
  }, [updateTasks]);

  // Turn 结束：finalize active task（approval pending 且用户 stop 时，stop 已清 pending + 标 cancelled）
  useEffect(() => {
    if (chat.status === "streaming" || chat.status === "submitted") return;
    finalizeActiveTask();
  }, [chat.status, finalizeActiveTask]);

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

  const sendWithAttachments = useCallback(
    async (text: string, turnAttachments: KiroAttachment[]): Promise<boolean> => {
      const v = text.trim();
      if (!v || !enabled) return false;
      readCounterRef.current = 0;
      materialReadCounterRef.current = 0;
      writeCounterRef.current = 0;
      limitReachedRef.current = false;
      visionPagesRef.current = [];

      // ---- Scanned PDF Vision（Task 12）：发送时渲染所选页面为 JPEG，再与用户图片合并发送 ----
      const scanned = turnAttachments.filter(isScannedAttachment);
      const pageFiles: File[] = [];
      let remainingVisionBytes = MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN;
      if (scanned.length > 0) {
        setPreparingVision(true);
        try {
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
            // 全 Turn 字节预算：每份 PDF 只能使用剩余额度（Task 13）
            const rendered = await renderPdfPages(blob, pages, sourceId, {
              maxBytes: remainingVisionBytes,
            });
            for (const r of rendered) {
              pageFiles.push(r.file);
              remainingVisionBytes -= r.size;
              visionPagesRef.current.push({
                sourceId,
                page: r.page,
                fileName: r.file.name,
                attachmentId: a.id,
              });
            }
          }
          if (scanned.length > 0 && visionPagesRef.current.length === 0) {
            pushToast({ message: "扫描 PDF 页面读取失败，请重新添加文件。", type: "error" });
            return false; // Prompt 保留
          }
        } finally {
          setPreparingVision(false);
        }
      }

      // ---- Turn Context Snapshot：本 Turn 内 Prompt Context 冻结（下一 Turn 才刷新） ----
      turnSnapshotRef.current = buildSnapshotRef.current(turnAttachments);
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
                thumbnail: a.kind === "image" ? undefined : undefined,
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

      // 图片：扫描 PDF 页面图（固定在前） + 用户图片 → 一个 FileList（deterministic 顺序）
      const imageFiles = turnAttachments
        .filter((a): a is Extract<KiroAttachment, { source: "local" }> => a.source === "local" && a.kind === "image" && a.status === "ready")
        .map((a) => a.file);
      let files: FileList | undefined;
      if ((visionEnabled && imageFiles.length > 0) || pageFiles.length > 0) {
        if (typeof DataTransfer !== "undefined") {
          const dt = new DataTransfer();
          pageFiles.forEach((f) => dt.items.add(f));
          imageFiles.forEach((f) => dt.items.add(f));
          files = dt.files;
        }
      }

      chatSendMessage(
        { text: v, files },
        { body: requestBody() }
      );
      return true;
    },
    [chatSendMessage, enabled, visionEnabled, pushToast]
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

      const inFlight = chat.status === "streaming" || chat.status === "submitted";
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
    materialReadCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    void c.regenerate({ body: requestBody() });
  }, [enabled, pushToast]);

  /** stale approval / 本会话 task 状态清理（newChat / loadConversation 共用；不清理已完成任务展示？） */
  const clearComputerSessionState = useCallback(
    (keepRestored: boolean) => {
      pendingExecutionsRef.current.clear();
      oneShotApprovalsRef.current = [];
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
    materialReadCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    undoRegistryRef.current.clear();
    snapshotQueueRef.current = [];
    restoredActionsRef.current.clear();
    restoredAttachmentsRef.current.clear();
    restoredSourcesRef.current.clear();
    viewCacheRef.current.clear();
    turnSourcesRef.current = [];
    setSources([]);
    visionPagesRef.current = [];
  }, [chat.setMessages, clearComputerSessionState]);

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
      readCounterRef.current = 0;
      materialReadCounterRef.current = 0;
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
    // Worklog V2：最后一条 user 之后且仍在 streaming 的 assistant 消息 = 当前 Turn in-flight
    let lastUserIdx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    return chat.messages.map((m, idx) => {
      // 增量缓存：parts/metadata/statusRef 引用未变 → 复用 view
      //（streaming→ready 时即使 parts 引用不变，statusRef 也会变化，避免缓存返回过期 phase）
      const partsRef = (m.parts ?? []) as unknown;
      const metadataRef = m.metadata ?? null;
      const currentTurnInFlight = m.role === "assistant" && idx > lastUserIdx && streaming;
      const statusRef: "live" | "settled" = currentTurnInFlight ? "live" : "settled";
      let view = reuseMessageView(viewCacheRef.current, m.id, partsRef, metadataRef, () =>
        toView(m, currentTurnInFlight),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, streaming, tasksState]);

  /** Stop：清除 stale approvals（旧 Approval 不能在新会话执行）；awaiting task → cancelled */
  const handleStop = useCallback(() => {
    pendingExecutionsRef.current.clear();
    oneShotApprovalsRef.current = [];
    setPendingApproval(null);
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
    error: normalizedError,
    activity,
    /** 本 Turn 的文档来源（Citation 渲染用；不含正文） */
    sources,
    /** 扫描 PDF 页面渲染中（Send 禁用 + 「正在准备扫描 PDF…」） */
    preparingVision,
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
  };
}

/** Computer change 类型 → capability（Audit metadata 用） */
function capabilityForChange(change: { resourceType: "directory" | "text" | "document"; operation: "create" | "modify" }): ComputerCapability {
  if (change.resourceType === "document") return "document.create";
  if (change.resourceType === "directory") return "fs.create";
  return change.operation === "modify" ? "fs.modify" : "fs.create";
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

/** 构建 Write Executor 的受限 API（白名单，禁止 setState） */
function buildWriteApi({
  toolCallId,
  pushToast,
  registerUndo,
  onCancelOutput,
}: {
  toolCallId: string;
  pushToast: (t: { message: string; actionLabel?: string; onAction?: () => void; type?: "success" | "warning" | "error" | "info" }) => void;
  registerUndo: (toolCallId: string, undo: () => void) => void;
  onCancelOutput: (message: string) => void;
}): KiroWriteApi {
  const s = () => useAppStore.getState();
  return {
    getState: s,
    addAssignment: (a) => useAppStore.getState().addAssignment(a),
    updateAssignment: (a) => useAppStore.getState().updateAssignment(a),
    updateAssignmentPatch: (id, patch) => useAppStore.getState().updateAssignmentPatch(id, patch),
    deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
    restoreAssignment: (snapshot) => useAppStore.getState().restoreAssignment(snapshot),
    updateAssignmentStatus: (id, status) => useAppStore.getState().updateAssignmentStatus(id, status),
    updateAssignmentPriority: (id, priority) => useAppStore.getState().updateAssignmentPriority(id, priority),
    updateAssignmentProgress: (id, progress) => useAppStore.getState().updateAssignmentProgress(id, progress),
    toggleSubtask: (id, subtaskId) => useAppStore.getState().toggleSubtask(id, subtaskId),
    addScheduleSlot: (sl) => useAppStore.getState().addScheduleSlot(sl),
    updateSchedule: (sc) => useAppStore.getState().updateSchedule(sc),
    deleteSchedule: (id) => useAppStore.getState().deleteSchedule(id),
    restoreSchedule: (sc) => useAppStore.getState().restoreSchedule(sc),
    excludeWeekFromSchedule: (id, week) => useAppStore.getState().excludeWeekFromSchedule(id, week),
    addCourseWithSchedule: (c, slots) => useAppStore.getState().addCourseWithSchedule(c, slots),
    updateCourse: (c) => useAppStore.getState().updateCourse(c),
    addGroupProject: (p) => useAppStore.getState().addGroupProject(p),
    updateGroupProject: (id, patch) => useAppStore.getState().updateGroupProject(id, patch),
    deleteGroupProject: (id) => useAppStore.getState().deleteGroupProject(id),
    addGroupMember: (id, m) => useAppStore.getState().addGroupMember(id, m),
    updateGroupMember: (id, m) => useAppStore.getState().updateGroupMember(id, m),
    deleteGroupMember: (id, memberId) => useAppStore.getState().deleteGroupMember(id, memberId),
    addGroupTask: (id, t) => useAppStore.getState().addGroupTask(id, t),
    updateGroupTask: (id, t) => useAppStore.getState().updateGroupTask(id, t),
    deleteGroupTask: (id, taskId) => useAppStore.getState().deleteGroupTask(id, taskId),
    toggleGroupTask: (id, taskId) => useAppStore.getState().toggleGroupTask(id, taskId),
    // Task 7G-A1/B：Reminder 白名单
    addReminder: (input) => useAppStore.getState().addReminder(input),
    updateReminder: (id, patch) => useAppStore.getState().updateReminder(id, patch),
    deleteReminder: (id) => useAppStore.getState().deleteReminder(id),
    restoreReminder: (r) => useAppStore.getState().restoreReminder(r),
    reconcileTargetReminders: (targetType, targetId) =>
      useAppStore.getState().reconcileTargetReminders(targetType, targetId),
    // Task 5：Focus Session 白名单（canUndo=false）
    startFocusSession: (input) => useAppStore.getState().startFocusSession(input),
    pauseFocusSession: (now) => useAppStore.getState().pauseFocusSession(now),
    resumeFocusSession: (now) => useAppStore.getState().resumeFocusSession(now),
    finishFocusSession: (now) => useAppStore.getState().finishFocusSession(now),
    pushToast,
    registerUndo: (id, undo) => registerUndo(id, undo),
  };
}
