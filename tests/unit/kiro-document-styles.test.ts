import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
import {
  resolveDocumentTheme,
  mergeDocumentStyleForUpdate,
  cmToTwip,
  ptToHalfPoint,
} from "@/lib/ai/computer/documents/styles/resolve";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";

const baseDoc: KiroDocument = {
  title: "样式测试文档",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "第一章 引言" }] },
    { type: "paragraph", content: [{ text: "这是正文段落，用于验证排版。" }] },
    { type: "bullet-list", items: [[{ text: "要点一" }]] },
    { type: "numbered-list", items: [[{ text: "步骤一" }]] },
    { type: "table", header: [[{ text: "名称" }], [{ text: "值" }]], rows: [[[{ text: "A" }], [{ text: "1" }]]] },
    { type: "quote", content: [{ text: "引用内容" }] },
    { type: "code", language: "ts", text: "const a = 1;" },
  ],
};

describe("resolved theme：academic-cn preset", () => {
  const theme = resolveDocumentTheme("academic-cn", undefined);
  it("A4 + 学术页边距（2.54 / 2.8）", () => {
    expect(theme.page.widthTwip).toBe(11906);
    expect(theme.page.heightTwip).toBe(16838);
    expect(theme.page.topTwip).toBe(cmToTwip(2.54));
    expect(theme.page.bottomTwip).toBe(cmToTwip(2.54));
    expect(theme.page.leftTwip).toBe(cmToTwip(2.8));
    expect(theme.page.rightTwip).toBe(cmToTwip(2.8));
  });
  it("正文：宋体 / Times New Roman / 12pt / justify / 1.5 行距 / 首行缩进 2 字符", () => {
    expect(theme.body.eastAsiaFont).toBe("宋体");
    expect(theme.body.latinFont).toBe("Times New Roman");
    expect(theme.body.fontSizePt).toBe(12);
    expect(theme.body.alignment).toBe("justify");
    expect(theme.body.lineSpacing).toBe(1.5);
    expect(theme.body.firstLineIndentChars).toBe(2);
    expect(theme.body.spaceBeforePt).toBe(0);
    expect(theme.body.spaceAfterPt).toBe(0);
  });
  it("标题：黑体 18pt 居中；Heading1 黑体 16pt", () => {
    expect(theme.title.eastAsiaFont).toBe("黑体");
    expect(theme.title.fontSizePt).toBe(18);
    expect(theme.title.alignment).toBe("center");
    expect(theme.heading1.eastAsiaFont).toBe("黑体");
    expect(theme.heading1.fontSizePt).toBe(16);
    expect(theme.heading2.fontSizePt).toBe(14);
    expect(theme.heading3.fontSizePt).toBe(12);
  });
  it("表格：three-line；引用低权重", () => {
    expect(theme.table.style).toBe("three-line");
    expect(theme.table.headerShading).toBeUndefined();
    expect(theme.quote.fontSizePt).toBe(10.5);
    expect(theme.quote.lineSpacing).toBe(1.25);
  });
  it("代码：Consolas 9pt 浅底", () => {
    expect(theme.code.font).toBe("Consolas");
    expect(theme.code.fontSizePt).toBe(9);
    expect(theme.code.backgroundFill).toBeTruthy();
  });
});

describe("resolved theme：business-report preset", () => {
  const theme = resolveDocumentTheme("business-report", undefined);
  it("商务页边距（2.2 / 2.3）", () => {
    expect(theme.page.topTwip).toBe(cmToTwip(2.2));
    expect(theme.page.leftTwip).toBe(cmToTwip(2.3));
  });
  it("正文：微软雅黑 / Aptos / 11pt / left / 1.3 行距 / 无缩进 / 段后 6pt", () => {
    expect(theme.body.eastAsiaFont).toBe("微软雅黑");
    expect(theme.body.latinFont).toBe("Aptos");
    expect(theme.body.fontSizePt).toBe(11);
    expect(theme.body.alignment).toBe("left");
    expect(theme.body.lineSpacing).toBe(1.3);
    expect(theme.body.firstLineIndentChars).toBe(0);
    expect(theme.body.spaceAfterPt).toBe(6);
  });
  it("标题 22pt 左对齐；表格 clean + 表头底纹", () => {
    expect(theme.title.fontSizePt).toBe(22);
    expect(theme.title.alignment).toBe("left");
    expect(theme.table.style).toBe("clean");
    expect(theme.table.headerShading).toBe("F2F2F2");
  });
});

