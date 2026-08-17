import { describe, it, expect, vi } from "vitest";
import {
  resolveCurrentTurnWebSources,
  inspectCurrentTurnWebEvidenceState,
  createKiroWebReadTool,
} from "@/lib/ai/web/tool";
import { kiroWebReadSourceSchema } from "@/lib/ai/web/schemas";
import { createTavilyWebSearchProvider, TAVILY_EXTRACT_URL, canonicalEvidenceUrl } from "@/lib/ai/web/tavily";
import {
  MAX_WEB_EVIDENCE_CHARS_PER_SOURCE,
  MAX_WEB_EVIDENCE_CHARS_PER_TURN,
  MAX_WEB_EVIDENCE_CHUNK_CHARS,
} from "@/lib/ai/web/types";

/** Search Result helper：构造当前 Turn 真实成功 web_search output */
function searchMessages(webResults: { sourceId: string; url: string; title: string; domain: string }[]): unknown[] {
  return [
    { role: "user", parts: [{ type: "text", text: "查一下" }] },
    { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "s1", output: { ok: true, data: { results: webResults } } }] },
  ];
}

const CURRENT_TURN_SOURCES = [
  { sourceId: "web-3", url: "https://a.dev/3", title: "A3", domain: "a.dev" },
  { sourceId: "web-4", url: "https://b.dev/4", title: "B4", domain: "b.dev" },
];

/** Task 18C：默认 Native Reader mock —— 返回 NO_EVIDENCE，让旧 fallback-focused 测试继续走 fallback */
function nativeNoEvidence() {
  return vi.fn().mockResolvedValue({ ok: false, code: "WEB_NATIVE_NO_EVIDENCE" });
}

function readToolConfig(over: Partial<Parameters<typeof createKiroWebReadTool>[0]> = {}) {
  return {
    fallbackProvider: {
      id: "tavily" as const,
      checkCredential: vi.fn().mockResolvedValue({ ok: true }),
      search: vi.fn(),
      extract: vi.fn().mockResolvedValue({
        ok: true,
        sources: [
          { sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "evidence 内容" }], truncated: false },
        ],
      }),
    },
    nativeReader: nativeNoEvidence(),
    credential: { mode: "byok" as const, userApiKey: "sk-user" },
    attemptsSoFar: 0,
    trustedSources: CURRENT_TURN_SOURCES,
    readSourceIds: [],
    evidenceCharsUsed: 0,
    ...over,
  };
}

describe("Case A：trust boundary", () => {
  it("当前 Turn 真实 web-3 → resolve 成功；web-999 / 旧 Turn web-1 → 拒绝", () => {
    const msgs = [
      { role: "user", parts: [{ type: "text", text: "T1" }] },
      { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "t1", output: { ok: true, data: { results: [{ sourceId: "web-1", url: "https://old.dev/1", title: "旧", domain: "old.dev" }] } } }] },
      { role: "user", parts: [{ type: "text", text: "T2" }] },
      { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "t2", output: { ok: true, data: { results: CURRENT_TURN_SOURCES } } }] },
    ];
    const sources = resolveCurrentTurnWebSources(msgs);
    const ids = sources.map((s) => s.sourceId);
    expect(ids).toEqual(["web-3", "web-4"]); // 旧 Turn web-1 不在
    expect(ids).not.toContain("web-1");
  });

  it("编造 sourceId web-999 → 全部 NOT_FOUND，Provider 不调用", async () => {
    const cfg = readToolConfig();
    const readTool = createKiroWebReadTool(cfg);
    const r = (await readTool.execute?.({ sourceIds: ["web-999"] }, {} as never)) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WEB_SOURCE_NOT_FOUND");
    expect(cfg.fallbackProvider.extract).not.toHaveBeenCalled();
  });

  it("混入不可信 sourceId：web-3 合法 + web-999 非法 → 只读取 web-3", async () => {
    const cfg = readToolConfig();
    const readTool = createKiroWebReadTool(cfg);
    const r = (await readTool.execute?.({ sourceIds: ["web-3", "web-999"] }, {} as never)) as { ok: true; data: { sources: { sourceId: string }[] } };
    expect(r.ok).toBe(true);
    expect(r.data.sources.map((s) => s.sourceId)).toEqual(["web-3"]);
    expect(cfg.fallbackProvider.extract).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [{ sourceId: "web-3", url: "https://a.dev/3" }] }),
      expect.anything()
    );
  });
});

