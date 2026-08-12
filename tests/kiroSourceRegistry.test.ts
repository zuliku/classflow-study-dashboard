import { describe, it, expect } from "vitest";
import { enrichWebSourcePages, normalizeAvailablePages, KiroWebPageEnrichment } from "@/lib/ai/citations/sourceRegistry";
import { KiroSourceMeta } from "@/lib/ai/citations/types";

const web = (sourceId: string, availablePages?: number[]): KiroSourceMeta => ({
  sourceId,
  name: sourceId,
  source: "web",
  url: `https://example.com/${sourceId}`,
  domain: "example.com",
  ...(availablePages ? { availablePages } : {}),
});

describe("enrichWebSourcePages — Task 19B1", () => {
  it("Case A. immutable enrichment：输入对象不被修改，结果为新对象", () => {
    const source = web("web-3", [8]);
    const sources = [source];
    const result = enrichWebSourcePages(sources, [{ sourceId: "web-3", availablePages: [12] }]);

    expect(result).not.toBe(sources);
    expect(result[0]).not.toBe(source);
    expect(result[0].availablePages).toEqual([8, 12]);
    expect(source.availablePages).toEqual([8]); // 原对象不变
    expect(sources[0]).toBe(source);
  });

  it("Case B. unknown / non-web source 一律 ignore → 返回原数组", () => {
    const sources = [web("web-3"), { ...web("doc-1"), source: "chat" as const }];
    const enrichments: KiroWebPageEnrichment[] = [
      { sourceId: "web-999", availablePages: [3] }, // 未知
      { sourceId: "doc-1", availablePages: [4] }, // 非 web
      { sourceId: "web-3", availablePages: [] }, // 空列表
    ];
    const result = enrichWebSourcePages(sources, enrichments);
    expect(result).toBe(sources);
  });

  it("Case C. 页码归一（正整数/dedupe/sort）+ 幂等", () => {
    expect(normalizeAvailablePages([12, 8, 12, -1, 0, 3.5])).toEqual([8, 12]);

    const sources = [web("web-3", [8])];
    const first = enrichWebSourcePages(sources, [{ sourceId: "web-3", availablePages: [12, 8, 12, -1, 0, 3.5] }]);
    expect(first[0].availablePages).toEqual([8, 12]);

    // 幂等：再次合并同样的页码 → 同一数组引用（避免 streaming update 触发无意义 setSources）
    const second = enrichWebSourcePages(first, [{ sourceId: "web-3", availablePages: [12] }]);
    expect(second).toBe(first);
  });

  it("Case D. structural sharing：未变化 source 复用引用，变化 source 为新对象", () => {
    const sources = [web("web-1"), web("web-2", [1])];
    const next = enrichWebSourcePages(sources, [{ sourceId: "web-2", availablePages: [12] }]);
    expect(next[0]).toBe(sources[0]); // web-1 unchanged
    expect(next[1]).not.toBe(sources[1]); // web-2 changed
    expect(next[1].availablePages).toEqual([1, 12]);
  });

  it("同一 effect 内 fresh source + enrichment 合并（不依赖 Tool 顺序）", () => {
    // 模拟 web_search 与 read_web_source 同一次 render 到达：base 已含 fresh web-3
    const base = [web("web-1"), web("web-3")];
    const next = enrichWebSourcePages(base, [{ sourceId: "web-3", availablePages: [12] }]);
    expect(next.length).toBe(2);
    expect(next[1].sourceId).toBe("web-3");
    expect(next[1].availablePages).toEqual([12]);
    expect(next[0]).toBe(base[0]);
  });
});
