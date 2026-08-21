// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useKiroReplyDraft } from "@/hooks/useKiroReplyDraft";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { setSessionApiKey } from "@/lib/ai/sessionKeys";

describe("useKiroReplyDraft AbortSignal runtime boundary", () => {
  beforeEach(() => {
    useAISettingsStore.setState({
      enabled: true,
      provider: "opencode-go",
      model: "test-model",
      reasoningEffort: "default",
    });
    setSessionApiKey("opencode-go", "test-api-key");
  });

  afterEach(() => {
    cleanup();
    setSessionApiKey("opencode-go", "");
    delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
    vi.restoreAllMocks();
  });

  it("keeps AbortSignal in the renderer-native fetch boundary", async () => {
    const bridgeRequest = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.signal) {
        throw new DOMException("AbortSignal cannot cross contextBridge", "DataCloneError");
      }
      return new Response(JSON.stringify({ draft: "bridge draft" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      apiBase: "http://127.0.0.1:43123",
      api: { request: bridgeRequest },
      invocation: {
        beginRemoteInbox: vi.fn(async () => ({ invocationId: "inv-test-1" })),
      },
    };

    let capturedSignal: AbortSignal | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal ?? null;
      return new Response(JSON.stringify({ draft: "AI generated draft" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { result } = renderHook(() => useKiroReplyDraft());
    let generated: Awaited<ReturnType<typeof result.current.generateDraft>> = null;

    await act(async () => {
      generated = await result.current.generateDraft({
        inboxItemId: "inbox-1",
        message: "hello",
        senderDisplay: "QQ user",
        tone: "natural",
      });
    });

    expect(generated?.draft).toBe("AI generated draft");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:43123/api/ai/reply-draft");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(bridgeRequest).not.toHaveBeenCalled();
  });
});
