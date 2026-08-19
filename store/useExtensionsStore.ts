"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ExtensionKind, ExtensionRecord, ExtensionStatus, ChannelProvider } from "@/lib/extensions/types";
import { createId } from "@/lib/utils";

/**
 * Extensions Store — 仅保存 metadata + credentialRef，绝不保存 secret。
 * persist 白名单：extensions 数组（每项仅 credentialRef），不含任何明文。
 */

export type ExtensionsTab = "skills" | "mcp" | "channels";

interface ExtensionsState {
  extensions: ExtensionRecord[];
  activeTab: ExtensionsTab;
  setActiveTab: (tab: ExtensionsTab) => void;

  // CRUD（仅 metadata；credentialRef 可选）
  addExtension: (input: {
    kind: ExtensionKind;
    providerId: string;
    name: string;
    description: string;
    credentialRef?: string;
  }) => string;

  updateExtension: (id: string, patch: Partial<Pick<ExtensionRecord, "name" | "description" | "status" | "enabled" | "credentialRef" | "errorMessage">>) => void;
  removeExtension: (id: string) => void;

  // Channel 快捷
  getChannelStatus: (provider: ChannelProvider) => ExtensionStatus;
  setChannelStatus: (provider: ChannelProvider, status: ExtensionStatus) => void;

  // 统计（UI 顶部 summary 用）
  counts: () => { skills: number; mcp: number; channels: number; enabledSkills: number; connectedMcp: number; onlineChannels: number };
}

function countByKind(extensions: ExtensionRecord[]) {
  return {
    skills: extensions.filter((e) => e.kind === "skill").length,
    mcp: extensions.filter((e) => e.kind === "mcp").length,
    channels: extensions.filter((e) => e.kind === "channel").length,
    enabledSkills: extensions.filter((e) => e.kind === "skill" && e.enabled).length,
    connectedMcp: extensions.filter((e) => e.kind === "mcp" && e.status === "connected").length,
    onlineChannels: extensions.filter((e) => e.kind === "channel" && e.status === "connected").length,
  };
}

export const useExtensionsStore = create<ExtensionsState>()(
  persist(
    (set, get) => ({
      extensions: [],
      activeTab: "skills",
      setActiveTab: (tab) => set({ activeTab: tab }),

      addExtension: (input) => {
        // 防御：绝不允许传入 secret 字段（即使 caller 误传，也在 persist 前清洗）
        const id = createId("ext");
        const now = Date.now();
        const rec: ExtensionRecord = {
          id,
          kind: input.kind,
          providerId: input.providerId,
          name: input.name,
          description: input.description,
          status: "disconnected",
          credentialRef: input.credentialRef,
          enabled: input.kind === "skill" ? true : false,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ extensions: [...s.extensions, rec] }));
        return id;
      },

      updateExtension: (id, patch) =>
        set((s) => ({
          extensions: s.extensions.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)),
        })),

      removeExtension: (id) =>
        set((s) => ({
          extensions: s.extensions.filter((e) => e.id !== id),
        })),

      getChannelStatus: (provider) => {
        const rec = get().extensions.find((e) => e.kind === "channel" && e.providerId === provider);
        return rec?.status ?? "disconnected";
      },

      setChannelStatus: (provider, status) => {
        const existing = get().extensions.find((e) => e.kind === "channel" && e.providerId === provider);
        if (existing) {
          get().updateExtension(existing.id, { status });
        } else {
          // 不存在时自动创建占位（未连接）
          get().addExtension({
            kind: "channel",
            providerId: provider,
            name: provider,
            description: "",
          });
          const created = get().extensions.find((e) => e.providerId === provider);
          if (created) get().updateExtension(created.id, { status });
        }
      },

      counts: () => countByKind(get().extensions),
    }),
    {
      name: "classflow-extensions-v1",
      storage: createJSONStorage(() => {
        if (typeof localStorage !== "undefined") return localStorage;
        // Vitest node env fallback（永不持久化，仅内存）
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        } as unknown as Storage;
      }),
      // 白名单：仅 extensions 与 activeTab；绝不持久化 secret
      partialize: (state) => ({
        extensions: state.extensions.map((e) => ({
          id: e.id,
          kind: e.kind,
          providerId: e.providerId,
          name: e.name,
          description: e.description,
          status: e.status,
          credentialRef: e.credentialRef,
          enabled: e.enabled,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          errorMessage: e.errorMessage,
        })),
        activeTab: state.activeTab,
      }),
      // 迁移时清洗：若旧数据含 secret 字段，丢弃
      migrate: (persistedState: unknown, _version) => {
        const s = persistedState as { extensions?: unknown[]; activeTab?: unknown } | null;
        if (!s || !Array.isArray(s.extensions)) return persistedState as ExtensionsState;
        const cleaned = s.extensions.map((raw) => {
          const r = raw as Record<string, unknown>;
          const { secret: _s, accessToken: _a, refreshToken: _r, password: _p, token: _t, apiKey: _k, ...rest } = r;
          return rest;
        });
        return { ...(s as object), extensions: cleaned } as unknown as ExtensionsState;
      },
      version: 1,
    }
  )
);

/** 仅测试：创建内存隔离实例 */
export function createTestExtensionsStore() {
  return create<ExtensionsState>()((set, get) => ({
    extensions: [],
    activeTab: "skills",
    setActiveTab: (tab) => set({ activeTab: tab }),
    addExtension: (input) => {
      const id = `test_${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const rec: ExtensionRecord = {
        id,
        kind: input.kind,
        providerId: input.providerId,
        name: input.name,
        description: input.description,
        status: "disconnected",
        credentialRef: input.credentialRef,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({ extensions: [...s.extensions, rec] }));
      return id;
    },
    updateExtension: (id, patch) =>
      set((s) => ({
        extensions: s.extensions.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)),
      })),
    removeExtension: (id) => set((s) => ({ extensions: s.extensions.filter((e) => e.id !== id) })),
    getChannelStatus: (provider) => {
      const rec = get().extensions.find((e) => e.kind === "channel" && e.providerId === provider);
      return rec?.status ?? "disconnected";
    },
    setChannelStatus: (provider, status) => {
      const existing = get().extensions.find((e) => e.kind === "channel" && e.providerId === provider);
      if (existing) get().updateExtension(existing.id, { status });
    },
    counts: () => countByKind(get().extensions),
  }));
}
