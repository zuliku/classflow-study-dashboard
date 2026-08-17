/**
 * Kiro Computer Agent V1 — Task Checkpoint（Part 3）。
 * Checkpoint 只存在当前 Runtime Session（useKiroChat ref），绝不持久化；
 * 刷新页面后历史 Task 仍可看，但不能 Undo。
 * Undo 是 runtime restoration，不是 LLM delete capability（没有 delete_file 工具）。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { removeArtifactRecordIfMatches } from "@/lib/ai/computer/artifacts/service";
import {
  RestoreGenericArtifactRevisionInverse,
  undoGenericArtifactPatchRuntime,
} from "@/lib/ai/computer/genericArtifactPatchUndo";

/** V2 Part 2：文档 revision 的 exact 文件快照（runtime-only；绝不定持久化/进模型） */
export type DocumentFileSnapshot =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };

export type ComputerInverseOperation =
  | {
      type: "remove-created";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      resourceType: "file" | "directory";
      /** V2 Part 3：create 登记的 Artifact（create_text_file/create_document 携带；目录无） */
      artifactId?: string;
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
    }
  | {
      type: "restore-document-revision";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      artifactId: string;
      previousRevision: number;
      expectedCurrentRevision: number;
      previousDocument: KiroDocument;
      snapshot: DocumentFileSnapshot;
    }
  | RestoreGenericArtifactRevisionInverse;

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
    // V2 Part 3：create 登记的 Artifact 同步清理（匹配位置才删；registry 清理失败 → undo_failed）
    if (inverse.resourceType === "file" && inverse.artifactId) {
      await removeArtifactRecordIfMatches({
        artifactId: inverse.artifactId,
        workspaceId: inverse.workspaceId,
        rootId: inverse.rootId,
        relativePath: inverse.relativePath,
      });
    }
    return;
  }
  if (inverse.type === "move-back") {
    // 双 root 操作由 useKiroChat Undo orchestration 单独处理；这里防御性拒绝
    throw new ComputerError("VERIFICATION_FAILED", "move-back 需要在 Undo orchestration 中执行");
  }
  if (inverse.type === "restore-document-revision") {
    // revision 恢复需要同步 Artifact metadata + Source Store，由 useKiroChat Undo orchestration 处理
    throw new ComputerError("VERIFICATION_FAILED", "restore-document-revision 需要在 Undo orchestration 中执行");
  }
  if (inverse.type === "restore-generic-artifact-revision") {
    // generic Artifact patch Undo：exact 文本 + 原子 metadata revision 恢复（无 Source IR）
    await undoGenericArtifactPatchRuntime({ io, inverse });
    return;
  }
  // restore-text：写回 beforeText 并 exact read-back verify
  await io.writeText(inverse.relativePath, inverse.beforeText);
  const readBack = await io.readText(inverse.relativePath);
  if (readBack !== inverse.beforeText) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销恢复校验失败");
  }
}
