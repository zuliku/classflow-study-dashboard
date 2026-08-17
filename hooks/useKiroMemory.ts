"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { KiroMemory, MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";
import { listMemories, saveMemory, updateMemory, deleteMemory, MemoryDraft } from "@/lib/ai/memory/db";
import { buildMemoryIndex, searchMemoriesByKeyword, MemoryIndexEntry } from "@/lib/ai/memory/manager";

/**
 * Kiro Memory（跨会话长期学习记忆）客户端状态与 API。
 * - memories：全量（管理 UI 用）
 * - activeIndex：每轮注入模型的轻量 Index（不含 content；stale 自动过滤）
 * - api：search / save / update / remove（IndexedDB 执行 + 本地缓存刷新）
 * memoryEnabled=false：不构建 Index、拒绝 Memory 工具；已有记忆保留。
 */
export function useKiroMemory() {
  const memoryEnabled = useAISettingsStore((s) => s.memoryEnabled);
  const [memories, setMemories] = useState<KiroMemory[]>([]);
  const memoriesRef = useRef<KiroMemory[]>([]);

  const refresh = useCallback(async () => {
    const list = await listMemories();
    memoriesRef.current = list;
    setMemories(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Memory Index：仅 memoryEnabled 时构建（不注入模型）
  const activeIndex = useMemo<MemoryIndexEntry[]>(() => {
    if (!memoryEnabled) return [];
    const state = useAppStore.getState();
    const eligible = memories.filter((m) => {
      if (m.scope === "global") return true;
      if (m.scope === "semester") return !!m.scopeId && m.scopeId === state.semester.id;
      if (m.scope === "course") return !!m.scopeId && state.courses.some((c) => c.id === m.scopeId);
      return false;
    });
    return eligible.map((m) => ({ id: m.id, title: m.title, category: m.category, scope: m.scope, scopeId: m.scopeId }));
  }, [memoryEnabled, memories]);

  const search = useCallback(
    async (opts: { query?: string; category?: MemoryCategory; scope?: MemoryScope; limit?: number }) => {
      if (!memoryEnabled) return [];
      return searchMemoriesByKeyword(memoriesRef.current, opts);
    },
    [memoryEnabled]
  );

  const save = useCallback(
    async (draft: MemoryDraft) => {
      if (!memoryEnabled) return { memory: null as never, created: false, code: "MEMORY_DISABLED" };
      const result = await saveMemory(draft);
      await refresh();
      return result;
    },
    [memoryEnabled, refresh]
  );

  const update = useCallback(
    async (id: string, patch: Parameters<typeof updateMemory>[1]) => {
      if (!memoryEnabled) return { ok: false as const, code: "MEMORY_DISABLED" };
      const result = await updateMemory(id, patch);
      await refresh();
      return result;
    },
    [memoryEnabled, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteMemory(id);
      await refresh();
    },
    [refresh]
  );

  const clear = useCallback(async () => {
    const { clearMemories } = await import("@/lib/ai/memory/db");
    await clearMemories();
    await refresh();
  }, [refresh]);

  return { memories, activeIndex, memoryEnabled, refresh, search, save, update, remove, clear };
}
