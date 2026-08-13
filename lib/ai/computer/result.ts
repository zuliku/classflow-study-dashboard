import { ComputerActionFact } from "@/lib/ai/computer/types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { COMPUTER_TOOL_NAMES } from "@/lib/ai/computer/tools/registry";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";

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

/** 校验 toolName 属于 Computer 域 */
export function assertComputerToolName(toolName: string): void {
  if (!COMPUTER_TOOL_NAMES.has(toolName)) {
    throw new ComputerError("PERMISSION_DENIED", `未知 Computer 工具：${toolName}`);
  }
}

export function isComputerToolName(toolName: string): boolean {
  return COMPUTER_TOOL_NAMES.has(toolName);
}
