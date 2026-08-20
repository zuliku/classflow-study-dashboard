"use client";

import { useEffect } from "react";
import { useInboxStore } from "@/store/useInboxStore";

/**
 * Renderer bridge for Main → Renderer inbox external items (Task 13B)
 * Must be mounted once at stable root, does not create second inbox DB.
 */
export function useInboxChannelBridge(): void {
  useEffect(() => {
    const bridge = (window as unknown as { classflowDesktop?: { inbox?: { subscribeExternalItem: (cb: (item: unknown) => void) => () => void } } }).classflowDesktop?.inbox;
    if (!bridge || typeof bridge.subscribeExternalItem !== "function") return;
    const unsubscribe = bridge.subscribeExternalItem((raw: unknown) => {
      const item = raw as {
        source?: string;
        externalMessageId?: string;
        conversationId?: string;
        senderDisplay?: string;
        subject?: string;
        text?: string;
        receivedAt?: number;
        attachments?: unknown[];
      };
      if (!item || item.source !== "qq-bot") return;
      // Only raw payload, useInboxStore will generate dedupeKey/status/origin/id
      useInboxStore.getState().addItem({
        source: "qq-bot",
        externalMessageId: item.externalMessageId,
        conversationId: item.conversationId,
        senderDisplay: item.senderDisplay,
        subject: item.subject,
        text: item.text ?? "",
        receivedAt: item.receivedAt ?? Date.now(),
        attachments: (item.attachments as never) ?? [],
      });
    });
    return unsubscribe;
  }, []);
}
