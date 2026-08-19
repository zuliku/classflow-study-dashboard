import { z } from "zod";
import { kiroDocumentSchema } from "@/lib/ai/computer/documents/schema";
import { kiroDocumentDraftSchema } from "@/lib/ai/computer/documents/authoring/schema";
import { isStructuredBinaryPath } from "@/lib/ai/computer/filesystem/fileTypes";

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
  path: resourcePath.refine(
    (p) => !isStructuredBinaryPath(p),
    "不能创建结构化二进制格式（DOCX/PDF/XLSX/PPTX）；Word 文档必须使用 create_document"
  ),
  content: z.string().min(0).max(120_000),
});

export const patchTextFileSchema = z.object({
  path: resourcePath.refine(
    (p) => !isStructuredBinaryPath(p),
    "不能修改结构化二进制格式（DOCX/PDF/XLSX/PPTX）；Word 文档必须使用 update_document"
  ),
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

/** V2.5+V2.8：delete_file —— 只删除单个文件（不支持目录 / 递归 / root / glob / 批量）。
 *  rootId 可选：single-root Workspace 可省略（自动解析唯一 root）；
 *  multi-root Workspace 省略 → ROOT_REQUIRED（必须使用 list_workspace_roots / list_directory 返回的 rootId）。 */
export const deleteFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120).optional(),
  path: resourcePath,
});

/** Desktop Terminal V1/V2：run_terminal_command。
 * V2 新增 executionMode（默认 foreground；long-running 必须显式使用——放宽 timeout 上限，
 * 不默认允许无限 background process）。无 env/stdin/elevation 字段。 */
export const runTerminalCommandSchema = z.object({
  shell: z.enum(["powershell", "cmd"]),
  rootId: z.string().trim().min(1).max(120).optional(),
  /** relative cwd（"" = root） */
  cwd: z.string().trim().max(512).optional(),
  // 空命令由 Risk Classifier 判为 blocked（TERMINAL_COMMAND_BLOCKED），不在 schema 层拦截
  command: z.string().max(8192),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  /** V2：executionMode = "long-running" 显式启用长任务（timeout 上限放宽至 600s）；默认 foreground */
  executionMode: z.enum(["foreground", "long-running"]).optional(),
});
/** V2.3：Model-facing schemas 按 Document Authoring Protocol Version 分离。
 *  - V1 model contract：Canonical KiroDocument（legacy Client）
 *  - V2 model contract：扁平 Draft（当前 Client）
 *  Browser Runtime 不使用其中任何一个作为唯一 Schema（用 z.unknown() + parseDocumentAuthoringInput 双兼容）。
 */

export const createDocumentV1ModelSchema = z.object({
  path: resourcePath,
  document: kiroDocumentSchema,
});

export const createDocumentV2ModelSchema = z.object({
  path: resourcePath,
  document: kiroDocumentDraftSchema,
});

export const updateDocumentV1ModelSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: kiroDocumentSchema,
});

export const updateDocumentV2ModelSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: kiroDocumentDraftSchema,
});

/** Browser Runtime top-level schema：document 为 z.unknown()——不是放宽安全边界，
 *  document 必须在 Executor IO 前进入 parseDocumentAuthoringInput() 完成严格双兼容校验。 */
export const createDocumentRuntimeSchema = z.object({
  path: resourcePath,
  document: z.unknown(),
});

export const updateDocumentRuntimeSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: z.unknown(),
});

/** 兼容别名（旧 import 使用 createDocumentSchema / updateDocumentSchema = runtime schema） */
export const createDocumentSchema = createDocumentRuntimeSchema;
export const updateDocumentSchema = updateDocumentRuntimeSchema;

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
