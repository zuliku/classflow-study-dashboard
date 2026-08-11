/**
 * Kiro Search（Task 14A）— Provider-neutral types & ClassFlow 内部安全/成本边界。
 *
 * 产品层永远叫 Kiro Search；Agent Tool 永远叫 web_search；
 * V1 底层只接 Tavily，但上层（Agent / UI / Citation / History / Composer / Prompt 协议）
 * 只依赖本文件的类型，绝不传播 Provider 原始 response。
 */

export type KiroWebSearchProviderId = "tavily";

export type KiroWebSearchCredentialMode = "server" | "byok";

export type KiroWebSearchTopic = "general" | "news";

export type KiroWebSearchTimeRange = "day" | "week" | "month" | "year";

export interface KiroWebSearchRequest {
  query: string;
  topic?: KiroWebSearchTopic;
  timeRange?: KiroWebSearchTimeRange;
  includeDomains?: string[];
}

/** 归一化后的搜索结果（untrusted external content；sourceId 由调用层分配） */
export interface KiroWebSearchResult {
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
}

export interface KiroWebSearchSuccess {
  ok: true;
  query: string;
  count: number;
  results: KiroWebSearchResult[];
}

export type KiroWebSearchErrorCode =
  | "WEB_SEARCH_DISABLED"
  | "WEB_SEARCH_KEY_REQUIRED"
  | "WEB_SEARCH_AUTH_FAILED"
  | "WEB_SEARCH_RATE_LIMITED"
  | "WEB_SEARCH_TIMEOUT"
  | "WEB_SEARCH_FAILED"
  | "WEB_SEARCH_LIMIT_REACHED";

export interface KiroWebSearchFailure {
  ok: false;
  code: KiroWebSearchErrorCode;
  message: string;
}

export type KiroWebSearchOutcome = KiroWebSearchSuccess | KiroWebSearchFailure;

/** 一个 User Turn 内 web_search 最多调用次数（跨 client tool HTTP roundtrip 仍生效） */
export const MAX_WEB_SEARCHES_PER_TURN = 3;
/** 每次搜索返回结果上限（ClassFlow 成本边界，LLM 不能覆盖） */
export const MAX_WEB_RESULTS = 6;
/** 单次搜索超时 */
export const WEB_SEARCH_TIMEOUT_MS = 10_000;
/** snippet 单条最大字符数 */
export const WEB_SEARCH_SNIPPET_MAX_CHARS = 900;
