/**
 * Kiro Search — Provider 接口（Task 14A）。
 * 上层（Route / Tool / UI / Citation）只依赖本接口，禁止直接 import Tavily response。
 */

import {
  KiroWebSearchProviderId,
  KiroWebSearchRequest,
  KiroWebSearchOutcome,
  KiroWebSearchCredentialCheckOutcome,
} from "@/lib/ai/web/types";

export interface KiroWebSearchProvider {
  id: KiroWebSearchProviderId;
  search(
    request: KiroWebSearchRequest,
    context: {
      apiKey: string;
      signal?: AbortSignal;
    }
  ): Promise<KiroWebSearchOutcome>;
  /** 凭据检查（Task 15A）：轻量 endpoint，不消耗搜索配额 */
  checkCredential(context: {
    apiKey: string;
    signal?: AbortSignal;
  }): Promise<KiroWebSearchCredentialCheckOutcome>;
}

import { createTavilyWebSearchProvider } from "@/lib/ai/web/tavily";

const PROVIDERS: Record<KiroWebSearchProviderId, KiroWebSearchProvider> = {
  tavily: createTavilyWebSearchProvider(),
};

export function getKiroWebSearchProvider(id: KiroWebSearchProviderId): KiroWebSearchProvider {
  return PROVIDERS[id];
}
