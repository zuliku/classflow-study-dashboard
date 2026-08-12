/**
 * Kiro Web PDF Vision — 全局预算（Task 19C1）。
 *
 * 重要：3 pages / 4 MiB 是【一次 read_web_source 调用跨所有 PDF sources 共享】，
 * 不是每个 source 3 页 + 4MiB。Rasterizer 必须接受 remainingPages / remainingBytes
 * 并强制 min(callerRemaining, hardLimit) —— 调用方不能通过 maxPages:999 / maxBytes:Infinity 绕过。
 */
export const MAX_WEB_PDF_VISION_PAGES_PER_READ = 3;
export const MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ = 4 * 1024 * 1024;
export const MAX_WEB_PDF_VISION_DIMENSION = 1600;
export const MAX_WEB_PDF_VISION_PAGE_BYTES = 1_500_000;
export const WEB_PDF_VISION_JPEG_QUALITY = 0.82;
