/**
 * Kiro Vision Turn 统一二进制预算（Phase 3.4B）。
 *
 * 语义：
 * - totalLimitBytes = 一个 Turn 所有视觉二进制（用户图片 + 扫描 PDF 页面）总上限
 * - userImageBytes = 用户直接附加图片（preprocess 后）的实际字节
 * - remainingTurnBytes = totalLimit - userImageBytes（用户图片优先，不能静默丢弃）
 * - pdfBudgetBytes = min(pdfLimitBytes, remainingTurnBytes)：扫描 PDF 可用剩余额度
 * - overBudget = userImageBytes > totalLimit（此时整个 Send 必须被阻止）
 *
 * 注意：这是编码前的二进制预算（binary image bytes），不是 HTTP request
 * Content-Length；转为 data URL / Base64 后实际 JSON 请求会更大（约 4/3 膨胀）。
 */
import {
  MAX_VISION_BINARY_BYTES_PER_TURN,
  MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN,
} from "@/lib/ai/attachments/limits";

export interface VisionTurnBudget {
  totalLimitBytes: number;
  userImageBytes: number;
  remainingTurnBytes: number;
  pdfBudgetBytes: number;
  overBudget: boolean;
}

export function resolveVisionTurnBudget(input: {
  userImageBytes: number;
  totalLimitBytes?: number;
  pdfLimitBytes?: number;
}): VisionTurnBudget {
  const totalLimitBytes = input.totalLimitBytes ?? MAX_VISION_BINARY_BYTES_PER_TURN;
  const pdfLimitBytes = input.pdfLimitBytes ?? MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN;
  const userImageBytes = Math.max(0, input.userImageBytes);
  const remainingTurnBytes = Math.max(0, totalLimitBytes - userImageBytes);
  return {
    totalLimitBytes,
    userImageBytes,
    remainingTurnBytes,
    pdfBudgetBytes: Math.min(pdfLimitBytes, remainingTurnBytes),
    overBudget: userImageBytes > totalLimitBytes,
  };
}

/** 视觉二进制字节求和（File/Blob 通用） */
export function sumVisionBytes(items: readonly { size: number }[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.size), 0);
}

/** composition invariant：最终视觉二进制总字节是否在 Turn 预算内 */
export function isVisionTurnWithinBudget(totalBytes: number, totalLimitBytes?: number): boolean {
  return totalBytes <= (totalLimitBytes ?? MAX_VISION_BINARY_BYTES_PER_TURN);
}
