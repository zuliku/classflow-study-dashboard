"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ComputerPermissionRule,
  KiroAgentMode,
  KiroWorkspaceMeta,
} from "@/lib/ai/computer/types";
import { DEFAULT_SANDBOX_ADAPTER_REF } from "@/lib/ai/computer/workspace/management";

/**
 * Kiro Computer Agent 逻辑配置 store（独立于 useAISettingsStore / useAppStore）。
 *
 * 持久化边界（classflow-kiro-computer-v1，localStorage，version 2）：
 * - 可持久化：computerEnabled、activeWorkspaceId、agentMode、workspaces（逻辑元数据）、
 *   persistent permission rules。
 * - 禁止持久化：FileSystemDirectoryHandle、native path、permission token、file bytes、session rules。
 *   session rules 只存在于内存（persist 的 partialize 过滤 scope === "session"）。
 * - adapterRef 是 opaque runtime reference，随 workspace 逻辑元数据持久化是安全的
 *   （指向 IndexedDB grant store 的键），但绝不发送给模型。
 * - version 2 migrate：legacy 重复的 sandbox-default Workspace metadata 只保留第一项
 *   （共享同一文件 namespace，迁移绝不删除 Sandbox 文件）。
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
  /**
   * 默认 Kiro Sandbox 只能有一个：已存在则激活 + 启用并返回其 id；
   * 不存在则创建 canonical Sandbox（adapterRef = sandbox-default）并激活启用。
   */
  ensureDefaultSandboxWorkspace: () => string;
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
    (set, get) => ({
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
        set((state) => {
          const remaining = state.workspaces.filter((w) => w.id !== id);
          const currentStillExists = remaining.some((w) => w.id === state.activeWorkspaceId);
          return {
            workspaces: remaining,
            // 删除 active → 自动选择下一项；删除最后一项 → null
            activeWorkspaceId: currentStillExists
              ? state.activeWorkspaceId
              : (remaining[0]?.id ?? null),
            // 删除最后 Workspace → Computer Agent 自动关闭（保持其它情况下的 enabled）
            computerEnabled: remaining.length === 0 ? false : state.computerEnabled,
            // Workspace 对应 permission rules（session + persistent）一并清理
            permissionRules: state.permissionRules.filter((r) => r.workspaceId !== id),
          };
        }),

      ensureDefaultSandboxWorkspace: () => {
        const state = get();
        const existing = state.workspaces.find((w) =>
          w.roots.some((r) => r.adapterRef === DEFAULT_SANDBOX_ADAPTER_REF)
        );
        if (existing) {
          set({ activeWorkspaceId: existing.id, computerEnabled: true });
          return existing.id;
        }
        const now = new Date().toISOString();
        const id = `ws-${crypto.randomUUID()}`;
        set((s) => ({
          workspaces: [
            ...s.workspaces,
            {
              id,
              name: "Kiro Sandbox",
              roots: [
                {
                  id: "root-sandbox",
                  label: "Sandbox（当前浏览器）",
                  access: "read-write",
                  adapterRef: DEFAULT_SANDBOX_ADAPTER_REF,
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeWorkspaceId: id,
          computerEnabled: true,
        }));
        return id;
      },

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
      version: 2,
      migrate: (persistedState, version) => {
        if (version >= 2) return persistedState as Partial<KiroComputerState>;
        const s = persistedState as
          | {
              workspaces?: KiroWorkspaceMeta[];
              activeWorkspaceId?: string | null;
              permissionRules?: ComputerPermissionRule[];
            }
          | undefined;
        if (!s?.workspaces || s.workspaces.length === 0) {
          return s as Partial<KiroComputerState>;
        }
        // legacy：多个 sandbox-default Workspace 共享同一文件 namespace——
        // 只保留第一项 metadata（绝不删除 Sandbox 文件）；active 指向被去重项时重定向到 canonical。
        const sandboxWorkspaces = s.workspaces.filter((w) =>
          w.roots.some((r) => r.adapterRef === DEFAULT_SANDBOX_ADAPTER_REF)
        );
        if (sandboxWorkspaces.length <= 1) {
          return s as Partial<KiroComputerState>;
        }
        const kept = sandboxWorkspaces[0];
        const droppedIds = new Set(sandboxWorkspaces.slice(1).map((w) => w.id));
        return {
          ...s,
          workspaces: s.workspaces.filter((w) => !droppedIds.has(w.id)),
          activeWorkspaceId:
            s.activeWorkspaceId && droppedIds.has(s.activeWorkspaceId)
              ? kept.id
              : (s.activeWorkspaceId ?? null),
          permissionRules: (s.permissionRules ?? []).filter(
            (r) => !(r.workspaceId && droppedIds.has(r.workspaceId))
          ),
        } as Partial<KiroComputerState>;
      },
      partialize: (state): Partial<KiroComputerState> => ({
        computerEnabled: state.computerEnabled,
        activeWorkspaceId: state.activeWorkspaceId,
        agentMode: state.agentMode,
        workspaces: state.workspaces,
        // 只持久化 persistent rules；session rules 仅内存
        permissionRules: state.permissionRules.filter((r) => r.scope === "persistent"),
      }),
    }
  )
);
