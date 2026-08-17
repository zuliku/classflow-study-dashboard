/**
 * Kiro Web PDF Vision — 纯函数页选择（Task 19C1，Server-safe，无 Browser 依赖）。
 *
 * V1：explicit 页码（第 12 页 / 第 12-15 页 / 12页 / page 8 / pages 3-5）优先；
 * 无 explicit → 前 min(3, pageCount) 页。
 * 硬 cap：无论 explicit / default / maxPages 传多大，pages.length 恒 ≤ 3。
 * 越界页忽略；全部指定页越界 → 回退前 3 页。
 * 不做智能页面搜索（OCR / render all / LLM ranking 均不属于 V1）。
 */
import { MAX_WEB_PDF_VISION_PAGES_PER_READ } from "@/lib/ai/web/vision/limits";

/** 从用户文本识别页码表达（与 Browser 附件 Vision 同构；Server 侧自包含实现） */
export function extractWebPdfVisionPages(userText: string): { start: number; end: number }[] {
  if (!userText) return [];
  const out: { start: number; end: number }[] = [];
  const re = /(?:第\s*)?(\d{1,4})\s*(?:[-–~至到]\s*(\d{1,4}))?\s*(?:页|p(?:age)?s?\.?)/gi;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(userText)) !== null) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    out.push({ start, end: Math.max(start, end) });
  }
  const re2 = /\bpages?\s+(\d{1,4})\s*(?:[-–~至到]\s*(\d{1,4}))?\b/gi;
  re2.lastIndex = 0;
  while ((m = re2.exec(userText)) !== null) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    out.push({ start, end: Math.max(start, end) });
  }
  return out;
}

export function selectWebPdfVisionPages(input: {
  query?: string;
  pageCount: number;
  maxPages?: number;
}): { pages: number[]; truncated: boolean } {
  const pageCount = Math.max(1, input.pageCount);
  // 硬 cap：调用方 maxPages 不能绕过全局 3 页限制
  const max = Math.min(Math.max(1, input.maxPages ?? MAX_WEB_PDF_VISION_PAGES_PER_READ), MAX_WEB_PDF_VISION_PAGES_PER_READ);

  const explicit = extractWebPdfVisionPages(input.query ?? "");
  if (explicit.length > 0) {
    const pages: number[] = [];
    const seen = new Set<number>();
    let requested = 0;
    for (const r of explicit) {
      for (let p = r.start; p <= r.end; p++) {
        if (p >= 1 && p <= pageCount) requested += 1;
        if (p >= 1 && p <= pageCount && !seen.has(p)) {
          seen.add(p);
          pages.push(p);
        }
      }
    }
    if (requested === 0) {
      // 全部指定页越界：回退前 min(max, pageCount) 页
      const fallback = Array.from({ length: Math.min(pageCount, max) }, (_, i) => i + 1);
      return { pages: fallback, truncated: pageCount > max };
    }
    return { pages: pages.slice(0, max), truncated: requested > max };
  }

  const pages = Array.from({ length: Math.min(pageCount, max) }, (_, i) => i + 1);
  return { pages, truncated: pageCount > max };
}
