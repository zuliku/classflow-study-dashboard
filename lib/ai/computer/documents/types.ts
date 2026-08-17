/**
 * Kiro Document IR（结构化文档中间表示）：
 * 模型生成 IR，renderer 负责产出 Markdown/DOCX 字节。
 * 模型永远不能直接提交 raw Markdown blob / HTML / OOXML / base64。
 *
 * 类型与运行时校验统一来自 documents/schema.ts（单一 Source of Truth）。
 */
export type {
  KiroInline,
  KiroDocumentBlock,
  KiroDocument,
} from "@/lib/ai/computer/documents/schema";
export { isKiroDocument } from "@/lib/ai/computer/documents/schema";
