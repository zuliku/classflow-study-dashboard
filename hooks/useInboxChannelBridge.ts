"use client";

import { useEffect } from "react";
import { useInboxStore } from "@/store/useInboxStore";
import { inboxRawPayloadToInput } from "@/lib/inbox/fromRawPayload";

/**
 * Renderer bridge for Main → Renderer inbox external items (Task 14B reliable queue)
 * Must be mounted once at stable root, does not create second inbox DB.
 */
export function useInboxChannelBridge(): void {
  useEffect(() => {
    const bridge = (window as unknown as { classflowDesktop?: { inbox?: { subscribeExternalItem: (cb: (envelope: unknown) => void) => () => void; rendererReady: () => Promise<unknown>; ack: (id: string) => Promise<unknown> } } }).classflowDesktop?.inbox;
    if (!bridge || typeof bridge.subscribeExternalItem !== "function") return;
    const unsubscribe = bridge.subscribeExternalItem((envelopeRaw: unknown) => {
      const envelope = envelopeRaw as { deliveryId?: string; payload?: unknown };
      const payload = (envelope?.payload ?? envelopeRaw) as {
        source?: string;
        externalMessageId?: string;
        conversationId?: string;
        senderDisplay?: string;
        subject?: string;
        text?: string;
        receivedAt?: number;
        attachments?: unknown[];
        sourceAccountId?: string;
        replyContextId?: string;
      };
      const deliveryId = envelope?.deliveryId as string | undefined;
      if (!payload || payload.source !== "qq-bot") {
        if (deliveryId) void bridge.ack(deliveryId).catch(() => {});
        return;
      }
      try {
        const input = inboxRawPayloadToInput(payload as never);
        useInboxStore.getState().addItem(input);
        if (deliveryId) void bridge.ack(deliveryId).catch(() => {});
      } catch {
        // addItem threw, do not ack so it will be resent on reload
      }
    });
    // Signal ready after subscribe, so Main resends pending
    void bridge.rendererReady().catch(() => {});
    return unsubscribe;
  }, []);
}
