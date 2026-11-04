import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWebSearchStatus } from "@/app/api/ai/web-search/status/route";
import { handleWebSearchTest } from "@/app/api/ai/web-search/test/route";
import { EXA_MCP_ENDPOINT } from "@/lib/ai/web/keyless/exa";
import { TAVILY_USAGE_URL } from "@/lib/ai/web/tavily";

const previousKiro = process.env.KIRO_TAVILY_API_KEY;
const previousStandard = process.env.TAVILY_API_KEY;
const previousDisable = process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH;

function searchRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1/api/ai/web-search/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function exaOkResponse(): Response {
  return new Response(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "Title: Connection test\nURL: https://example.com/\nPublished: N/A\nHighlights:\nok",
          },
        ],
      },
    })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

beforeEach(() => {
  delete process.env.KIRO_TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH;
  vi.unstubAllGlobals();
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

describe("web-search status route", () => {
  it("server 未配置 + keyless 可用 → 真实状态", async () => {
    const res = await handleWebSearchStatus();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      serverConfigured: false,
      keylessAvailable: true,
    });
  });

  it("server 已配置 → serverConfigured=true", async () => {
    process.env.TAVILY_API_KEY = "tvly-server";
    const res = await handleWebSearchStatus();
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      serverConfigured: true,
      keylessAvailable: true,
    });
  });

  it("运营安全阀关闭 keyless → keylessAvailable=false", async () => {
    process.env.CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH = "1";
    const res = await handleWebSearchStatus();
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      serverConfigured: false,
      keylessAvailable: false,
    });
  });
});

describe("web-search test route", () => {
  it("server 无 Key → 测试 keyless，返回 mode=basic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(exaOkResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleWebSearchTest(searchRequest({ credentialMode: "server" }));
    await expect(res.json()).resolves.toEqual({ ok: true, mode: "basic" });
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toBe(EXA_MCP_ENDPOINT);
  });

  it("byok 无 Key → WEB_SEARCH_KEY_REQUIRED，不发网络请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleWebSearchTest(searchRequest({ credentialMode: "byok" }));
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("byok + Key → 测试 Tavily usage，返回 mode=enhanced", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleWebSearchTest(
      searchRequest({ credentialMode: "byok", apiKey: "tvly-user" })
    );
    await expect(res.json()).resolves.toEqual({ ok: true, mode: "enhanced" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(TAVILY_USAGE_URL);
  });

  it("server 已配置 Key → 测试 Tavily usage，返回 mode=enhanced", async () => {
    process.env.TAVILY_API_KEY = "tvly-server";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleWebSearchTest(searchRequest({ credentialMode: "server" }));
    await expect(res.json()).resolves.toEqual({ ok: true, mode: "enhanced" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(TAVILY_USAGE_URL);
  });
});
