/**
 * Task 7C：Kiro 输出排版纯配置（最小测试 seam）。
 * 只控制 Assistant Markdown 输出字号；不影响 User Message / Composer / Card / Rail。
 * 离散三档，不做 slider：small=14px / standard=15px / large=17px。
 */

export type KiroOutputTextSize = "small" | "standard" | "large";

export const KIRO_OUTPUT_FONT_SIZE_PX: Record<KiroOutputTextSize, number> = {
  small: 14,
  standard: 15,
  large: 17,
};

export const KIRO_OUTPUT_TEXT_SIZE_LABELS: Record<KiroOutputTextSize, string> = {
  small: "小",
  standard: "标准",
  large: "大",
};

export function getKiroOutputFontSize(size: KiroOutputTextSize): number {
  return KIRO_OUTPUT_FONT_SIZE_PX[size];
}

/** 持久化 / 未知值清洗：非法回退 standard（旧数据 / 迁移安全） */
export function normalizeKiroOutputTextSize(value: unknown): KiroOutputTextSize {
  return value === "small" || value === "large" ? value : "standard";
}
