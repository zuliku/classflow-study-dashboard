import { ExtractedDocument, normalizeLineEndings, truncateText } from "@/lib/ai/attachments/extractors";

/**
 * DOCX 文本提取（mammoth raw text，不保留 Word 样式，只做 AI Context）。
 * V1.4：extractDocxRawText 提供 untruncated 完整正文（search_project_file 复用）；
 * extractDocx 保持 bounded extraction（100k truncate），语义不变。
 */
export async function extractDocxRawText(file: Blob): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const options = typeof window === "undefined" ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer };
  const result = await mammoth.extractRawText(options);
  return normalizeLineEndings(result.value || "").trim();
}

/** bounded extraction（沿用既有语义；search 请用 extractDocxRawText） */
export async function extractDocx(file: Blob): Promise<ExtractedDocument> {
  const normalized = await extractDocxRawText(file);
  const { text, truncated } = truncateText(normalized);
  return { text, truncated };
}
