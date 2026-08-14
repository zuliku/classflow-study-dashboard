/**
 * Workspace File Deletion（V2.5 / V2.8）。
 *
 * 共享删除 primitive：
 * - Agent delete_file（policy + approval 之后）与用户手动删除（确认 Dialog = user gesture）复用同一底层。
 * - 只删除单个文件：stat 必须 kind === "file"；目录 → UNSUPPORTED_FILE_TYPE。
 * - V2.8 两阶段语义：filesystem core mutation（stat → remove → stat absent）成功 = 删除成功；
 *   Artifact Registry / Knowledge 同步是 best-effort post-sync——失败只产生 warning，
 *   绝不把「文件已删除」报告成 ok:false（避免模型推断"零副作用"）。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/adapters/factory";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import {
  findArtifactByLocation,
  removeArtifactRecord,
} from "@/lib/ai/computer/artifacts/service";
import { markWorkspaceKnowledgeDirty } from "@/lib/ai/computer/knowledge/service";

export interface FileDeletionResult {
  /** filesystem core mutation 已成功（remove + stat absent verified） */
  fileDeleted: true;
  artifactCleanup: "removed" | "not-found" | "failed";
  knowledgeSync: "dirty" | "failed";
  warnings?: string[];
}

/**
 * 底层删除（V2.8 两阶段）。
 * 调用方负责：workspace 解析、root 存在性、policy/approval（Agent）或 user gesture（手动）。
 *
 * Core mutation（真正失败才 throw，且此时文件未删除）：
 *   stat=file → remove → stat absent verify
 * Post-sync（best-effort；失败仅 warning）：
 *   Artifact Registry / Source 清理；Knowledge dirty
 */
export async function performFileDeletion(input: {
  workspace: KiroWorkspaceMeta;
  rootId: string;
  relativePath: string;
}): Promise<FileDeletionResult> {
  const { workspace: ws, rootId, relativePath } = input;
  const normalized = normalizeRelativeComputerPath(relativePath).path;

  const root = ws.roots.find((r) => r.id === rootId);
  if (!root) throw new ComputerError("ROOT_NOT_FOUND", `工作区根不存在：${rootId}`);
  if (root.access !== "read-write") {
    throw new ComputerError("READ_ONLY_ROOT", "只读工作区根不允许删除");
  }
  const io = getComputerAdapterForAdapterRef(root.adapterRef);

  // ---- Core mutation（唯一可能使 Tool 返回 ok:false 的部分）----
  // stat 必须为 file
  const stat = await io.stat(normalized);
  if (!stat) throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${normalized}`);
  if (stat.kind !== "file") {
    throw new ComputerError("UNSUPPORTED_FILE_TYPE", "当前仅支持删除文件，不支持删除目录。");
  }

  // 真实删除（filesystem 是事实来源）
  await io.remove(normalized, "file");

  // Verify：删除后必须 absent（此处失败 → 文件状态不确定 → VERIFICATION_FAILED）
  const after = await io.stat(normalized);
  if (after !== null) {
    throw new ComputerError("VERIFICATION_FAILED", "文件删除校验失败");
  }

  // ---- Post-sync（best-effort；绝不因失败改变 filesystem truth）----
  const warnings: string[] = [];
  let artifactCleanup: FileDeletionResult["artifactCleanup"] = "not-found";
  try {
    const artifact = await findArtifactByLocation(ws.id, rootId, normalized);
    if (artifact) {
      await removeArtifactRecord(artifact.id);
      artifactCleanup = "removed";
    }
  } catch {
    artifactCleanup = "failed";
    warnings.push("文件已删除，但最近文件记录同步稍有延迟。");
  }

  let knowledgeSync: FileDeletionResult["knowledgeSync"] = "dirty";
  try {
    await markWorkspaceKnowledgeDirty(ws.id);
  } catch {
    knowledgeSync = "failed";
    warnings.push("文件已删除，但工作区知识索引稍后才会更新。");
  }

  return {
    fileDeleted: true,
    artifactCleanup,
    knowledgeSync,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** 用户手动删除（确认 Dialog = 明确 user gesture，不再走 Agent approval，但完整安全检查保留） */
export async function deleteWorkspaceFile(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<FileDeletionResult> {
  const ws = input.workspaces.find((w) => w.id === input.workspaceId);
  if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "工作区不存在");
  return performFileDeletion({
    workspace: ws,
    rootId: input.rootId,
    relativePath: input.relativePath,
  });
}
