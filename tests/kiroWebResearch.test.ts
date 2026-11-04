import { describe, expect, it, vi } from "vitest";
import {
  createKiroWebResearchTool,
  normalizeResearchQueries,
} from "@/lib/ai/web/research";
import {
  inspectCurrentTurnWebSearchState,
  resolveCurrentTurnWebSources,
} from "@/lib/ai/web/tool";
import { createKiroWebTurnState } from "@/lib/ai/web/turnState";
import type { KiroWebSearchProvider } from "@/lib/ai/web/provider";
import type { KiroWebSearchResult } from "@/lib/ai/web/types";

function result(url: string, domain: string, title = domain): KiroWebSearchResult {
  return { sourceId: "", url, domain, title, snippet: `snippet ${url}` };
}

function providerOf(byQuery: Record<string, KiroWebSearchResult[] | Error>): KiroWebSearchProvider {
  return {
    id: "tavily",
    search: vi.fn(async (request) => {
      const value = byQuery[request.query];
      if (value instanceof Error) throw value;
      return { ok: true as const, query: request.query, count: value?.length ?? 0, results: value ?? [] };
    }),
    checkCredential: vi.fn(async () => ({ ok: true as const })),
  };
}

function makeTool(provider: KiroWebSearchProvider, state = createKiroWebTurnState({ attemptsSoFar: 0, nextSourceIndex: 1 })) {
  return {
    state,
    tool: createKiroWebResearchTool({
      provider,
      credential: { mode: "byok", userApiKey: "sk-test" },
      state,
    }),
  };
}

describe("normalizeResearchQueries", () => {
  it("queries 省略 → topic；去重/trim；最多 3 个", () => {
    expect(normalizeResearchQueries({ topic: "  AI   agents  " })).toEqual(["AI agents"]);
    expect(
      normalizeResearchQueries({
        topic: "ignored",
        queries: [" a ", "A", "b", "c", "d"],
      })
    ).toEqual(["a", "b", "c"]);
  });
});

