import { describe, it, expect } from "vitest";
import {
  extractExplicitPages,
  selectScannedPdfPages,
  allocateVisionPages,
  hasFigureIntent,
} from "@/lib/ai/attachments/pdfVision";
import { MAX_SCANNED_PDF_PAGES_PER_TURN } from "@/lib/ai/attachments/limits";

describe("extractExplicitPages", () => {
  it("中文页码表达：第12页 / 第12-15页 / 12页", () => {
    expect(extractExplicitPages("帮我解释第 12 页")).toEqual([{ start: 12, end: 12 }]);
    expect(extractExplicitPages("看第12-15页")).toEqual([{ start: 12, end: 15 }]);
    expect(extractExplicitPages("12页讲了什么")).toEqual([{ start: 12, end: 12 }]);
  });

  it("英文表达：pages 3-5 / page 8", () => {
    expect(extractExplicitPages("summarize pages 3-5")).toEqual([{ start: 3, end: 5 }]);
    expect(extractExplicitPages("what is on page 8")).toEqual([{ start: 8, end: 8 }]);
  });

  it("无页码表达 → 空", () => {
    expect(extractExplicitPages("总结这份资料的重点")).toEqual([]);
    expect(extractExplicitPages("")).toEqual([]);
  });
});

describe("selectScannedPdfPages", () => {
  it("必做测试 1：用户指定第 12–14 页 → [12,13,14]", () => {
    const r = selectScannedPdfPages({ userText: "看第 12–14 页", pageCount: 30 });
    expect(r.pages).toEqual([12, 13, 14]);
    expect(r.truncated).toBe(false);
  });

  it("必做测试 2：请求 1–20 页超上限 → 前 6 页 + truncated", () => {
    const r = selectScannedPdfPages({ userText: "总结第 1–20 页", pageCount: 20 });
    expect(r.pages).toHaveLength(MAX_SCANNED_PDF_PAGES_PER_TURN);
    expect(r.pages).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.truncated).toBe(true);
  });

  it("必做测试 3：无指定页码 → 默认前 6 页（不足则全部）", () => {
    expect(selectScannedPdfPages({ userText: "总结这份资料", pageCount: 20 }).pages).toEqual([1, 2, 3, 4, 5, 6]);
    expect(selectScannedPdfPages({ userText: "", pageCount: 3 }).pages).toEqual([1, 2, 3]);
    expect(selectScannedPdfPages({ userText: "", pageCount: 3 }).truncated).toBe(false);
  });

  it("越界页码被 clamp（第 99 页 → 忽略，回退默认）", () => {
    const r = selectScannedPdfPages({ userText: "看第 99 页", pageCount: 30 });
    expect(r.pages).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("allocateVisionPages（多文档公平分配）", () => {
  it("两份 PDF：round-robin 不独占预算", () => {
    const r = allocateVisionPages(
      [
        { pageCount: 20, explicitPages: [] },
        { pageCount: 10, explicitPages: [] },
      ],
      6
    );
    expect(r[0].pages).toEqual([1, 2, 3]);
    expect(r[1].pages).toEqual([1, 2, 3]);
  });

  it("explicit 优先：先满足指定页，剩余 round-robin", () => {
    const r = allocateVisionPages(
      [
        { pageCount: 30, explicitPages: [12] },
        { pageCount: 30, explicitPages: [4] },
      ],
      6
    );
    expect(r[0].pages).toContain(12);
    expect(r[1].pages).toContain(4);
    const total = r[0].pages.length + r[1].pages.length;
    expect(total).toBeLessThanOrEqual(6);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it("单文档 = selectScannedPdfPages 默认行为", () => {
    const r = allocateVisionPages([{ pageCount: 20, explicitPages: [] }], 6);
    expect(r[0].pages).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("hasFigureIntent（文本 PDF 图表页按需渲染）", () => {
  it("命中：图N / 第N图 / 图表 / figure", () => {
    for (const t of [
      "解释一下图2",
      "图2至图4讲了什么",
      "看看第3图",
      "这张图表说明了什么",
      "看图中的曲线",
      "如图4所示，解释置换检验",
      "please explain figure 2",
      "what does fig.3 show",
      "PDF里的图片是什么意思",
      "描述一下图4的内容",
    ]) {
      expect(hasFigureIntent(t), t).toBe(true);
    }
  });

  it("不命中：裸图误伤与纯文字请求", () => {
    for (const t of [
      "",
      "总结这份PDF的重点",
      "我试图理解这篇论文",
      "地图学原理是什么",
      "图书馆什么时候开门",
      "翻译第二段",
    ]) {
      expect(hasFigureIntent(t), t).toBe(false);
    }
  });

  it("不误伤 config 等英文词", () => {
    expect(hasFigureIntent("config the build")).toBe(false);
  });
});
