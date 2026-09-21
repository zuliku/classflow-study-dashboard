// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MAX_DESKTOP_VISION_CANDIDATES,
  extractDesktopVisionCandidates,
  parseVisionCandidates,
} from "@/lib/ai/computer/gui/vision";

describe("parseVisionCandidates — fail closed / bounded", () => {
  it("合法数组 → candidates", () => {
    const candidates = parseVisionCandidates(
      JSON.stringify([
        { label: "开始按钮", confidence: 0.9, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } },
      ])
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].label).toBe("开始按钮");
  });

  it("夹带说明文字 → 提取 JSON 数组", () => {
    const candidates = parseVisionCandidates(
      '这是结果：[{"label":"OK","confidence":0.5,"bounds":{"x":0,"y":0,"width":0.1,"height":0.1}}]'
    );
    expect(candidates).toHaveLength(1);
  });

  it.each([
    ["非 JSON", "hello"],
    ["空数组", "[]"],
    ["越界坐标", '[{"label":"x","confidence":1,"bounds":{"x":1.5,"y":0,"width":0.5,"height":0.5}}]'],
    ["零尺寸", '[{"label":"x","confidence":1,"bounds":{"x":0.1,"y":0.1,"width":0,"height":0.1}}]'],
    ["缺 label", '[{"confidence":1,"bounds":{"x":0.1,"y":0.1,"width":0.1,"height":0.1}}]'],
  ])("%s → 空（fail closed）", (_label, raw) => {
    expect(parseVisionCandidates(raw)).toEqual([]);
  });

  it("数量有界 + label 截断", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: `标签${i}`.repeat(30),
      confidence: 0.5,
      bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
    }));
    const candidates = parseVisionCandidates(JSON.stringify(many));
    expect(candidates.length).toBeLessThanOrEqual(MAX_DESKTOP_VISION_CANDIDATES);
    expect(candidates[0].label.length).toBeLessThanOrEqual(40);
  });
});

describe("extractDesktopVisionCandidates — 只读 candidate（不执行动作）", () => {
  const config = { enabled: true, model: "mimo-v2.5", apiKey: "test-key" };
  const screenshot = "data:image/jpeg;base64,AAAA";

  it("禁用 → available:false（不调用模型）", async () => {
    const result = await extractDesktopVisionCandidates(
      { screenshotDataUrl: screenshot },
      { enabled: false, model: "mimo-v2.5" }
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(result.candidates).toEqual([]);
  });

  it("缺 key → missing-key", async () => {
    const result = await extractDesktopVisionCandidates(
      { screenshotDataUrl: screenshot },
      { enabled: true, model: "mimo-v2.5" }
    );
    expect(result.reason).toBe("missing-key");
  });

  it("模型异常 → extract-failed（优雅降级）", async () => {
    const result = await extractDesktopVisionCandidates({ screenshotDataUrl: screenshot }, config, {
      resolveModel: async () => ({ model: {} }) as never,
      generateText: (async () => {
        throw new Error("boom");
      }) as never,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("extract-failed");
  });

  it("成功 → candidates（归一化 bounds）", async () => {
    const result = await extractDesktopVisionCandidates({ screenshotDataUrl: screenshot, goal: "登录" }, config, {
      resolveModel: async () => ({ model: {} }) as never,
      generateText: (async () => ({
        text: JSON.stringify([
          { label: "登录按钮", confidence: 0.8, bounds: { x: 0.4, y: 0.6, width: 0.2, height: 0.08 } },
        ]),
      })) as never,
    });
    expect(result.available).toBe(true);
    expect(result.candidates[0].label).toBe("登录按钮");
    expect(result.model).toBe("mimo-v2.5");
  });
});
