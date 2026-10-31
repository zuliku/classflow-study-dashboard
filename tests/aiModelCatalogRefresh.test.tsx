/**
 * @vitest-environment jsdom
 *
 * 2026-10：设置页「更新模型列表」契约。
 * - 首次加载不带 refresh=1（可命中服务端短缓存）
 * - refresh() 带 refresh=1 强制远端；成功替换列表并清除错误
 * - 刷新失败保留当前列表并暴露 error（不静默回到 registry、不误报成功）
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";

const entry = (id: string) => ({ id, name: id, transport: "openai-chat" as const, vendor: null });

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAIModelCatalog refresh", () => {
  it("首次加载不带 refresh=1；refresh() 携带 refresh=1 并替换为最新列表", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ models: [entry("gpt-6-luna")], source: "remote" }))
      .mockResolvedValueOnce(jsonResponse({ models: [entry("claude-haiku-5-5")], source: "remote" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAIModelCatalog("opencode-go"));
    await waitFor(() => expect(result.current.source).toBe("remote"));
    expect(result.current.models.map((m) => m.id)).toEqual(["gpt-6-luna"]);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("refresh=1");

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(result.current.models.map((m) => m.id)).toEqual(["claude-haiku-5-5"])
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain("refresh=1");
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("刷新失败：保留当前列表 + 暴露 error（不丢弃已渲染模型）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ models: [entry("grok-4.7")], source: "remote" }))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAIModelCatalog("opencode-go"));
    await waitFor(() => expect(result.current.source).toBe("remote"));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/无法连接模型服务/);
    expect(result.current.models.map((m) => m.id)).toEqual(["grok-4.7"]);
    expect(result.current.refreshing).toBe(false);
  });

  it("远端可达但无可用模型（source=registry）：提示未能获取最新列表，且不用 fallback 覆盖当前列表", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ models: [entry("grok-4.7")], source: "remote" }))
      .mockResolvedValueOnce(
        jsonResponse({ models: [entry("claude-haiku-5-5")], source: "registry" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAIModelCatalog("opencode-go"));
    await waitFor(() => expect(result.current.source).toBe("remote"));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/未能获取最新模型列表/);
    expect(result.current.models.map((m) => m.id)).toEqual(["grok-4.7"]);
    expect(result.current.source).toBe("remote");
  });
});
