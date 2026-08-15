/**
 * Kiro Vision Turn Runtime Ledger（V1.3B）：
 * 一个逻辑 User Turn 内，direct user images + scanned attachment pages +
 * Project images + Project scanned PDF pages 共享同一份预算。
 *
 * 初始化（Send boundary）：由已实际准备的 preparedImageFiles / pageFiles 物化
 * - totalBytesRemaining = MAX_VISION_BINARY_BYTES_PER_TURN - initialUserImageBytes - initialPdfBytes
 * - pdfBytesRemaining    = min(MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN, total) - initialPdfBytes
 * - pdfPagesRemaining    = MAX_SCANNED_PDF_PAGES_PER_TURN - initialPdfPages
 *
 * 并发语义（async-exclusive）：
 * - reserveImageExclusive / runPdfRasterizationExclusive 串行化；并发调用各自看到真实 remaining
 * - PDF 在 exclusive 区内完成 page selection + rasterize，按实际 rendered pages/bytes 扣减
 * - Vision 转录在锁外执行（另一 visual call 可并行）
 *
 * Conservative accounting：
 * - 只要 payload 已准备并开始提交 extraction request，即使 Provider 失败也不 refund
 * - 失败发生在 reservation 之前（Blob 缺失 / capability gate / MIME gate / preprocess fail）不消耗
 * - 只活在 useKiroChat runtime ref，绝不进入 request body / History / IndexedDB / Memory
 */
import {
  MAX_VISION_BINARY_BYTES_PER_TURN,
  MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN,
  MAX_SCANNED_PDF_PAGES_PER_TURN,
} from "@/lib/ai/attachments/limits";

export interface VisionTurnRuntimeRemaining {
  totalBytes: number;
  pdfBytes: number;
  pdfPages: number;
}

export interface VisionTurnRuntimeLedger {
  remaining(): VisionTurnRuntimeRemaining;
  /** image：exclusive 保留 totalBytes；足够 → true（立即扣减，绝不 refund），否则 false */
  reserveImageExclusive(bytes: number): Promise<boolean>;
  /** PDF：exclusive 区内选择页 + rasterize；完成后按实际 rendered pages/bytes 扣减 total/pdf */
  runPdfRasterizationExclusive<T extends { pages: { size: number }[] }>(
    fn: (remaining: VisionTurnRuntimeRemaining) => Promise<T>
  ): Promise<T>;
}

export function createVisionTurnRuntimeBudget(input: {
  initialUserImageBytes?: number;
  initialPdfBytes?: number;
  initialPdfPages?: number;
  totalLimitBytes?: number;
  pdfLimitBytes?: number;
  pdfPageLimit?: number;
}): VisionTurnRuntimeLedger {
  const totalLimit = input.totalLimitBytes ?? MAX_VISION_BINARY_BYTES_PER_TURN;
  const pdfLimit = input.pdfLimitBytes ?? MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN;
  const pageLimit = input.pdfPageLimit ?? MAX_SCANNED_PDF_PAGES_PER_TURN;
  const initialUserImageBytes = Math.max(0, input.initialUserImageBytes ?? 0);
  const initialPdfBytes = Math.max(0, input.initialPdfBytes ?? 0);
  const initialPdfPages = Math.max(0, input.initialPdfPages ?? 0);

  let totalBytesRemaining = Math.max(0, totalLimit - initialUserImageBytes - initialPdfBytes);
  let pdfBytesRemaining = Math.max(0, Math.min(pdfLimit, totalLimit - initialUserImageBytes) - initialPdfBytes);
  let pdfPagesRemaining = Math.max(0, pageLimit - initialPdfPages);
  let chain: Promise<unknown> = Promise.resolve();

  return {
    remaining: () => ({ totalBytes: totalBytesRemaining, pdfBytes: pdfBytesRemaining, pdfPages: pdfPagesRemaining }),

    reserveImageExclusive(bytes: number): Promise<boolean> {
      const run = chain.then(() => {
        if (bytes <= 0) return true;
        if (totalBytesRemaining < bytes) return false;
        totalBytesRemaining -= bytes;
        return true;
      });
      chain = run.catch(() => undefined);
      return run;
    },

    runPdfRasterizationExclusive<T extends { pages: { size: number }[] }>(
      fn: (remaining: VisionTurnRuntimeRemaining) => Promise<T>
    ): Promise<T> {
      const run = chain.then(async () => {
        const result = await fn({ totalBytes: totalBytesRemaining, pdfBytes: pdfBytesRemaining, pdfPages: pdfPagesRemaining });
        const usedPages = Array.isArray(result.pages) ? result.pages.length : 0;
        const usedBytes = Array.isArray(result.pages)
          ? result.pages.reduce((sum, p) => sum + Math.max(0, p.size), 0)
          : 0;
        totalBytesRemaining = Math.max(0, totalBytesRemaining - usedBytes);
        pdfBytesRemaining = Math.max(0, pdfBytesRemaining - usedBytes);
        pdfPagesRemaining = Math.max(0, pdfPagesRemaining - usedPages);
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
