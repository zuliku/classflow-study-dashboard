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
  /** Task 15B：显式排除域名（用户/Agent 明确要求；不建默认黑名单） */
  excludeDomains?: string[];
  /** 精确名称 / 短语搜索（仅用户明确要求精确匹配时；request planner 校验引号短语） */
  exactMatch?: boolean;
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
  /** Provider 层 canonical 去重移除的数量（安全确定性数字） */
  duplicatesFiltered?: number;
}

export type KiroWebSearchErrorCode =
  | "WEB_SEARCH_DISABLED"
  | "WEB_SEARCH_KEY_REQUIRED"
  | "WEB_SEARCH_AUTH_FAILED"
  | "WEB_SEARCH_RATE_LIMITED"
  | "WEB_SEARCH_TIMEOUT"
  | "WEB_SEARCH_FAILED"
  | "WEB_SEARCH_LIMIT_REACHED"
  | "WEB_SEARCH_DUPLICATE_QUERY"
  | "WEB_SOURCE_NOT_FOUND"
  | "WEB_READ_LIMIT_REACHED"
  | "WEB_SOURCE_ALREADY_READ"
  | "WEB_READ_TIMEOUT"
  | "WEB_READ_FAILED"
  | "WEB_READ_NO_EVIDENCE";

export interface KiroWebSearchFailure {
  ok: false;
  code: KiroWebSearchErrorCode;
  message: string;
}

export type KiroWebSearchOutcome = KiroWebSearchSuccess | KiroWebSearchFailure;

/** 凭据检查结果（Task 15A）：只表达「凭据是否工作」，绝不返回 usage/limit/plan/credits/account/key */
export type KiroWebSearchCredentialCheckOutcome =
  | { ok: true }
  | {
      ok: false;
      code: "WEB_SEARCH_AUTH_FAILED" | "WEB_SEARCH_RATE_LIMITED" | "WEB_SEARCH_TIMEOUT" | "WEB_SEARCH_FAILED";
      message: string;
    };

/* ---------------- Kiro Web Evidence（Task 16A：Search=Discovery / Read=Evidence） ---------------- */

/** 可信 Web Source（只来自当前 Turn 真实成功 web_search Tool Result） */
export interface KiroTrustedWebSource {
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
}

export interface KiroWebEvidenceRequest {
  sources: { sourceId: string; url: string }[];
  /** 「希望从这些网页中找什么」；Agent 可选 */
  query?: string;
}

/** Task 19B：chunk 可携带可信页码（Web PDF；普通 HTML 只有 text） */
export interface KiroWebEvidenceChunk {
  text: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface KiroWebEvidenceSource {
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  /** Task 19B：本次 Tool Result 实际向模型提供 Evidence 的页面（非整份 PDF 页数）；HTML/Tavily fallback 不设置 */
  availablePages?: number[];
  chunks: KiroWebEvidenceChunk[];
  truncated: boolean;
}

export type KiroWebEvidenceOutcome =
  | { ok: true; sources: KiroWebEvidenceSource[] }
  | { ok: false; code: KiroWebSearchErrorCode; message: string };

/** 一个 User Turn 内 web_search 最多调用次数（跨 client tool HTTP roundtrip 仍生效） */
export const MAX_WEB_SEARCHES_PER_TURN = 3;
/** 每次搜索返回结果上限（ClassFlow 成本边界，LLM 不能覆盖） */
export const MAX_WEB_RESULTS = 6;
/** 单次搜索超时 */
export const WEB_SEARCH_TIMEOUT_MS = 10_000;
/** Task 18C：一次 read_web_source 总预算（Native + Fallback 共享同一 AbortController） */
export const WEB_READ_TIMEOUT_MS = 15_000;
/** snippet 单条最大字符数 */
export const WEB_SEARCH_SNIPPET_MAX_CHARS = 900;
/** Task 15B：未显式 includeDomains 时，单域名最多保留结果数（来源多样性） */
export const MAX_WEB_RESULTS_PER_DOMAIN = 2;
/** Task 16A：一次 read_web_source 最多读取的 source 数 */
export const MAX_WEB_SOURCES_PER_READ = 2;
/** Task 16A：一个 User Turn 最多执行 read_web_source 次数（与 search limit 独立） */
export const MAX_WEB_READS_PER_TURN = 2;
/** Task 16A：单 source evidence 字符预算 */
export const MAX_WEB_EVIDENCE_CHARS_PER_SOURCE = 5_000;
/** Task 16A：单 Turn evidence 字符总预算 */
export const MAX_WEB_EVIDENCE_CHARS_PER_TURN = 10_000;
/** Task 17A：单 chunk 字符上限（所有 Provider chunks 与 fallback 切分统一经过） */
export const MAX_WEB_EVIDENCE_CHUNK_CHARS = 1_800;
