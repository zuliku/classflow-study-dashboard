/**
 * S-fix（超时对齐）：Chat transport 超时 fetch 中间件。
 *
 * 背景：
 * - 桌面端路由走纯 Node http server（src/main/httpServer.ts），Next 的
 *   `maxDuration` 在此路径不生效；真正的天花板是传输层默认 ~300s 断 socket，
 *   掐断后客户端只能看到通用网络错误。
 * - AI.CHAT_TIMEOUT_MS（300s）此前只定义未接线。本中间件把它接上：
 *   客户端先于传输层上限 abort（留 5s 余量），AbortSignal.timeout 产生
 *   TimeoutError → normalizeAIError 归一为可重试的 TIMEOUT（“请求超时，请重试。”）。
 * - 用户主动 Stop 走 SDK 自有 signal（组合后同样 abort，语义与此前一致，
 *   错误归一路径不变）。
 */
import { AI } from "@/lib/ai/config";

/** 客户端先于传输层默认上限 abort 的余量（确定先行，不与 socket 竞速） */
export const CHAT_TRANSPORT_TIMEOUT_MARGIN_MS = 5_000;

export function chatTransportTimeoutMs(): number {
  return Math.max(0, AI.CHAT_TIMEOUT_MS - CHAT_TRANSPORT_TIMEOUT_MARGIN_MS);
}

export function createTimeoutFetch(
  timeoutMs: number = chatTransportTimeoutMs(),
  impl: typeof fetch = globalThis.fetch.bind(globalThis)
): typeof fetch {
  return ((url, init) => {
    const incoming = init?.signal;
    if (incoming?.aborted) return Promise.reject(incoming.reason);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = incoming ? AbortSignal.any([incoming, timeoutSignal]) : timeoutSignal;
    return impl(url, { ...init, signal });
  }) as typeof fetch;
}
