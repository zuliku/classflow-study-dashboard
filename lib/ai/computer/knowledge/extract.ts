/**
 * Content extraction + bounded chunking（V3 Part 1）。
 * 文本文件复用 TEXT_LIKE_EXTENSIONS；DOCX 复用 extractDocx（raw text only）；
 * PDF/不支持/超限 → metadata-only。绝不定保存 HTML / OOXML / bytes。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import {
  KIRO_KNOWLEDGE_MAX_CHUNKS_PER_FILE,
  KIRO_KNOWLEDGE_MAX_CONTENT_BYTES,
  KIRO_KNOWLEDGE_TARGET_CHARS_PER_CHUNK,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeContentType,
  KiroKnowledgeContentStatus,
  knowledgeChunkKey,
} from "@/lib/ai/computer/knowledge/types";
import { knowledgeTokenCounts, normalizeKnowledgeText, tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";
import { TEXT_LIKE_EXTENSIONS } from "@/lib/ai/computer/filesystem/search";

export interface ExtractedFileContent {
  type: KiroKnowledgeContentType;
  contentStatus: KiroKnowledgeContentStatus;
  title?: string;
  chunks: KiroKnowledgeChunkRecord[];
}

/** 按目标 ~1800 字符切块（硬切分，保持确定性） */
export function chunkText(text: string): string[] {
  const normalized = normalizeKnowledgeText(text);
  if (!normalized) return [];
  const chunks: string[] = [];
  const limit = KIRO_KNOWLEDGE_TARGET_CHARS_PER_CHUNK;
  for (let i = 0; i < normalized.length; i += limit) {
    chunks.push(normalized.slice(i, i + limit));
  }
  return chunks;
}

function buildChunks(input: {
  fileKey: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  text: string;
  maxChunks: number;
}): KiroKnowledgeChunkRecord[] {
  const parts = chunkText(input.text).slice(0, input.maxChunks);
  return parts.map((text, ordinal) => ({
    key: knowledgeChunkKey(input.fileKey, ordinal),
    fileKey: input.fileKey,
    workspaceId: input.workspaceId,
    rootId: input.rootId,
    relativePath: input.relativePath,
    ordinal,
    text,
    tokenCounts: knowledgeTokenCounts(tokenizeKnowledgeText(text)),
  }));
}

/**
 * 提取单个文件内容（当前 exact-file fs.read=allow 时调用）：
 * - text-like（≤2 MiB）→ 内容索引
 * - docx（≤2 MiB）→ Mammoth raw text 索引
 * - 其它 / 超限 → metadata-only
 */
export async function extractFileContent(input: {
  adapter: ComputerAdapterIO;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  extension: string;
  size: number;
  fileKey: string;
  maxChunksPerFile: number;
}): Promise<ExtractedFileContent> {
  const { adapter, workspaceId, rootId, relativePath, extension, size, fileKey, maxChunksPerFile } = input;
  const metadataOnly = (title?: string): ExtractedFileContent => ({
    type: "metadata",
    contentStatus: "metadata-only",
    title,
    chunks: [],
  });

  // 超限（含 PDF 等无正文支持的文件）→ metadata-only
  if (size > KIRO_KNOWLEDGE_MAX_CONTENT_BYTES) {
    return metadataOnly();
  }

  if (extension === "docx") {
    try {
      const bytes = await adapter.readBytes(relativePath);
      const { extractDocx } = await import("@/lib/ai/attachments/docx");
      const extracted = await extractDocx(
        new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })
      );
      if (!extracted.text) return metadataOnly();
      return {
        type: "docx",
        contentStatus: "indexed",
        chunks: buildChunks({ fileKey, workspaceId, rootId, relativePath, text: extracted.text, maxChunks: maxChunksPerFile }),
      };
    } catch {
      return metadataOnly();
    }
  }

  if (TEXT_LIKE_EXTENSIONS.has(extension)) {
    try {
      const text = await adapter.readText(relativePath);
      if (!text) return metadataOnly();
      return {
        type: "text",
        contentStatus: "indexed",
        chunks: buildChunks({ fileKey, workspaceId, rootId, relativePath, text, maxChunks: maxChunksPerFile }),
      };
    } catch {
      return metadataOnly();
    }
  }

  // PDF 及其它：V3 Part 1 metadata-only（禁 PDF OCR / 正文索引）
  return metadataOnly();
}