describe("Case B：arbitrary URL impossible", () => {
  it("schema 只接受 sourceIds（web-N）；url / apiKey / extractDepth 被拒", () => {
    expect(kiroWebReadSourceSchema.safeParse({ url: "https://example.com" }).success).toBe(false);
    expect(kiroWebReadSourceSchema.safeParse({ sourceIds: ["https://example.com"] }).success).toBe(false);
    expect(kiroWebReadSourceSchema.safeParse({ sourceIds: ["web-1"] }).success).toBe(true);
    expect(kiroWebReadSourceSchema.safeParse({ sourceIds: ["web-1", "web-2", "web-3"] }).success).toBe(false); // >2
    expect(kiroWebReadSourceSchema.safeParse({ sourceIds: ["web-1"], url: "https://x.dev" }).success).toBe(true); // url 被剥离
    const stripped = kiroWebReadSourceSchema.parse({ sourceIds: ["web-1"], apiKey: "sk", extractDepth: "advanced" });
    expect("url" in stripped).toBe(false);
    expect("apiKey" in stripped).toBe(false);
    expect("extractDepth" in stripped).toBe(false);
  });
});

describe("Case C：read limit", () => {
  it("当前 Turn 已两次 read → 第三次 WEB_READ_LIMIT_REACHED，Provider 不调用", async () => {
    const msgs = searchMessages(CURRENT_TURN_SOURCES);
    msgs.push(
      { role: "assistant", parts: [{ type: "tool-read_web_source", toolCallId: "r1", output: { ok: true, data: { sources: [] } } }] },
      { role: "assistant", parts: [{ type: "tool-read_web_source", toolCallId: "r2", output: { ok: false, code: "X" } }] }
    );
    const state = inspectCurrentTurnWebEvidenceState(msgs);
    expect(state.attempts).toBe(2);
    const cfg = readToolConfig({ attemptsSoFar: state.attempts });
    const readTool = createKiroWebReadTool(cfg);
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: false; code: string };
    expect(r.code).toBe("WEB_READ_LIMIT_REACHED");
    expect(cfg.fallbackProvider.extract).not.toHaveBeenCalled();
  });

  it("同一 toolCallId 重复只计一次 attempt", () => {
    const msgs = searchMessages(CURRENT_TURN_SOURCES);
    msgs.push(
      { role: "assistant", parts: [
        { type: "tool-read_web_source", toolCallId: "dup", output: { ok: true, data: { sources: [] } } },
        { type: "tool-read_web_source", toolCallId: "dup", output: { ok: true, data: { sources: [] } } },
      ] }
    );
    const state = inspectCurrentTurnWebEvidenceState(msgs);
    expect(state.attempts).toBe(1);
  });
});

describe("Case D/E：duplicate read guard", () => {
  it("web-3 已成功读过 → 再次请求 → WEB_SOURCE_ALREADY_READ，Provider 不调用", async () => {
    const cfg = readToolConfig({ readSourceIds: ["web-3"] });
    const readTool = createKiroWebReadTool(cfg);
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: false; code: string };
    expect(r.code).toBe("WEB_SOURCE_ALREADY_READ");
    expect(cfg.fallbackProvider.extract).not.toHaveBeenCalled();
  });

  it("mixed：web-3 已读 + web-4 未读 → Provider 只收到 web-4", async () => {
    const cfg = readToolConfig({
      readSourceIds: ["web-3"],
      fallbackProvider: {
        id: "tavily" as const,
        extract: vi.fn().mockResolvedValue({
          ok: true,
          sources: [{ sourceId: "web-4", title: "", url: "https://b.dev/4", domain: "", chunks: [{ text: "B4 内容" }], truncated: false }],
        }),
      },
    });
    const readTool = createKiroWebReadTool(cfg);
    const r = (await readTool.execute?.({ sourceIds: ["web-3", "web-4"] }, {} as never)) as { ok: true; data: { sources: { sourceId: string }[] } };
    expect(r.ok).toBe(true);
    expect(r.data.sources.map((s) => s.sourceId)).toEqual(["web-4"]);
    expect(cfg.fallbackProvider.extract).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [{ sourceId: "web-4", url: "https://b.dev/4" }] }),
      expect.anything()
    );
  });
});

