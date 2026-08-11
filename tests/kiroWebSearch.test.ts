import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTavilyWebSearchProvider, TAVILY_SEARCH_URL, webSearchSafeMessage, canonicalWebSearchUrl } from "@/lib/ai/web/tavily";
import { resolveWebSearchCredential, getSessionWebSearchApiKey, setSessionWebSearchApiKey } from "@/lib/ai/web/credentials";
import { MAX_WEB_RESULTS } from "@/lib/ai/web/types";
import { kiroWebSearchInputSchema, normalizeWebSearchDomain } from "@/lib/ai/web/schemas";
import { createKiroWebSearchTool, inspectCurrentTurnWebSearchState } from "@/lib/ai/web/tool";
import { createTavilyWebSearchProvider as _unused } from "@/lib/ai/web/tavily";

const SERVER_KEY = "sk-server-tavily";

function tavilyPayload(results: unknown[]): string {
  return JSON.stringify({ results });
}

describe("Kiro Search credential resolver", () => {
  const prev = process.env.KIRO_TAVILY_API_KEY;

  beforeEach(() => {
    delete process.env.KIRO_TAVILY_API_KEY;
    sessionStorage.clear();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.KIRO_TAVILY_API_KEY;
    else process.env.KIRO_TAVILY_API_KEY = prev;
  });

  it("1. server mode → 读取 Server Key", () => {
    process.env.KIRO_TAVILY_API_KEY = SERVER_KEY;
    const r = resolveWebSearchCredential({ mode: "server" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.apiKey).toBe(SERVER_KEY);
      expect(r.mode).toBe("server");
    }
  });

  it("2. byok mode → 使用 User Key；缺 Key 不 fallback Server Key", () => {
    process.env.KIRO_TAVILY_API_KEY = SERVER_KEY;
    const withKey = resolveWebSearchCredential({ mode: "byok", userApiKey: "sk-user" });
    expect(withKey.ok).toBe(true);
    if (withKey.ok) expect(withKey.apiKey).toBe("sk-user");

    const missing = resolveWebSearchCredential({ mode: "byok" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("WEB_SEARCH_KEY_REQUIRED");
      // 绝不偷偷使用 Server Key
      expect(missing.message).not.toContain(SERVER_KEY);
    }
  });

  it("server mode 缺 env → WEB_SEARCH_KEY_REQUIRED（不 crash）", () => {
    const r = resolveWebSearchCredential({ mode: "server" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WEB_SEARCH_KEY_REQUIRED");
  });

  it("BYOK sessionStorage：Key 只在 sessionStorage，不进 localStorage", () => {
    setSessionWebSearchApiKey("tvly-user-secret");
    expect(getSessionWebSearchApiKey()).toBe("tvly-user-secret");
    expect(localStorage.getItem("classflow-web-search-key")).toBeNull();
    expect(localStorage.getItem("classflow-ai-key:opencode-go")).toBeNull();
  });
});

describe("Tavily adapter normalization", () => {
  const provider = createTavilyWebSearchProvider();

  it("3. 合法结果保留；非 http/https URL skip；最多 6 条；snippet 截断", async () => {
    const longContent = "a".repeat(2000);
    const rawResults = [
      { title: "  官方公告  ", url: "https://example.com/a", content: `  多  余   空白  ${longContent}`, score: 0.9, published_date: "2026-08-10" },
      { title: "javascript 链接", url: "javascript:alert(1)" },
      { title: "非法协议", url: "file:///etc/passwd" },
      { title: "非字符串 url", url: 123 },
      { title: "合法 http", url: "http://www.sub.example.com/x?q=1", content: "ok" },
      { title: "t1", url: "https://e.com/1", content: "c1" },
      { title: "t2", url: "https://e.com/2", content: "c2" },
      { title: "t3", url: "https://e.com/3", content: "c3" },
      { title: "t4", url: "https://e.com/4", content: "c4" },
      { title: "t5", url: "https://e.com/5", content: "c5" },
      { title: "t6", url: "https://e.com/6", content: "c6" },
      { title: "t7", url: "https://e.com/7", content: "c7" },
    ] as never;
    const fetchMock = vi.fn().mockResolvedValue(new Response(tavilyPayload(rawResults), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await provider.search({ query: "q" }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBeLessThanOrEqual(MAX_WEB_RESULTS);
    expect(r.results).toHaveLength(MAX_WEB_RESULTS); // 6 条上限（4 条非法 + 6 条合法 = 10 → 截 6）
    expect(r.results.some((x) => x.url.startsWith("javascript:"))).toBe(false);
    expect(r.results.some((x) => x.url.startsWith("file:"))).toBe(false);
    // 第一条合法：title trim + domain + snippet 折叠截断 + publishedAt
    const first = r.results.find((x) => x.url.includes("example.com/a"));
    expect(first).toBeDefined();
    expect(first!.title).toBe("官方公告");
    expect(first!.domain).toBe("example.com");
    expect(first!.publishedAt).toBe("2026-08-10");
    expect(first!.snippet.length).toBeLessThanOrEqual(900);
    expect(first!.snippet).not.toContain("   ");
    // 不含 raw content / answer / request id / key
    const raw = JSON.stringify(r);
    expect(raw).not.toContain("raw_content");
    expect(raw).not.toContain("include_answer");
    expect(raw).not.toContain("sk");
  });

  it("请求体：固定资源参数，Agent 不能控制 depth/max_results/key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(tavilyPayload([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.search(
      { query: "news", topic: "news", timeRange: "day", includeDomains: ["example.com"] },
      { apiKey: "sk-test" }
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TAVILY_SEARCH_URL);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.query).toBe("news");
    expect(body.topic).toBe("news");
    expect(body.search_depth).toBe("basic");
    expect(body.max_results).toBe(MAX_WEB_RESULTS);
    expect(body.include_answer).toBe(false);
    expect(body.include_raw_content).toBe(false);
    expect(body.time_range).toBe("day");
    expect(body.include_domains).toEqual(["example.com"]);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("4. 401 / 429 / timeout → safe error code，不暴露 Tavily 原始 body", async () => {
    const rawError = JSON.stringify({ error: { message: "invalid api key sk-server-tavily secret" } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(rawError, { status: 401 }))
        .mockResolvedValueOnce(new Response(rawError, { status: 429 }))
        .mockRejectedValueOnce(new DOMException("timeout", "AbortError"))
    );
    const auth = await provider.search({ query: "q" }, { apiKey: "bad" });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.code).toBe("WEB_SEARCH_AUTH_FAILED");
      expect(auth.message).not.toContain("invalid api key");
      expect(auth.message).not.toContain("sk-server-tavily");
    }
    const limited = await provider.search({ query: "q" }, { apiKey: "bad" });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.code).toBe("WEB_SEARCH_RATE_LIMITED");
    const timeout = await provider.search({ query: "q" }, { apiKey: "bad" });
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.code).toBe("WEB_SEARCH_TIMEOUT");
  });

  it("5. Provider interface 返回 normalized result（sourceId 由调用层分配）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(tavilyPayload([{ title: "t", url: "https://x.dev/1", content: "c" }]), { status: 200 }))
    );
    const r = await provider.search({ query: "q" }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results[0].sourceId).toBe(""); // adapter 不生成 web-N
  });

  it("Case D：checkCredential 用 /usage；200→ok、401→AUTH_FAILED，且不请求 /search", async () => {
    const usageUrl = "https://api.tavily.com/usage";
    const searchUrl = "https://api.tavily.com/search";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await provider.checkCredential({ apiKey: "sk" });
    expect(ok).toEqual({ ok: true });
    const auth = await provider.checkCredential({ apiKey: "bad" });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.code).toBe("WEB_SEARCH_AUTH_FAILED");

    const requested: string[] = [];
    for (const call of fetchMock.mock.calls) requested.push(String(call[0]));
    expect(requested).toEqual([usageUrl, usageUrl]);
    expect(requested.some((u) => u === searchUrl)).toBe(false);
  });

  it("Case E：URL canonical 去重——tracking 参数差异合并；业务 query 参数保留", async () => {
    const raw = [
      { title: "a", url: "https://example.com/article?utm_source=x&id=1", content: "c" },
      { title: "b", url: "https://example.com/article?utm_source=y&id=1", content: "c" }, // canonical 相同 → 去重
      { title: "c", url: "https://example.com/article?id=2", content: "c" }, // 业务参数不同 → 保留
    ] as never;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(tavilyPayload(raw), { status: 200 }))
    );
    const r = await provider.search({ query: "q" }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results).toHaveLength(2);
    expect(r.count).toBe(2);
    expect(r.results.some((x) => x.url.includes("id=2"))).toBe(true);
  });

  it("canonicalWebSearchUrl：hash 移除 / hostname 小写 / 非法协议 null", () => {
    expect(canonicalWebSearchUrl("https://Example.com/a?utm_campaign=x&keep=1#sec")).toBe(
      "https://example.com/a?keep=1"
    );
    expect(canonicalWebSearchUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalWebSearchUrl("https://a.dev/?utm_source=1")).toBe("https://a.dev/");
  });
});

