import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExaKeylessWebSearchProvider,
  EXA_MCP_ENDPOINT,
  EXA_SEARCH_TOOL,
} from "@/lib/ai/web/keyless/exa";
import {
  createParallelKeylessWebSearchProvider,
  PARALLEL_MCP_ENDPOINT,
  PARALLEL_SEARCH_TOOL,
} from "@/lib/ai/web/keyless/parallel";
import {
  createKeylessEvidenceRouter,
  createKeylessSearchRouter,
} from "@/lib/ai/web/keyless/router";
import type { KiroWebEvidenceProvider, KiroWebSearchProvider } from "@/lib/ai/web/provider";
import type {
  KiroWebEvidenceOutcome,
  KiroWebSearchOutcome,
  KiroWebSearchRequest,
} from "@/lib/ai/web/types";

const EXA_TEXT = [
  "Title: Example official page",
  "URL: https://www.example.com/a?utm_source=x",
  "Published: 2026-11-03T00:00:00.000Z",
  "Author: N/A",
  "Highlights:",
  "Example snippet with <b>HTML</b> &amp; entities.",
  "",
  "---",
  "",
  "Title: Second page",
  "URL: https://news.example.org/b",
  "Published: N/A",
  "Highlights:",
  "Second snippet.",
].join("\n");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(payload: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function exaSearchResponse(text = EXA_TEXT): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  };
}

function parallelSearchResponse(results: unknown[]): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify({ results }) }],
    },
  };
}

function rateLimitResponse(message = "You've hit the free-tier rate limit for Parallel Search MCP."): unknown {
  return { jsonrpc: "2.0", id: 1, error: { code: -32000, message } };
}

function makeFakeProvider(id: "exa" | "parallel", overrides?: {
  search?: (request: KiroWebSearchRequest) => Promise<KiroWebSearchOutcome>;
  extract?: () => Promise<KiroWebEvidenceOutcome>;
}): KiroWebSearchProvider & KiroWebEvidenceProvider {
  return {
    id,
    search: vi.fn(
      overrides?.search ??
        (async (request) => ({
          ok: true,
          query: request.query,
          count: 1,
          results: [
            {
              sourceId: "",
              title: `${id} result`,
              url: `https://${id}.example.com/result`,
              domain: `${id}.example.com`,
              snippet: "snippet",
            },
          ],
        }))
    ),
    checkCredential: vi.fn(async () => ({ ok: true })),
    extract: vi.fn(
      overrides?.extract ??
        (async () => ({
          ok: true,
          sources: [
            {
              sourceId: "web-1",
              title: "",
              url: "https://example.com/a",
              domain: "",
              chunks: [{ text: "evidence" }],
              truncated: false,
            },
          ],
        }))
    ),
  } as KiroWebSearchProvider & KiroWebEvidenceProvider;
}

