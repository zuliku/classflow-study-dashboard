"use client";

import { create } from "zustand";

/**
 * Reminder Center UI 瞬时状态（不持久化）。
 * Reminder Center 是 Global Action（Sidebar Bell / Mobile More 入口），不是 NavTab。
 */

interface ReminderCenterState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useReminderCenterStore = create<ReminderCenterState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