describe("web_search schema", () => {
  it("query min/max；includeDomains ≤5；合法 topic/timeRange", () => {
    expect(kiroWebSearchInputSchema.safeParse({ query: "x" }).success).toBe(false);
    expect(kiroWebSearchInputSchema.safeParse({ query: "ok" }).success).toBe(true);
    expect(
      kiroWebSearchInputSchema.safeParse({ query: "ok", topic: "news", timeRange: "week", includeDomains: ["a.com", "b.com"] }).success
    ).toBe(true);
    expect(kiroWebSearchInputSchema.safeParse({ query: "ok", topic: "images" }).success).toBe(false);
    expect(
      kiroWebSearchInputSchema.safeParse({ query: "ok", includeDomains: ["1", "2", "3", "4", "5", "6"] }).success
    ).toBe(false);
    const stripped = kiroWebSearchInputSchema.safeParse({ query: "ok", search_depth: "advanced", max_results: 99 });
    expect(stripped.success).toBe(true); // 未知键被剥离（schema 只暴露白名单字段）
    if (stripped.success) { expect("search_depth" in stripped.data).toBe(false); expect("max_results" in stripped.data).toBe(false); }
  });

  it("domain normalization：scheme / path / query / www 去除", () => {
    expect(normalizeWebSearchDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeWebSearchDomain("News.Site.org")).toBe("news.site.org");
  });
});

