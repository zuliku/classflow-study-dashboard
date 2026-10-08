"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExternalInboxItem, InboxSource, InboxStatus } from "@/lib/inbox/types";
import { createHash } from "@/lib/inbox/dedupe";
import { createGuardedStorage, subscribeCrossWindowSync } from "@/lib/persistStorage";
import { useToastStore } from "@/store/useToastStore";

interface InboxState {
  items: ExternalInboxItem[];
  addItem: (input: Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin"> & { id?: string }) => string;
  updateStatus: (id: string, status: InboxStatus) => void;
  removeItem: (id: string) => void;
  /** 删除撤销：按原 id 完整回填（addItem 会走去重/新 id，不适合撤销） */
  restoreItem: (item: ExternalInboxItem) => void;
  archiveItem: (id: string) => void;
  getUnreadCount: () => number;
  getByStatus: (status: InboxStatus | "all") => ExternalInboxItem[];
  clearAll: () => void;
}

function makeDedupeKey(input: { source: InboxSource; externalMessageId?: string; text: string; senderDisplay?: string; sourceAccountId?: string }): string {
  const accountPart = input.sourceAccountId ? `:${input.sourceAccountId}` : "";
  if (input.externalMessageId) return `${input.source}${accountPart}:${input.externalMessageId}`;
  return `${input.source}${accountPart}:${createHash(input.text + (input.senderDisplay ?? ""))}`;
}

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (input) => {
        const dedupeKey = makeDedupeKey(input as { source: InboxSource; externalMessageId?: string; text: string; senderDisplay?: string; sourceAccountId?: string });
        // 去重：已存在则不重复创建
        const existing = get().items.find((it) => it.dedupeKey === dedupeKey);
        if (existing) return existing.id;

        const id = input.id ?? `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const item: ExternalInboxItem = {
          id,
          source: input.source,
          externalMessageId: input.externalMessageId,
          conversationId: input.conversationId,
          senderDisplay: input.senderDisplay,
          subject: input.subject,
          text: input.text,
          receivedAt: input.receivedAt ?? Date.now(),
          attachments: input.attachments ?? [],
          status: "unread",
          dedupeKey,
          origin: "remote-channel",
          sourceAccountId: (input as { sourceAccountId?: string }).sourceAccountId,
          replyContextId: (input as { replyContextId?: string }).replyContextId,
        };
        set((s) => ({ items: [item, ...s.items] }));
        return id;
      },
      updateStatus: (id, status) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status } : it)) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
      restoreItem: (item) =>
        set((s) => (s.items.some((it) => it.id === item.id) ? s : { items: [item, ...s.items] })),
      archiveItem: (id) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status: "archived" as const } : it)) })),
      getUnreadCount: () => get().items.filter((it) => it.status === "unread").length,
      getByStatus: (status) => {
        const items = get().items;
        if (status === "all") return items;
        return items.filter((it) => it.status === status);
      },
      clearAll: () => set({ items: [] }),
    }),
    {
      name: "classflow-inbox-v1",
      storage: createGuardedStorage(() =>
        useToastStore.getState().pushToast({
          message: "本地存储空间已满，最新更改可能无法保存，请备份后清理空间。",
          type: "error",
        })
      ),
      // 跨窗 rehydrate 归一：远端超长正文截断（与 partialize 同口径），防脏库直写入库
      merge: (persistedState, currentState) => {
        const s = persistedState as Partial<InboxState> | undefined;
        if (!s || typeof s !== "object") return currentState;
        const items = Array.isArray(s.items)
          ? s.items
              .filter((it) => it && typeof it.id === "string")
              .map((it) => ({
                ...it,
                text: typeof it.text === "string" ? it.text.slice(0, 2000) : "",
                attachments: Array.isArray(it.attachments) ? it.attachments.slice(0, 3) : [],
              }))
          : [];
        return { ...currentState, ...s, items };
      },
      partialize: (state) => ({
        items: state.items.map((it) => ({
          id: it.id,
          source: it.source,
          externalMessageId: it.externalMessageId,
          conversationId: it.conversationId,
          senderDisplay: it.senderDisplay,
          subject: it.subject,
          text: it.text.slice(0, 2000), // 限制长度，避免大量正文塞进 localStorage
          receivedAt: it.receivedAt,
          attachments: it.attachments.slice(0, 3),
          status: it.status,
          dedupeKey: it.dedupeKey,
          origin: it.origin,
          sourceAccountId: it.sourceAccountId,
          replyContextId: it.replyContextId,
        })),
      }),
      version: 1,
    }
  )
);

// 跨窗口收敛：他窗写入同 key 后去抖 rehydrate（此前收件箱跨窗分叉，未读覆盖已读）
subscribeCrossWindowSync(useInboxStore, "classflow-inbox-v1");

/** 仅测试：内存隔离实例 */
export function createTestInboxStore() {
  return create<InboxState>()((set, get) => ({
    items: [],
    addItem: (input) => {
      const dedupeKey = makeDedupeKey(input as { source: InboxSource; externalMessageId?: string; text: string; senderDisplay?: string; sourceAccountId?: string });
      const existing = get().items.find((it) => it.dedupeKey === dedupeKey);
      if (existing) return existing.id;
      const id = `test_${Math.random().toString(36).slice(2, 6)}`;
      const item: ExternalInboxItem = {
        id,
        source: input.source,
        externalMessageId: input.externalMessageId,
        conversationId: input.conversationId,
        senderDisplay: input.senderDisplay,
        subject: input.subject,
        text: input.text,
        receivedAt: input.receivedAt ?? Date.now(),
        attachments: input.attachments ?? [],
        status: "unread",
        dedupeKey,
        origin: "remote-channel",
        sourceAccountId: (input as { sourceAccountId?: string }).sourceAccountId,
        replyContextId: (input as { replyContextId?: string }).replyContextId,
      };
      set((s) => ({ items: [item, ...s.items] }));
      return id;
    },
    updateStatus: (id, status) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status } : it)) })),
    removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
    restoreItem: (item) =>
      set((s) => (s.items.some((it) => it.id === item.id) ? s : { items: [item, ...s.items] })),
    archiveItem: (id) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status: "archived" as const } : it)) })),
    getUnreadCount: () => get().items.filter((it) => it.status === "unread").length,
    getByStatus: (status) => {
      const items = get().items;
      if (status === "all") return items;
      return items.filter((it) => it.status === status);
    },
    clearAll: () => set({ items: [] }),
  }));
}
