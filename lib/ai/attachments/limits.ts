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

/** 提取器版本（缓存失效用） */
export const EXTRACTOR_VERSION = 1;
