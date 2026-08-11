/**
 * Kiro Search — Provider 接口（Task 14A）。
 * 上层（Route / Tool / UI / Citation）只依赖本接口，禁止直接 import Tavily response。
 */

import { KiroWebSearchProviderId, KiroWebSearchRequest, KiroWebSearchOutcome } from "@/lib/ai/web/types";

export interface KiroWebSearchProvider {
  id: KiroWebSearchProviderId;
  search(
    request: KiroWebSearchRequest,
    context: {
      apiKey: string;
      signal?: AbortSignal;
    }
  ): Promise<KiroWebSearchOutcome>;
}

import { createTavilyWebSearchProvider } from "@/lib/ai/web/tavily";

const PROVIDERS: Record<KiroWebSearchProviderId, KiroWebSearchProvider> = {
  tavily: createTavilyWebSearchProvider(),
};

export function getKiroWebSearchProvider(id: KiroWebSearchProviderId): KiroWebSearchProvider {
  return PROVIDERS[id];
}
