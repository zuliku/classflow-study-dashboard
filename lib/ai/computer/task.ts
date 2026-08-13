/**
 * Kiro Computer Agent V1 — Agent Task Model（Part 3）。
 * Task 基于真实 Tool Runtime 的可观察活动，绝不展示 chain-of-thought；
 * Step label 来自工具映射（toolStepLabel），不是模型生成的步骤。
 */
import { ComputerToolDefinition } from "@/lib/ai/computer/tools/registry";

export type KiroAgentTaskStatus =
  | "running"
  | "awaiting_permission"
  | "completed"
  | "failed"
  | "cancelled"
  | "undone"
  | "undo_failed";

export type KiroAgentTaskStepStatus = "running" | "awaiting_permission" | "done" | "failed" | "cancelled";

export interface KiroAgentTaskStep {
  id: string;
  toolCallId: string;
  label: string;
  status: KiroAgentTaskStepStatus;
  startedAt: string;
  completedAt?: string;
}

/** 真实变更记录（review 数据来自 runtime 事实；展示有界） */
export interface KiroComputerChange {
  id: string;
  toolCallId: string;
  operation: "create" | "modify" | "move" | "rename";
  resourceType: "directory" | "text" | "document";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  /** V2：Artifact 长期身份（rename/move 不变；create 时登记） */
  artifactId?: string;
  /** V2：relocation 来源（rename/move 展示事实；destination 用 rootId/rootLabel/relativePath） */
  fromRootId?: string;
  fromRootLabel?: string;
  fromRelativePath?: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
  verification: "passed";
  review:
    | { kind: "create"; preview?: string }
    | { kind: "text-patch"; edits: Array<{ before: string; after: string }> }
    | {
        kind: "document";
        title?: string;
        headings: string[];
        paragraphs: number;
        lists: number;
        tables: number;
        codeBlocks: number;
        characters: number;
      };
}

export interface KiroAgentTask {
  id: string;
  conversationId: string | null;
  userMessageId: string;
  assistantMessageId?: string;
  title: string;
  status: KiroAgentTaskStatus;
  steps: KiroAgentTaskStep[];
  changes: KiroComputerChange[];
  toolCallIds: string[];
  canUndo: boolean;
  undoUsed: boolean;
  startedAt: string;
  completedAt?: string;
}

/** 事实性 Step label（Plan §15 映射）；不展示 tool name / JSON */
export function toolStepLabel(toolName: string): string {
  switch (toolName) {
    case "list_workspace_roots":
      return "正在查看工作区";
    case "list_directory":
      return "正在浏览工作区";
    case "search_files":
      return "正在搜索工作区";
    case "grep_files":
      return "正在搜索文件内容";
    case "get_file_metadata":
      return "正在读取文件";
    case "read_text":
      return "正在读取文件";
    case "inspect_document":
      return "正在检查文档";
    case "create_directory":
      return "正在创建目录";
    case "create_text_file":
      return "正在创建文件";
    case "patch_text_file":
      return "正在修改文件";
    case "create_document":
      return "正在创建文档";
    default:
      return "正在执行操作";
  }
}

export function isComputerMutationTool(toolName: string): boolean {
  return (
    toolName === "create_directory" ||
    toolName === "create_text_file" ||
    toolName === "patch_text_file" ||
    toolName === "create_document"
  );
}

export function isComputerReadTool(toolName: string): boolean {
  return (
    toolName === "list_workspace_roots" ||
    toolName === "list_directory" ||
    toolName === "search_files" ||
    toolName === "grep_files" ||
    toolName === "get_file_metadata" ||
    toolName === "read_text" ||
    toolName === "inspect_document"
  );
}

/** 工具定义 → Step label 的运行时映射（task 只消费真实定义） */
export function stepLabelForDefinition(def: ComputerToolDefinition | undefined, toolName: string): string {
  return def ? toolStepLabel(def.name) : toolStepLabel(toolName);
}

let taskSeq = 0;

export function createAgentTask(input: {
  userMessageId: string;
  conversationId: string | null;
  title: string;
}): KiroAgentTask {
  taskSeq += 1;
  return {
    id: `task-${Date.now().toString(36)}-${taskSeq}`,
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    title: input.title,
    status: "running",
    steps: [],
    changes: [],
    toolCallIds: [],
    canUndo: false,
    undoUsed: false,
    startedAt: new Date().toISOString(),
  };
}

export function taskStepForToolCall(task: KiroAgentTask, toolCallId: string, label: string): KiroAgentTaskStep {
  const existing = task.steps.find((s) => s.toolCallId === toolCallId);
  if (existing) return existing;
  const step: KiroAgentTaskStep = {
    id: `step-${toolCallId}`,
    toolCallId,
    label,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  task.steps.push(step);
  if (!task.toolCallIds.includes(toolCallId)) task.toolCallIds.push(toolCallId);
  return step;
}

export function completeTaskStep(task: KiroAgentTask, toolCallId: string): void {
  const step = task.steps.find((s) => s.toolCallId === toolCallId);
  if (!step) return;
  step.status = "done";
  step.completedAt = new Date().toISOString();
}

export function failTaskStep(task: KiroAgentTask, toolCallId: string): void {
  const step = task.steps.find((s) => s.toolCallId === toolCallId);
  if (!step) return;
  step.status = "failed";
  step.completedAt = new Date().toISOString();
}
