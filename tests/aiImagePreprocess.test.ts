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
  it("JPEG 保持 image/jpeg；scaleFromBase 1 → .85 → .7225；quality .86 → .78 → .72", () => {
    const plan = visionEncodePlan({ mime: "image/jpeg" });
    expect(plan.targetMime).toBe("image/jpeg");
    expect(plan.attempts).toHaveLength(3);
    expect(plan.attempts[0]).toEqual({ scaleFromBase: 1, quality: USER_VISION_JPEG_QUALITY });
    expect(plan.attempts[1]).toEqual({ scaleFromBase: 0.85, quality: 0.78 });
    expect(plan.attempts[2]).toEqual({ scaleFromBase: 0.85 * 0.85, quality: 0.72 });
    // 真正逐级收敛：第三次 < 第二次
    expect(plan.attempts[2].scaleFromBase).toBeLessThan(plan.attempts[1].scaleFromBase);
  });

  it("WEBP 保持 image/webp；scaleFromBase 1 → .85 → .7225；首次质量 USER_VISION_WEBP_QUALITY", () => {
    const plan = visionEncodePlan({ mime: "image/webp" });
    expect(plan.targetMime).toBe("image/webp");
    expect(plan.attempts.map((a) => a.scaleFromBase)).toEqual([1, 0.85, 0.85 * 0.85]);
    expect(plan.attempts[0]).toEqual({ scaleFromBase: 1, quality: USER_VISION_WEBP_QUALITY });
  });

  it("PNG 不转换为 JPEG：targetMime=image/png，无损（quality 0），scaleFromBase 1 → .82 → .6724", () => {
    const plan = visionEncodePlan({ mime: "image/png" });
    expect(plan.targetMime).toBe("image/png");
    expect(plan.attempts.map((a) => a.scaleFromBase)).toEqual([1, 0.82, 0.82 * 0.82]);
    expect(plan.attempts.every((a) => a.quality === 0)).toBe(true);
    expect(plan.attempts[2].scaleFromBase).toBeLessThan(plan.attempts[1].scaleFromBase);
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

describe("preprocessVisionImage encode loop（fake encoder 注入，Phase 3.4A.1）", () => {
  // 4032×3024 + 3MB → 触发 canvas pipeline；base（contain 到 2048）= 2048×1536
  const BIG_DIMS = async () => ({ width: 4032, height: 3024 });
  const bigFile = (name: string, type: string) => new File([new Uint8Array(3 * 1024 * 1024)], name, { type });

  interface EncoderCall {
    mime: string;
    width: number;
    height: number;
    quality: number;
  }

  const makeEncoder = (sizes: number[]) => {
    const calls: EncoderCall[] = [];
    return {
      calls,
      encode: async (input: { blob: Blob; mime: string; width: number; height: number; quality: number }): Promise<Blob> => {
        calls.push({ mime: input.mime, width: input.width, height: input.height, quality: input.quality });
        const size = sizes[Math.min(calls.length - 1, sizes.length - 1)] ?? sizes[sizes.length - 1];
        return new Blob([new Uint8Array(size)], { type: input.mime });
      },
    };
  };

  it("JPEG：三次真实递减尺寸（2048×1536 → 1741×1306 → 1480×1110），quality .86/.78/.72", async () => {
    const enc = makeEncoder([3 * 1024 * 1024, 2.5 * 1024 * 1024, 1.5 * 1024 * 1024]);
    const prepared = await preprocessVisionImage(bigFile("photo.jpg", "image/jpeg"), { getDimensions: BIG_DIMS, encode: enc.encode });
    expect(enc.calls).toHaveLength(3);
    expect(enc.calls.map((c) => c.mime)).toEqual(["image/jpeg", "image/jpeg", "image/jpeg"]);
    expect(enc.calls[0]).toMatchObject({ width: 2048, height: 1536, quality: USER_VISION_JPEG_QUALITY });
    expect(enc.calls[1]).toMatchObject({ width: 1741, height: 1306, quality: 0.78 });
    expect(enc.calls[2]).toMatchObject({ width: 1480, height: 1110, quality: 0.72 });
    // 核心：第三次必须小于第二次（不再相等）
    expect(enc.calls[2].width).toBeLessThan(enc.calls[1].width);
    expect(enc.calls[2].height).toBeLessThan(enc.calls[1].height);
    // metadata 对应实际成功的第三次输出
    expect(prepared.outputWidth).toBe(1480);
    expect(prepared.outputHeight).toBe(1110);
    expect(prepared.file.type).toBe("image/jpeg");
  });

  it("WEBP：MIME 始终 image/webp，首次质量 USER_VISION_WEBP_QUALITY，第三次 < 第二次", async () => {
    const enc = makeEncoder([3 * 1024 * 1024, 2.5 * 1024 * 1024, 1.5 * 1024 * 1024]);
    const prepared = await preprocessVisionImage(bigFile("photo.webp", "image/webp"), { getDimensions: BIG_DIMS, encode: enc.encode });
    expect(enc.calls).toHaveLength(3);
    expect(enc.calls.every((c) => c.mime === "image/webp")).toBe(true);
    expect(enc.calls[0].quality).toBe(USER_VISION_WEBP_QUALITY);
    expect(enc.calls[2].width).toBeLessThan(enc.calls[1].width);
    expect(prepared.file.type).toBe("image/webp");
  });

  it("PNG：scaleFromBase 1 → .82 → .6724，第三次 < 第二次，全部 image/png，quality 不参与", async () => {
    const enc = makeEncoder([3 * 1024 * 1024, 2.5 * 1024 * 1024, 1.5 * 1024 * 1024]);
    const prepared = await preprocessVisionImage(bigFile("photo.png", "image/png"), { getDimensions: BIG_DIMS, encode: enc.encode });
    expect(enc.calls).toHaveLength(3);
    expect(enc.calls.every((c) => c.mime === "image/png")).toBe(true);
    expect(enc.calls.every((c) => c.quality === 0)).toBe(true); // PNG 无损，无质量参数
    expect(enc.calls[0]).toMatchObject({ width: 2048, height: 1536 });
    expect(enc.calls[1]).toMatchObject({ width: Math.round(2048 * 0.82), height: Math.round(1536 * 0.82) });
    expect(enc.calls[2]).toMatchObject({ width: Math.round(2048 * 0.82 * 0.82), height: Math.round(1536 * 0.82 * 0.82) });
    expect(enc.calls[2].width).toBeLessThan(enc.calls[1].width); // 回归：修复前二者相等
    expect(prepared.file.type).toBe("image/png");
  });

  it("early stop：首次即达标 → encode 只调用 1 次", async () => {
    const enc = makeEncoder([1.5 * 1024 * 1024]);
    const prepared = await preprocessVisionImage(bigFile("photo.jpg", "image/jpeg"), { getDimensions: BIG_DIMS, encode: enc.encode });
    expect(enc.calls).toHaveLength(1);
    expect(prepared.outputWidth).toBe(2048);
    expect(prepared.outputHeight).toBe(1536);
  });

  it("第二次成功：只调用 2 次，outputWidth/Height 对应 attempt 2（1741×1306）", async () => {
    const enc = makeEncoder([3 * 1024 * 1024, 1.5 * 1024 * 1024]);
    const prepared = await preprocessVisionImage(bigFile("photo.jpg", "image/jpeg"), { getDimensions: BIG_DIMS, encode: enc.encode });
    expect(enc.calls).toHaveLength(2);
    expect(prepared.outputWidth).toBe(1741);
    expect(prepared.outputHeight).toBe(1306);
    expect(prepared.resized).toBe(true);
    expect(prepared.reencoded).toBe(true);
  });

  it("bounded failure：三次全超限 → throw VisionImagePreprocessError，且 encode 恰好 3 次（无第 4 次）", async () => {
    const enc = makeEncoder([3 * 1024 * 1024]);
    await expect(
      preprocessVisionImage(bigFile("photo.png", "image/png"), { getDimensions: BIG_DIMS, encode: enc.encode })
    ).rejects.toBeInstanceOf(VisionImagePreprocessError);
    expect(enc.calls).toHaveLength(3);
  });
});
