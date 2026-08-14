import { z } from "zod";
import { kiroDocumentDraftSchema } from "@/lib/ai/computer/documents/authoring/schema";

/**
 * Computer Tool 输入 Schema（zod）——所有工具在 Executor 内强制校验。
 * 资源路径为 logical relative path；限制与 Prompt 一致。
 */

const resourcePath = z.string().trim().min(1).max(512);

export const listWorkspaceRootsSchema = z.object({});

export const listDirectorySchema = z.object({
  // allowRoot：缺省/“.” → root scope
  path: z.string().trim().max(512).optional(),
});

export const searchFilesSchema = z.object({
  query: z.string().trim().min(1).max(120),
  path: z.string().trim().max(512).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  maxDepth: z.number().int().min(1).max(10).optional(),
});

export const grepFilesSchema = z.object({
  query: z.string().trim().min(1).max(200),
  path: z.string().trim().max(512).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  maxFiles: z.number().int().min(1).max(200).optional(),
});

export const getFileMetadataSchema = z.object({
  path: resourcePath,
});

export const readTextSchema = z.object({
  path: resourcePath,
  startLine: z.number().int().min(1).max(1_000_000).optional(),
  endLine: z.number().int().min(1).max(1_000_000).optional(),
  maxChars: z.number().int().min(1).max(24000).optional(),
});

export const inspectDocumentSchema = z.object({
  path: resourcePath,
});

export const createDirectorySchema = z.object({
  path: resourcePath,
});

export const createTextFileSchema = z.object({
  path: resourcePath,
  content: z.string().min(0).max(120_000),
});

export const patchTextFileSchema = z.object({
  path: resourcePath,
  edits: z
    .array(
      z.object({
        oldText: z.string().min(1).max(40_000),
        newText: z.string().max(40_000),
      })
    )
    .min(1)
    .max(20),
});

/** V2.2：create_document —— 模型写扁平 KiroDocumentDraft（text/items/string 表格），executor 内 normalize 为 canonical */
export const createDocumentSchema = z.object({
  path: resourcePath,
  document: kiroDocumentDraftSchema,
});

/** V2：rename_file —— newName 只能是 basename（/ \\ . .. NUL/control/Windows reserved 由运行时拒绝） */
export const renameFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: resourcePath,
  newName: z.string().trim().min(1).max(255),
});

/** V2：move_file —— 同一 frozen Workspace 内跨 root 移动；目标不存在（无隐式覆盖） */
export const moveFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: resourcePath,
  destinationRootId: z.string().trim().min(1).max(120),
  destinationPath: resourcePath,
});

/** V2 Part 2 + V2.2：update_document —— 模型只提供 artifactId + expectedRevision + 扁平 Draft（无路径/adapterRef/bytes） */
export const updateDocumentSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: kiroDocumentDraftSchema,
});

/** V3 Part 1：search_workspace_knowledge —— 本地知识索引候选搜索（正文结论仍需实时读取） */
export const searchWorkspaceKnowledgeSchema = z.object({
  query: z.string().trim().min(1).max(200),
  rootIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

/** V3 Part 2：retrieve_workspace_context —— Grounded Retrieval（live excerpt；有界 budget） */
export const retrieveWorkspaceContextSchema = z.object({
  query: z.string().trim().min(1).max(200),
  rootIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32).optional(),
  maxFiles: z.number().int().min(1).max(4).optional(),
  maxChars: z.number().int().min(1).max(6000).optional(),
});
