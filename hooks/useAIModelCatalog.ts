"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getModelsForProvider, getSelectorModelsForProvider } from "@/lib/ai/providers/registry";
import { AIProviderId, AIModelVendor, AITransport } from "@/lib/ai/providers/types";
import { apiUrl } from "@/lib/desktop/apiBase";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

/** 模型 Catalog 条目（Settings 与 Composer 共用同一模型集合） */
export interface AIModelCatalogEntry {
  id: string;
  name: string;
  transport: AITransport;
  vendor: AIModelVendor | null;
}

/**
 * AI Model Catalog（Task 10 + 2026-09 更多模型开关 + 一键刷新）：
 * - DeepSeek / Custom：直接使用静态 Registry（Custom 无固定列表）
 * - OpenCode Go：默认精选列表（少而精）；Kiro 设置「显示更多模型」打开后 → 全部已验证模型
 *   （先以 registry fallback 渲染，再异步请求 /api/ai/models 刷新远端 catalog；
 *   远端失败静默保留 registry fallback；transport 不暴露给用户）
 * - refresh()：设置页「更新模型列表」→ 带 refresh=1 绕过服务端短缓存重新请求；
 *   失败时保留当前列表并暴露 error（不把已下线模型误报为可用）。
 */
export function useAIModelCatalog(provider: AIProviderId) {
  // 2026-09：模型范围偏好（Settings 开关；打开 = 全部已验证模型）
  const showAllModels = useKiroPreferencesStore((s) => s.showAllModels);

  const toEntries = (p: AIProviderId): AIModelCatalogEntry[] => {
    const source = showAllModels ? getModelsForProvider(p) : getSelectorModelsForProvider(p);
    return source.map((m) => ({
      id: m.id,
      name: m.name,
      transport: m.transport,
      vendor: m.vendor,
    }));
  };

  const [models, setModels] = useState<AIModelCatalogEntry[]>(() => toEntries(provider));
  const [source, setSource] = useState<"registry" | "remote">("registry");
  const [loading, setLoading] = useState(false);
  // 手动刷新：与首次加载区分（刷新时不回退到 registry fallback，避免列表闪烁）
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const manualRefreshRef = useRef(false);

  const refresh = useCallback(() => {
    manualRefreshRef.current = true;
    setRefreshing(true);
    setError(null);
    setRefreshSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    const fallback = toEntries(provider);
    if (provider !== "opencode-go") {
      setModels(fallback);
      setSource("registry");
      setError(null);
      setLoading(false);
      setRefreshing(false);
      manualRefreshRef.current = false;
      return;
    }
    const manual = manualRefreshRef.current;
    manualRefreshRef.current = false;
    // 首次加载 / 切换范围：先渲染 registry fallback，再异步刷新远端（成功才替换）
    if (!manual) {
      setModels(fallback);
      setSource("registry");
      setLoading(true);
    }
    let cancelled = false;
    fetch(apiUrl(`/api/ai/models?provider=opencode-go${showAllModels ? "&all=1" : ""}${manual ? "&refresh=1" : ""}`))
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ models?: AIModelCatalogEntry[]; source?: string }>)
          : Promise.reject(new Error(`catalog ${r.status}`))
      )
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.models) ? data.models : [];
        // 仅把「远端成功」视为刷新成功；失败时保留当前已渲染列表（不回退覆盖）
        const refreshedOk = data.source === "remote" && list.length > 0;
        if (list.length > 0 && (!manual || refreshedOk)) {
          setModels(list);
          setSource(refreshedOk ? "remote" : "registry");
        }
        if (manual) {
          // 远端不可达 / 官方暂无可验证模型：保留本地列表并提示，不静默成功
          setError(refreshedOk ? null : "未能获取最新模型列表，已保留本地列表，请稍后重试。");
        }
      })
      .catch(() => {
        /* 远端失败：保留 registry fallback（手动刷新时额外提示） */
        if (!cancelled && manual) {
          setError("更新失败：无法连接模型服务，已保留本地列表。");
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, showAllModels, refreshSeq]);

  return { models, loading, refreshing, source, error, refresh };
}
