"use client";

import { useEffect } from "react";
import { useInboxStore } from "@/store/useInboxStore";
import { inboxRawPayloadToInput, isInboxRawPayload } from "@/lib/inbox/fromRawPayload";
import type { InboxRawPayloadLike } from "@/lib/inbox/fromRawPayload";

/**
 * Renderer bridge for Main → Renderer inbox external items (Task 14B reliable queue)
 * Must be mounted once at stable root, does not create second inbox DB.
 *
 * Source contract：Main 端 Sink 对 qq-bot / gmail / qq-mail 一视同仁地 publish；
 * 本 bridge 必须对**所有**合法 InboxSource ingest → ACK。
 * 历史 bug：曾对非 "qq-bot" 的 payload 直接 ACK-and-drop，导致 Gmail / QQ Mail
 * 消息被 Main 认为已消费但 Renderer 从未收到（消息丢失）。
 *
 * ACK 语义：
 * - 合法 payload + addItem 成功 → ACK（已消费）
 * - addItem throw（瞬时故障）→ 不 ACK，下次 rendererReady 重投
 * - 结构性不可用 payload（非对象 / source 非法 / text 缺失）→ poison-ACK，
 *   防止可靠队列无限重投；明确不 crash。
 */
export function useInboxChannelBridge(): void {
  useEffect(() => {
    const bridge = (window as unknown as { classflowDesktop?: { inbox?: { subscribeExternalItem: (cb: (envelope: unknown) => void) => () => void; rendererReady: () => Promise<unknown>; ack: (id: string) => Promise<unknown> } } }).classflowDesktop?.inbox;
    if (!bridge || typeof bridge.subscribeExternalItem !== "function") return;
    const unsubscribe = bridge.subscribeExternalItem((envelopeRaw: unknown) => {
      const envelope = (envelopeRaw ?? {}) as { deliveryId?: string; payload?: unknown };
      const deliveryId = typeof envelope.deliveryId === "string" ? envelope.deliveryId : undefined;
      // 兼容两种封包：{deliveryId, payload} 或裸 payload
      const candidate = envelope.payload ?? envelopeRaw;

      if (!isInboxRawPayload(candidate)) {
        // 结构性不可用：永远无法 ingest → bounded 处理（poison-ack），避免队列无限重投
        if (deliveryId) void bridge.ack(deliveryId).catch(() => {});
        return;
      }
      try {
        const input = inboxRawPayloadToInput(candidate as InboxRawPayloadLike);
        useInboxStore.getState().addItem(input);
        if (deliveryId) void bridge.ack(deliveryId).catch(() => {});
      } catch (err) {
        // addItem threw, do not ack so it will be resent on reload.
        // 可观测性：静默会让连续失败时用户收不到站外消息且无感知；此处至少落 console，
        // 长期失败的显性告警需要同步状态 UI（未建，先留痕）。
        // eslint-disable-next-line no-console
        console.error("[classflow:inbox] ingest failed, will retry on reload", deliveryId, err);
      }
    });
    // Signal ready after subscribe, so Main resends pending
    void bridge.rendererReady().catch(() => {});
    return unsubscribe;
  }, []);
}
