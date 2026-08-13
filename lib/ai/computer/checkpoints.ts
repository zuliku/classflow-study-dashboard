/**
 * Kiro Computer Agent V1 — Task Checkpoint（Part 3）。
 * Checkpoint 只存在当前 Runtime Session（useKiroChat ref），绝不持久化；
 * 刷新页面后历史 Task 仍可看，但不能 Undo。
 * Undo 是 runtime restoration，不是 LLM delete capability（没有 delete_file 工具）。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";

export type ComputerInverseOperation =
  | {
      type: "remove-created";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      resourceType: "file" | "directory";
    }
  | {
      type: "restore-text";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      beforeText: string;
    }
  | {
      type: "move-back";
      workspaceId: string;
      fromRootId: string;
      fromPath: string;
      toRootId: string;
      toPath: string;
      /** V2：直接把 artifactId 放进 runtime checkpoint（Undo 时不需要从 UI 反向猜） */
      artifactId?: string;
    };

export interface ComputerTaskCheckpoint {
  taskId: string;
  inverses: ComputerInverseOperation[];
  used: boolean;
}

export function createTaskCheckpoint(taskId: string): ComputerTaskCheckpoint {
  return { taskId, inverses: [], used: false };
}

export function appendInverseToCheckpoint(
  checkpoint: ComputerTaskCheckpoint,
  inverse: ComputerInverseOperation
): void {
  checkpoint.inverses.push(inverse);
}

/** 单条 inverse 执行 + 验证（失败抛 ComputerError；任何一步失败 → undo_failed，绝不宣称全部撤销） */
export async function applyInverseToAdapter(io: ComputerAdapterIO, inverse: ComputerInverseOperation): Promise<void> {
  if (inverse.type === "remove-created") {
    await io.remove(inverse.relativePath, inverse.resourceType);
    // Verify：目标必须不存在
    const after = await io.stat(inverse.relativePath);
    if (after !== null) {
      throw new ComputerError("VERIFICATION_FAILED", "撤销删除校验失败");
    }
    return;
  }
  if (inverse.type === "move-back") {
    // 双 root 操作由 useKiroChat Undo orchestration 单独处理；这里防御性拒绝
    throw new ComputerError("VERIFICATION_FAILED", "move-back 需要在 Undo orchestration 中执行");
  }
  // restore-text：写回 beforeText 并 exact read-back verify
  await io.writeText(inverse.relativePath, inverse.beforeText);
  const readBack = await io.readText(inverse.relativePath);
  if (readBack !== inverse.beforeText) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销恢复校验失败");
  }
}
