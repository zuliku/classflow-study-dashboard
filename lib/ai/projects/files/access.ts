/**
 * Project File Turn Access Guard（V1.3B 共享）：
 * read_project_file 与 read_project_visual 共用同一套跨项目访问控制，
 * 避免两份实现逐渐漂移。
 *
 * 检查链（缺一即拒绝）：
 * 1. frozenProjectContext 存在（当前 Turn 冻结的 Project Context）
 * 2. projectFileId 在 frozen files index 中（模型只能读索引内文件）
 * 3. metadata 实际存在
 * 4. record.projectId === frozenProjectContext.id（双重检查；跨 Project 读取绝对禁止）
 *
 * 任何失败都在读取 Blob / 调用 internal Vision endpoint 之前发生。
 */
import { getProjectFile } from "@/lib/ai/projects/files/db";
import { KiroProjectFileRecord, KiroProjectFileKind } from "@/lib/ai/projects/files/types";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";

export type ProjectFileAccessOutcome =
  | { ok: true; indexEntry: { id: string; name: string; kind: KiroProjectFileKind; sizeBytes: number }; record: KiroProjectFileRecord }
  | { ok: false; code: "NOT_FOUND"; message: string };

export async function resolveProjectFileForTurn(input: {
  projectFileId: string;
  projectContext: KiroProjectTurnContext | undefined;
}): Promise<ProjectFileAccessOutcome> {
  if (!input.projectContext) {
    return { ok: false, code: "NOT_FOUND", message: "当前对话不属于 Kiro 项目。" };
  }
  // 1. frozen index 检查：只能读取当前 Turn 索引中存在的文件
  const indexEntry = (input.projectContext.files ?? []).find((f) => f.id === input.projectFileId);
  if (!indexEntry) {
    return { ok: false, code: "NOT_FOUND", message: "该项目资料不在当前会话可用索引中。" };
  }

  // 2. metadata + 跨项目双重检查（即使 IndexedDB 存在其他 Project 的文件也拒绝）
  let record: KiroProjectFileRecord | null = null;
  try {
    record = await getProjectFile(input.projectFileId);
  } catch {
    return { ok: false, code: "NOT_FOUND", message: "无法读取该项目资料。" };
  }
  if (!record || record.projectId !== input.projectContext.id) {
    return { ok: false, code: "NOT_FOUND", message: "无法读取该项目资料。" };
  }
  return {
    ok: true,
    indexEntry: { id: indexEntry.id, name: indexEntry.name, kind: indexEntry.kind, sizeBytes: indexEntry.sizeBytes },
    record,
  };
}
