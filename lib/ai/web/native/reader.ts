/**
 * Task 18B：Kiro Native HTML Reader —— 第一方网页正文读取器。
 *
 * URL → safeWebFetch（Task 18A，安全边界不可绕过）→ JSDOM（无脚本/无资源）→
 * Mozilla Readability（clone 上运行）→ 克制 fallback（main/article/body）→
 * normalize → chunk → query-aware selection → budget cap。
 *
 * 本模块是 Server-only：禁止 import 到 React component / Browser hook / Zustand。
 * 目前没有 Agent 入口（read_web_source 仍走 Tavily Extract）；后续 Task 18C 才接入。
 *
 * 安全约定：
 * - 所有网页 bytes 只来自 safeWebFetch（禁止 fetch / axios / JSDOM.fromURL / Readability 自己加载）
 * - 禁止 runScripts（含 outside-only）与 resources 加载
 * - 正文唯一事实来源是 article.textContent（或 fallback container.textContent）；
 *   HTML / DOM / attributes / script / style 一律不进 evidence
 * - Prompt Injection 文本只作为 untrusted evidence 传递，本层不解析不执行
 * - 返回失败不含 raw Error / HTML / stack / DNS / socket 细节
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { safeWebFetch } from "@/lib/ai/web/native/safeFetch";
import type { KiroSafeFetchSuccess } from "@/lib/ai/web/native/safeFetch";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";
import {
  applyNativeEvidenceBudget,
  chunkNativeEvidence,
  MIN_NATIVE_WEB_EVIDENCE_CHARS,
  normalizeNativeWebText,
  selectNativeEvidenceChunks,
} from "@/lib/ai/web/native/evidenceChunks";

/** DOM complexity guard（§22）：超过即放弃解析，避免恶意复杂 DOM 消耗大量 CPU */
export const MAX_NATIVE_WEB_DOM_ELEMENTS = 12_000;
/** Readability charThreshold（§23）：固定 ClassFlow 参数，不过高导致短官方公告失败 */
export const NATIVE_READABILITY_CHAR_THRESHOLD = 180;

export interface KiroNativeWebReadRequest {
  sourceId: string;
  url: string;
  query?: string;
  signal?: AbortSignal;
}

export interface KiroNativeWebReadSuccess {
  ok: true;
  sourceId: string;
  /** Search URL 经 Safe Fetch redirect 后的最终地址，仅内部 metadata，不作 Citation authority */
  finalUrl: string;
  /** Readability / document 提取的 metadata，仅供后续判断，不作 Citation authority */
  parsedTitle?: string;
  siteName?: string;
  publishedAt?: string;
  chunks: { text: string }[];
  truncated: boolean;
}

export type KiroNativeWebReadFailureCode =
  | "WEB_NATIVE_FETCH_FAILED"
  | "WEB_NATIVE_POLICY_BLOCKED"
  | "WEB_NATIVE_UNSUPPORTED_CONTENT"
  | "WEB_NATIVE_PARSE_FAILED"
  | "WEB_NATIVE_NO_EVIDENCE";

export interface KiroNativeWebReadFailure {
  ok: false;
  code: KiroNativeWebReadFailureCode;
}

export type KiroNativeWebReadOutcome = KiroNativeWebReadSuccess | KiroNativeWebReadFailure;

export interface KiroNativeWebReaderDeps {
  /** 生产 = safeWebFetch；测试 = fake fetcher（不得真实联网） */
  fetcher?: typeof safeWebFetch;
}

function mediaTypeOf(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/** 克制清理：只移除安全无用的元素，不删 nav/header/footer/aside（Readability 需要结构判断正文） */
function removeNonContentElements(doc: Document): void {
  for (const tag of ["script", "style", "noscript", "template"]) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      el.remove();
    }
  }
}

/** Fallback：从原 document 取 main → article → body 第一个存在容器，clone 后删除明显非正文 */
function fallbackContainerText(doc: Document): string {
  const container =
    doc.querySelector("main") ??
    doc.querySelector("article") ??
    doc.querySelector("body");
  if (!container) return "";
  const clone = container.cloneNode(true) as HTMLElement;
  for (const tag of ["script", "style", "noscript", "template", "nav", "footer", "aside", "form", "button", "svg", "canvas"]) {
    for (const el of Array.from(clone.getElementsByTagName(tag))) {
      el.remove();
    }
  }
  return clone.textContent ?? "";
}

/**
 * Task 18C：Safe Fetch 错误 → Native Reader 失败分类（内部；details 不传播给上层）。
 * 安全策略拒绝（SSRF / redirect / hostname / URL 形态）必须与普通网络失败区分，
 * 因为前者绝不能触发 Tavily fallback（fallback 不能成为绕过 Safety Layer 的通道）。
 */
function mapSafeFetchFailure(code: string): KiroNativeWebReadFailureCode {
  switch (code) {
    case "WEB_FETCH_INVALID_URL":
    case "WEB_FETCH_BLOCKED_HOST":
    case "WEB_FETCH_BLOCKED_IP":
    case "WEB_FETCH_REDIRECT_BLOCKED":
    case "WEB_FETCH_TOO_MANY_REDIRECTS":
      return "WEB_NATIVE_POLICY_BLOCKED";
    case "WEB_FETCH_UNSUPPORTED_CONTENT":
    case "WEB_FETCH_TOO_LARGE":
      return "WEB_NATIVE_UNSUPPORTED_CONTENT";
    case "WEB_FETCH_TIMEOUT":
    case "WEB_FETCH_HTTP_ERROR":
    case "WEB_FETCH_FAILED":
    default:
      return "WEB_NATIVE_FETCH_FAILED";
  }
}