describe("Case F：evidence budget", () => {
  it("超长 chunks → 单 source ≤ source 预算、truncated=true", async () => {
    const long = "x".repeat(2000);
    const provider = createTavilyWebSearchProvider();
    // 通过 provider.extract 直接归一化验证（mock fetch）
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [{ url: "https://a.dev/3", raw_content: `${long}\n\n${long}\n\n${long}` }] }), { status: 200 })
      )
    );
    const r = await provider.extract({ sources: [{ sourceId: "web-3", url: "https://a.dev/3" }] }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const src = r.sources[0];
    const total = src.chunks.reduce((sum, c) => sum + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_WEB_EVIDENCE_CHARS_PER_SOURCE);
    expect(total).toBeLessThanOrEqual(MAX_WEB_EVIDENCE_CHARS_PER_TURN);
    expect(src.truncated).toBe(true); // 6000 chars > 5000 预算
  });

  it("Tool 层按 Turn 预算截断多个来源", async () => {
    const provider = {
      id: "tavily" as const,
      checkCredential: vi.fn().mockResolvedValue({ ok: true }),
      search: vi.fn(),
      extract: vi.fn().mockResolvedValue({
        ok: true,
        sources: [
          { sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "c".repeat(7000) }], truncated: false },
          { sourceId: "web-4", title: "", url: "https://b.dev/4", domain: "", chunks: [{ text: "d".repeat(7000) }], truncated: false },
        ],
      }),
    };
    const readTool = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider, evidenceCharsUsed: 0 }));
    const r = (await readTool.execute?.({ sourceIds: ["web-3", "web-4"] }, {} as never)) as {
      ok: true;
      data: { sources: { sourceId: string; chunks: { text: string }[]; truncated: boolean }[] };
    };
    const total = r.data.sources.reduce((sum, s) => sum + s.chunks.reduce((a, c) => a + c.text.length, 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_WEB_EVIDENCE_CHARS_PER_TURN);
    expect(r.data.sources.some((s) => s.truncated)).toBe(true);
  });
});

