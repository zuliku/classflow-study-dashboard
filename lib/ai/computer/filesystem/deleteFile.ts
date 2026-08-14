/**
 * Workspace File Deletion（V2.5）。
 *
 * 共享删除 primitive：
 * - Agent delete_file（policy + approval 之后）与用户手动删除（确认 Dialog = user gesture）复用同一底层。
 * - 只删除单个文件：stat 必须 kind === "file"；目录 → UNSUPPORTED_FILE_TYPE。
 * - filesystem 是事实来源：删除成功后才同步 Artifact Registry / Source；Knowledge 标记 dirty。
 * - 删除后 stat 必须为 null，否则 VERIFICATION_FAILED。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import {
  findArtifactByLocation,
  removeArtifactRecord,
} from "@/lib/ai/computer/artifacts/service";
import { markWorkspaceKnowledgeDirty } from "@/lib/ai/computer/knowledge/service";

/**
 * 底层删除（文件系统成功后同步 Registry / Source / Knowledge）。不含 policy/approval。
 * 调用方负责：workspace 解析、root 存在性、policy/approval（Agent）或 user gesture（手动）。
 */
export async function performFileDeletion(input: {
  workspace: KiroWorkspaceMeta;
  rootId: string;
  relativePath: string;
}): Promise<void> {
  const { workspace: ws, rootId, relativePath } = input;
  const normalized = normalizeRelativeComputerPath(relativePath).path;

  const root = ws.roots.find((r) => r.id === rootId);
  if (!root) throw new ComputerError("ROOT_NOT_FOUND", `工作区根不存在：${rootId}`);
  if (root.access !== "read-write") {
    throw new ComputerError("READ_ONLY_ROOT", "只读工作区根不允许删除");
  }
  const io = getComputerAdapterForAdapterRef(root.adapterRef);

  // stat 必须为 file
  const stat = await io.stat(normalized);
  if (!stat) throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${normalized}`);
  if (stat.kind !== "file") {
    throw new ComputerError("UNSUPPORTED_FILE_TYPE", "当前仅支持删除文件，不支持删除目录。");
  }

  // 真实删除（filesystem 是事实来源）
  await io.remove(normalized, "file");

  // Verify：删除后必须 absent
  const after = await io.stat(normalized);
  if (after !== null) {
    throw new ComputerError("VERIFICATION_FAILED", "文件删除校验失败");
  }

  // Artifact Registry / Source 同步清理（文件已删除成功才清理）
  const artifact = await findArtifactByLocation(ws.id, rootId, normalized);
  if (artifact) {
    await removeArtifactRecord(artifact.id);
  }

  // Knowledge 索引标记 dirty（不返回已删除文件）
  await markWorkspaceKnowledgeDirty(ws.id);
}

/** 用户手动删除（确认 Dialog = 明确 user gesture，不再走 Agent approval，但完整安全检查保留） */
export async function deleteWorkspaceFile(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<void> {
  const ws = input.workspaces.find((w) => w.id === input.workspaceId);
  if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "工作区不存在");
  await performFileDeletion({
    workspace: ws,
    rootId: input.rootId,
    relativePath: input.relativePath,
  });
}
