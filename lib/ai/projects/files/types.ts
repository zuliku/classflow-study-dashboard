/**
 * Kiro Project File（V1.3A）：Project 持久化文档。
 * Kiro Project File ≠ Computer Workspace file：这里是 Project 知识文档，
 * Workspace 是 Agent filesystem capability/sandbox，两个概念不耦合。
 */
export type KiroProjectFileKind = "text" | "pdf" | "docx";

export interface KiroProjectFileRecord {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: KiroProjectFileKind;
  /** Blob storage implementation detail：绝不允许进入 Prompt / Tool Schema / Tool Output / Citation / UI */
  storageKey: string;
  createdAt: string;
}

/** 每 Project 最大文件数（V1.3A） */
export const MAX_PROJECT_FILES_PER_PROJECT = 20;

/** Project File 业务 id（≠ storageKey） */
export function createProjectFileId(): string {
  return `pf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