describe("Task 18C：Native-first read_web_source", () => {
  it("Native success → credential 不解析、fallback 不调用、metadata 来自 trustedSources", async () => {
    const fallbackProvider = {
      id: "tavily" as const,
      checkCredential: vi.fn(),
      search: vi.fn(),
      extract: vi.fn(),
    };
    const nativeReader = vi.fn().mockResolvedValue({
      ok: true,
      sourceId: "web-3",
      finalUrl: "https://cdn.example.com/redirected",
      chunks: [{ text: "Native 读取的正文" }, { text: "第二段" }],
      truncated: false,
    });
    const readTool = createKiroWebReadTool(
      readToolConfig({
        fallbackProvider,
        nativeReader,
        trustedSources: [{ sourceId: "web-3", url: "https://example.com/a?utm=x", title: "官方标题", domain: "example.com" }],
      })
    );
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as {
      ok: true;
      data: { sources: { sourceId: string; title: string; url: string; domain: string; chunks: { text: string }[] }[] };
    };
    expect(r.ok).toBe(true);
    expect(r.data.sources).toHaveLength(1);
    const s = r.data.sources[0];
    expect(s.sourceId).toBe("web-3");
    expect(s.title).toBe("官方标题"); // metadata 来自 trustedSources
    expect(s.domain).toBe("example.com");
    expect(s.url).toBe("https://example.com/a?utm=x"); // finalUrl 不覆盖 Citation URL
    expect(s.chunks.map((c) => c.text)).toEqual(["Native 读取的正文", "第二段"]);
    expect(nativeReader).toHaveBeenCalledTimes(1);
    expect(nativeReader.mock.calls[0][0].url).toBe("https://example.com/a?utm=x");
    expect(fallbackProvider.extract).not.toHaveBeenCalled();
  });

  it("Native NO_EVIDENCE → fallback extract 收到 sources 与 query", async () => {
    const extract = vi.fn().mockResolvedValue({
      ok: true,
      sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "fallback 正文" }], truncated: false }],
    });
    const readTool = createKiroWebReadTool(
      readToolConfig({
        fallbackProvider: { id: "tavily" as const, extract },
        nativeReader: vi.fn().mockResolvedValue({ ok: false, code: "WEB_NATIVE_NO_EVIDENCE" }),
        trustedSources: [{ sourceId: "web-3", url: "https://a.dev/3", title: "A3", domain: "a.dev" }],
      })
    );
    const r = (await readTool.execute?.({ sourceIds: ["web-3"], query: "报名条件" }, {} as never)) as { ok: true; data: { sources: unknown[] } };
    expect(r.ok).toBe(true);
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [{ sourceId: "web-3", url: "https://a.dev/3" }], query: "报名条件" }),
      expect.anything()
    );
  });
});

