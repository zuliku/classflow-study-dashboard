/**
 * Kiro Web PDF Vision — 扫描 PDF Runtime（Task 19C2）。
 *
 * 职责 ONLY：scanned PDF bytes → 共享预算页选择 → rasterize → Vision 转录 → 统一 PDF evidence。
 *
 * 预算语义（一次 read_web_source 跨所有 PDF sources 共享）：
 * - 3 pages / 4 MiB 硬上限，调用方不能绕过
 * - page selection + rasterization + budget deduction 位于 async-exclusive section
 *   （并发 sources 各自看到真实 remaining，不会双双读到 3/4MiB）
 * - Vision transcription 在锁外（另一 scanned source 可并行 rasterize；HTML/text PDF 不受影响）
 *
 * 任何普通 Vision 失败（disabled / missing key / model unavailable / provider error /
 * rasterize fail / 空转录）→ 统一内部映射 WEB_NATIVE_PDF_SCANNED（Evidence Runtime 自动
 * Tavily fallback）。不向公共错误枚举暴露 Vision codes。
 */
import {
  selectWebPdfVisionPages,
} from "@/lib/ai/web/vision/pageSelection";
import {
  rasterizeWebPdfPages,
  KiroRasterizedWebPdfPage,
} from "@/lib/ai/web/native/pdfVisionRasterizer";
import {
  extractWebPdfVisionPages,
  KiroWebPdfVisionExtractorDeps,
} from "@/lib/ai/web/vision/extractor";
import { buildPdfPageEvidence } from "@/lib/ai/web/native/pdfEvidence";
import { KiroNativeWebReadOutcome } from "@/lib/ai/web/native/reader";
import {
  MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ,
  MAX_WEB_PDF_VISION_PAGES_PER_READ,
} from "@/lib/ai/web/vision/limits";

export interface KiroWebPdfVisionRuntimeConfig {
  enabled: boolean;
  model: string;
  apiKey?: string;
}

export interface KiroScannedWebPdfEvidenceInput {
  sourceId: string;
  bytes: Uint8Array;
  pageCount: number;
  finalUrl: string;
  query?: string;
  signal?: AbortSignal;
}

export interface KiroWebPdfVisionRuntimeDeps {
  rasterize?: typeof rasterizeWebPdfPages;
  extract?: typeof extractWebPdfVisionPages;
  extractorDeps?: KiroWebPdfVisionExtractorDeps;
}

interface RasterizedBudgetResult {
  pages: { page: number; size: number }[];
  truncated: boolean;
}

export interface KiroWebPdfVisionBudget {
  /** async-exclusive：fn 内看到真实 remaining；完成后按实际 rasterized 页/bytes 扣减再释放锁 */
  runRasterizationExclusive<T extends RasterizedBudgetResult>(
    fn: (remaining: { pages: number; bytes: number }) => Promise<T>
  ): Promise<T>;
  remaining(): { pages: number; bytes: number };
}

/** 一次 read_web_source 一个共享 budget（跨所有 PDF sources） */
export function createWebPdfVisionBudget(): KiroWebPdfVisionBudget {
  let pagesRemaining = MAX_WEB_PDF_VISION_PAGES_PER_READ;
  let bytesRemaining = MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ;
  let chain: Promise<unknown> = Promise.resolve();

  return {
    runRasterizationExclusive<T extends RasterizedBudgetResult>(fn: (remaining: { pages: number; bytes: number }) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const result = await fn({ pages: pagesRemaining, bytes: bytesRemaining });
        const usedPages = Array.isArray(result.pages) ? result.pages.length : 0;
        const usedBytes = Array.isArray(result.pages) ? result.pages.reduce((s, p) => s + p.size, 0) : 0;
        pagesRemaining = Math.max(0, pagesRemaining - usedPages);
        bytesRemaining = Math.max(0, bytesRemaining - usedBytes);
        return result;
      });
      // 单次 fn 失败不阻塞后续排队（错误仍向调用方传播）
      chain = run.catch(() => undefined);
      return run;
    },
    remaining: () => ({ pages: pagesRemaining, bytes: bytesRemaining }),
  };
}

/**
 * 扫描 PDF → Vision evidence：
 * enabled/key/budget 任一不可用 → WEB_NATIVE_PDF_SCANNED（不调用模型）。
 */
export async function readScannedWebPdfEvidence(
  input: KiroScannedWebPdfEvidenceInput,
  config: KiroWebPdfVisionRuntimeConfig,
  budget: KiroWebPdfVisionBudget,
  deps?: KiroWebPdfVisionRuntimeDeps
): Promise<KiroNativeWebReadOutcome> {
  const scannedFailure = (): KiroNativeWebReadOutcome => ({ ok: false, code: "WEB_NATIVE_PDF_SCANNED" });

  if (!config.enabled) return scannedFailure();
  const apiKey = (config.apiKey ?? "").trim();
  if (!apiKey) return scannedFailure();
  const remaining = budget.remaining();
  if (remaining.pages <= 0 || remaining.bytes <= 0) return scannedFailure();

  const rasterize = deps?.rasterize ?? rasterizeWebPdfPages;
  const extract = deps?.extract ?? extractWebPdfVisionPages;

  // ---- 原子区：page selection + rasterization + budget deduction ----
  const rasterized = await budget.runRasterizationExclusive(async (rem) => {
    const { pages: pageNumbers, truncated: selTruncated } = selectWebPdfVisionPages({
      query: input.query,
      pageCount: input.pageCount,
      maxPages: rem.pages,
    });
    if (pageNumbers.length === 0) return { pages: [], truncated: selTruncated };
    const out = await rasterize({
      bytes: input.bytes,
      pageNumbers,
      remainingPages: rem.pages,
      remainingBytes: rem.bytes,
    });
    if (!out.ok || out.pages.length === 0) return { pages: [], truncated: selTruncated };
    return { pages: out.pages, truncated: selTruncated || out.truncated };
  });
  if (rasterized.pages.length === 0) return scannedFailure();

  // ---- Vision transcription（锁外） ----
  const extracted = await extract(
    rasterized.pages,
    input.query,
    { model: config.model, apiKey, signal: input.signal },
    deps?.extractorDeps
  );
  if (!extracted.ok || extracted.pages.length === 0) return scannedFailure();

  return buildPdfPageEvidence({
    sourceId: input.sourceId,
    finalUrl: input.finalUrl,
    pages: extracted.pages.map((p) => ({ page: p.page, text: p.text })),
    query: input.query,
    truncated: rasterized.truncated,
  });
}

export type { KiroRasterizedWebPdfPage };
