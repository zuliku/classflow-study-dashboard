/**
 * 用户图片 Send-time 预处理（Phase 3.4A）。
 *
 * 原则：
 * - Original File 永远不变（attachment.file / Save to Course 使用原图）
 * - Send File 只活在当前 Turn，只进入 DataTransfer / useChat
 * - 小图（尺寸与体积都达标）不做像素重编码，只做 MIME normalization
 * - 需要处理时保持 MIME（JPEG→JPEG / WEBP→WEBP / PNG→PNG），不做跨格式转码
 * - bounded / deterministic 收敛，禁止无限循环
 * - 不做 EXIF 手写解析（浏览器 Image decode 结果为准）
 */
import {
  MAX_USER_VISION_DIMENSION,
  MAX_USER_VISION_IMAGE_BYTES,
  USER_VISION_JPEG_QUALITY,
  USER_VISION_WEBP_QUALITY,
} from "@/lib/ai/attachments/limits";
import { resolveImageMimeType } from "@/lib/ai/attachments/imageMime";

export class VisionImagePreprocessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionImagePreprocessError";
  }
}

export interface PreparedVisionImage {
  file: File;
  originalSize: number;
  outputSize: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  resized: boolean;
  reencoded: boolean;
}

/** 等比包含缩放（禁止 upscale；4032×3024 + 2048 → 2048×1536） */
export function calculateContainedImageSize(input: {
  width: number;
  height: number;
  maxDimension: number;
}): { width: number; height: number } {
  const { width, height, maxDimension } = input;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || maxDimension <= 0) {
    return { width: Math.max(1, Math.round(width || 1)), height: Math.max(1, Math.round(height || 1)) };
  }
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 是否需要像素级处理（尺寸或体积任一超限） */
export function needsVisionImagePreprocess(input: {
  width: number;
  height: number;
  size: number;
  maxDimension: number;
  maxBytes: number;
}): boolean {
  return Math.max(input.width, input.height) > input.maxDimension || input.size > input.maxBytes;
}

export interface VisionEncodeAttempt {
  /** 相对当前（已包含到 maxDimension 的）画布的缩放系数 */
  scale: number;
  /** 有损格式质量；PNG 忽略 */
  quality: number;
}

export interface VisionEncodePlan {
  targetMime: string;
  /** 第一个 attempt 使用包含尺寸；后续 attempt 逐级缩小 */
  attempts: VisionEncodeAttempt[];
}

/**
 * 确定性 / bounded 编码计划（最多 3 次）：
 * - JPEG / WEBP：首次质量 .86，第二次 scale .85 + quality .78，第三次 scale .85 + quality .72
 * - PNG：无损（无质量参数），scale 1.0 → .82 → .82
 */
export function visionEncodePlan(input: { mime: string }): VisionEncodePlan {
  if (input.mime === "image/png") {
    return {
      targetMime: "image/png",
      attempts: [
        { scale: 1, quality: 0 },
        { scale: 0.82, quality: 0 },
        { scale: 0.82, quality: 0 },
      ],
    };
  }
  // JPEG / WEBP（有损收敛）
  return {
    targetMime: input.mime,
    attempts: [
      { scale: 1, quality: input.mime === "image/webp" ? USER_VISION_WEBP_QUALITY : USER_VISION_JPEG_QUALITY },
      { scale: 0.85, quality: 0.78 },
      { scale: 0.85, quality: 0.72 },
    ],
  };
}

/** 解码器注入点（node 单测用；浏览器默认走 Image + object URL） */
export type VisionImageDimensionsProvider = (file: File) => Promise<{ width: number; height: number }>;

