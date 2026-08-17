import { describe, it, expect } from "vitest";
import {
  formatKiroToolActivityHeadline,
  formatWebSearchQueryForActivity,
  WEB_ACTIVITY_QUERY_MAX_CHARS,
} from "@/lib/ai/presentation/toolActivityDetails";
import {
  collectCitedWebSources,
  isSafeWebUrl,
} from "@/lib/ai/citations/parser";
import { KiroSourceMeta } from "@/lib/ai/citations/types";

const WEB_SOURCES: KiroSourceMeta[] = [
  {
    sourceId: "web-1",
    name: "新学期选课通知",
    source: "web",
    url: "https://example.com/notice",
    domain: "example.com",
    publishedAt: "2026-08-01",
  },
  {
    sourceId: "web-2",
    name: "选课系统使用说明",
    source: "web",
    url: "http://docs.example.com/guide",
    domain: "docs.example.com",
  },
  {
    sourceId: "doc-1",
    name: "第三章讲义.pdf",
    source: "chat",
    availablePages: [1, 2, 3],
  },
];

const searchInput = (query?: unknown) => ({ query, includeDomains: ["edu.cn"] });
const searchOutput = (n: number) => ({ ok: true, data: { results: Array.from({ length: n }, () => ({})) } });

const readInput = (sourceIds: unknown) => ({ sourceIds });

describe("formatWebSearchQueryForActivity", () => {
  it("1. 合法 query 原样返回", () => {
    expect(formatWebSearchQueryForActivity(searchInput("新学期 选课"))).toBe("新学期 选课");
  });
  it("2. trim + 折叠连续空白", () => {
    expect(formatWebSearchQueryForActivity(searchInput("  新学期\t  选课  "))).toBe("新学期 选课");
  });
  it("3. 超长 query 截断（69 字符 + …）", () => {
    const long = "a".repeat(100);
    const out = formatWebSearchQueryForActivity(searchInput(long));
    expect(out.length).toBe(69 + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(WEB_ACTIVITY_QUERY_MAX_CHARS);
  });
  it("4. 非 string / 缺失 / 空 → 空字符串", () => {
    expect(formatWebSearchQueryForActivity(searchInput(42))).toBe("");
    expect(formatWebSearchQueryForActivity(searchInput(undefined))).toBe("");
    expect(formatWebSearchQueryForActivity(searchInput("   "))).toBe("");
    expect(formatWebSearchQueryForActivity(undefined)).toBe("");
  });
});

describe("formatKiroToolActivityHeadline — web_search", () => {
  it("5. working 显示「正在搜索网页：query」；无 query → 通用文案", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "web_search",
        status: "working",
        input: searchInput("新学期 选课"),
      })
    ).toBe("正在搜索网页：新学期 选课");
    expect(
      formatKiroToolActivityHeadline({ toolName: "web_search", status: "working" })
    ).toBe("正在搜索网页…");
  });
  it("6. done 显示「已搜索网页：query · N 个来源」", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "web_search",
        status: "done",
        input: searchInput("新学期 选课"),
        output: searchOutput(3),
      })
    ).toBe("已搜索网页：新学期 选课 · 3 个来源");
  });
  it("7. done 无 query → 「搜索网页 · N 个来源」", () => {
    expect(
      formatKiroToolActivityHeadline({ toolName: "web_search", status: "done", output: searchOutput(2) })
    ).toBe("搜索网页 · 2 个来源");
  });
  it("8. error 显示「网页搜索失败：query」；无 query → 通用失败文案", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "web_search",
        status: "error",
        input: searchInput("新学期 选课"),
      })
    ).toBe("网页搜索失败：新学期 选课");
    expect(formatKiroToolActivityHeadline({ toolName: "web_search", status: "error" })).toBe("网页搜索失败");
  });
});

