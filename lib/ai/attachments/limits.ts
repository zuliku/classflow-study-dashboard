/** 附件限制（第一版） */

/** 每个 user turn 最多附件数 */
export const MAX_ATTACHMENTS_PER_TURN = 5;

/** 单文件大小限制（MB） */
export const SIZE_LIMITS: Record<string, number> = {
  pdf: 20 * 1024 * 1024,
  docx: 20 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  image: 10 * 1024 * 1024,
};

/** 单附件提取文本上限（超长截断并标记） */
export const MAX_EXTRACTED_CHARS = 100_000;

/** 当前 Turn 附件总文本上限 */
export const MAX_ATTACHMENT_CONTEXT_CHARS = 160_000;

/** read_material 单回合调用上限（重量级工具单独限制） */
export const MAX_MATERIAL_READS_PER_TURN = 5;

/** 提取器版本（缓存失效用）：v2 起缓存 pageCount / possiblyScanned（扫描件标记不可丢失） */
export const EXTRACTOR_VERSION = 2;

// ---- Task 12：扫描 PDF Vision fallback 限制 ----

/** 每个 Turn 最多发送的扫描 PDF 页面图像数 */
export const MAX_SCANNED_PDF_PAGES_PER_TURN = 6;

/** 渲染最长边（px）：避免超大图 */
export const MAX_PDF_VISION_DIMENSION = 1600;

/** 单页 JPEG 体积上限（超出降一次尺寸/质量） */
export const MAX_RENDERED_PAGE_BYTES = 1_500_000;

/** 整个 Turn 扫描 PDF 图像总字节上限（ClassFlow 自身防护预算） */
export const MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN = 8 * 1024 * 1024;

/** JPEG 质量 */
export const PDF_VISION_JPEG_QUALITY = 0.82;