describe("Kiro Search tool + turn state", () => {
  function fakeProvider() {
    return {
      id: "tavily" as const,
      checkCredential: vi.fn().mockResolvedValue({ ok: true }),
      search: vi.fn().mockResolvedValue({
        ok: true,
        query: "q",
        count: 2,
        results: [
          { sourceId: "", title: "t1", url: "https://a.dev/1", domain: "a.dev", snippet: "s1" },
          { sourceId: "", title: "t2", url: "https://a.dev/2", domain: "a.dev", snippet: "s2" },
        ],
      }),
    };
  }

  it("execute：分配 web-N sourceId 并返回 ok envelope", async () => {
    const provider = fakeProvider();
    const webTool = createKiroWebSearchTool({ provider, credential: { mode: "byok", userApiKey: "sk-test" }, attemptsSoFar: 0, nextSourceIndex: 1 });
    const r = (await webTool.execute?.({ query: "news" }, {} as never)) as { ok: true; data: { results: { sourceId: string }[] } };
    expect(r.ok).toBe(true);
    expect(r.data.results.map((x) => x.sourceId)).toEqual(["web-1", "web-2"]);
  });

  it("已 3 次 web_search → 第 4 次返回 WEB_SEARCH_LIMIT_REACHED（不调用 provider）", async () => {
    const provider = fakeProvider();
    const webTool = createKiroWebSearchTool({ provider, credential: { mode: "server" }, attemptsSoFar: 3, nextSourceIndex: 10 });
    const r = (await webTool.execute?.({ query: "again" }, {} as never)) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WEB_SEARCH_LIMIT_REACHED");
    expect(provider.search).not.toHaveBeenCalled();
  });

  it("Case A：失败也算 attempt——success+timeout+429 后第 4 次 LIMIT_REACHED 且不再请求 Provider", async () => {
    const provider = fakeProvider();
    // 已发生 3 次（2 成功 1 失败）
    const s = inspectCurrentTurnWebSearchState([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "tool-web_search", toolCallId: "c1", output: { ok: true, data: { results: [{ sourceId: "web-1" }] } } },
          { type: "tool-web_search", toolCallId: "c2", output: { ok: false, code: "WEB_SEARCH_TIMEOUT" } },
          { type: "tool-web_search", toolCallId: "c3", output: { ok: false, code: "WEB_SEARCH_RATE_LIMITED" } },
        ],
      },
    ]);
    expect(s.attempts).toBe(3);
    const webTool = createKiroWebSearchTool({ provider, credential: { mode: "server" }, attemptsSoFar: s.attempts, nextSourceIndex: s.nextSourceIndex });
    const r = (await webTool.execute?.({ query: "fourth" }, {} as never)) as { ok: false; code: string };
    expect(r.code).toBe("WEB_SEARCH_LIMIT_REACHED");
    expect(provider.search).not.toHaveBeenCalled();
  });

  it("Case B：同一 toolCallId 重复出现只计一次 attempt", () => {
    const s = inspectCurrentTurnWebSearchState([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "tool-web_search", toolCallId: "dup", output: { ok: true, data: { results: [{ sourceId: "web-1" }] } } },
          { type: "tool-web_search", toolCallId: "dup", output: { ok: false, code: "X" } }, // 消息结构重复
          { type: "tool-web_search", toolCallId: "c2", output: { ok: false, code: "WEB_SEARCH_FAILED" } },
        ],
      },
    ]);
    expect(s.attempts).toBe(2); // dup 计 1 + c2 计 1
  });

  it("Case C：attempts 只统计当前 Turn；nextSourceIndex conversation-wide", () => {
    const s = inspectCurrentTurnWebSearchState([
      { role: "user", parts: [{ type: "text", text: "T1" }] },
      { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "t1", output: { ok: true, data: { results: [{ sourceId: "web-1" }, { sourceId: "web-2" }] } } }] },
      { role: "user", parts: [{ type: "text", text: "T2" }] },
      { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "t2", output: { ok: true, data: { results: [{ sourceId: "web-3" }] } } }] },
      { role: "user", parts: [{ type: "text", text: "T3（当前）" }] },
    ]);
    expect(s.attempts).toBe(0); // 当前 Turn 无尝试
    expect(s.nextSourceIndex).toBe(4); // 整段会话最大 web-3 → 4
  });

  it("nextSourceIndex 只信真实 Tool Result 的 /^web-(\\d+)$/；模型正文 web-999 不影响", () => {
    const s = inspectCurrentTurnWebSearchState([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "参考 [[source:web-999]]" }] },
      { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "c1", output: { ok: true, data: { results: [{ sourceId: "web-2" }] } } }] },
    ]);
    expect(s.nextSourceIndex).toBe(3);
  });

  it("web_search 不属于 mutating：不在 KIRO_MUTATING_TOOL_NAMES", async () => {
    const { KIRO_MUTATING_TOOL_NAMES } = await import("@/lib/ai/tools/mutating");
    expect((KIRO_MUTATING_TOOL_NAMES as string[]).includes("web_search")).toBe(false);
  });

  it("assembleKiroToolsForRequest：enabled → 有 web_search；disabled → 无；client tools 保留", async () => {
    const { assembleKiroToolsForRequest } = await import("@/lib/ai/web/tool");
    const { KIRO_TOOLS } = await import("@/lib/ai/tools");
    const clientTools = { ...KIRO_TOOLS };

    const enabled = assembleKiroToolsForRequest({
      webSearchEnabled: true,
      credential: { mode: "server" },
      messages: [],
      clientTools,
    });
    expect("web_search" in enabled).toBe(true);
    expect("search_assignments" in enabled).toBe(true); // client tools 保留

    const disabled = assembleKiroToolsForRequest({
      webSearchEnabled: false,
      credential: { mode: "server" },
      messages: [],
      clientTools,
    });
    expect("web_search" in disabled).toBe(false);
    expect("search_assignments" in disabled).toBe(true);
  });

  it("Client Read/Write Tools 没有 server execute（保持原 client-side 架构）", async () => {
    const { KIRO_READ_TOOLS } = await import("@/lib/ai/tools/read/registry");
    const { KIRO_WRITE_TOOLS } = await import("@/lib/ai/tools/write/registry");
    const read = KIRO_READ_TOOLS as unknown as Record<string, { execute?: unknown }>;
    const write = KIRO_WRITE_TOOLS as unknown as Record<string, { execute?: unknown }>;
    for (const [name, t] of Object.entries(read)) {
      expect(t.execute, `read ${name}`).toBeUndefined();
    }
    for (const [name, t] of Object.entries(write)) {
      expect(t.execute, `write ${name}`).toBeUndefined();
    }
  });

  it("Task 14D：Kiro Search 偏好默认 enabled=true / credentialMode=server；BYOK Key 不入 Store", async () => {
    const { useKiroPreferencesStore } = await import("@/store/useKiroPreferencesStore");
    const s = useKiroPreferencesStore.getState();
    expect(s.webSearchEnabled).toBe(true);
    expect(s.webSearchCredentialMode).toBe("server");
    // Key 不进 Store：设置切换后 Store 仍无 Key 字段
    s.setWebSearchCredentialMode("byok");
    expect(useKiroPreferencesStore.getState().webSearchCredentialMode).toBe("byok");
    const raw = JSON.stringify(useKiroPreferencesStore.getState());
    expect(raw).not.toContain("tvly-");
    expect(raw).not.toContain("apiKey");
    s.setWebSearchCredentialMode("server");
    expect(useKiroPreferencesStore.getState().webSearchCredentialMode).toBe("server");
    // 非法值回落
    s.setWebSearchCredentialMode("hacked" as never);
    expect(useKiroPreferencesStore.getState().webSearchCredentialMode).toBe("server");
  });
});

void _unused;
void webSearchSafeMessage;