describe("formatKiroToolActivityHeadline — read_web_source", () => {
  const trusted = new Map([
    ["web-1", { title: "新学期选课通知", domain: "example.com" }],
    ["web-2", { title: "选课系统使用说明", domain: "docs.example.com" }],
  ]);

  it("9. working 单来源 → 已解析 title；多来源 → 数量", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "working",
        input: readInput(["web-1"]),
        trustedWebSources: trusted,
      })
    ).toBe("正在阅读网页：新学期选课通知");
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "working",
        input: readInput(["web-1", "web-2"]),
        trustedWebSources: trusted,
      })
    ).toBe("正在阅读 2 个网页来源");
  });
  it("10. working 来源不在 lookup / 无 input → 通用文案", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "working",
        input: readInput(["unknown-9"]),
        trustedWebSources: trusted,
      })
    ).toBe("正在阅读网页…");
    expect(
      formatKiroToolActivityHeadline({ toolName: "read_web_source", status: "working" })
    ).toBe("正在阅读网页…");
  });
  it("11. done 单来源 → 「已阅读网页：title」；多来源成功 → 「已阅读 N 个网页来源」", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "done",
        input: readInput(["web-1"]),
        output: { ok: true, data: { sources: [{ id: "web-1" }] } },
        trustedWebSources: trusted,
      })
    ).toBe("已阅读网页：新学期选课通知");
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "done",
        input: readInput(["web-1", "web-2"]),
        output: { ok: true, data: { sources: [{ id: "web-1" }, { id: "web-2" }] } },
        trustedWebSources: trusted,
      })
    ).toBe("已阅读 2 个网页来源");
  });
  it("12. done 全部失败（empty evidence / 无 output）→ 「网页内容读取失败」", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "done",
        input: readInput(["web-1"]),
        output: { ok: true, data: { sources: [] } },
        trustedWebSources: trusted,
      })
    ).toBe("网页内容读取失败");
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "done",
        input: readInput(["web-1"]),
        trustedWebSources: trusted,
      })
    ).toBe("网页内容读取失败");
  });
  it("12b. Partial Success：请求 2 个、成功 1 个 → 「已阅读 1 个网页来源」（主行不展示失败 ID）", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "read_web_source",
        status: "done",
        input: readInput(["web-1", "web-2"]),
        output: { ok: true, data: { sources: [{ sourceId: "web-1" }] } },
        trustedWebSources: trusted,
      })
    ).toBe("已阅读 1 个网页来源");
  });
  it("13. 超长 title 截断（52 字符内）", () => {
    const long = "标".repeat(80);
    const out = formatKiroToolActivityHeadline({
      toolName: "read_web_source",
      status: "working",
      input: readInput(["w"]),
      trustedWebSources: new Map([["w", { title: long, domain: "example.com" }]]),
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(52 + "正在阅读网页：".length);
    expect(out!.endsWith("…")).toBe(true);
  });
  it("14. 非 web Tool → null（UI 回退 block.label；不重写其它 Tool 文案）", () => {
    expect(
      formatKiroToolActivityHeadline({
        toolName: "search_assignments",
        status: "working",
        input: searchInput("secret query"),
      })
    ).toBeNull();
    expect(
      formatKiroToolActivityHeadline({
        toolName: "update_assignment",
        status: "done",
        input: searchInput("secret query"),
        output: { ok: true },
      })
    ).toBeNull();
  });
});

describe("collectCitedWebSources", () => {
  it("15. 引用的 web sources 按首次出现顺序去重", () => {
    const out = collectCitedWebSources(
      "正文[[source:web-2]]再[[source:web-1]]又[[source:web-2]]结束",
      WEB_SOURCES
    );
    expect(out.map((s) => s.sourceId)).toEqual(["web-2", "web-1"]);
  });
  it("16. 未引用 / 无 registry / 非 web → 空数组", () => {
    expect(collectCitedWebSources("没有引用", WEB_SOURCES)).toEqual([]);
    expect(collectCitedWebSources("[[source:web-1]]")).toEqual([]);
    expect(collectCitedWebSources("[[source:doc-1:p1]]", WEB_SOURCES)).toEqual([]);
  });
  it("17. 无效 sourceId 被 resolve 拦截，不进入 tray", () => {
    expect(collectCitedWebSources("[[source:nope]]和[[source:web-1]]", WEB_SOURCES).map((s) => s.sourceId)).toEqual([
      "web-1",
    ]);
  });
  it("18. isSafeWebUrl 只放行 http/https", () => {
    expect(isSafeWebUrl("https://example.com/a")).toBe(true);
    expect(isSafeWebUrl("http://example.com/a")).toBe(true);
    expect(isSafeWebUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeWebUrl("data:text/html,x")).toBe(false);
    expect(isSafeWebUrl(undefined)).toBe(false);
    expect(isSafeWebUrl("not a url")).toBe(false);
  });
});
