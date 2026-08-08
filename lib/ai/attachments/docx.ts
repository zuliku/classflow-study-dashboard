import { ExtractedDocument, normalizeLineEndings, truncateText } from "@/lib/ai/attachments/extractors";

/**
 * DOCX 文本提取（mammoth raw text，不保留 Word 样式，只做 AI Context）。
 */
export async function extractDocx(file: Blob): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const options = typeof window === "undefined" ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer };
  const result = await mammoth.extractRawText(options);
  const normalized = normalizeLineEndings(result.value || "").trim();
  const { text, truncated } = truncateText(normalized);
  return { text, truncated };
}
