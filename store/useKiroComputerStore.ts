"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ComputerPermissionRule,
  KiroAgentMode,
  KiroWorkspaceMeta,
} from "@/lib/ai/computer/types";

/**
 * Kiro Computer Agent 逻辑配置 store（独立于 useAISettingsStore / useAppStore）。
 *
 * 持久化边界（classflow-kiro-computer-v1，localStorage）：
 * - 可持久化：computerEnabled、agentMode、workspaces（逻辑元数据）、persistent permission rules。
 * - 禁止持久化：FileSystemDirectoryHandle、native path、permission token、file bytes、session rules。
 *   session rules 只存在于内存（persist 的 partialize 过滤 scope === "session"）。
 * - adapterRef 是 opaque runtime reference，随 workspace 逻辑元数据持久化是安全的
 *   （指向 IndexedDB grant store 的键），但绝不发送给模型。
 */
export interface KiroComputerState {
  computerEnabled: boolean;
  activeWorkspaceId: string | null;
  agentMode: KiroAgentMode;
  workspaces: KiroWorkspaceMeta[];
  permissionRules: ComputerPermissionRule[];

  setComputerEnabled: (enabled: boolean) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setAgentMode: (mode: KiroAgentMode) => void;
  addWorkspace: (workspace: KiroWorkspaceMeta) => void;
  updateWorkspace: (id: string, patch: Partial<Omit<KiroWorkspaceMeta, "id">>) => void;
  removeWorkspace: (id: string) => void;
  upsertPermissionRule: (rule: ComputerPermissionRule) => void;
  removePermissionRule: (id: string) => void;
}

export const DEFAULT_AGENT_MODE: KiroAgentMode = "guided";

const DEFAULT_STATE = {
  computerEnabled: false,
  activeWorkspaceId: null,
  agentMode: DEFAULT_AGENT_MODE as KiroAgentMode,
  workspaces: [] as KiroWorkspaceMeta[],
  permissionRules: [] as ComputerPermissionRule[],
};

export const useKiroComputerStore = create<KiroComputerState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setComputerEnabled: (enabled) => set({ computerEnabled: enabled }),
      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
      setAgentMode: (mode) => set({ agentMode: mode }),

      addWorkspace: (workspace) =>
        set((state) => ({
          workspaces: [...state.workspaces, workspace],
        })),

      updateWorkspace: (id, patch) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w
          ),
        })),

      removeWorkspace: (id) =>
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
          // 删除当前 active workspace → 清空选择
          activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
        })),

      upsertPermissionRule: (rule) =>
        set((state) => ({
          permissionRules: [...state.permissionRules.filter((r) => r.id !== rule.id), rule],
        })),

      removePermissionRule: (id) =>
        set((state) => ({
          permissionRules: state.permissionRules.filter((r) => r.id !== id),
        })),
    }),
    {
      name: "classflow-kiro-computer-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Partial<KiroComputerState> => ({
        computerEnabled: state.computerEnabled,
        agentMode: state.agentMode,
        workspaces: state.workspaces,
        // 只持久化 persistent rules；session rules 仅内存
        permissionRules: state.permissionRules.filter((r) => r.scope === "persistent"),
      }),
    }
  )
);