describe("Exa keyless adapter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("发送固定 endpoint + JSON-RPC tools/call；解析 Exa 文本块并归一化", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(exaSearchResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createExaKeylessWebSearchProvider({ endpoint: EXA_MCP_ENDPOINT });
    const outcome = await provider.search(
      { query: "latest AI news", topic: "news", timeRange: "week" },
      { apiKey: "", signal: new AbortController().signal }
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]).toMatchObject({
      title: "Example official page",
      url: "https://www.example.com/a?utm_source=x",
      domain: "example.com",
      publishedAt: "2026-11-03",
    });
    expect(outcome.results[0].snippet).toContain("HTML");
    expect(outcome.results[0].snippet).not.toContain("<b>");
    expect(outcome.results[0].sourceId).toBe("");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXA_MCP_ENDPOINT);
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe(EXA_SEARCH_TOOL);
    expect(body.params.arguments.query).toBe("latest AI news");
    expect(body.params.arguments.numResults).toBe(8);
    expect(String(body.params.arguments.objective)).toContain("recent news");
  });

  it("includeDomains / excludeDomains / timeRange 后过滤", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(exaSearchResponse())));
    const provider = createExaKeylessWebSearchProvider();
    const outcome = await provider.search(
      {
        query: "q",
        includeDomains: ["example.com"],
        excludeDomains: ["news.example.org"],
        timeRange: "week",
      },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results.map((r) => r.domain)).toEqual(["example.com"]);
  });

  it("429 → WEB_SEARCH_RATE_LIMITED，不泄漏 provider 原始 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { error: "secret provider body" } }), { status: 429 })
      )
    );
    const provider = createExaKeylessWebSearchProvider();
    const outcome = await provider.search(
      { query: "q" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("WEB_SEARCH_RATE_LIMITED");
      expect(outcome.message).not.toContain("secret provider body");
    }
  });

  it("HTTP 200 + JSON-RPC rate-limit error → 安全 rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(rateLimitResponse())));
    const provider = createExaKeylessWebSearchProvider();
    const outcome = await provider.search(
      { query: "q" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("WEB_SEARCH_RATE_LIMITED");
  });

  it("web_fetch_exa：按 URL 映射 evidence，不产生页码", async () => {
    const long = "这一段是网页正文证据，用于验证 keyless fallback 的归一化与 chunk 预算。".repeat(8);
    const fetchText = [
      "# Official page",
      "URL: https://example.com/a",
      "Published: 2026-11-03",
      "",
      long,
      "",
      "---",
      "",
      "# Second page",
      "URL: https://example.org/b",
      "Published: N/A",
      "",
      long,
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: fetchText }] },
        })
      )
    );
    const provider = createExaKeylessWebSearchProvider();
    const outcome = await provider.extract(
      {
        sources: [
          { sourceId: "web-1", url: "https://example.com/a" },
          { sourceId: "web-2", url: "https://example.org/b" },
        ],
      },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sources.map((s) => s.sourceId)).toEqual(["web-1", "web-2"]);
    expect(outcome.sources.every((s) => s.availablePages === undefined)).toBe(true);
    expect(outcome.sources[0].chunks.length).toBeGreaterThan(0);
  });

  it("超时 → WEB_SEARCH_TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      })
    );
    const provider = createExaKeylessWebSearchProvider();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const outcome = await provider.search({ query: "q" }, { apiKey: "", signal: controller.signal });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("WEB_SEARCH_TIMEOUT");
  });
});

describe("Parallel keyless adapter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("发送 session_id / objective / search_queries，解析 structured results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        parallelSearchResponse([
          {
            url: "https://www.chsi.com.cn/yzwb/",
            title: "研招网",
            publish_date: "2026-10-01",
            excerpts: ["报名时间", "考试时间"],
          },
        ])
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createParallelKeylessWebSearchProvider({ sessionId: "test-session" });
    const outcome = await provider.search(
      { query: "2026 考研报名时间", includeDomains: ["chsi.com.cn"] },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results[0]).toMatchObject({
      title: "研招网",
      domain: "chsi.com.cn",
      publishedAt: "2026-10-01",
    });
    expect(outcome.results[0].snippet).toContain("报名时间");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PARALLEL_MCP_ENDPOINT);
    const body = JSON.parse(String(init.body)) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(body.params.name).toBe(PARALLEL_SEARCH_TOOL);
    expect(body.params.arguments.session_id).toBe("test-session");
    expect(body.params.arguments.search_queries).toEqual(["2026 考研报名时间", "site:chsi.com.cn"]);
  });

  it("HTTP 200 + free-tier JSON-RPC error → rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(rateLimitResponse())));
    const provider = createParallelKeylessWebSearchProvider({ sessionId: "s" });
    const outcome = await provider.search(
      { query: "q" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("WEB_SEARCH_RATE_LIMITED");
  });

  it("web_fetch：按 URL 映射 excerpts 为 evidence，不产生页码", async () => {
    const long = "Parallel excerpt evidence ".repeat(20);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                text: JSON.stringify({
                  results: [
                    {
                      url: "https://example.com/a",
                      title: "Official page",
                      publish_date: "2026-11-03",
                      excerpts: [long, long],
                    },
                  ],
                }),
              },
            ],
          },
        })
      )
    );
    const provider = createParallelKeylessWebSearchProvider({ sessionId: "s" });
    const outcome = await provider.extract(
      { sources: [{ sourceId: "web-1", url: "https://example.com/a" }], query: "evidence" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0].sourceId).toBe("web-1");
    expect(outcome.sources[0].url).toBe("https://example.com/a");
    expect(outcome.sources[0].availablePages).toBeUndefined();
    expect(outcome.sources[0].chunks.length).toBeGreaterThan(0);
  });
});

