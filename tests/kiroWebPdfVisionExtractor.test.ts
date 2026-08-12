import { describe, it, expect, vi } from "vitest";
import {
  extractWebPdfVisionPages,
  KiroWebPdfVisionPageText,
} from "@/lib/ai/web/vision/extractor";
import { KiroRasterizedWebPdfPage } from "@/lib/ai/web/native/pdfVisionRasterizer";
import { MAX_WEB_PDF_VISION_OUTPUT_TOKENS_PER_PAGE } from "@/lib/ai/web/vision/limits";

const page = (n: number): KiroRasterizedWebPdfPage => ({
  page: n,
  data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  mediaType: "image/jpeg",
  width: 10,
  height: 10,
  size: 4,
});

function makeDeps(over: {
  outputs?: Record<number, string | Error>;
  resolveModel?: typeof import("@/lib/ai/providers/resolver").resolveLanguageModel;
}) {
  const generateText = vi.fn(async (opts: Record<string, unknown>) => {
    // 从 messages 里无法直接取页码 → 用调用序号模拟；outputs 按调用序号 0..n 对应
    const callIndex = generateText.mock.calls.length - 1;
    const out = over.outputs ? Object.values(over.outputs)[callIndex] : "提取的文字内容";
    if (out instanceof Error) throw out;
    return { text: out };
  });
  const resolveModel = over.resolveModel ?? (vi.fn(async () => ({ model: {} })) as never);
  return { generateText, resolveModel: resolveModel as never };
}

describe("extractWebPdfVisionPages — Task 19C2", () => {
  it("A. page 8 image → page 8 text（页码来自图片本身，不靠模型生成）", async () => {
    const { generateText, resolveModel } = makeDeps({});
    const out = await extractWebPdfVisionPages(
      [page(8)],
      "招生人数",
      { model: "mimo-v2.5", apiKey: "sk-vision" },
      { generateText: generateText as never, resolveModel }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pages).toEqual([{ page: 8, text: "提取的文字内容" }]);
    const call = generateText.mock.calls[0][0] as Record<string, unknown>;
    expect(call.maxOutputTokens).toBe(MAX_WEB_PDF_VISION_OUTPUT_TOKENS_PER_PAGE);
    expect(call.abortSignal).toBeUndefined();
    const messages = call.messages as { content: { type: string; text?: string; image?: unknown; mediaType?: string }[] }[];
    const content = messages[0].content;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("招生人数");
    expect(content[1].type).toBe("image");
    expect(content[1].image).toEqual(page(8).data);
    expect(content[1].mediaType).toBe("image/jpeg");
  });

  it("B. 3 页中 1 页失败 → 其它页保留", async () => {
    const { generateText, resolveModel } = makeDeps({ outputs: { 0: "p1 文字", 1: new Error("provider boom"), 2: "p3 文字" } });
    const out = await extractWebPdfVisionPages(
      [page(1), page(2), page(3)],
      undefined,
      { model: "mimo-v2.5", apiKey: "sk-vision" },
      { generateText: generateText as never, resolveModel }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it("C. 空 / 纯空白输出 → 丢弃；全部为空 → NO_EVIDENCE", async () => {
    const { generateText, resolveModel } = makeDeps({ outputs: { 0: "   ", 1: "" } });
    const out = await extractWebPdfVisionPages(
      [page(1), page(2)],
      undefined,
      { model: "mimo-v2.5", apiKey: "sk-vision" },
      { generateText: generateText as never, resolveModel }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_PDF_VISION_NO_EVIDENCE");
  });

  it("D. missing key → provider 0 calls（不解析模型、不调用 generateText）", async () => {
    const { generateText, resolveModel } = makeDeps({});
    const out = await extractWebPdfVisionPages(
      [page(1)],
      undefined,
      { model: "mimo-v2.5", apiKey: "  " },
      { generateText: generateText as never, resolveModel }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_PDF_VISION_KEY_REQUIRED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("D2. resolveLanguageModel throw（MODEL_UNAVAILABLE）→ 内部失败，不调 generateText", async () => {
    const { generateText } = makeDeps({});
    const resolveModel = vi.fn(async () => {
      throw new Error("MODEL_UNAVAILABLE");
    });
    const out = await extractWebPdfVisionPages(
      [page(1)],
      undefined,
      { model: "mimo-v2.5", apiKey: "sk-vision" },
      { generateText: generateText as never, resolveModel: resolveModel as never }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_PDF_VISION_MODEL_UNAVAILABLE");
    expect(generateText).not.toHaveBeenCalled();
  });
});