describe("web_research tool", () => {
  it("并发执行多个 query；sourceId 连续且跨 query 去重", async () => {
    const provider = providerOf({
      q1: [result("https://a.dev/1", "a.dev"), result("https://a.dev/2", "a.dev"), result("https://a.dev/3", "a.dev")],
      q2: [result("https://a.dev/1", "a.dev"), result("https://b.dev/1", "b.dev")],
    });
    const { tool, state } = makeTool(provider);
    const r = (await tool.execute?.({ topic: "topic", queries: ["q1", "q2"] }, {} as never)) as {
      ok: true;
      data: { queries: string[]; queryResults: { query: string; count: number }[]; results: { sourceId: string; url: string }[]; skippedQueries: string[] };
    };
    expect(r.ok).toBe(true);
    expect(provider.search).toHaveBeenCalledTimes(2);
    // 单域最多 2 条（a.dev/1、a.dev/2），总 sourceId 连续
    expect(r.data.results.map((x) => x.url)).toEqual([
      "https://a.dev/1",
      "https://a.dev/2",
      "https://b.dev/1",
    ]);
    expect(r.data.results.map((x) => x.sourceId)).toEqual(["web-1", "web-2", "web-3"]);
    expect(state.nextSourceIndex).toBe(4);
    expect(state.remainingSearchAttempts).toBe(1);
    expect(r.data.skippedQueries).toEqual([]);
  });

  it("部分失败仍返回成功 query；失败 query 不标记成功", async () => {
    const provider = providerOf({
      ok: [result("https://a.dev/1", "a.dev")],
      reject: new Error("boom"),
      fail: new Error("ignored"),
    });
    // 第二个 query 走 rejected；第三个走 provider throw。两个失败都安全归一化。
    const spy = vi.spyOn(provider, "search");
    spy.mockImplementation(async (request) => {
      if (request.query === "reject") throw new Error("boom");
      if (request.query === "fail") return { ok: false as const, code: "WEB_SEARCH_TIMEOUT", message: "timeout" };
      return { ok: true as const, query: request.query, count: 1, results: [result("https://a.dev/1", "a.dev")] };
    });
    const { tool, state } = makeTool(provider);
    const r = (await tool.execute?.({ topic: "t", queries: ["ok", "reject", "fail"] }, {} as never)) as {
      ok: true;
      data: { queryResults: { query: string }[]; failedQueries: { query: string; code: string }[] };
    };
    expect(r.ok).toBe(true);
    expect(r.data.queryResults.map((q) => q.query)).toEqual(["ok"]);
    expect(r.data.failedQueries.map((q) => q.query).sort()).toEqual(["fail", "reject"]);
    expect(state.successfulQueries.has("ok")).toBe(true);
    expect(state.successfulQueries.has("reject")).toBe(false);
  });

  it("全部失败 → 安全错误（不透传 provider raw message）", async () => {
    const provider = providerOf({ a: new Error("RAW PROVIDER STACK"), b: new Error("RAW") });
    const { tool } = makeTool(provider);
    const r = (await tool.execute?.({ topic: "t", queries: ["a", "b"] }, {} as never)) as {
      ok: false;
      code: string;
      message: string;
    };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WEB_SEARCH_FAILED");
    expect(r.message).not.toContain("RAW PROVIDER");
  });

  it("共享搜索预算：只剩 1 次时只执行 1 个 query，其余 skipped", async () => {
    const provider = providerOf({ q1: [result("https://a.dev/1", "a.dev")], q2: [], q3: [] });
    const state = createKiroWebTurnState({ attemptsSoFar: 2, nextSourceIndex: 1 });
    const { tool } = makeTool(provider, state);
    const r = (await tool.execute?.({ topic: "t", queries: ["q1", "q2", "q3"] }, {} as never)) as {
      ok: true;
      data: { queries: string[]; skippedQueries: string[] };
    };
    expect(r.ok).toBe(true);
    expect(r.data.queries).toEqual(["q1"]);
    expect(r.data.skippedQueries).toEqual(["q2", "q3"]);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(state.remainingSearchAttempts).toBe(0);
  });

  it("重复 query 不再消耗预算", async () => {
    const provider = providerOf({ q1: [] });
    const state = createKiroWebTurnState({ attemptsSoFar: 0, nextSourceIndex: 1 });
    state.successfulQueries.add("q1");
    const { tool } = makeTool(provider, state);
    const r = (await tool.execute?.({ topic: "t", queries: ["q1"] }, {} as never)) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WEB_SEARCH_DUPLICATE_QUERY");
    expect(provider.search).not.toHaveBeenCalled();
    expect(state.remainingSearchAttempts).toBe(3);
  });
});

describe("research source trust chain", () => {
  it("resolveCurrentTurnWebSources 包含 web_research 结果", () => {
    const sources = resolveCurrentTurnWebSources([
      { role: "user", parts: [{ type: "text", text: "research" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-web_research",
            toolCallId: "r1",
            output: { ok: true, data: { results: [{ ...result("https://a.dev/1", "a.dev"), sourceId: "web-7" }] } },
          },
        ],
      },
    ]);
    expect(sources).toEqual([
      { sourceId: "web-7", title: "a.dev", url: "https://a.dev/1", domain: "a.dev", publishedAt: undefined },
    ]);
  });

  it("inspectCurrentTurnWebSearchState 按 research query 数计 attempts，并推进 nextSourceIndex", () => {
    const s = inspectCurrentTurnWebSearchState([
      { role: "user", parts: [{ type: "text", text: "research" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-web_research",
            toolCallId: "r1",
            output: {
              ok: true,
              data: {
                queries: ["q1", "q2"],
                failedQueries: [],
                results: [{ ...result("https://a.dev/1", "a.dev"), sourceId: "web-9" }],
              },
            },
          },
        ],
      },
    ]);
    expect(s.attempts).toBe(2);
    expect(s.nextSourceIndex).toBe(10);
    expect(s.successfulQueries).toEqual(["q1", "q2"]);
    expect(s.seenUrls).toEqual(["https://a.dev/1"]);
  });
});
