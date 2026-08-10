"use client";

import { create } from "zustand";

/**
 * Reminder Delivery Queue（Task 7G-A2）：站内 Reminder Card 的瞬时队列。
 * 只保存 Reminder ID（不复制完整对象）；不持久化。
 * Toast 是短暂操作反馈；Reminder 是持久业务提醒 —— 两者 Store 严格分离。
 */

interface ReminderDeliveryState {
  queue: string[];
  enqueue: (id: string) => void;
  dismiss: (id: string) => void;
}

export const useReminderDeliveryStore = create<ReminderDeliveryState>((set) => ({
  queue: [],
  enqueue: (id) =>
    set((s) => (s.queue.includes(id) ? s : { queue: [...s.queue, id] })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((x) => x !== id) })),
}));
