// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useKiroReplyDraft } from "@/hooks/useKiroReplyDraft";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { setSessionApiKey } from "@/lib/ai/sessionKeys";

function installDesktopBridge() {
  const bridgeRequest = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.signal) {
      throw new DOMException("AbortSignal cannot cross contextBridge", "DataCloneError");
    }
    return new Response(JSON.stringify({ draft: "bridge draft" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const beginRemoteInbox = vi.fn(async ({ inboxItemId }: { inboxItemId: string }) => ({
    invocationId: `inv-${inboxItemId}`,
  }));

  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    apiBase: "http://127.0.0.1:43123",
    api: { request: bridgeRequest },
    invocation: { beginRemoteInbox },
  };

  return { bridgeRequest, beginRemoteInbox };
}

function jsonResponse(draft: string) {
  return new Response(JSON.stringify({ draft }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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
    const { bridgeRequest } = installDesktopBridge();
    let capturedSignal: AbortSignal | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal ?? null;
      return jsonResponse("AI generated draft");
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
    expect(capturedSignal?.aborted).toBe(false);
    expect(bridgeRequest).not.toHaveBeenCalled();
  });

  it("cancel aborts the renderer-native fetch and suppresses a draft", async () => {
    installDesktopBridge();
    let capturedSignal: AbortSignal | null = null;
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? null;
      fetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    });

    const { result } = renderHook(() => useKiroReplyDraft());
    let pending!: ReturnType<typeof result.current.generateDraft>;
    act(() => {
      pending = result.current.generateDraft({ inboxItemId: "inbox-cancel", message: "cancel me" });
    });
    await started;

    act(() => {
      result.current.cancel();
    });

    const generated = await pending;
    expect(generated).toBeNull();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("a superseded request cannot overwrite the newer inbox draft", async () => {
    installDesktopBridge();
    const resolvers: Array<(response: Response) => void> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => resolvers.push(resolve))
    );

    const { result } = renderHook(() => useKiroReplyDraft());
    let first!: ReturnType<typeof result.current.generateDraft>;
    let second!: ReturnType<typeof result.current.generateDraft>;

    act(() => {
      first = result.current.generateDraft({ inboxItemId: "inbox-old", message: "old" });
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    act(() => {
      second = result.current.generateDraft({ inboxItemId: "inbox-new", message: "new" });
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolvers[1](jsonResponse("new draft"));
    });
    const secondResult = await second;

    await act(async () => {
      resolvers[0](jsonResponse("stale draft"));
    });
    const firstResult = await first;

    expect(secondResult?.draft).toBe("new draft");
    expect(secondResult?.inboxItemId).toBe("inbox-new");
    expect(firstResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