describe("Task 17A：evidence reader hardening", () => {
  function evidenceProvider(extractResult: unknown, extractImpl?: (req: unknown) => unknown) {
    const extract = vi.fn((req: unknown) => {
      if (extractImpl) return Promise.resolve(extractImpl(req)) as Promise<never>;
      return Promise.resolve(extractResult) as Promise<never>;
    });
    return {
      id: "tavily" as const,
      checkCredential: vi.fn().mockResolvedValue({ ok: true }),
      search: vi.fn(),
      extract,
    };
  }

  it("Case A：canonical URL 匹配——Search 带 tracking 参数、Extract 返回干净 URL → 同一 sourceId", async () => {
    const provider = evidenceProvider({
      ok: true,
      sources: [
        { sourceId: "web-3", title: "", url: "https://example.com/a", domain: "", chunks: [{ text: "正文内容" }], truncated: false },
      ],
    });
    const readTool = createKiroWebReadTool(
      readToolConfig({
        fallbackProvider: provider,
        trustedSources: [{ sourceId: "web-3", url: "https://example.com/a?utm_source=x", title: "A", domain: "example.com" }],
      })
    );
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: true; data: { sources: { sourceId: string }[] } };
    expect(r.ok).toBe(true);
    expect(r.data.sources.map((s) => s.sourceId)).toEqual(["web-3"]);
  });

  it("Case B：trailing slash 兼容——requested /a、Extract /a/ → 匹配", () => {
    expect(canonicalEvidenceUrl("https://example.com/a/")).toBe("https://example.com/a");
    expect(canonicalEvidenceUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalEvidenceUrl("https://example.com/a?utm_source=1")).toBe("https://example.com/a");
  });

  it("Case C：empty evidence → WEB_READ_NO_EVIDENCE，且该 source 不进入 readSet", async () => {
    const provider = evidenceProvider({
      ok: true,
      sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [], truncated: false }],
    });
    const readTool = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider }));
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WEB_READ_NO_EVIDENCE");
    // inspect 视角：该 attempt 计一次，但 web-3 不是已读 source
    const state = inspectCurrentTurnWebEvidenceState([
      { role: "user", parts: [{ type: "text", text: "查" }] },
      { role: "assistant", parts: [{ type: "tool-read_web_source", toolCallId: "r1", output: r }] },
    ]);
    expect(state.attempts).toBe(1);
    expect(state.readSourceIds).toEqual([]);
  });

  it("Case D：partial success——web-3 有证据 + web-4 无 → sources=[web-3], unavailableSourceIds=[web-4]", async () => {
    const provider = evidenceProvider({
      ok: true,
      sources: [
        { sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "A 内容" }], truncated: false },
        { sourceId: "web-4", title: "", url: "https://b.dev/4", domain: "", chunks: [], truncated: false },
      ],
    });
    const readTool = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider }));
    const r = (await readTool.execute?.({ sourceIds: ["web-3", "web-4"] }, {} as never)) as {
      ok: true;
      data: { sources: { sourceId: string }[]; unavailableSourceIds: string[] };
    };
    expect(r.ok).toBe(true);
    expect(r.data.sources.map((s) => s.sourceId)).toEqual(["web-3"]);
    expect(r.data.unavailableSourceIds).toEqual(["web-4"]);
  });

  it("Case E：duplicate sourceIds——Provider 只收到一个 URL", async () => {
    let received: unknown = null;
    const provider = evidenceProvider({ ok: true, sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "x" }], truncated: false }] }, (req) => {
      received = req;
      return { ok: true, sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "x" }], truncated: false }] };
    });
    const readTool = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider }));
    await readTool.execute?.({ sourceIds: ["web-3", "web-3"] }, {} as never);
    const req = received as { sources: { sourceId: string }[] };
    expect(req.sources).toHaveLength(1);
    expect(req.sources[0].sourceId).toBe("web-3");
  });

  it("Case F：chunk 去重 + 单 chunk 上限——重复 chunk 消失、超长 chunk 截断", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://a.dev/3",
                chunks: ["报名时间为9月1日", "报名时间为9月1日", "x".repeat(3000)],
              },
            ],
          }),
          { status: 200 }
        )
      )
    );
    const provider = createTavilyWebSearchProvider();
    const r = await provider.extract({ sources: [{ sourceId: "web-3", url: "https://a.dev/3" }] }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chunks = r.sources[0].chunks;
    expect(chunks.map((c) => c.text)).toEqual(["报名时间为9月1日", "x".repeat(MAX_WEB_EVIDENCE_CHUNK_CHARS)]);
    expect(chunks.every((c) => c.text.length <= MAX_WEB_EVIDENCE_CHUNK_CHARS)).toBe(true);
    expect(r.sources[0].truncated).toBe(true);
  });

  it("Case G：evidence budget 已用满 → Provider 不调用（WEB_READ_LIMIT_REACHED）", async () => {
    const provider = evidenceProvider({ ok: true, sources: [] });
    const readTool = createKiroWebReadTool(
      readToolConfig({ fallbackProvider: provider, evidenceCharsUsed: MAX_WEB_EVIDENCE_CHARS_PER_TURN })
    );
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: false; code: string };
    expect(r.code).toBe("WEB_READ_LIMIT_REACHED");
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it("all-dup 全已读 / 不可信 source → Provider 不调用", async () => {
    const provider = evidenceProvider({ ok: true, sources: [] });
    const readTool = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider, readSourceIds: ["web-3"] }));
    const r = (await readTool.execute?.({ sourceIds: ["web-3"] }, {} as never)) as { ok: false; code: string };
    expect(r.code).toBe("WEB_SOURCE_ALREADY_READ");
    expect(provider.extract).not.toHaveBeenCalled();

    const readTool2 = createKiroWebReadTool(readToolConfig({ fallbackProvider: provider }));
    const r2 = (await readTool2.execute?.({ sourceIds: ["web-999"] }, {} as never)) as { ok: false; code: string };
    expect(r2.code).toBe("WEB_SOURCE_NOT_FOUND");
    expect(provider.extract).not.toHaveBeenCalled();
  });
});

