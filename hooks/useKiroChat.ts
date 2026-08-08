"use client";

import { useCallback, useMemo, useRef } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useChat, UIMessage } from "@ai-sdk/react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { normalizeAIError, AIError } from "@/lib/ai/errors";
import { buildBaseContext } from "@/lib/ai/context/buildBaseContext";
import { buildAutoContextRefs, resolveContextRefs, refsForPrompt } from "@/lib/ai/context/contextSelection";
import { KiroContextRef } from "@/lib/ai/context/types";
import { executeKiroReadTool, ReadToolResult } from "@/lib/ai/tools/read/executor";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { isDestructiveWriteTool, KiroUndoEntry, KiroWriteApi, WriteToolResult } from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { actionToastMessage, toolLabel } from "@/lib/ai/tools/formatters";

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
}

export interface KiroActivity {
  visible: boolean;
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

function toView(m: UIMessage): KiroChatMessageView {
  const parts = (m.parts ?? []) as unknown as (ToolCallPart | { type: "text"; text: string; state?: string })[];
  const content = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const streaming = parts.some((p) => p.type === "text" && p.state === "streaming");

  // 真实 Write Tool 结果（ok:true 且带 action）→ Action Card 数据
  const actions: KiroActionResultView[] = [];
  for (const p of parts) {
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
    const tp = p as ToolCallPart;
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
  };
}

/** 从最新 assistant 消息推导本轮真实工具调用（只显示用户语义标签） */
function deriveActivity(messages: UIMessage[], status: string): KiroActivity {
  let target: UIMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if ((m.parts ?? []).some((p) => typeof p.type === "string" && p.type.startsWith("tool-"))) {
      target = m;
      break;
    }
    if ((m.parts ?? []).some((p) => p.type === "text")) break;
  }
  if (!target) return { visible: false, steps: [], done: true };

  const parts = ((target.parts ?? []).filter(
    (p) => typeof p.type === "string" && p.type.startsWith("tool-")
  ) as unknown) as ToolCallPart[];
  const steps: KiroActivityStep[] = parts.map((p) => {
    const name = toolNameOf(p);
    const isWrite = (KIRO_WRITE_TOOL_NAMES as string[]).includes(name);
    if (p.state === "output-available") return { label: toolLabel(name), status: "done", kind: isWrite ? "write" : "read" };
    if (p.state === "output-error") return { label: toolLabel(name), status: "error", kind: isWrite ? "write" : "read", message: p.errorText };
    return { label: toolLabel(name), status: "working", kind: isWrite ? "write" : "read" };
  });
  const streaming = status === "streaming" || status === "submitted";
  const done = steps.every((s) => s.status === "done") && !streaming;
  return { visible: steps.length > 0, steps, done };
}

type ToolOutput = { ok: boolean; code?: string; message?: string; data?: unknown; action?: unknown };

/**
 * Kiro Chat runtime（Task 3）：Read + Write client-side tools。
 * 安全链：LLM → Tool Call → Client Validation → Existing ClassFlow Action → Tool Result。
 * 高风险工具（delete_*）强制 Confirm；普通编辑直接执行；成功写操作注册一次性 Undo。
 */
export function useKiroChat({
  manualRefs,
  suppressedAutoKeys,
}: {
  manualRefs: KiroContextRef[];
  suppressedAutoKeys: string[];
}) {
  const enabled = useAISettingsStore((s) => s.enabled);
  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);

  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  // 每轮请求体：Base Context + 显式 Context 引用（每次渲染刷新为最新 Store 状态）
  const bodyRef = useRef<Record<string, unknown>>({});
  bodyRef.current = {
    provider,
    model,
    apiKey: getSessionApiKey(provider),
    customConfig: custom,
    baseContext: buildBaseContext(),
    contextRefs: refsForPrompt(
      resolveContextRefs(buildAutoContextRefs(), manualRefs, suppressedAutoKeys)
    ),
  };

  const readCounterRef = useRef(0);
  const writeCounterRef = useRef(0);
  const limitReachedRef = useRef(false);
  const undoRegistryRef = useRef(new Map<string, KiroUndoEntry>());

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
          options: { body: bodyRef.current },
        });

      // ---- 循环保护 ----
      if (limitReachedRef.current) {
        failOutput("READ_TOOL_LIMIT_REACHED", "已达到本轮操作上限，请换个问法。");
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
        options: { body: bodyRef.current },
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
        options: { body: bodyRef.current },
      });
    },
    [chat, consumeUndo, pushToast]
  );

  const send = useCallback(
    (text: string) => {
      const v = text.trim();
      if (!v || !enabled) return;
      readCounterRef.current = 0;
      writeCounterRef.current = 0;
      limitReachedRef.current = false;
      void chat.sendMessage({ text: v }, { body: bodyRef.current });
    },
    [chat, enabled]
  );

  const retry = useCallback(() => {
    if (!enabled) return;
    readCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    void chat.regenerate({ body: bodyRef.current });
  }, [chat, enabled]);

  const newChat = useCallback(() => {
    chat.setMessages([]);
    readCounterRef.current = 0;
    writeCounterRef.current = 0;
    limitReachedRef.current = false;
    undoRegistryRef.current.clear();
  }, [chat]);

  const normalizedError: AIError | null = chat.error ? normalizeAIError(chat.error) : null;
  const streaming = chat.status === "streaming" || chat.status === "submitted";
  const activity = useMemo(
    () => deriveActivity(chat.messages, chat.status),
    [chat.messages, chat.status]
  );

  return {
    messages: chat.messages.map(toView),
    status: chat.status,
    streaming,
    error: normalizedError,
    activity,
    send,
    retry,
    stop: chat.stop,
    newChat,
    configured: enabled,
    consumeUndo,
  };
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
    deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
    restoreAssignment: (a, marks) => useAppStore.getState().restoreAssignment(a, marks),
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
    pushToast,
    registerUndo: (id, undo) => registerUndo(id, undo),
  };
}
