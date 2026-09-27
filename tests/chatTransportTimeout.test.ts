/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import {
  createTimeoutFetch,
  chatTransportTimeoutMs,
  CHAT_TRANSPORT_TIMEOUT_MARGIN_MS,
} from "@/lib/ai/chatTransport";
import { AI } from "@/lib/ai/config";

/**
 * S-fix（超时对齐）：transport 超时中间件。
 * 客户端先行 abort → 超长流转为可重试 TIMEOUT，而非 socket 被掐断后的通用网络错误。
 */
function hangingFetch(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("chatTransportTimeoutMs", () => {
  it("CHAT_TIMEOUT_MS 留 5s 余量（确定先于传输层 abort）", () => {
    expect(chatTransportTimeoutMs()).toBe(AI.CHAT_TIMEOUT_MS - CHAT_TRANSPORT_TIMEOUT_MARGIN_MS);
    expect(chatTransportTimeoutMs()).toBe(295_000);
  });
});

describe("createTimeoutFetch", () => {
  it("正常请求透传（返回原 Response，只调一次）", async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response("ok");
    }) as typeof fetch;
    const res = await createTimeoutFetch(1000, impl)("http://127.0.0.1/api", {});
    expect(calls).toBe(1);
    expect(await res.text()).toBe("ok");
  });

  it("超时 abort（TimeoutError，可被归一为 TIMEOUT 重试）", async () => {
    const impl = ((_url: unknown, init?: RequestInit) =>
      hangingFetch(init?.signal ?? null)) as typeof fetch;
    await expect(createTimeoutFetch(30, impl)("http://127.0.0.1/api", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("已 abort 的传入 signal：不调底层 fetch，直接拒绝", async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response("ok");
    }) as typeof fetch;
    const controller = new AbortController();
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(
      createTimeoutFetch(1000, impl)("http://127.0.0.1/api", { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("用户中途 abort 透传（Stop 语义不变）", async () => {
    const impl = ((_url: unknown, init?: RequestInit) =>
      hangingFetch(init?.signal ?? null)) as typeof fetch;
    const controller = new AbortController();
    const pending = createTimeoutFetch(5000, impl)("http://127.0.0.1/api", {
      signal: controller.signal,
    });
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
