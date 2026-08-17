/**
 * 图片 MIME 统一解析（Phase 3.3C）。
 * 只覆盖 ClassFlow Attachment Router 已开放的三种格式：JPEG / PNG / WEBP。
 * 不支持 gif / svg / bmp / avif（Router 未开放，即使上游支持也不猜测）。
 */

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const STANDARD_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * 解析真实图片 MIME：
 * - mimeType 为标准值（image/jpeg | image/png | image/webp）→ 原样返回
 * - mimeType 为空/未知时按扩展名有限兜底（.jpg/.jpeg/.png/.webp）
 * - 其余 → undefined
 * 扩展名只负责解析真实 MIME；是否允许最终由模型 visionMimeTypes whitelist 决定。
 */
export function resolveImageMimeType(input: { mimeType?: string; fileName?: string }): string | undefined {
  const t = (input.mimeType ?? "").trim().toLowerCase();
  if (STANDARD_MIMES.has(t)) return t;
  const name = (input.fileName ?? "").trim().toLowerCase();
  if (!name) return undefined;
  for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
    if (name.endsWith(ext)) return mime;
  }
  return undefined;
}

/**
 * visionMimeTypes → 人类可读格式列表（Toast 用），如
 * ["image/jpeg","image/png","image/webp"] → "JPG / PNG / WEBP"
 * 未知 MIME 保持原样；空/undefined → ""。
 */
export function formatVisionMimeTypes(visionMimeTypes: string[] | undefined): string {
  if (!visionMimeTypes || visionMimeTypes.length === 0) return "";
  const label: Record<string, string> = {
    "image/jpeg": "JPG",
    "image/png": "PNG",
    "image/webp": "WEBP",
  };
  return visionMimeTypes.map((m) => label[m] ?? m).join(" / ");
}