describe("styleHints 覆盖", () => {
  it("preset + titleAlignment=center → 只覆盖 title alignment", () => {
    const theme = resolveDocumentTheme("business-report", { titleAlignment: "center" });
    expect(theme.title.alignment).toBe("center");
    expect(theme.title.fontSizePt).toBe(22); // 其余保持 preset
    expect(theme.body.alignment).toBe("left");
    expect(theme.table.style).toBe("clean");
  });
  it("自定义页边距 → 覆盖 preset（含 clamp）", () => {
    const theme = resolveDocumentTheme("academic-cn", {
      pageMarginsCm: { left: 3, top: 2.5 },
    });
    expect(theme.page.leftTwip).toBe(cmToTwip(3));
    expect(theme.page.topTwip).toBe(cmToTwip(2.5));
    expect(theme.page.rightTwip).toBe(cmToTwip(2.8)); // 未指定 → preset
    // clamp：超过 1–5cm 边界
    const clamped = resolveDocumentTheme("academic-cn", { pageMarginsCm: { left: 9, top: 0.2 } });
    expect(clamped.page.leftTwip).toBe(cmToTwip(5));
    expect(clamped.page.topTwip).toBe(cmToTwip(1));
  });
  it("pageMarginMode：narrow / wide", () => {
    expect(resolveDocumentTheme("academic-cn", { pageMarginMode: "narrow" }).page.topTwip).toBe(cmToTwip(2.0));
    expect(resolveDocumentTheme("academic-cn", { pageMarginMode: "wide" }).page.leftTwip).toBe(cmToTwip(3.0));
  });
  it("bodyFontSizePt 越界 → resolver clamp（9–16）", () => {
    const theme = resolveDocumentTheme("academic-cn", { bodyFontSizePt: 40 });
    expect(theme.body.fontSizePt).toBe(16);
    const small = resolveDocumentTheme("academic-cn", { bodyFontSizePt: 4 });
    expect(small.body.fontSizePt).toBe(9);
  });
  it("bodyFont 中文 hint → 只改 eastAsia；Latin hint → 只改 latin", () => {
    const simsun = resolveDocumentTheme("business-report", { bodyFont: "simsun" });
    expect(simsun.body.eastAsiaFont).toBe("宋体");
    expect(simsun.body.latinFont).toBe("Aptos"); // latin 保持 preset
    const arial = resolveDocumentTheme("business-report", { bodyFont: "arial" });
    expect(arial.body.latinFont).toBe("Arial");
    expect(arial.body.eastAsiaFont).toBe("微软雅黑");
  });
  it("density：只缩放 spacing，不改字号/内容", () => {
    const compact = resolveDocumentTheme("business-report", { density: "compact" });
    expect(compact.body.spaceAfterPt).toBeCloseTo(6 * 0.75);
    expect(compact.body.fontSizePt).toBe(11);
    const relaxed = resolveDocumentTheme("business-report", { density: "relaxed" });
    expect(relaxed.heading1.spaceBeforePt).toBeCloseTo(16 * 1.15);
  });
  it("无 preset → fallback academic-cn", () => {
    const theme = resolveDocumentTheme(undefined, undefined);
    expect(theme.preset).toBe("academic-cn");
    expect(theme.body.eastAsiaFont).toBe("宋体");
  });
});

