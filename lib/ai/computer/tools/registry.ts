import { z } from "zod";
import { ComputerCapability, KiroAgentMode } from "@/lib/ai/computer/types";
import {
  listWorkspaceRootsSchema,
  listDirectorySchema,
  searchFilesSchema,
  grepFilesSchema,
  getFileMetadataSchema,
  readTextSchema,
  inspectDocumentSchema,
  createDirectorySchema,
  createTextFileSchema,
  patchTextFileSchema,
  createDocumentSchema,
  renameFileSchema,
  moveFileSchema,
  updateDocumentSchema,
  searchWorkspaceKnowledgeSchema,
  retrieveWorkspaceContextSchema,
} from "@/lib/ai/computer/tools/schemas";

export interface ComputerToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  capability: ComputerCapability;
  /** 该 tool 是否 mutation（影响 regenerate guard / 调用限制） */
  mutation: boolean;
}

export const COMPUTER_READ_TOOLS: ComputerToolDefinition[] = [
  {
    name: "list_workspace_roots",
    description: "列出当前 Workspace 的授权根目录（id/label/access）。",
    schema: listWorkspaceRootsSchema,
    capability: "workspace.list",
    mutation: false,
  },
  {
    name: "list_directory",
    description: "列出目录内容（从授权 root 或相对路径开始）。",
    schema: listDirectorySchema,
    capability: "fs.list",
    mutation: false,
  },
  {
    name: "search_files",
    description: "按文件名搜索工作区文件（相对路径）。",
    schema: searchFilesSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "grep_files",
    description: "在工作区文本文件中进行精确文本搜索（非正则）。",
    schema: grepFilesSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "search_workspace_knowledge",
    description: "在当前 Workspace 的本地知识索引中搜索相关文件候选；正文结论仍需实时读取文件确认。",
    schema: searchWorkspaceKnowledgeSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "retrieve_workspace_context",
    description: "在工作区知识索引定位候选文件后，实时读取少量最相关文件的有界正文片段（Grounded Context）。正文来自当前文件内容；完整段落/表格请继续用 read_text / inspect_document / grep_files。",
    schema: retrieveWorkspaceContextSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "get_file_metadata",
    description: "获取文件或目录的元信息（kind/size/type）。",
    schema: getFileMetadataSchema,
    capability: "fs.read",
    mutation: false,
  },
  {
    name: "read_text",
    description: "读取文本文件（支持 startLine/endLine/maxChars 分界读取）。",
    schema: readTextSchema,
    capability: "fs.read",
    mutation: false,
  },
  {
    name: "inspect_document",
    description: "检查文档结构事实（Markdown/DOCX）：标题、章节、段落、表格等计数。",
    schema: inspectDocumentSchema,
    capability: "fs.read",
    mutation: false,
  },
];

export const COMPUTER_MUTATION_TOOLS: ComputerToolDefinition[] = [
  {
    name: "create_directory",
    description: "在工作区创建目录（已存在时返回 exists，不覆盖）。",
    schema: createDirectorySchema,
    capability: "fs.create",
    mutation: true,
  },
  {
    name: "create_text_file",
    description: "在工作区创建新文本文件（已存在时拒绝，绝不覆盖）。",
    schema: createTextFileSchema,
    capability: "fs.create",
    mutation: true,
  },
  {
    name: "patch_text_file",
    description: "对现有文本文件进行精确修改（oldText 必须唯一匹配）。",
    schema: patchTextFileSchema,
    capability: "fs.modify",
    mutation: true,
  },
  {
    name: "create_document",
    description: "从结构化文档 IR 生成 Markdown 或 DOCX 文件。",
    schema: createDocumentSchema,
    capability: "document.create",
    mutation: true,
  },
  {
    name: "rename_file",
    description: "在同一目录内重命名文件（newName 必须是 basename）。",
    schema: renameFileSchema,
    capability: "fs.move",
    mutation: true,
  },
  {
    name: "move_file",
    description: "在同一 Workspace 内把文件移动到另一个根目录（目标必须不存在）。",
    schema: moveFileSchema,
    capability: "fs.move",
    mutation: true,
  },
  {
    name: "update_document",
    description: "更新 Kiro 创建的 Markdown/DOCX Artifact；必须提供当前 expectedRevision。",
    schema: updateDocumentSchema,
    capability: "document.modify",
    mutation: true,
  },
];

export const COMPUTER_TOOLS: ComputerToolDefinition[] = [
  ...COMPUTER_READ_TOOLS,
  ...COMPUTER_MUTATION_TOOLS,
];

export const COMPUTER_TOOL_NAMES = new Set(COMPUTER_TOOLS.map((t) => t.name));

/** Mutation 工具名（regenerate guard / 调用限制使用） */
export const COMPUTER_MUTATION_TOOL_NAMES = new Set(COMPUTER_MUTATION_TOOLS.map((t) => t.name));

/**
 * 按 Agent Mode 暴露工具（server 过滤；不是安全边界——executor 仍独立 policy 求值）：
 * - plan：只读工具
 * - guided / workspace-auto：read + mutation
 */
export function getComputerToolsForMode(mode: KiroAgentMode): ComputerToolDefinition[] {
  if (mode === "plan") return COMPUTER_READ_TOOLS;
  return COMPUTER_TOOLS;
}
