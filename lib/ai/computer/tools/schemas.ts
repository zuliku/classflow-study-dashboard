import { z } from "zod";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";

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

export const createDocumentSchema = z.object({
  path: resourcePath,
  document: z
    .unknown()
    .refine(isKiroDocument, { message: "document 必须是结构化 KiroDocument IR" }),
});