describe("mergeDocumentStyleForUpdate（style 保持语义）", () => {
  const previous: KiroDocument = {
    title: "旧文档",
    blocks: [{ type: "paragraph", content: [{ text: "旧内容" }] }],
    stylePreset: "academic-cn",
    styleHints: { pageMarginsCm: { left: 3 } },
  };

  it("Case 1: incoming 无 style → 完整保持 previous style", () => {
    const merged = mergeDocumentStyleForUpdate(previous, {
      title: "旧文档",
      blocks: [{ type: "paragraph", content: [{ text: "新内容" }] }],
    });
    expect(merged.stylePreset).toBe("academic-cn");
    expect(merged.styleHints).toEqual({ pageMarginsCm: { left: 3 } });
  });

  it("Case 2: incoming 只有 hints → 保持 preset + merge hints", () => {
    const merged = mergeDocumentStyleForUpdate(previous, {
      title: "旧文档",
      blocks: [{ type: "paragraph", content: [{ text: "新内容" }] }],
      styleHints: { titleAlignment: "center" },
    });
    expect(merged.stylePreset).toBe("academic-cn");
    expect(merged.styleHints).toEqual({
      pageMarginsCm: { left: 3 },
      titleAlignment: "center",
    });
  });

  it("Case 3: incoming 切换 preset（无 hints）→ 新 preset + 旧 hints 清空", () => {
    const merged = mergeDocumentStyleForUpdate(previous, {
      title: "旧文档",
      blocks: [{ type: "paragraph", content: [{ text: "新内容" }] }],
      stylePreset: "business-report",
    });
    expect(merged.stylePreset).toBe("business-report");
    expect(merged.styleHints).toBeUndefined();
  });

  it("Case 4: preset + hints → 新 preset + 新 hints", () => {
    const merged = mergeDocumentStyleForUpdate(previous, {
      title: "旧文档",
      blocks: [{ type: "paragraph", content: [{ text: "新内容" }] }],
      stylePreset: "business-report",
      styleHints: { bodyFontSizePt: 12 },
    });
    expect(merged.stylePreset).toBe("business-report");
    expect(merged.styleHints).toEqual({ bodyFontSizePt: 12 });
  });

  it("嵌套 hints 字段级 merge（pageMarginsCm）", () => {
    const merged = mergeDocumentStyleForUpdate(
      {
        title: "旧文档",
        blocks: [],
        stylePreset: "academic-cn",
        styleHints: { pageMarginsCm: { left: 3, top: 2.5 } },
      },
      {
        title: "旧文档",
        blocks: [],
        styleHints: { pageMarginsCm: { top: 3 } },
      }
    );
    expect(merged.styleHints?.pageMarginsCm).toEqual({ left: 3, top: 3 });
  });
});

describe("schema + 向后兼容", () => {
  it("旧 IR（仅 title + blocks）仍可 parse / render / verify", async () => {
    const legacy: KiroDocument = { title: "旧文档", blocks: [{ type: "paragraph", content: [{ text: "旧内容" }] }] };
    expect(isKiroDocument(legacy)).toBe(true);
    const bytes = await renderDocx(legacy);
    expect(await verifyDocxBytes(bytes)).toBe(true);
    expect(await verifyRenderedDocx(bytes, legacy)).toBe(true);
  });

  it("stylePreset/styleHints 合法值通过；越界数值被 schema 拒绝", () => {
    expect(
      isKiroDocument({
        title: "x",
        blocks: [],
        stylePreset: "academic-cn",
        styleHints: { titleAlignment: "center", bodyFontSizePt: 12 },
      })
    ).toBe(true);
    expect(isKiroDocument({ title: "x", blocks: [], stylePreset: "unknown-preset" })).toBe(false);
    expect(isKiroDocument({ title: "x", blocks: [], styleHints: { bodyFontSizePt: 40 } })).toBe(false);
    expect(isKiroDocument({ title: "x", blocks: [], styleHints: { lineSpacing: 3 } })).toBe(false);
  });
});

describe("渲染产物：结构与 round-trip", () => {
  it("DOCX package 全 XML part 可解析（styles/numbering/theme 等）", async () => {
    const bytes = await renderDocx({
      ...baseDoc,
      stylePreset: "academic-cn",
    });
    expect(await verifyDocxBytes(bytes)).toBe(true);
  });

  it("Mammoth 可提取生成 DOCX 的正文", async () => {
    const bytes = await renderDocx({ ...baseDoc, stylePreset: "business-report" });
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = result.value ?? "";
    expect(text).toContain("样式测试文档");
    expect(text).toContain("第一章 引言");
    expect(text).toContain("这是正文段落，用于验证排版。");
  });

  it("verifyRenderedDocx：round-trip 与 Source IR 一致；内容被篡改则失败", async () => {
    const bytes = await renderDocx(baseDoc);
    expect(await verifyRenderedDocx(bytes, baseDoc)).toBe(true);
    // 篡改正文（替换 document.xml 文本）→ verifyRenderedDocx 失败
    const zip = await JSZip.loadAsync(bytes);
    let documentXml = await zip.file("word/document.xml")?.async("string");
    documentXml = documentXml!.replace("这是正文段落，用于验证排版。", "被篡改的正文内容完全不一样了。");
    zip.file("word/document.xml", documentXml!);
    const repacked = await zip.generateAsync({ type: "uint8array" });
    expect(await verifyRenderedDocx(new Uint8Array(repacked), baseDoc)).toBe(false);
  });

  it("单位换算 helpers", () => {
    expect(ptToHalfPoint(12)).toBe(24);
    expect(ptToHalfPoint(10.5)).toBe(21);
    expect(cmToTwip(2.54)).toBe(1440);
  });
});
