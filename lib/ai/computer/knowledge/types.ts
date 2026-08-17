/**
 * Kiro Computer Agent V3 Part 1 — Workspace Knowledge（本地有界词法索引）。
 *
 * 安全边界：
 * - Knowledge 只是 candidate cache；filesystem 始终是事实来源。
 * - 不保存 adapterRef / native path / handle / grant / token / file bytes / 无限长全文 /
 *   Artifact Source IR / chat history / whole prompt。
 * - 只允许 logical workspace/root/path metadata + 有界 lexical chunks。
 */

export const KIRO_KNOWLEDGE_DB = "classflow-kiro-knowledge-v1";
export const KIRO_KNOWLEDGE_MAX_FILES = 2_000;
export const KIRO_KNOWLEDGE_MAX_DEPTH = 12;
export const KIRO_KNOWLEDGE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
export const KIRO_KNOWLEDGE_MAX_CHUNKS_PER_FILE = 20;
export const KIRO_KNOWLEDGE_TARGET_CHARS_PER_CHUNK = 1_800;
export const KIRO_KNOWLEDGE_MAX_CHUNKS_PER_WORKSPACE = 10_000;
export const KIRO_KNOWLEDGE_SEARCH_DEFAULT_RESULTS = 20;
export const KIRO_KNOWLEDGE_SEARCH_MAX_RESULTS = 50;
export const KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS = 320;
export const KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT = 8_000;
export const KIRO_INSTRUCTIONS_MAX_CHARS_TOTAL = 16_000;
export const KIRO_INSTRUCTIONS_PREFIX_MAX_BYTES = 64 * 1024;

export type KiroKnowledgeContentType = "text" | "docx" | "metadata";
export type KiroKnowledgeContentStatus = "indexed" | "metadata-only" | "failed";

export interface KiroKnowledgeWorkspaceState {
  workspaceId: string;
  lastIndexedAt: string;
  fileCount: number;
  chunkCount: number;
  partial: boolean;
  dirty: boolean;
  unavailableRootIds: string[];
}

export interface KiroKnowledgeFileRecord {
  key: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  extension: string;
  type: KiroKnowledgeContentType;
  size: number;
  title?: string;
  fingerprint: string;
  contentStatus: KiroKnowledgeContentStatus;
  indexedAt: string;
}

export interface KiroKnowledgeChunkRecord {
  key: string;
  fileKey: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  ordinal: number;
  text: string;
  tokenCounts: Record<string, number>;
}

export interface KiroKnowledgeSearchResult {
  rootId: string;
  path: string;
  title?: string;
  type: KiroKnowledgeContentType;
  snippet?: string;
  score: number;
  matchReasons: Array<"filename" | "path" | "title" | "phrase" | "content-token">;
}

/** 含内部评分拆分（权限过滤阶段需要去掉正文 evidence） */
export interface KiroKnowledgeScoredCandidate {
  result: KiroKnowledgeSearchResult;
  metadataScore: number;
  contentScore: number;
}

export type KiroKnowledgeIndexState = "ready" | "partial" | "stale" | "unavailable";

/** 稳定逻辑 key（不依赖 adapterRef/native path） */
export function knowledgeFileKey(workspaceId: string, rootId: string, relativePath: string): string {
  return `${workspaceId}\u0000${rootId}\u0000${relativePath}`;
}

export function knowledgeChunkKey(fileKey: string, ordinal: number): string {
  return `${fileKey}\u0000${String(ordinal).padStart(4, "0")}`;
}