describe("Task 16B：presentation & policy", () => {
  it("Case A：activity formatter——working/done N 来源/error", async () => {
    const { formatKiroToolActivityDetail } = await import("@/lib/ai/presentation/toolActivityDetails");
    expect(formatKiroToolActivityDetail("read_web_source", "working", {})).toEqual(["正在阅读网页"]);
    expect(
      formatKiroToolActivityDetail("read_web_source", "done", {
        ok: true,
        data: { sources: [{ sourceId: "web-3" }, { sourceId: "web-4" }] },
      })
    ).toEqual(["已阅读 2 个来源"]);
    expect(
      formatKiroToolActivityDetail("read_web_source", "done", { ok: true, data: { sources: [{ sourceId: "web-3" }] } })
    ).toEqual(["已阅读 1 个来源"]);
    expect(formatKiroToolActivityDetail("read_web_source", "error", {})).toEqual(["网页内容读取失败"]);
    // 不展示工具名 / URL / query
    const raw = JSON.stringify(formatKiroToolActivityDetail("read_web_source", "done", { ok: true, data: { sources: [{ sourceId: "web-3" }] } }));
    expect(raw).not.toContain("read_web_source");
    expect(raw).not.toContain("http");
  });

  it("tool label：read_web_source → 阅读网页（不出现 Tavily Extract）", async () => {
    const { toolLabel } = await import("@/lib/ai/tools/formatters");
    expect(toolLabel("read_web_source")).toBe("阅读网页");
  });

  it("Case B：read_web_source 不属于 mutating（不在 KIRO_MUTATING_TOOL_NAMES）", async () => {
    const { KIRO_MUTATING_TOOL_NAMES } = await import("@/lib/ai/tools/mutating");
    expect((KIRO_MUTATING_TOOL_NAMES as string[]).includes("read_web_source")).toBe(false);
  });

  it("Case C：Reader output 不能单独注册 Web Source——只有 web_search output 是可信 registry 来源", () => {
    const msgs = [
      { role: "user", parts: [{ type: "text", text: "查" }] },
      { role: "assistant", parts: [{ type: "tool-read_web_source", toolCallId: "r1", output: { ok: true, data: { sources: [{ sourceId: "web-3", title: "仅Reader", url: "https://a.dev/3" }] } } }] },
    ];
    const sources = resolveCurrentTurnWebSources(msgs);
    expect(sources).toEqual([]); // 只有 Search output 才会注册
  });
});

describe("Case G：provider normalization（Tavily Extract）", () => {
  it("只返回 clean chunks + source metadata；不含 raw response / usage / key", async () => {
    const rawPayload = {
      results: [{ url: "https://a.dev/3", raw_content: "  第一段  \n\n  第二段  " }],
      failed_results: [],
      response_time: 1.2,
      usage: { api_key: "sk-secret", tokens: 999 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(rawPayload), { status: 200 })));
    const provider = createTavilyWebSearchProvider();
    const r = await provider.extract({ sources: [{ sourceId: "web-3", url: "https://a.dev/3" }] }, { apiKey: "sk" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const src = r.sources[0];
    expect(src.sourceId).toBe("web-3");
    expect(src.url).toBe("https://a.dev/3");
    expect(src.chunks.length).toBeGreaterThan(0);
    expect(src.chunks[0].text).toContain("第一段");
    const raw = JSON.stringify(r);
    expect(raw).not.toContain("sk-secret");
    expect(raw).not.toContain("usage");
    expect(raw).not.toContain("response_time");
    expect(raw).not.toContain("failed_results");
  });

  it("请求映射：POST /extract，extract_depth=basic + chunks_per_source + query；无 include_images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createTavilyWebSearchProvider();
    await provider.extract(
      { sources: [{ sourceId: "web-3", url: "https://a.dev/3" }], query: "报名条件" },
      { apiKey: "sk" }
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TAVILY_EXTRACT_URL);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.urls).toEqual(["https://a.dev/3"]);
    expect(body.extract_depth).toBe("basic");
    expect(body.chunks_per_source).toBe(3);
    expect(body.query).toBe("报名条件");
    expect("include_images" in body).toBe(false);
  });
});
