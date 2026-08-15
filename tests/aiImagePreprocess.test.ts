/**
 * 用户图片 Send-time 预处理纯逻辑测试（Phase 3.4A）。
 * 浏览器 Canvas pipeline（decode/encode）不在此 mock；纯函数 + MIME normalization
 * 路径（node 可测）+ 确定性编码计划覆盖。Canvas 路径由浏览器人工 smoke 验证。
 */
import { describe, it, expect } from "vitest";
import {
  calculateContainedImageSize,
  needsVisionImagePreprocess,
  visionEncodePlan,
  preprocessVisionImage,
  VisionImagePreprocessError,
} from "@/lib/ai/attachments/preprocessImage";
import {
  MAX_USER_VISION_DIMENSION,
  MAX_USER_VISION_IMAGE_BYTES,
  USER_VISION_JPEG_QUALITY,
  USER_VISION_WEBP_QUALITY,
} from "@/lib/ai/attachments/limits";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

describe("calculateContainedImageSize（等比包含，禁止 upscale）", () => {
  it("1. 4032×3024 + 2048 → 2048×1536", () => {
    expect(calculateContainedImageSize({ width: 4032, height: 3024, maxDimension: 2048 })).toEqual({ width: 2048, height: 1536 });
  });

  it("2. 3024×4032 + 2048 → 1536×2048", () => {
    expect(calculateContainedImageSize({ width: 3024, height: 4032, maxDimension: 2048 })).toEqual({ width: 1536, height: 2048 });
  });

  it("3. 1000×800 + 2048 → 不 upscale", () => {
    expect(calculateContainedImageSize({ width: 1000, height: 800, maxDimension: 2048 })).toEqual({ width: 1000, height: 800 });
  });

  it("非法输入不抛错，返回 ≥1 的兜底尺寸", () => {
    expect(calculateContainedImageSize({ width: 0, height: 100, maxDimension: 2048 }).width).toBeGreaterThanOrEqual(1);
    expect(calculateContainedImageSize({ width: -5, height: -5, maxDimension: 2048 }).height).toBeGreaterThanOrEqual(1);
  });
});

describe("needsVisionImagePreprocess", () => {
  it("4. 小于 dimension 且小于 byte threshold → false（不需要 pixel reencode）", () => {
    expect(
      needsVisionImagePreprocess({ width: 1200, height: 800, size: 500_000, maxDimension: MAX_USER_VISION_DIMENSION, maxBytes: MAX_USER_VISION_IMAGE_BYTES })
    ).toBe(false);
  });

  it("尺寸超限 → true；体积超限 → true", () => {
    expect(
      needsVisionImagePreprocess({ width: 3000, height: 2000, size: 100_000, maxDimension: MAX_USER_VISION_DIMENSION, maxBytes: MAX_USER_VISION_IMAGE_BYTES })
    ).toBe(true);
    expect(
      needsVisionImagePreprocess({ width: 1000, height: 800, size: 5 * 1024 * 1024, maxDimension: MAX_USER_VISION_DIMENSION, maxBytes: MAX_USER_VISION_IMAGE_BYTES })
    ).toBe(true);
  });
});

describe("visionEncodePlan（bounded / deterministic / 保 MIME）", () => {
  it("JPEG 保持 image/jpeg；首次质量 USER_VISION_JPEG_QUALITY；最多 3 次收敛", () => {
    const plan = visionEncodePlan({ mime: "image/jpeg" });
    expect(plan.targetMime).toBe("image/jpeg");
    expect(plan.attempts).toHaveLength(3);
    expect(plan.attempts[0]).toEqual({ scale: 1, quality: USER_VISION_JPEG_QUALITY });
    expect(plan.attempts[1]).toEqual({ scale: 0.85, quality: 0.78 });
    expect(plan.attempts[2]).toEqual({ scale: 0.85, quality: 0.72 });
  });

  it("10. WEBP 保持 image/webp；首次质量 USER_VISION_WEBP_QUALITY", () => {
    const plan = visionEncodePlan({ mime: "image/webp" });
    expect(plan.targetMime).toBe("image/webp");
    expect(plan.attempts[0]).toEqual({ scale: 1, quality: USER_VISION_WEBP_QUALITY });
  });

  it("9. PNG 不转换为 JPEG：targetMime=image/png，无损（quality 0），逐级降尺寸", () => {
    const plan = visionEncodePlan({ mime: "image/png" });
    expect(plan.targetMime).toBe("image/png");
    expect(plan.attempts.map((a) => a.scale)).toEqual([1, 0.82, 0.82]);
    expect(plan.attempts.every((a) => a.quality === 0)).toBe(true);
  });
});

describe("preprocessVisionImage（小图：仅 MIME normalization，不重编码）", () => {
  const fakeDims = async () => ({ width: 1000, height: 800 });

  it("5. 小图 File.type='' + photo.webp → outbound File.type = image/webp", async () => {
    const file = new File([pngBytes()], "photo.webp", { type: "" });
    const prepared = await preprocessVisionImage(file, { getDimensions: fakeDims });
    expect(prepared.file.type).toBe("image/webp");
    expect(prepared.resized).toBe(false);
    expect(prepared.reencoded).toBe(false);
    expect(prepared.originalWidth).toBe(1000);
    expect(prepared.outputWidth).toBe(1000);
  });

  it("6. .jpg empty MIME → image/jpeg", async () => {
    const file = new File([pngBytes()], "photo.jpg", { type: "" });
    const prepared = await preprocessVisionImage(file, { getDimensions: fakeDims });
    expect(prepared.file.type).toBe("image/jpeg");
    expect(prepared.reencoded).toBe(false);
  });

  it("7. .png empty MIME → image/png", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "" });
    const prepared = await preprocessVisionImage(file, { getDimensions: fakeDims });
    expect(prepared.file.type).toBe("image/png");
  });

  it("8. 未知 MIME / extension → failure（throw）", async () => {
    const file = new File([pngBytes()], "photo.gif", { type: "" });
    await expect(preprocessVisionImage(file, { getDimensions: fakeDims })).rejects.toBeInstanceOf(VisionImagePreprocessError);
    const file2 = new File([pngBytes()], "noext", { type: "application/octet-stream" });
    await expect(preprocessVisionImage(file2, { getDimensions: fakeDims })).rejects.toBeInstanceOf(VisionImagePreprocessError);
  });

  it("decode 失败 → failure（不泄漏，阻止 Send 路径由调用方处理）", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });
    await expect(preprocessVisionImage(file, { getDimensions: async () => { throw new Error("boom"); } })).rejects.toBeInstanceOf(VisionImagePreprocessError);
  });

  it("Original File 不被修改（small-file path 只包装新 File）", async () => {
    const file = new File([pngBytes()], "photo.webp", { type: "" });
    const prepared = await preprocessVisionImage(file, { getDimensions: fakeDims });
    expect(file.type).toBe("");
    expect(file.name).toBe("photo.webp");
    expect(prepared.file).not.toBe(file);
    expect(prepared.file.name).toBe("photo.webp");
  });
});
