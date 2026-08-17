/**
 * Local Document Search Primitives（V1.4）：normalize / tokenize / scoring / snippet /
 * searchLocalText / searchPdfText / extractPdfPagesText。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLocalSearchText,
  tokenizeLocalSearchQuery,
  scoreLocalSearch,
  buildSourceEvidenceSnippet,
  searchLocalText,
  searchPdfText,
  extractPdfPagesText,
  buildNormalizedSourceView,
  mapNormalizedRangeToSource,
} from "@/lib/ai/attachments/documentSearch";
import {
  MAX_PROJECT_SEARCH_SNIPPET_CHARS,
  MAX_PROJECT_SEARCH_TOTAL_CHARS,
  MAX_PROJECT_SEARCH_RESULTS,
} from "@/lib/ai/attachments/limits";
import { buildMultiPageTextPdf, buildScannedPdf } from "@/tests/fixtures/files";
import { classifyPdfTextLayer } from "@/lib/ai/attachments/pdf";

describe("normalizeLocalSearchText", () => {
  it("NFKC + lowercase + collapse whitespace；中文 substring 保留", () => {
    expect(normalizeLocalSearchText("  Hello　World\n\nSecond ")).toBe("hello world second");
    expect(normalizeLocalSearchText("农户的政策认知会显著影响技术采纳")).toContain("政策认知");
  });
});

describe("V1.4.1 multi-term matching / ranking", () => {
  it("1. phrase absent 但多词分散：policy/adoption/technology → 必须命中（term fallback）", () => {
    const text = normalizeLocalSearchText("policy incentives can increase household adoption of low carbon technology");
    const scored = scoreLocalSearch(text, tokenizeLocalSearchQuery("policy adoption technology"));
    expect(scored.length).toBeGreaterThan(0);
  });

  it("2. coverage ranking：多词同上下文 > 单词", () => {
    const a = normalizeLocalSearchText("policy only");
    const b = normalizeLocalSearchText("policy information is relevant for household adoption of clean technology");
    const q = tokenizeLocalSearchQuery("policy adoption technology");
    const bestA = scoreLocalSearch(a, q)[0]?.score ?? 0;
    const bestB = scoreLocalSearch(b, q)[0]?.score ?? 0;
    expect(bestB).toBeGreaterThan(bestA);
  });

  it("3. 中文 multi-term（无空格连续短语）：政策 低碳 技术 采纳 → 命中", () => {
    const doc = "低碳生产技术的推广会显著提高农户的技术采纳意愿，政策宣传也会影响其认知。";
    const r = searchLocalText(doc, "政策 低碳 技术 采纳", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("4. 中文标点分隔 query：政策认知、技术采纳 → 命中（即使原文无连续完整短语）", () => {
    const doc = "技术采纳受到农户政策认知影响";
    const r = searchLocalText(doc, "政策认知、技术采纳", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("5. exact phrase 仍最高：连续「政策认知」明显高于分散出现", () => {
    const exact = normalizeLocalSearchText("政策认知影响技术采纳");
    const scattered = normalizeLocalSearchText("政策问题影响认知，再谈技术，最后讲采纳");
    const q = tokenizeLocalSearchQuery("政策认知");
    const bestExact = scoreLocalSearch(exact, q)[0]?.score ?? 0;
    const bestScattered = scoreLocalSearch(scattered, q)[0]?.score ?? 0;
    expect(bestExact).toBeGreaterThanOrEqual(10_000);
    expect(bestExact).toBeGreaterThan(bestScattered);
  });

  it("6. near-duplicate suppression：同一段 policy 高频重复 → 不返回 8 个几乎相同 snippet", () => {
    const doc = "policy policy policy policy policy policy policy policy policy policy policy policy policy " +
      "其他无关内容填充其他无关内容填充其他无关内容填充其他无关内容填充" +
      "policy policy policy policy policy policy policy policy policy policy";
    const r = searchLocalText(doc, "policy", { maxResults: 8 });
    // 200 chars 去重窗口内只保留一个 → 高频重复不会铺满 8 个
    expect(r.matches.length).toBeLessThan(8);
  });
});

describe("tokenizeLocalSearchQuery", () => {
  it("保留完整短语 + 最多 8 个 terms", () => {
    const q = tokenizeLocalSearchQuery("农户 政策认知 技术 采纳 行为 影响 显著 采用 采纳 额外");
    expect(q.phrase).toBe("农户 政策认知 技术 采纳 行为 影响 显著 采用 采纳 额外");
    expect(q.terms.length).toBeLessThanOrEqual(8);
  });
});

describe("scoreLocalSearch（deterministic）", () => {
  it("exact phrase 优先于单独 term", () => {
    const text = normalizeLocalSearchText("政策认知影响采纳行为，其他内容");
    const scored = scoreLocalSearch(text, tokenizeLocalSearchQuery("政策认知"));
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].score).toBeGreaterThanOrEqual(1000);
  });

  it("中文整句 substring 命中", () => {
    const text = normalizeLocalSearchText("农户的政策认知会显著影响技术采纳行为");
    const scored = scoreLocalSearch(text, tokenizeLocalSearchQuery("政策认知"));
    expect(scored.length).toBeGreaterThan(0);
  });

  it("Latin case-insensitive：Difference-in-Differences", () => {
    const text = normalizeLocalSearchText("we use Difference-in-Differences estimator");
    const scored = scoreLocalSearch(text, tokenizeLocalSearchQuery("difference-in-differences"));
    expect(scored.length).toBeGreaterThan(0);
  });

  it("排序 deterministic：score 降序 → index 升序", () => {
    const text = normalizeLocalSearchText("cat dog cat bird cat dog");
    const scored = scoreLocalSearch(text, tokenizeLocalSearchQuery("cat dog"));
    for (let i = 1; i < scored.length; i++) {
      const prev = scored[i - 1];
      const cur = scored[i];
      expect(prev.score > cur.score || (prev.score === cur.score && prev.index < cur.index)).toBe(true);
    }
  });
});

describe("buildSourceEvidenceSnippet（V1.4.3 source-faithful）", () => {
  it("总长 ≤ maxChars；保留 source 原文（大小写/空白不归一）", () => {
    const source = "x".repeat(3000) + "The Treatment Effect is ATT." + "y".repeat(3000);
    const view = buildNormalizedSourceView(source);
    const scored = scoreLocalSearch(view.normalized, tokenizeLocalSearchQuery("treatment effect"));
    const range = mapNormalizedRangeToSource(view, { start: scored[0].index, end: scored[0].index + scored[0].matchLength });
    const snippet = buildSourceEvidenceSnippet({ sourceText: source, sourceStart: range.sourceStart, sourceEnd: range.sourceEnd, maxChars: 1200 });
    expect(snippet.length).toBeLessThanOrEqual(1200);
    expect(snippet).toContain("Treatment Effect");
  });
});

describe("V1.4.3 source-faithful Evidence", () => {
  it("大小写保真：DiD 原文保留，query 仍 case-insensitive 命中", () => {
    const doc = "We use Difference-in-Differences (DiD) to estimate ATT.";
    const r = searchLocalText(doc, "difference-in-differences", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("Difference-in-Differences");
    expect(r.matches[0].text).toContain("(DiD)");
    expect(r.matches[0].text).toContain("ATT");
    expect(r.matches[0].text).not.toContain("(did)");
  });

  it("全角 / NFKC：query abc123 命中，Evidence 返回全角原文 ＡＢＣ１２３", () => {
    const doc = "模型版本：ＡＢＣ１２３";
    const r = searchLocalText(doc, "abc123", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("ＡＢＣ１２３");
    expect(r.matches[0].text).not.toContain("abc123");
  });

  it("whitespace fidelity：换行与原始空白保留", () => {
    const doc = "Results\n\nThe ATT   estimate is 4.2%.\nNext section";
    const r = searchLocalText(doc, "att estimate", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("ATT   estimate");
    expect(r.matches[0].text).toContain("\n");
    expect(r.matches[0].text).not.toContain("results the att estimate");
  });

  it("中文 Evidence：标点与换行保留", () => {
    const doc = "政策认知显著影响技术采纳。\n第二段讨论低碳生产。";
    const r = searchLocalText(doc, "政策认知 技术采纳", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("。");
    expect(r.matches[0].text).toContain("政策认知");
    expect(r.matches[0].text).toContain("技术采纳");
  });

  it("normalization length change：ligature ﬀ → ff 命中，Evidence 保留 ﬀ", () => {
    const doc = "oﬀice treatment";
    const r = searchLocalText(doc, "office", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("oﬀice");
  });

  it("Evidence bounded：每个 match ≤1200，总和 ≤8000（按 source snippet 计）", () => {
    const doc = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: the ATT estimate paragraph body content ${i}`).join("\n\n");
    const r = searchLocalText(doc, "ATT estimate", { maxResults: 8 });
    for (const m of r.matches) {
      expect(m.text.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_SNIPPET_CHARS);
    }
    const total = r.matches.reduce((s, m) => s + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_TOTAL_CHARS);
  });

  it("multi-term ranking 不回归：coverage 排序保持", () => {
    const a = normalizeLocalSearchText("policy only");
    const b = normalizeLocalSearchText("policy information is relevant for household adoption of clean technology");
    const q = tokenizeLocalSearchQuery("policy adoption technology");
    const bestA = scoreLocalSearch(a, q)[0]?.score ?? 0;
    const bestB = scoreLocalSearch(b, q)[0]?.score ?? 0;
    expect(bestB).toBeGreaterThan(bestA);
  });

  it("mapNormalizedRangeToSource 稀疏映射正确（全角 3 字符 + expansion + composition）", () => {
    const view = buildNormalizedSourceView("模型版本：ＡＢＣ１２３");
    // NFKC 把全角冒号一并归一为半角
    expect(view.normalized).toBe("模型版本:abc123");
    // normalized "abc" 起始 offset 应映射回全角 "Ａ" 的 source 位置
    const start = view.normalized.indexOf("abc");
    const range = mapNormalizedRangeToSource(view, { start, end: start + 3 });
    expect(view.source.slice(range.sourceStart, range.sourceEnd)).toBe("ＡＢＣ");
  });

  it("expansion range：normalized [1,2]（ﬀ 的第二个 f）→ source span 覆盖整个 ﬀ", () => {
    const view = buildNormalizedSourceView("oﬀice");
    expect(view.normalized).toBe("office");
    const range = mapNormalizedRangeToSource(view, { start: 1, end: 2 });
    expect(view.source.slice(range.sourceStart, range.sourceEnd)).toBe("ﬀ");
    expect(range.sourceStart).not.toBe(range.sourceEnd);
  });

  it("composition range：e+◌́ 组合为 é → 单个 canonical 字符映射回两个 source cp", () => {
    const view = buildNormalizedSourceView("Cafe\u0301");
    expect(view.normalized).toBe("café");
    const idx = view.normalized.indexOf("é");
    const range = mapNormalizedRangeToSource(view, { start: idx, end: idx + 1 });
    expect(view.source.slice(range.sourceStart, range.sourceEnd)).toBe("e\u0301");
  });
});

describe("searchLocalText", () => {
  it("中文 query 命中；matches bounded；matchCount 真实", () => {
    const doc = "政策认知显著影响低碳技术采纳行为，".repeat(2000);
    const r = searchLocalText(doc, "政策认知", { maxResults: 3 });
    expect(r.matches.length).toBeLessThanOrEqual(3);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.text.includes("政策认知"))).toBe(true);
    expect(r.matchCount).toBeGreaterThanOrEqual(r.matches.length);
  });

  it("300 段文本：总 snippet chars ≤ 总预算；matchCount 反映去重后候选数（V1.4.1 suppression 语义）", () => {
    const doc = Array.from({ length: 300 }, (_, i) => `page ${i + 1} common phrase content ${i}`).join("\n");
    const r = searchLocalText(doc, "common phrase", { maxResults: 8 });
    expect(r.matches.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_RESULTS);
    const total = r.matches.reduce((s, m) => s + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_TOTAL_CHARS);
    // 每段相距 <200 chars → 去重后候选显著少于 300（≈ 段数 × 段间距/200）
    expect(r.matchCount).toBeGreaterThan(0);
    expect(r.matchCount).toBeLessThan(300);
    expect(r.truncated).toBe(true);
  });

  it("无匹配 → matches=[]，不报错", () => {
    const r = searchLocalText("nothing here", "zzz_not_there");
    expect(r.matches).toEqual([]);
    expect(r.matchCount).toBe(0);
    expect(r.truncated).toBe(false);
  });
});

describe("searchPdfText（真实多页 PDF；bounded memory）", () => {
  it("150 页 PDF：全页扫描命中尾部 sentinel（不提前 break）", async () => {
    const pages = Array.from({ length: 150 }, (_, i) => (i === 149 ? "LONG_DOCUMENT_TAIL_SENTINEL marker" : `ordinary page content line ${i + 1}`));
    const pdf = buildMultiPageTextPdf(pages);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "LONG_DOCUMENT_TAIL_SENTINEL", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].page).toBe(150);
    // V1.4.3：Evidence 保持 source 原文大小写
    expect(r.matches[0].text).toContain("LONG_DOCUMENT_TAIL_SENTINEL");
  });

  it("高频率词跨多页：matches ≤ maxResults，总 chars ≤ 预算", async () => {
    const pages = Array.from({ length: 120 }, (_, i) => `section ${i + 1} contains common words`);
    const pdf = buildMultiPageTextPdf(pages);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "common", { maxResults: 8 });
    expect(r.matches.length).toBeLessThanOrEqual(8);
    const total = r.matches.reduce((s, m) => s + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_TOTAL_CHARS);
    expect(r.truncated).toBe(true);
  });

  it("PDF 多 term page ranking：page 10（policy+adoption+technology 同上下文）排在 page 2（仅 policy）前", async () => {
    const pages = ["intro page", "policy information only", "methodology", "data", "results"];
    while (pages.length < 10) pages.push("intermediate content");
    pages.push("technology adoption behavior is influenced by policy communication");
    const pdf = buildMultiPageTextPdf(pages);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "policy adoption technology", { maxResults: 8 });
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
    // page 11（1-based）含三个 term 同一局部上下文 → 必须排在最前
    expect(r.matches[0].page).toBe(11);
    const pagesInOrder = r.matches.map((m) => m.page);
    expect(pagesInOrder.indexOf(11)).toBeLessThan(pagesInOrder.indexOf(2));
  });

  it("PDF Evidence：expansion 在目标前 → Treatment Effect 保真命中（V1.4.3.1）", async () => {
    const pdf = buildMultiPageTextPdf(["oﬀice notes The Treatment Effect is ATT"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "treatment effect", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("Treatment Effect");
  });

  it("无匹配 → matches=[]", async () => {
    const pdf = buildMultiPageTextPdf(["alpha", "beta"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "gamma_delta");
    expect(r.matches).toEqual([]);
    expect(r.matchCount).toBe(0);
  });
});

describe("classifyPdfTextLayer（V1.4.2 canonical）", () => {
  const cases: { pages: number; chars: number; scanned: boolean }[] = [
    { pages: 1, chars: 0, scanned: true },
    { pages: 2, chars: 0, scanned: true },
    { pages: 1, chars: 20, scanned: false },
    { pages: 2, chars: 30, scanned: false },
    { pages: 3, chars: 30, scanned: true },
    { pages: 3, chars: 100, scanned: false },
  ];
  it("规则矩阵：零文本任何页数 → scanned；1–2 页短文本 → text；3+ 页 <40 → scanned", () => {
    for (const c of cases) {
      const r = classifyPdfTextLayer({ pageCount: c.pages, nonWhitespaceTextChars: c.chars });
      expect(r.possiblyScanned).toBe(c.scanned);
      expect(r.hasUsableTextLayer).toBe(!c.scanned);
    }
  });
});

describe("V1.4.3.1 offset mapping / parity / relevance", () => {
  const referenceNormalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

  it("A. expansion 在目标前：oﬀice 前置后 Treatment Effect 不漂移", () => {
    const doc = "oﬀice notes. The Treatment Effect is ATT.";
    const r = searchLocalText(doc, "treatment effect", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("The Treatment Effect");
  });

  it("B. canonical combining sequence：Cafe\u0301 → café parity + 命中", () => {
    const doc = "Cafe\u0301 Results";
    const r = searchLocalText(doc, "café results", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(normalizeLocalSearchText(doc)).toBe(referenceNormalize(doc));
  });

  it("C. TXT relevance order：后部高相关 candidate 必须排第一", () => {
    const doc =
      "policy only at the very beginning of the document " +
      "x".repeat(500) +
      " policy adoption technology appear together later";
    const r = searchLocalText(doc, "policy adoption technology", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("policy adoption technology");
    expect(r.matches[0].text).not.toContain("policy only");
  });

  it("normalization parity matrix", () => {
    const cases = ["ＡＢＣ１２３", "oﬀice", "Cafe\u0301", "\u212B", "  A\t\nB  ", "政策认知　技术采纳", "ﬁnancial ﬂow", "Στοιχεία"];
    for (const input of cases) {
      expect(normalizeLocalSearchText(input)).toBe(referenceNormalize(input));
    }
  });

  it("mapping：目标位于 expansion 之后（累计偏移不漂移）", () => {
    const doc = "prefix ﬀ middle Treatment Effect suffix";
    const r = searchLocalText(doc, "treatment effect", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("Treatment Effect");
  });

  it("mapping：多个 expansion 之后的目标", () => {
    const doc = "ＡＢＣ ﬀ Cafe\u0301 ... FINAL_TARGET";
    const r = searchLocalText(doc, "final_target", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("FINAL_TARGET");
  });

  it("mapping：surrogate pair 之前的目标（不切在 pair 中间）", () => {
    const doc = "😀 Intro — Treatment Effect";
    const r = searchLocalText(doc, "treatment effect", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("Treatment Effect");
  });

  it("TXT total-budget 按 relevance 消费：高相关 candidate 排第一（不受文档位置影响）", () => {
    const low = ("policy only content ".repeat(60)).slice(0, 1500);
    const high = "policy adoption technology at the tail " + "z".repeat(600);
    const doc = low + high;
    const r = searchLocalText(doc, "policy adoption technology", { maxResults: 8, snippetChars: 400, totalChars: 800 });
    expect(r.matches.length).toBeGreaterThan(0);
    // 第一条必须是后部高相关 Evidence（exact phrase 10_000 起跳；窗口回扩可能含前文，但匹配区必须在尾部）
    expect(r.matches[0].text).toContain("policy adoption technology");
    expect(r.matches[0].text).toContain("at the tail");
  });

  it("checkpoint 之后 expansion：>512 normalized chars 后仍有组合/扩张且目标可达", () => {
    const filler = "普通文本内容".repeat(140); // >512 normalized chars
    const doc = filler + " ＡＢＣ ﬀ Cafe\u0301 ... CHECKPOINT_TAIL_TARGET";
    const r = searchLocalText(doc, "checkpoint_tail_target", { maxResults: 5 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text).toContain("CHECKPOINT_TAIL_TARGET");
  });
});

describe("searchPdfText text-layer metadata（V1.4.2）", () => {
  it("扫描 PDF（3 页零文本）→ textLayer.possiblyScanned=true", async () => {
    const blob = new Blob([buildScannedPdf().buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "anything", { maxResults: 5 });
    expect(r.textLayer.possiblyScanned).toBe(true);
    expect(r.textLayer.pageCount).toBe(3);
    expect(r.matches).toEqual([]);
  });

  it("普通 text PDF → textLayer.possiblyScanned=false（即使 query 无匹配）", async () => {
    const pdf = buildMultiPageTextPdf(["This document discusses agriculture."]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "quantum", { maxResults: 5 });
    expect(r.textLayer.possiblyScanned).toBe(false);
    expect(r.matches).toEqual([]);
    expect(r.matchCount).toBe(0);
  });

  it("1 页零文本 PDF → scanned（V1.4.2 修复：单页扫描通知页）", async () => {
    const pdf = buildMultiPageTextPdf([" "]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "x", { maxResults: 5 });
    expect(r.textLayer.possiblyScanned).toBe(true);
    expect(r.textLayer.pageCount).toBe(1);
  });

  it("1 页短文本 PDF → text-layer（不误判扫描件）", async () => {
    const pdf = buildMultiPageTextPdf(["DDL: 2026-08-20"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "DDL", { maxResults: 5 });
    expect(r.textLayer.possiblyScanned).toBe(false);
    expect(r.matches.length).toBeGreaterThan(0);
  });
});

describe("extractPdfPagesText（定向页正文）", () => {
  it("只读取明确页面；返回真实 numPages", async () => {
    const pdf = buildMultiPageTextPdf(["first page text", "second page text", "third page text"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await extractPdfPagesText(blob, [2, 3]);
    expect(r.numPages).toBe(3);
    expect(r.pages.map((p) => p.page)).toEqual([2, 3]);
    expect(r.pages[0].text).toContain("second");
    expect(r.pages[1].text).toContain("third");
  });

  it("越界页 → invalid 标记（不 getPage、不抛错）", async () => {
    const pdf = buildMultiPageTextPdf(["a", "b"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await extractPdfPagesText(blob, [999]);
    expect(r.numPages).toBe(2);
    expect(r.invalid).toEqual([999]);
    expect(r.pages).toEqual([]);
  });
});

