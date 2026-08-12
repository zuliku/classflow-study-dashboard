/**
 * Kiro Native Web PDF — 统一 page-aware evidence builder（Task 19C2）。
 *
 * 普通文字 PDF 与 Vision 转录 PDF 共用：
 *   {page,text}[] → 每页 normalize + per-page chunk（chunk 绝不跨页）→
 *   query-aware selection → source budget → availablePages（只含实际输出页）。
 *
 * Task 19B 语义保持：页码只来自 page.page（绝不 index+1 猜）；
 * availablePages 只从最终返回的 chunks 推导（未发送页面不可引用）。
 */
import {
  KiroNativeWebReadOutcome,
  KiroNativeWebReadSuccess,
} from "@/lib/ai/web/native/reader";
import {
  chunkNativeEvidence,
  selectNativeEvidenceChunks,
  normalizeNativeWebText,
} from "@/lib/ai/web/native/evidenceChunks";
import { MAX_WEB_EVIDENCE_CHARS_PER_SOURCE } from "@/lib/ai/web/types";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";

export interface PdfEvidencePage {
  page: number;
  text: string;
}

export interface KiroPdfPageEvidenceInput {
  sourceId: string;
  finalUrl: string;
  pages: PdfEvidencePage[];
  query?: string;
  truncated: boolean;
}

/** 与 pdfReader 同构：预算 cap 截断 chunk 时保留页码 */
function applyPdfEvidenceBudget(
  selected: { index: number; text: string; pageStart: number; pageEnd: number }[]
): { chunks: { text: string; pageStart: number; pageEnd: number }[]; truncated: boolean } {
  const out: { text: string; pageStart: number; pageEnd: number }[] = [];
  let total = 0;
  let truncated = false;
  for (const chunk of selected) {
    if (total + chunk.text.length <= MAX_WEB_EVIDENCE_CHARS_PER_SOURCE) {
      out.push({ text: chunk.text, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd });
      total += chunk.text.length;
      continue;
    }
    const room = MAX_WEB_EVIDENCE_CHARS_PER_SOURCE - total;
    if (room > 0) {
      out.push({ text: chunk.text.slice(0, room), pageStart: chunk.pageStart, pageEnd: chunk.pageEnd });
      total += room;
      truncated = true;
    }
    truncated = true;
  }
  return { chunks: out, truncated };
}

export function buildPdfPageEvidence(input: KiroPdfPageEvidenceInput): KiroNativeWebReadOutcome {
  const candidates: { index: number; text: string; pageStart: number; pageEnd: number }[] = [];
  let globalIndex = 0;
  let truncated = input.truncated;
  for (const page of input.pages) {
    const normalized = normalizeNativeWebText(page.text);
    if (!normalized) continue;
    const { chunks, truncated: pageTruncated } = chunkNativeEvidence(normalized);
    if (pageTruncated) truncated = true;
    for (const c of chunks) {
      candidates.push({ index: globalIndex++, text: c.text, pageStart: page.page, pageEnd: page.page });
    }
  }

  const { selected, truncated: selectionTruncated } = selectNativeEvidenceChunks(candidates, input.query);
  if (selectionTruncated) truncated = true;
  const { chunks: finalChunks, truncated: budgetTruncated } = applyPdfEvidenceBudget(selected);
  if (budgetTruncated) truncated = true;

  if (finalChunks.length === 0) return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };

  const pages = new Set<number>();
  for (const c of finalChunks) {
    for (let p = c.pageStart; p <= c.pageEnd; p++) pages.add(p);
  }
  const availablePages = Array.from(pages).sort((a, b) => a - b);

  debugKiroWebRead("pdf-read-ok", {
    sourceId: input.sourceId,
    chunks: finalChunks.length,
    chars: finalChunks.reduce((s, c) => s + c.text.length, 0),
    pages: availablePages.join(","),
    truncated,
  });

  const success: KiroNativeWebReadSuccess = {
    ok: true,
    sourceId: input.sourceId,
    finalUrl: input.finalUrl,
    availablePages,
    chunks: finalChunks.map((c) => ({ text: c.text, pageStart: c.pageStart, pageEnd: c.pageEnd })),
    truncated,
  };
  return success;
}
