import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_WEB_PDF_VISION_MODEL,
  getWebPdfVisionModelOptions,
  isWebPdfVisionModel,
  normalizeWebPdfVisionModel,
} from "@/lib/ai/web/vision/models";
import {
  getSessionWebPdfVisionApiKey,
  setSessionWebPdfVisionApiKey,
  hasSessionWebPdfVisionApiKey,
} from "@/lib/ai/web/vision/credentials";
import { setSessionApiKey, getSessionApiKey } from "@/lib/ai/sessionKeys";
import {
  selectWebPdfVisionPages,
} from "@/lib/ai/web/vision/pageSelection";
import {
  MAX_WEB_PDF_VISION_PAGES_PER_READ,
  MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ,
  MAX_WEB_PDF_VISION_DIMENSION,
  MAX_WEB_PDF_VISION_PAGE_BYTES,
  WEB_PDF_VISION_JPEG_QUALITY,
} from "@/lib/ai/web/vision/limits";

describe("Kiro Web PDF Vision — model whitelist", () => {
  it("A1a. 合法 Vision 模型存在：mimo-v2.5 / kimi-k3 / grok-4.5", () => {
    const ids = getWebPdfVisionModelOptions().map((m) => m.id);
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("grok-4.5");
  });
  it("A1b. vision:false 模型（deepseek-v4-flash）不在 whitelist", () => {
    expect(isWebPdfVisionModel("deepseek-v4-flash")).toBe(false);
    expect(getWebPdfVisionModelOptions().some((m) => m.id === "deepseek-v4-flash")).toBe(false);
  });
  it("A1c. anthropic-messages 模型（minimax-m3）不在 whitelist", () => {
    expect(isWebPdfVisionModel("minimax-m3")).toBe(false);
    expect(getWebPdfVisionModelOptions().some((m) => m.id === "minimax-m3")).toBe(false);
  });

  it("A2. normalize：合法保留；非法一律 → mimo-v2.5（统一 invalid→default 语义）", () => {
    expect(normalizeWebPdfVisionModel("mimo-v2.5")).toBe("mimo-v2.5");
    expect(normalizeWebPdfVisionModel("deepseek-v4-flash")).toBe("mimo-v2.5");
    expect(normalizeWebPdfVisionModel("random-model")).toBe("mimo-v2.5");
    expect(normalizeWebPdfVisionModel("")).toBe(DEFAULT_WEB_PDF_VISION_MODEL);
    expect(normalizeWebPdfVisionModel(null)).toBe(DEFAULT_WEB_PDF_VISION_MODEL);
    expect(normalizeWebPdfVisionModel(undefined)).toBe(DEFAULT_WEB_PDF_VISION_MODEL);
    expect(DEFAULT_WEB_PDF_VISION_MODEL).toBe("mimo-v2.5");
  });
});

describe("Kiro Web PDF Vision — credential isolation", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("A3. Vision Key 与主 OpenCode Key 互不覆盖；清空 Vision Key 不影响主 Key", () => {
    setSessionApiKey("opencode-go", "main-key");
    setSessionWebPdfVisionApiKey("vision-key");

    expect(getSessionApiKey("opencode-go")).toBe("main-key");
    expect(getSessionWebPdfVisionApiKey()).toBe("vision-key");
    expect(hasSessionWebPdfVisionApiKey()).toBe(true);

    setSessionWebPdfVisionApiKey("  ");
    expect(getSessionWebPdfVisionApiKey()).toBe("");
    expect(hasSessionWebPdfVisionApiKey()).toBe(false);
    expect(getSessionApiKey("opencode-go")).toBe("main-key"); // 主 Key 仍在
  });

  it("A3b. trim 存储", () => {
    setSessionWebPdfVisionApiKey("  sk-vision  ");
    expect(getSessionWebPdfVisionApiKey()).toBe("sk-vision");
  });
});

describe("Kiro Web PDF Vision — page selection", () => {
  it("A4. explicit 区间（第 8-12 页）→ 硬 cap 3：[8,9,10]，truncated=true", () => {
    const out = selectWebPdfVisionPages({ query: "请读取第 8-12 页", pageCount: 20 });
    expect(out.pages).toEqual([8, 9, 10]);
    expect(out.truncated).toBe(true);
  });
  it("A5. 无 explicit → 前 3 页", () => {
    const out = selectWebPdfVisionPages({ query: "招生条件", pageCount: 20 });
    expect(out.pages).toEqual([1, 2, 3]);
    expect(out.truncated).toBe(true); // 20 > 3
  });
  it("A6. 全部越界（第 99 页 / pageCount=5）→ fallback 前 3 页", () => {
    const out = selectWebPdfVisionPages({ query: "第 99 页", pageCount: 5 });
    expect(out.pages).toEqual([1, 2, 3]);
  });
  it("A6b. 硬 cap 不可绕过：maxPages=999 → 仍 ≤3", () => {
    const out = selectWebPdfVisionPages({ query: "第 1-20 页", pageCount: 20, maxPages: 999 });
    expect(out.pages.length).toBeLessThanOrEqual(3);
  });
});

describe("Kiro Web PDF Vision — limits", () => {
  it("预算常量：3 pages / 4MiB / 1600 / 1.5MB / 0.82", () => {
    expect(MAX_WEB_PDF_VISION_PAGES_PER_READ).toBe(3);
    expect(MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ).toBe(4 * 1024 * 1024);
    expect(MAX_WEB_PDF_VISION_DIMENSION).toBe(1600);
    expect(MAX_WEB_PDF_VISION_PAGE_BYTES).toBe(1_500_000);
    expect(WEB_PDF_VISION_JPEG_QUALITY).toBe(0.82);
  });
});
