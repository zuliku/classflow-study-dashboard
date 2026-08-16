/**
 * Local Document Search Primitives（V1.4）：normalize / tokenize / scoring / snippet /
 * searchLocalText / searchPdfText / extractPdfPagesText。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLocalSearchText,
  tokenizeLocalSearchQuery,
  scoreLocalSearch,
  buildLocalSearchSnippet,
  searchLocalText,
  searchPdfText,
  extractPdfPagesText,
} from "@/lib/ai/attachments/documentSearch";
import {
  MAX_PROJECT_SEARCH_SNIPPET_CHARS,
  MAX_PROJECT_SEARCH_TOTAL_CHARS,
  MAX_PROJECT_SEARCH_RESULTS,
} from "@/lib/ai/attachments/limits";
import { buildMultiPageTextPdf } from "@/tests/fixtures/files";

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

describe("buildLocalSearchSnippet", () => {
  it("总长 ≤ MAX_PROJECT_SEARCH_SNIPPET_CHARS；含匹配区域", () => {
    const text = "x".repeat(5000) + "THE_MATCH" + "y".repeat(5000);
    const scored = scoreLocalSearch(normalizeLocalSearchText(text), tokenizeLocalSearchQuery("THE_MATCH"));
    const snippet = buildLocalSearchSnippet(normalizeLocalSearchText(text), scored[0]);
    expect(snippet.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_SNIPPET_CHARS);
    expect(snippet).toContain("the_match");
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
    expect(r.matches[0].text).toContain("long_document_tail_sentinel");
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

  it("无匹配 → matches=[]", async () => {
    const pdf = buildMultiPageTextPdf(["alpha", "beta"]);
    const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
    const r = await searchPdfText(blob, "gamma_delta");
    expect(r.matches).toEqual([]);
    expect(r.matchCount).toBe(0);
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

