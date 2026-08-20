"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ExternalInboxItem, InboxSource, InboxStatus } from "@/lib/inbox/types";
import { createHash } from "@/lib/inbox/dedupe";

interface InboxState {
  items: ExternalInboxItem[];
  addItem: (input: Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin"> & { id?: string }) => string;
  updateStatus: (id: string, status: InboxStatus) => void;
  removeItem: (id: string) => void;
  archiveItem: (id: string) => void;
  getUnreadCount: () => number;
  getByStatus: (status: InboxStatus | "all") => ExternalInboxItem[];
  clearAll: () => void;
}

function makeDedupeKey(input: { source: InboxSource; externalMessageId?: string; text: string; senderDisplay?: string }): string {
  if (input.externalMessageId) return `${input.source}:${input.externalMessageId}`;
  return `${input.source}:${createHash(input.text + (input.senderDisplay ?? ""))}`;
}

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (input) => {
        const dedupeKey = makeDedupeKey(input);
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
        };
        set((s) => ({ items: [item, ...s.items] }));
        return id;
      },
      updateStatus: (id, status) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status } : it)) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
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
      storage: createJSONStorage(() => {
        if (typeof localStorage !== "undefined") return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        } as unknown as Storage;
      }),
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
        })),
      }),
      version: 1,
    }
  )
);

/** 仅测试：内存隔离实例 */
export function createTestInboxStore() {
  return create<InboxState>()((set, get) => ({
    items: [],
    addItem: (input) => {
      const dedupeKey = makeDedupeKey(input);
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
      };
      set((s) => ({ items: [item, ...s.items] }));
      return id;
    },
    updateStatus: (id, status) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, status } : it)) })),
    removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
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
