import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import {
  buildKiroWebSearchCapabilitySection,
  isKiroWebSearchAvailable,
  resolveKiroWebSearchMode,
} from "@/lib/ai/web/capability";
import {
  resolveKiroWebSearchAccess,
  resolveWebSearchCredential,
} from "@/lib/ai/web/credentials";
import {
  assembleKiroToolsForRequest,
  createKiroWebSearchTool,
  createKiroWebReadTool,
} from "@/lib/ai/web/tool";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/prompts/kiroSystemPrompt";
import type { KiroWebEvidenceProvider, KiroWebSearchProvider } from "@/lib/ai/web/provider";

const previousKiro = process.env.KIRO_TAVILY_API_KEY;
const previousStandard = process.env.TAVILY_API_KEY;
const previousDisable = process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH;

beforeEach(() => {
  delete process.env.KIRO_TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH;
});

afterEach(() => {
  if (previousKiro === undefined) delete process.env.KIRO_TAVILY_API_KEY;
  else process.env.KIRO_TAVILY_API_KEY = previousKiro;
  if (previousStandard === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = previousStandard;
  if (previousDisable === undefined) delete process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH;
  else process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH = previousDisable;
  vi.unstubAllGlobals();
});

describe("Kiro web search access truth", () => {
  it("server 无 Key → keyless；byok 无 Key → 不可用；byok 有 Key → keyed", () => {
    expect(resolveKiroWebSearchAccess({ mode: "server" })).toMatchObject({
      ok: true,
      kind: "keyless",
    });
    expect(resolveKiroWebSearchAccess({ mode: "byok" })).toMatchObject({
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
    });
    expect(resolveKiroWebSearchAccess({ mode: "byok", userApiKey: "tvly-user" })).toMatchObject({
      ok: true,
      kind: "keyed",
      apiKey: "tvly-user",
    });
  });

  it("运营安全阀关闭 keyless → server 无 Key 不可用", () => {
    process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH = "1";
    expect(resolveKiroWebSearchAccess({ mode: "server" })).toMatchObject({
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
    });
  });

  it("byok 缺 Key 不 fallback server key / keyless", () => {
    process.env.TAVILY_API_KEY = "tvly-server";
    const r = resolveWebSearchCredential({ mode: "byok" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WEB_SEARCH_KEY_REQUIRED");
  });
});

describe("capability prompt section", () => {
  it("四种模式互斥且包含自主搜索指引", () => {
    const off = buildKiroWebSearchCapabilitySection({
      enabled: false,
      access: null,
    });
    expect(off).toContain("不可用");
    expect(off).not.toContain("自主搜索");

    const basic = buildKiroWebSearchCapabilitySection({
      enabled: true,
      access: { ok: true, kind: "keyless", mode: "server" },
    });
    expect(basic).toContain("基础搜索（免 Key）");
    expect(basic).toContain("自主搜索");
    expect(basic).toContain("英文关键词");

    const enhanced = buildKiroWebSearchCapabilitySection({
      enabled: true,
      access: { ok: true, kind: "keyed", apiKey: "sk-secret", mode: "server" },
    });
    expect(enhanced).toContain("增强搜索");
    expect(enhanced).not.toContain("sk-secret");

    const unavailable = buildKiroWebSearchCapabilitySection({
      enabled: true,
      access: { ok: false, code: "WEB_SEARCH_KEY_REQUIRED", message: "需要 Key" },
    });
    expect(unavailable).toContain("不可用");
    expect(unavailable).not.toContain("web_search 可用");

    expect(resolveKiroWebSearchMode({ enabled: true, access: null, textOnlyAnswer: true })).toBe("off");
    expect(
      isKiroWebSearchAvailable({
        enabled: true,
        access: { ok: true, kind: "keyless", mode: "server" },
      })
    ).toBe(true);

    const remote = buildKiroWebSearchCapabilitySection({
      enabled: true,
      access: { ok: true, kind: "keyless", mode: "server" },
      remote: true,
    });
    expect(remote).toContain("远程渠道");
    expect(remote).toContain("最多 1 次搜索");
  });
});

describe("tool assembly availability truth", () => {
  const clientTools = {} as ToolSet;

  it("server 无 Key → 仍暴露 web_search / read_web_source（keyless）", () => {
    const tools = assembleKiroToolsForRequest({
      webSearchEnabled: true,
      access: { ok: true, kind: "keyless", mode: "server" },
      credential: { mode: "server" },
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      clientTools,
    });
    expect("web_search" in tools).toBe(true);
    expect("read_web_source" in tools).toBe(true);
  });

  it("byok 缺 Key → 不暴露必然失败的工具", () => {
    const tools = assembleKiroToolsForRequest({
      webSearchEnabled: true,
      access: { ok: false, code: "WEB_SEARCH_KEY_REQUIRED", message: "需要 Key" },
      credential: { mode: "byok" },
      messages: [],
      clientTools,
    });
    expect("web_search" in tools).toBe(false);
    expect("read_web_source" in tools).toBe(false);
  });

  it("webSearchEnabled=false → 不暴露", () => {
    const tools = assembleKiroToolsForRequest({
      webSearchEnabled: false,
      access: { ok: true, kind: "keyless", mode: "server" },
      credential: { mode: "server" },
      messages: [],
      clientTools,
    });
    expect(tools).toBe(clientTools);
  });

  it("keyless execute 使用 keylessProvider，不调用 keyed provider；分配 web-N", async () => {
    const keyed: KiroWebSearchProvider = {
      id: "tavily",
      checkCredential: vi.fn(),
      search: vi.fn(),
    };
    const keyless: KiroWebSearchProvider = {
      id: "auto",
      checkCredential: vi.fn(),
      search: vi.fn().mockResolvedValue({
        ok: true,
        query: "news",
        count: 2,
        results: [
          { sourceId: "", title: "A", url: "https://a.dev/1", domain: "a.dev", snippet: "s" },
          { sourceId: "", title: "B", url: "https://b.dev/1", domain: "b.dev", snippet: "s" },
        ],
      }),
    };
    const tool = createKiroWebSearchTool({
      provider: keyed,
      keylessProvider: keyless,
      credential: { mode: "server" },
      attemptsSoFar: 0,
      nextSourceIndex: 1,
      successfulQueries: [],
      seenUrls: [],
    });
    const result = (await tool.execute?.({ query: "news" }, {} as never)) as {
      ok: true;
      data: { results: { sourceId: string }[] };
    };
    expect(result.ok).toBe(true);
    expect(result.data.results.map((r) => r.sourceId)).toEqual(["web-1", "web-2"]);
    expect(keyless.search).toHaveBeenCalledTimes(1);
    expect(keyed.search).not.toHaveBeenCalled();
  });

  it("remote-channel maxAttempts=1：第二次搜索直接 LIMIT_REACHED", async () => {
    const keyless: KiroWebSearchProvider = {
      id: "auto",
      checkCredential: vi.fn(),
      search: vi.fn().mockResolvedValue({
        ok: true,
        query: "news",
        count: 1,
        results: [{ sourceId: "", title: "A", url: "https://a.dev/1", domain: "a.dev", snippet: "s" }],
      }),
    };
    const tool = createKiroWebSearchTool({
      provider: { id: "tavily", checkCredential: vi.fn(), search: vi.fn() },
      keylessProvider: keyless,
      credential: { mode: "server" },
      attemptsSoFar: 0,
      maxAttempts: 1,
      nextSourceIndex: 1,
      successfulQueries: [],
      seenUrls: [],
    });
    const first = (await tool.execute?.({ query: "news" }, {} as never)) as { ok: true };
    expect(first.ok).toBe(true);
    const second = (await tool.execute?.({ query: "other" }, {} as never)) as {
      ok: false;
      code: string;
    };
    expect(second.ok).toBe(false);
    expect(second.code).toBe("WEB_SEARCH_LIMIT_REACHED");
    expect(keyless.search).toHaveBeenCalledTimes(1);
  });
});

describe("keyless read_web_source fallback", () => {
  it("Native Reader 失败 → auto keyless evidence provider；不报 misleading KEY_REQUIRED", async () => {
    const extract = vi.fn().mockResolvedValue({
      ok: true,
      sources: [
        {
          sourceId: "web-1",
          title: "",
          url: "https://example.com/a",
          domain: "",
          chunks: [{ text: "keyless evidence text" }],
          truncated: false,
        },
      ],
    });
    const fallback: KiroWebEvidenceProvider = { id: "auto", extract };
    const readTool = createKiroWebReadTool({
      fallbackProvider: fallback,
      nativeReader: (async () => ({ ok: false, code: "WEB_NATIVE_FETCH_FAILED" })) as never,
      credential: { mode: "server" },
      attemptsSoFar: 0,
      trustedSources: [
        { sourceId: "web-1", title: "Example", url: "https://example.com/a", domain: "example.com" },
      ],
      readSourceIds: [],
      evidenceCharsUsed: 0,
    });
    const result = (await readTool.execute?.({ sourceIds: ["web-1"], query: "evidence" }, {} as never)) as {
      ok: true;
      data: { sources: { sourceId: string; availablePages?: number[] }[] };
    };
    expect(result.ok).toBe(true);
    expect(result.data.sources[0].sourceId).toBe("web-1");
    expect(result.data.sources[0].availablePages).toBeUndefined();
    expect(extract).toHaveBeenCalledTimes(1);
  });
});

describe("prompt autonomy contract", () => {
  it("Kiro prompt 明确默认可用 / 英文重试 / 个人敏感信息约束", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("联网搜索默认可用");
    expect(KIRO_SYSTEM_PROMPT).toContain("英文关键词");
    expect(KIRO_SYSTEM_PROMPT).toContain("个人敏感信息");
    expect(KIRO_SYSTEM_PROMPT).toContain("不要编造来源");
  });

  it("Settings 不再把默认搜索说成必须自带 Key", () => {
    const source = readFileSync("components/settings/KiroAISettings.tsx", "utf8");
    expect(source).toContain("自动（推荐）");
    expect(source).toContain("基础搜索");
    expect(source).not.toContain("当前服务端未配置搜索凭据，请使用自己的 API Key");
  });
});