/**
 * Task 18C：是否允许 Tavily fallback。
 * WEB_NATIVE_POLICY_BLOCKED → false（安全策略拒绝必须是最终拒绝）；
 * 其它（FETCH_FAILED / UNSUPPORTED_CONTENT / PARSE_FAILED / NO_EVIDENCE）→ true。
 */
export function shouldFallbackNativeWebRead(code: KiroNativeWebReadFailureCode): boolean {
  return code !== "WEB_NATIVE_POLICY_BLOCKED";
}

/** 诊断用 hostname（只记录 host，不记录完整 URL / query） */
function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

/**
 * HTML Reader 主函数：Safe Fetch → JSDOM → Readability → fallback → evidence pipeline。
 */
export async function readNativeWebSource(
  request: KiroNativeWebReadRequest,
  deps?: KiroNativeWebReaderDeps
): Promise<KiroNativeWebReadOutcome> {
  const fetcher = deps?.fetcher ?? safeWebFetch;

  const fetchResult = await fetcher({ url: request.url, signal: request.signal });
  if (!fetchResult.ok) {
    return { ok: false, code: mapSafeFetchFailure(fetchResult.code) };
  }
  const fetch = fetchResult;
  const mediaType = mediaTypeOf(fetch.contentType);

  let parsedText: string;
  let metadata: { title?: string; siteName?: string; publishedAt?: string } = {};

  if (mediaType === "text/plain") {
    // Plain Text：不创建 jsdom；直接 normalize pipeline
    parsedText = normalizeNativeWebText(fetch.body);
  } else {
    const parsed = parseHtmlEvidence(fetch, request.sourceId);
    if (!parsed.ok) return parsed;
    parsedText = parsed.text;
    metadata = parsed.metadata;
  }

  const normalized = normalizeNativeWebText(parsedText);
  if (normalized.length < MIN_NATIVE_WEB_EVIDENCE_CHARS) {
    debugKiroWebRead("parse-no-evidence", { sourceId: request.sourceId, host: hostOf(request.url), chars: normalized.length });
    return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };
  }

  const { chunks: allChunks, truncated: scanTruncated } = chunkNativeEvidence(normalized);
  const { selected, truncated: selectionTruncated } = selectNativeEvidenceChunks(
    allChunks,
    request.query
  );
  const { chunks, truncated: budgetTruncated } = applyNativeEvidenceBudget(selected);

  if (chunks.length === 0) return { ok: false, code: "WEB_NATIVE_NO_EVIDENCE" };

  debugKiroWebRead("native-read-ok", {
    sourceId: request.sourceId,
    host: hostOf(request.url),
    chunks: chunks.length,
    chars: chunks.reduce((s, c) => s + c.text.length, 0),
    truncated: scanTruncated || selectionTruncated || budgetTruncated,
  });

  return {
    ok: true,
    sourceId: request.sourceId,
    finalUrl: fetch.finalUrl,
    parsedTitle: metadata.title,
    siteName: metadata.siteName,
    publishedAt: metadata.publishedAt,
    chunks,
    truncated: scanTruncated || selectionTruncated || budgetTruncated,
  };
}

interface HtmlEvidence {
  ok: true;
  text: string;
  metadata: { title?: string; siteName?: string; publishedAt?: string };
}

/** HTML/XHTML：JSDOM（无脚本/无资源）→ complexity guard → Readability → fallback */
function parseHtmlEvidence(fetch: KiroSafeFetchSuccess, sourceId: string): HtmlEvidence | KiroNativeWebReadFailure {
  const dom = new JSDOM(fetch.body, { url: fetch.finalUrl });
  try {
    const document = dom.window.document;

    // DOM complexity guard（§22）：复杂恶意 DOM 直接放弃解析
    if (document.getElementsByTagName("*").length > MAX_NATIVE_WEB_DOM_ELEMENTS) {
      return { ok: false, code: "WEB_NATIVE_PARSE_FAILED" };
    }

    // 克制清理（§19），在 Readability 之前
    removeNonContentElements(document);

    // Readability 会修改传入 DOM → 必须 clone（§21）；原 document 留给 fallback
    const readabilityClone = document.cloneNode(true) as Document;
    const article = new Readability(readabilityClone, {
      maxElemsToParse: MAX_NATIVE_WEB_DOM_ELEMENTS,
      charThreshold: NATIVE_READABILITY_CHAR_THRESHOLD,
    }).parse();

    const articleText = article?.textContent ?? "";
    if (article && normalizeNativeWebText(articleText).length >= MIN_NATIVE_WEB_EVIDENCE_CHARS) {
      debugKiroWebRead("parse-readability-success", { sourceId, chars: articleText.length });
      return {
        ok: true,
        text: articleText,
        metadata: {
          title: article.title ?? undefined,
          siteName: article.siteName ?? undefined,
          publishedAt: article.publishedTime ?? undefined,
        },
      };
    }

    // Fallback（§26-30）：Readability 不适合的通知/公告/文档类页面
    const fallbackText = fallbackContainerText(document);
    debugKiroWebRead("parse-fallback", { chars: fallbackText.length });
    return {
      ok: true,
      text: fallbackText,
      metadata: {},
    };
  } finally {
    dom.window.close(); // 释放 jsdom 资源（§51）
  }
}
