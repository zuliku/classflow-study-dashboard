/**
 * Task 19B：Kiro Native Web PDF Reader。
 *
 * 职责 ONLY：safeWebFetchPdf → extractPdf → 分页文本 → query-aware page/chunk selection。
 * 不包含：Evidence Runtime / Tool / Citation Registry。
 *
 * 安全：只消费 safeWebFetchPdf（Task 19A 全部安全边界保留：SSRF / pinned IP / failover /
 * redirect 重验证 / application/pdf 白名单 / %PDF- signature / 8MB+10MB 预算）。
 * PDF bytes 全程内存内（Blob），不写临时文件。
 *
 * 页码信任边界：页码只来自 extractor 的 page.page（绝不 index+1 猜）；availablePages =
 * 本次实际输出 chunks 覆盖的页面（未发送的页面不可引用）。
 */
import { safeWebFetchPdf } from "@/lib/ai/web/native/safeFetch";
import { extractPdf } from "@/lib/ai/attachments/pdf";
import {
  KiroNativeWebReadRequest,
  KiroNativeWebReadOutcome,
  KiroNativeWebReadSuccess,
  mapSafeFetchFailure,
} from "@/lib/ai/web/native/reader";
import {
  NativeEvidenceChunk,
  chunkNativeEvidence,
  selectNativeEvidenceChunks,
  normalizeNativeWebText,
} from "@/lib/ai/web/native/evidenceChunks";
import { MAX_WEB_EVIDENCE_CHARS_PER_SOURCE } from "@/lib/ai/web/types";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";

export interface KiroNativeWebPdfReaderDeps {
  /** 生产 = safeWebFetchPdf；测试 = fake（不得真实联网） */
  fetcher?: typeof safeWebFetchPdf;
  /** 生产 = extractPdf（pdf.js）；测试 = fake */
  extractor?: typeof extractPdf;
}

/** 带页码的 Evidence Candidate（document index 全局重排，页码来自 extractor） */
export interface PdfEvidenceCandidate extends NativeEvidenceChunk {
  pageStart: number;
  pageEnd: number;
}

/**
 * Source budget cap（PDF 版）：与 applyNativeEvidenceBudget 相同，但截断 chunk 时保留 pageStart/pageEnd
 * （被截断的 700 chars 仍完全来自第 12 页 → pageStart:12 / pageEnd:12）。
 */
export function applyPdfEvidenceBudget(
  selected: PdfEvidenceCandidate[]
): { chunks: PdfEvidenceCandidate[]; truncated: boolean } {
  const out: PdfEvidenceCandidate[] = [];
  let total = 0;
  let truncated = false;
  for (const chunk of selected) {
    if (total + chunk.text.length <= MAX_WEB_EVIDENCE_CHARS_PER_SOURCE) {
      out.push(chunk);
      total += chunk.text.length;
      continue;
    }
    const room = MAX_WEB_EVIDENCE_CHARS_PER_SOURCE - total;
    if (room > 0) {
      out.push({ index: chunk.index, text: chunk.text.slice(0, room), pageStart: chunk.pageStart, pageEnd: chunk.pageEnd });
      total += room;
      truncated = true;
    }
    truncated = true;
  }
  return { chunks: out, truncated };
}

/**
 * 主函数：safeWebFetchPdf → Blob → extractPdf → 每页 normalize+chunk（页码映射不丢失）→
 * query-aware selection → budget → availablePages（只含实际输出页面）。
 */
export async function readNativeWebPdfSource(
  request: KiroNativeWebReadRequest,
  deps?: KiroNativeWebPdfReaderDeps
): Promise<KiroNativeWebReadOutcome> {
  const fetcher = deps?.fetcher ?? safeWebFetchPdf;
  const extractor = deps?.extractor ?? extractPdf;

  const fetchResult = await fetcher({ url: request.url, sourceId: request.sourceId, signal: request.signal });
  if (!fetchResult.ok) {
    // 与 HTML Reader 相同安全语义：policy blocked 绝不 fallback；unsupported/too-large 允许
    return { ok: false, code: mapSafeFetchFailure(fetchResult.code) };
  }

  let extracted: Awaited<ReturnType<typeof extractPdf>>;
  try {
    extracted = await extractor(new Blob([Buffer.from(fetchResult.bytes)], { type: "application/pdf" }));
  } catch {
    debugKiroWebRead("pdf-parse-failed", { sourceId: request.sourceId, host: hostOf(request.url) });
    return { ok: false, code: "WEB_NATIVE_PARSE_FAILED" }; // malformed PDF：不 500
  }

  // 扫描型 PDF：无文本层（本 Task 不做 Vision/OCR；独立 code 供未来分支）
  if (extracted.possiblyScanned) {
    debugKiroWebRead("pdf-scanned", { sourceId: request.sourceId, host: hostOf(request.url) });
    return { ok: false, code: "WEB_NATIVE_PDF_SCANNED" };
  }
  if (!extracted.pages || extracted.pages.length === 0) {
    return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };
  }

  // 每页独立 normalize + chunk（不先 concat 再切，否则页码映射丢失）；页码只信 extractor
  const candidates: PdfEvidenceCandidate[] = [];
  let globalIndex = 0;
  let truncated = extracted.truncated;
  for (const page of extracted.pages) {
    const normalized = normalizeNativeWebText(page.text);
    if (!normalized) continue;
    const { chunks, truncated: pageTruncated } = chunkNativeEvidence(normalized);
    if (pageTruncated) truncated = true;
    for (const c of chunks) {
      candidates.push({
        index: globalIndex++,
        text: c.text,
        pageStart: page.page,
        pageEnd: page.page,
      });
    }
  }

  const { selected, truncated: selectionTruncated } = selectNativeEvidenceChunks(candidates, request.query);
  if (selectionTruncated) truncated = true;
  const { chunks: finalChunks, truncated: budgetTruncated } = applyPdfEvidenceBudget(selected);
  if (budgetTruncated) truncated = true;

  if (finalChunks.length === 0) return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };

  // availablePages：只含实际输出 chunks 覆盖的页面（Citation Trust Boundary）
  const pages = new Set<number>();
  for (const c of finalChunks) {
    for (let p = c.pageStart; p <= c.pageEnd; p++) pages.add(p);
  }
  const availablePages = Array.from(pages).sort((a, b) => a - b);

  debugKiroWebRead("pdf-read-ok", {
    sourceId: request.sourceId,
    host: hostOf(request.url),
    chunks: finalChunks.length,
    chars: finalChunks.reduce((s, c) => s + c.text.length, 0),
    pages: availablePages.join(","),
    truncated,
  });

  const success: KiroNativeWebReadSuccess = {
    ok: true,
    sourceId: request.sourceId,
    finalUrl: fetchResult.finalUrl,
    availablePages,
    chunks: finalChunks.map((c) => ({ text: c.text, pageStart: c.pageStart, pageEnd: c.pageEnd })),
    truncated,
  };
  return success;
}

/** 诊断用 hostname */
function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}
