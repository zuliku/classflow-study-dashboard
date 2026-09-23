"use client";

import { useEffect, useState } from "react";
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
 * AI Model Catalog（Task 10 + 2026-09 更多模型开关）：
 * - DeepSeek / Custom：直接使用静态 Registry（Custom 无固定列表）
 * - OpenCode Go：默认精选列表（少而精）；Kiro 设置「显示更多模型」打开后 → 全部已验证模型
 *   （先以 registry fallback 渲染，再异步请求 /api/ai/models 刷新远端 catalog；
 *   远端失败静默保留 registry fallback；transport 不暴露给用户）
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

  useEffect(() => {
    const fallback = toEntries(provider);
    if (provider !== "opencode-go") {
      setModels(fallback);
      setSource("registry");
      return;
    }
    // 先渲染 registry fallback，再异步刷新远端（成功才替换）
    setModels(fallback);
    setSource("registry");
    setLoading(true);
    let cancelled = false;
    fetch(apiUrl(`/api/ai/models?provider=opencode-go${showAllModels ? "&all=1" : ""}`))
      .then((r) => (r.ok ? (r.json() as Promise<{ models?: AIModelCatalogEntry[] }>) : Promise.reject()))
      .then((data) => {
        if (!cancelled && Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
          setSource("remote");
        }
      })
      .catch(() => {
        /* 远端失败：保留 registry fallback */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, showAllModels]);

  return { models, loading, source };
}
