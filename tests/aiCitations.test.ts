import { describe, it, expect } from "vitest";
import {
  parseCitationMarkers,
  splitCitationSegments,
  resolveCitation,
  citationLabel,
  citationsToReadableText,
} from "@/lib/ai/citations/parser";
import { buildTurnSourceRegistry, materialSourceId } from "@/lib/ai/citations/sources";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { formatKiroToolActivityDetail } from "@/lib/ai/presentation/toolActivityDetails";

const SOURCES: KiroSourceMeta[] = [
  {
    sourceId: "doc-1",
    name: "第三章讲义.pdf",
    source: "chat",
    availablePages: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  {
    sourceId: "doc-2",
    name: "课程要求.docx",
    source: "course-material",
    courseName: "统计学",
  },
  {
    sourceId: "material-mat123",
    name: "复习提纲.pdf",
    source: "course-material",
    courseName: "微观经济学",
    availablePages: [1, 2],
  },
];

describe("Citation Parser", () => {
  it("C. 单页 / 多页 / 文件级 marker 解析", () => {
    expect(parseCitationMarkers("正文[[source:doc-1:p12]]。")).toEqual([{ sourceId: "doc-1", pageStart: 12, pageEnd: 12 }]);
    expect(parseCitationMarkers("[[source:doc-1:p12-p14]]")).toEqual([{ sourceId: "doc-1", pageStart: 12, pageEnd: 14 }]);
    expect(parseCitationMarkers("[[source:doc-2]]")).toEqual([{ sourceId: "doc-2" }]);
  });

  it("C. resolveCitation：sourceId 存在 + 页码在 availablePages 内 → 通过", () => {
    const c = { sourceId: "doc-1", pageStart: 3, pageEnd: 3 };
    const src = resolveCitation(c, SOURCES);
    expect(src?.name).toBe("第三章讲义.pdf");
    // 连续多页都必须可用
    expect(resolveCitation({ sourceId: "doc-1", pageStart: 1, pageEnd: 8 }, SOURCES)).not.toBeNull();
  });

  it("D. 无效页码（不在 availablePages）→ 不解析为可信来源", () => {
    expect(resolveCitation({ sourceId: "doc-1", pageStart: 99, pageEnd: 99 }, SOURCES)).toBeNull();
    expect(resolveCitation({ sourceId: "doc-1", pageStart: 1, pageEnd: 9 }, SOURCES)).toBeNull(); // 9 不在预算内
  });

  it("E. 无效 sourceId → 不解析为可信来源", () => {
    expect(resolveCitation({ sourceId: "fake", pageStart: 1, pageEnd: 1 }, SOURCES)).toBeNull();
    expect(resolveCitation({ sourceId: "doc-9", pageStart: 1, pageEnd: 1 }, SOURCES)).toBeNull();
  });

  it("F. 流式未闭合 marker：不 throw、正文保留、不解析", () => {
    const text = "hello [[source:doc-";
    expect(() => parseCitationMarkers(text)).not.toThrow();
    expect(parseCitationMarkers(text)).toEqual([]);
    const segs = splitCitationSegments(text);
    expect(segs.length).toBe(1);
    expect(segs[0].type).toBe("text");
    expect((segs[0] as { text: string }).text).toBe("hello [[source:doc-");
  });

  it("splitCitationSegments：闭合 marker → citation 段；其余为 text 段", () => {
    const segs = splitCitationSegments("固定效应模型[[source:doc-1:p12]]主要控制异质性。");
    expect(segs).toEqual([
      { type: "text", text: "固定效应模型" },
      { type: "citation", citation: { sourceId: "doc-1", pageStart: 12, pageEnd: 12 } },
      { type: "text", text: "主要控制异质性。" },
    ]);
  });

  it("citationLabel：单页 / 多页 / 文件级中文文案", () => {
    const s = SOURCES[0];
    expect(citationLabel(s, { sourceId: "doc-1", pageStart: 12, pageEnd: 12 })).toBe("第三章讲义.pdf · 第 12 页");
    expect(citationLabel(s, { sourceId: "doc-1", pageStart: 12, pageEnd: 13 })).toBe("第三章讲义.pdf · 第 12–13 页");
    expect(citationLabel(SOURCES[1], { sourceId: "doc-2" })).toBe("课程要求.docx");
  });
});

describe("citationsToReadableText（导出/复制）", () => {
  it("有 Registry：marker → [文件名 · 第 X 页]，不暴露内部协议", () => {
    const out = citationsToReadableText("结论见[[source:doc-1:p5]]与[[source:doc-2]]。", SOURCES);
    expect(out).toBe("结论见[第三章讲义.pdf · 第 5 页]与[课程要求.docx]。");
    expect(out).not.toContain("[[source:");
    expect(out).not.toContain("doc-1");
  });

  it("无 Registry：移除 marker（保留正文，不暴露内部 ID）", () => {
    expect(citationsToReadableText("见[[source:doc-1:p12]]。", undefined)).toBe("见。");
  });

  it("无效引用：不包装成可信来源", () => {
    expect(citationsToReadableText("见[[source:doc-1:p99]]。", SOURCES)).toBe("见[来源不可验证]。");
  });
});

describe("Task 14：Web Citation（Kiro Search）", () => {
  const WEB_SOURCES: KiroSourceMeta[] = [
    {
      sourceId: "web-1",
      name: "浙江大学研究生院2026年招生简章",
      source: "web",
      url: "https://grs.zju.edu.cn/postgraduate/2026",
      domain: "grs.zju.edu.cn",
      publishedAt: "2026-08-01",
    },
  ];

  it("真实 web source → citation valid（文件级）", () => {
    const src = resolveCitation({ sourceId: "web-1" }, WEB_SOURCES);
    expect(src?.source).toBe("web");
    expect(src?.url).toBe("https://grs.zju.edu.cn/postgraduate/2026");
  });

  it("fake web source → rejected", () => {
    expect(resolveCitation({ sourceId: "web-999" }, WEB_SOURCES)).toBeNull();
  });

  it("web source + page → rejected（网页没有 PDF 页码）", () => {
    expect(resolveCitation({ sourceId: "web-1", pageStart: 12, pageEnd: 12 }, WEB_SOURCES)).toBeNull();
  });

  it("Task 19B Case 1. Web PDF：availablePages:[12] → p12 valid、p13 invalid", () => {
    const pdfSource: KiroSourceMeta = {
      sourceId: "web-3",
      name: "2026年硕士研究生招生简章.pdf",
      source: "web",
      url: "https://grs.zju.edu.cn/zhaosheng.pdf",
      domain: "grs.zju.edu.cn",
      availablePages: [12],
    };
    expect(resolveCitation({ sourceId: "web-3", pageStart: 12, pageEnd: 12 }, [pdfSource])?.sourceId).toBe("web-3");
    expect(resolveCitation({ sourceId: "web-3", pageStart: 13, pageEnd: 13 }, [pdfSource])).toBeNull();
    expect(resolveCitation({ sourceId: "web-3" }, [pdfSource])?.sourceId).toBe("web-3"); // 文件级引用仍合法
  });

  it("Task 19B Case 2. 普通 web（availablePages undefined）→ 页码引用 invalid", () => {
    expect(resolveCitation({ sourceId: "web-1", pageStart: 12, pageEnd: 12 }, WEB_SOURCES)).toBeNull();
    expect(resolveCitation({ sourceId: "web-1" }, WEB_SOURCES)?.sourceId).toBe("web-1");
  });

  it("export/copy 不暴露 [[source:web-*]]", () => {
    const out = citationsToReadableText("来源见[[source:web-1]]。", WEB_SOURCES);
    expect(out).not.toContain("[[source:");
    expect(out).not.toContain("web-1");
    expect(out).toContain("浙江大学研究生院2026年招生简章");
  });

  it("worklog formatter：web_search success → 搜索网络 · N 个来源；working/error 专属文案", () => {
    const output = { ok: true, data: { results: [{ sourceId: "web-1" }, { sourceId: "web-2" }, { sourceId: "web-3" }] } };
    expect(formatKiroToolActivityDetail("web_search", "done", output)).toEqual(["搜索网络 · 3 个来源"]);
    expect(formatKiroToolActivityDetail("web_search", "working", {})).toEqual(["正在搜索网络"]);
    expect(formatKiroToolActivityDetail("web_search", "error", {})).toEqual(["网络搜索失败"]);
    // 不展示工具名 / Tavily / raw query
    const raw = JSON.stringify(formatKiroToolActivityDetail("web_search", "done", output));
    expect(raw).not.toContain("tavily");
    expect(raw).not.toContain("web_search");
  });
});

describe("buildTurnSourceRegistry（纯函数）", () => {
  it("按序分配 doc-N；availablePages 来自实际提供的 pages；source 分类正确", () => {
    const { sources, sourceIdOf } = buildTurnSourceRegistry([
      { name: "第三章讲义.pdf", source: "chat", pages: [{ page: 1, text: "a" }, { page: 2, text: "b" }] },
      { name: "课程要求.docx", source: "course-material", courseName: "统计学" },
    ]);
    expect(sources).toEqual([
      { sourceId: "doc-1", name: "第三章讲义.pdf", source: "chat", availablePages: [1, 2] },
      { sourceId: "doc-2", name: "课程要求.docx", source: "course-material", courseName: "统计学" },
    ]);
    expect(sourceIdOf("第三章讲义.pdf")).toBe("doc-1");
  });

  it("materialSourceId：基于 materialId，绝不包含 storageKey", () => {
    expect(materialSourceId("mat123")).toBe("material-mat123");
    const safe = materialSourceId("weird id!@#");
    expect(safe).toBe("material-weirdid");
    expect(materialSourceId("")).toBe("material-file");
  });
});
