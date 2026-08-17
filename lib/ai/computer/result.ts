import { ComputerActionFact } from "@/lib/ai/computer/types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { COMPUTER_TOOL_NAMES } from "@/lib/ai/computer/tools/registry";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import { ComputerInverseOperation } from "@/lib/ai/computer/checkpoints";
import { KiroComputerChange } from "@/lib/ai/computer/task";

/** 捕获 Computer 域错误 → 归一化 result（不抛给 tool loop） */
export function toComputerResult(fn: () => Promise<unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (err) => {
      if (err instanceof ComputerError) {
        return { ok: false as const, code: err.code, message: err.message };
      }
      return { ok: false as const, code: "UNKNOWN", message: err instanceof Error ? err.message : "未知错误" };
    }
  );
}

export function buildActionFact(input: {
  tool: string;
  operation: "create" | "modify";
  resourceType: "text" | "document" | "directory";
  snapshot: KiroComputerTurnSnapshot;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
}): ComputerActionFact {
  return {
    tool: input.tool,
    operation: input.operation,
    resourceType: input.resourceType,
    workspaceId: input.snapshot.workspaceId ?? "",
    workspaceLabel: input.workspaceLabel,
    rootId: input.rootId,
    rootLabel: input.rootLabel,
    relativePath: input.relativePath,
    displayName: input.displayName,
    format: input.format,
    size: input.size,
    changeCount: input.changeCount,
    verification: "passed",
  };
}

/**
 * Part 3：Executor 分层结果。
 * - completed.output 是唯一允许进入 chat.addToolOutput 的 model-safe 输出；
 *   runtime（变更事实 + inverse）只属于 runtime（checkpoint/review）。
 * - approval-required 携带 safe ApprovalRequest（无 tool input / handle / bytes）。
 */
export type ComputerExecutionAttempt =
  | {
      kind: "completed";
      output: ComputerToolResult;
      runtime?: ComputerRuntimeMutation;
    }
  | {
      kind: "approval-required";
      request: ComputerApprovalRequest;
    };

export type ComputerToolResult =
  | { ok: true; data: unknown; actionFact?: ComputerActionFact }
  | {
      ok: false;
      code: string;
      message: string;
      /** V2.9：结构化 failure 事实（如 partial-state { fileMayExist, artifactRegistered }）；模型可读但不含内部 token/path 语义 */
      data?: Record<string, unknown>;
    };

/** Verified mutation 的 runtime-only 事实：change（review 用）+ inverse（checkpoint 用，可选） */
export interface ComputerRuntimeMutation {
  change: KiroComputerChange;
  inverse?: ComputerInverseOperation;
}

/** 校验 toolName 属于 Computer 域 */
export function assertComputerToolName(toolName: string): void {
  if (!COMPUTER_TOOL_NAMES.has(toolName)) {
    throw new ComputerError("PERMISSION_DENIED", `未知 Computer 工具：${toolName}`);
  }
}

export function isComputerToolName(toolName: string): boolean {
  return COMPUTER_TOOL_NAMES.has(toolName);
}
