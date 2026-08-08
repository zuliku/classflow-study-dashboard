import { MAX_EXTRACTED_CHARS } from "@/lib/ai/attachments/limits";

export interface ExtractedDocument {
  text: string;
  pages?: { page: number; text: string }[];
  truncated: boolean;
}

/** 截断到上限并标记（不静默） */
export function truncateText(text: string, max = MAX_EXTRACTED_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

/** 统一换行（\r\n / \r → \n） */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** TXT / MD：直接读文本（UTF-8），归一化换行 + 截断 */
export async function extractTextFile(file: Blob): Promise<ExtractedDocument> {
  const raw = await file.text();
  const normalized = normalizeLineEndings(raw).trim();
  const { text, truncated } = truncateText(normalized);
  return { text, truncated };
}

/** 按页码截断：优先保留前面的页 */
export function truncateWithPages(
  pages: { page: number; text: string }[],
  max = MAX_EXTRACTED_CHARS
): { pages: { page: number; text: string }[]; text: string; truncated: boolean } {
  const out: { page: number; text: string }[] = [];
  let total = 0;
  let truncated = false;
  for (const p of pages) {
    if (total + p.text.length > max) {
      truncated = true;
      break;
    }
    out.push(p);
    total += p.text.length;
  }
  return {
    pages: out,
    text: out.map((p) => p.text).join("\n\n"),
    truncated,
  };
}