describe("Keyless search router", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非 CJK：Exa 成功 → 不调用 Parallel", async () => {
    const exa = makeFakeProvider("exa");
    const parallel = makeFakeProvider("parallel");
    const router = createKeylessSearchRouter({ exa, parallel });
    const outcome = await router.provider.search(
      { query: "latest AI news" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    expect(exa.search).toHaveBeenCalledTimes(1);
    expect(parallel.search).not.toHaveBeenCalled();
  });

  it("CJK：Parallel 优先；Parallel 失败 → Exa", async () => {
    const exa = makeFakeProvider("exa");
    const parallel = makeFakeProvider("parallel", {
      search: async () => ({
        ok: false,
        code: "WEB_SEARCH_RATE_LIMITED",
        message: "limited",
      }),
    });
    const router = createKeylessSearchRouter({ exa, parallel });
    const outcome = await router.provider.search(
      { query: "2026 考研报名时间" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    expect(parallel.search).toHaveBeenCalledTimes(1);
    expect(exa.search).toHaveBeenCalledTimes(1);
  });

  it("相同 query 命中缓存；并发 single-flight", async () => {
    let resolveSearch: ((outcome: KiroWebSearchOutcome) => void) | null = null;
    const exa = makeFakeProvider("exa", {
      search: () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    });
    const parallel = makeFakeProvider("parallel");
    const router = createKeylessSearchRouter({ exa, parallel });
    const request: KiroWebSearchRequest = { query: "cache me" };
    const first = router.provider.search(request, { apiKey: "", signal: new AbortController().signal });
    const second = router.provider.search(request, { apiKey: "", signal: new AbortController().signal });
    expect(exa.search).toHaveBeenCalledTimes(1);
    resolveSearch?.({
      ok: true,
      query: "cache me",
      count: 1,
      results: [
        {
          sourceId: "web-9",
          title: "t",
          url: "https://a.dev/1",
          domain: "a.dev",
          snippet: "s",
        },
      ],
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.results[0].sourceId).toBe("");
      expect(b.results[0].sourceId).toBe("");
    }
    const third = await router.provider.search(request, { apiKey: "", signal: new AbortController().signal });
    expect(third.ok).toBe(true);
    expect(exa.search).toHaveBeenCalledTimes(1);
  });

  it("provider 进入冷却后自动切换；全部冷却 → rate limited", async () => {
    let clock = 1_000;
    const exa = makeFakeProvider("exa", {
      search: async () => ({ ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: "limited" }),
    });
    const parallel = makeFakeProvider("parallel", {
      search: async () => ({ ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: "limited" }),
    });
    const router = createKeylessSearchRouter({ exa, parallel, now: () => clock });
    const first = await router.provider.search(
      { query: "q1" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("WEB_SEARCH_RATE_LIMITED");
    const callsAfterFirst = { exa: exa.search.mock.calls.length, parallel: parallel.search.mock.calls.length };
    const second = await router.provider.search(
      { query: "q2" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(second.ok).toBe(false);
    expect(exa.search.mock.calls.length).toBe(callsAfterFirst.exa);
    expect(parallel.search.mock.calls.length).toBe(callsAfterFirst.parallel);

    clock += 61_000;
    parallel.search.mockResolvedValueOnce({
      ok: true,
      query: "q3",
      count: 1,
      results: [{ sourceId: "", title: "t", url: "https://a.dev/3", domain: "a.dev", snippet: "s" }],
    });
    const third = await router.provider.search(
      { query: "q3" },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(third.ok).toBe(true);
  });
});

describe("Keyless evidence router", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Exa 失败 → Parallel 成功", async () => {
    const exa = makeFakeProvider("exa", {
      extract: async () => ({ ok: false, code: "WEB_READ_FAILED", message: "failed" }),
    });
    const parallel = makeFakeProvider("parallel");
    const router = createKeylessEvidenceRouter({ exa, parallel });
    const outcome = await router.provider.extract(
      { sources: [{ sourceId: "web-1", url: "https://example.com/a" }] },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(true);
    expect(exa.extract).toHaveBeenCalledTimes(1);
    expect(parallel.extract).toHaveBeenCalledTimes(1);
  });

  it("全部失败 → 安全错误", async () => {
    const exa = makeFakeProvider("exa", {
      extract: async () => ({ ok: false, code: "WEB_READ_FAILED", message: "failed" }),
    });
    const parallel = makeFakeProvider("parallel", {
      extract: async () => ({ ok: false, code: "WEB_READ_FAILED", message: "failed" }),
    });
    const router = createKeylessEvidenceRouter({ exa, parallel });
    const outcome = await router.provider.extract(
      { sources: [{ sourceId: "web-1", url: "https://example.com/a" }] },
      { apiKey: "", signal: new AbortController().signal }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(["WEB_READ_FAILED", "WEB_READ_NO_EVIDENCE"]).toContain(outcome.code);
  });
});
