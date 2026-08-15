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

/** 重型本地文档读取（read_material + read_project_file 共享）单回合上限 */
export const MAX_DOCUMENT_READS_PER_TURN = 5;

/** @deprecated 兼容别名：重型文档读取统一使用 MAX_DOCUMENT_READS_PER_TURN */
export const MAX_MATERIAL_READS_PER_TURN = MAX_DOCUMENT_READS_PER_TURN;

/** 提取器版本（缓存失效用）：v3 起缓存真实 truncated 状态（绝不从 text.length 推导） */
export const EXTRACTOR_VERSION = 3;

// ---- V1.4：Project File 本地词法检索 / PDF 定向页读取 ----

/** 单个命中 snippet 上限（围绕匹配位置：前 ~400 + 匹配区 + 后 ~700） */
export const MAX_PROJECT_SEARCH_SNIPPET_CHARS = 1200;

/** 单次 search_project_file 最多返回命中数 */
export const MAX_PROJECT_SEARCH_RESULTS = 8;

/** search_project_file 总输出字符预算（即使 8 hits × 1200 也须经过总预算） */
export const MAX_PROJECT_SEARCH_TOTAL_CHARS = 8_000;

/** read_project_file(pages) 单次最多 PDF 页数 */
export const MAX_PROJECT_PDF_TEXT_PAGES_PER_READ = 8;

/** read_project_file(pages) 定向正文总字符预算（单页超限时保留该页前段并标 truncated） */
export const MAX_PROJECT_TARGETED_TEXT_CHARS = 30_000;

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

/**
 * 一个 Kiro Turn 所有视觉二进制（用户图片 + 扫描 PDF 页面）总上限（Phase 3.4B）。
 * 注意：这是编码前的 binary image bytes，不是 HTTP request Content-Length；
 * 转为 data URL / Base64 后实际 JSON 请求会更大（约 4/3 膨胀）。
 * 双层约束：PDF 子预算 8 MiB（下方常量）+ 全 Turn 10 MiB。
 */
export const MAX_VISION_BINARY_BYTES_PER_TURN = 10 * 1024 * 1024;

// ---- Phase 3.4A：用户直接附加图片的 Send-time 预处理限制 ----
// 与扫描 PDF Vision 是两套独立业务预算，各自独立调优，不复用。

/** 用户图片发送前最长边（px）：超出则等比缩小（禁止 upscale / crop） */
export const MAX_USER_VISION_DIMENSION = 2048;

/** 单张用户图片发送体积上限（字节）：超出则 canvas 重编码收敛 */
export const MAX_USER_VISION_IMAGE_BYTES = 2 * 1024 * 1024;

/** JPEG 重编码质量（首次尝试） */
export const USER_VISION_JPEG_QUALITY = 0.86;

/** WEBP 重编码质量（首次尝试） */
export const USER_VISION_WEBP_QUALITY = 0.86;
