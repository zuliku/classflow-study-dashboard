/**
 * Kiro Search — Provider 接口（Task 14A / 18C）。
 * 上层（Route / Tool / UI / Citation）只依赖本接口，禁止直接 import Tavily response。
 *
 * Task 18C 拆分：
 * - KiroWebSearchProvider = search + checkCredential（web_search 用）
 * - KiroWebEvidenceProvider = extract（read_web_source 的 fallback backend 用）
 * Evidence Runtime 只依赖 KiroWebEvidenceProvider；Tavily 只是 fallback implementation。
 */

import {
  KiroWebSearchProviderId,
  KiroWebSearchRequest,
  KiroWebSearchOutcome,
  KiroWebSearchCredentialCheckOutcome,
  KiroWebEvidenceRequest,
  KiroWebEvidenceOutcome,
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

/** Task 18C：Evidence Provider（网页正文提取）。Tavily Extract 只是默认 fallback implementation */
export interface KiroWebEvidenceProvider {
  id: KiroWebSearchProviderId;
  extract(
    request: KiroWebEvidenceRequest,
    context: {
      apiKey: string;
      signal?: AbortSignal;
    }
  ): Promise<KiroWebEvidenceOutcome>;
}

export type KiroWebProvider = KiroWebSearchProvider & KiroWebEvidenceProvider;

import { createTavilyWebSearchProvider } from "@/lib/ai/web/tavily";

const tavilyProvider = createTavilyWebSearchProvider();

const SEARCH_PROVIDERS: Record<KiroWebSearchProviderId, KiroWebSearchProvider> = {
  tavily: tavilyProvider,
};

const EVIDENCE_PROVIDERS: Record<KiroWebSearchProviderId, KiroWebEvidenceProvider> = {
  tavily: tavilyProvider,
};

export function getKiroWebSearchProvider(id: KiroWebSearchProviderId): KiroWebSearchProvider {
  return SEARCH_PROVIDERS[id];
}

export function getKiroWebEvidenceProvider(id: KiroWebSearchProviderId): KiroWebEvidenceProvider {
  return EVIDENCE_PROVIDERS[id];
}