/** 浏览器默认解码：Image + URL.createObjectURL（保证 revoke） */
export const decodeVisionImageDimensions: VisionImageDimensionsProvider = async (file) => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new VisionImagePreprocessError("图片解码失败"));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** 浏览器默认编码：canvas.toBlob（仅浏览器环境调用） */
export function encodeVisionImageBlob(input: {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  quality: number;
}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = input.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new VisionImagePreprocessError("Canvas 不可用"));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(input.blob);
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, input.width, input.height);
        const quality = input.mime === "image/png" ? undefined : input.quality;
        canvas.toBlob(
          (blob) => {
            canvas.width = 0;
            canvas.height = 0;
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new VisionImagePreprocessError("图片编码失败"));
              return;
            }
            resolve(blob);
          },
          input.mime,
          quality
        );
      } catch (err) {
        canvas.width = 0;
        canvas.height = 0;
        URL.revokeObjectURL(url);
        reject(err instanceof VisionImagePreprocessError ? err : new VisionImagePreprocessError("图片编码失败"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new VisionImagePreprocessError("图片解码失败"));
    };
    img.src = url;
  });
}

/**
 * Send-time 预处理入口：
 * 1. MIME 统一（复用 resolveImageMimeType；未知 → 失败）
 * 2. 尺寸/体积都达标 → 只包装 File 修正 MIME，不重编码
 * 3. 需要处理 → canvas 等比包含 + 保 MIME 编码，bounded 收敛
 * 失败（decode / canvas / toBlob / 收敛后仍超限）→ throw，调用方必须阻止 Send。
 */
export async function preprocessVisionImage(
  file: File,
  opts?: { getDimensions?: VisionImageDimensionsProvider }
): Promise<PreparedVisionImage> {
  const mime = resolveImageMimeType({ mimeType: file.type, fileName: file.name });
  if (!mime) {
    throw new VisionImagePreprocessError("不支持的图片格式");
  }
  const getDimensions = opts?.getDimensions ?? decodeVisionImageDimensions;
  let dimensions: { width: number; height: number };
  try {
    dimensions = await getDimensions(file);
  } catch (err) {
    throw err instanceof VisionImagePreprocessError ? err : new VisionImagePreprocessError("图片解码失败");
  }
  const { width, height } = dimensions;

  const needs = needsVisionImagePreprocess({
    width,
    height,
    size: file.size,
    maxDimension: MAX_USER_VISION_DIMENSION,
    maxBytes: MAX_USER_VISION_IMAGE_BYTES,
  });

  if (!needs) {
    // 只做必要的 MIME normalization，保留原始字节
    const normalized = new File([file], file.name, { type: mime, lastModified: file.lastModified });
    return {
      file: normalized,
      originalSize: file.size,
      outputSize: normalized.size,
      originalWidth: width,
      originalHeight: height,
      outputWidth: width,
      outputHeight: height,
      resized: false,
      reencoded: false,
    };
  }

  // 像素级处理：canvas pipeline（浏览器）
  const plan = visionEncodePlan({ mime });
  const base = calculateContainedImageSize({ width, height, maxDimension: MAX_USER_VISION_DIMENSION });
  let lastBlob: Blob | null = null;
  let lastWidth = base.width;
  let lastHeight = base.height;
  for (let i = 0; i < plan.attempts.length; i++) {
    const attempt = plan.attempts[i];
    const w = Math.max(1, Math.round(base.width * attempt.scale));
    const h = Math.max(1, Math.round(base.height * attempt.scale));
    const blob = await encodeVisionImageBlob({ blob: file, mime: plan.targetMime, width: w, height: h, quality: attempt.quality });
    lastBlob = blob;
    lastWidth = w;
    lastHeight = h;
    if (blob.size <= MAX_USER_VISION_IMAGE_BYTES) break;
  }

  if (!lastBlob || lastBlob.size > MAX_USER_VISION_IMAGE_BYTES) {
    throw new VisionImagePreprocessError("图片压缩后仍超过发送上限");
  }

  const out = new File([lastBlob], file.name, { type: plan.targetMime, lastModified: file.lastModified });
  return {
    file: out,
    originalSize: file.size,
    outputSize: out.size,
    originalWidth: width,
    originalHeight: height,
    outputWidth: lastWidth,
    outputHeight: lastHeight,
    resized: lastWidth !== width || lastHeight !== height,
    reencoded: true,
  };
}
