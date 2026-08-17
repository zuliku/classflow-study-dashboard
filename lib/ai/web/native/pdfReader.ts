/**
 * Task 19B/19C2：Kiro Native Web PDF Reader。
 *
 * 职责 ONLY：safeWebFetchPdf → extractPdf → 分页文本 → buildPdfPageEvidence（统一 evidence 管线）。
 * 不包含：Evidence Runtime / Tool / Citation Registry。
 *
 * 安全：只消费 safeWebFetchPdf（Task 19A 全部安全边界保留）。
 * PDF bytes 全程内存内（Blob），不写临时文件。
 *
 * 页码信任边界：页码只来自 extractor 的 page.page（绝不 index+1 猜）；availablePages =
 * 本次实际输出 chunks 覆盖的页面（未发送的页面不可引用）。
 *
 * Task 19C2：possiblyScanned 时若注入 scannedRuntime（Vision runtime）则走 Vision；
 * 否则保持 WEB_NATIVE_PDF_SCANNED（Evidence Runtime 自动 Tavily fallback）。
 */
import { safeWebFetchPdf } from "@/lib/ai/web/native/safeFetch";
import { extractPdf } from "@/lib/ai/attachments/pdf";
import {
  KiroNativeWebReadRequest,
  KiroNativeWebReadOutcome,
  mapSafeFetchFailure,
} from "@/lib/ai/web/native/reader";
import { buildPdfPageEvidence } from "@/lib/ai/web/native/pdfEvidence";
import {
  readScannedWebPdfEvidence,
  KiroWebPdfVisionRuntimeConfig,
  KiroWebPdfVisionBudget,
  KiroWebPdfVisionRuntimeDeps,
} from "@/lib/ai/web/vision/runtime";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";

export interface KiroNativeWebPdfReaderDeps {
  /** 生产 = safeWebFetchPdf；测试 = fake（不得真实联网） */
  fetcher?: typeof safeWebFetchPdf;
  /** 生产 = extractPdf（pdf.js）；测试 = fake */
  extractor?: typeof extractPdf;
  /** Task 19C2：扫描 PDF Vision（一次 read_web_source 共享一个 budget；未注入 → WEB_NATIVE_PDF_SCANNED） */
  vision?: {
    config: KiroWebPdfVisionRuntimeConfig;
    budget: KiroWebPdfVisionBudget;
    runtimeDeps?: KiroWebPdfVisionRuntimeDeps;
  };
}

/**
 * 主函数：safeWebFetchPdf → Blob → extractPdf → buildPdfPageEvidence（统一管线）。
 * 扫描 PDF → 注入的 Vision runtime；无 runtime → WEB_NATIVE_PDF_SCANNED。
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

  // 扫描型 PDF：无文本层（Task 19C2：注入 Vision 时走 Vision；否则保持独立 code 供 Tavily fallback）
  if (extracted.possiblyScanned) {
    debugKiroWebRead("pdf-scanned", { sourceId: request.sourceId, host: hostOf(request.url) });
    if (deps?.vision && extracted.pageCount) {
      return readScannedWebPdfEvidence(
        {
          sourceId: request.sourceId,
          bytes: fetchResult.bytes,
          pageCount: extracted.pageCount,
          finalUrl: fetchResult.finalUrl,
          query: request.query,
          signal: request.signal,
        },
        deps.vision.config,
        deps.vision.budget,
        deps.vision.runtimeDeps
      );
    }
    return { ok: false, code: "WEB_NATIVE_PDF_SCANNED" };
  }
  if (!extracted.pages || extracted.pages.length === 0) {
    return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };
  }

  return buildPdfPageEvidence({
    sourceId: request.sourceId,
    finalUrl: fetchResult.finalUrl,
    pages: extracted.pages.map((p) => ({ page: p.page, text: p.text })),
    query: request.query,
    truncated: extracted.truncated,
  });
}

/** 诊断用 hostname */
function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}
