/**
 * Task 18A / Compatibility Hotfix / Task 19A：Kiro Safe Web Fetch 基础层。
 *
 * 共享安全网络核心（Text 与 PDF 走同一条路径，禁止两套网络逻辑）：
 *   normalize URL（protocol/credentials/port）
 *   → hostname blocklist
 *   → 直接 IP URL 分类（IPv4/IPv6/v4-mapped）
 *   → DNS 全量解析 + 全部地址 fail-closed 校验（任一 private → 整体拒绝）
 *   → 全部 vetted public 地址按 IPv4 优先排序，逐个 pinned socket 尝试（≤3，防 DNS rebinding）
 *   → manual redirect（每跳重验证，禁 downgrade，上限 3）
 *   → content-type（按 policy 白名单）→ content-encoding（gzip/deflate/br 有界解压）→
 *     Content-Length / 字节预算 → 超时（总 10s + 每地址 3.5s）
 *
 * 公开入口只有两个：
 * - safeWebFetch()：text bytes → charset decode → string（HTML/XHTML/Plain Text）
 * - safeWebFetchPdf()：PDF bytes → Uint8Array（application/pdf + %PDF- signature）
 *
 * 禁止：把 core 导出为通用下载器；信任 .pdf 扩展名；接受 application/octet-stream。
 */
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Transform } from "node:stream";
import {
  isBlockedHostname,
  isBlockedIpAddress,
  isIpAddressText,
  normalizeWebFetchUrl,
} from "@/lib/ai/web/native/networkSafety";
import { decodeWebText } from "@/lib/ai/web/native/textDecode";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";

export const MAX_WEB_FETCH_REDIRECTS = 3;
/** 每跳总超时（总硬上限；Read Tool 15s 仍约束整体） */
export const WEB_FETCH_TIMEOUT_MS = 10_000;
/** 每地址 attempt 超时 */
export const WEB_FETCH_ADDRESS_TIMEOUT_MS = 3_500;
/** 地址尝试上限 */
export const MAX_WEB_FETCH_ADDRESS_ATTEMPTS = 3;
/** Text：最终解压后 bytes 上限 */
export const MAX_WEB_FETCH_BYTES = 1_500_000;
/** Text：压缩态 bytes 上限 */
export const MAX_WEB_FETCH_COMPRESSED_BYTES = 2_000_000;
/** PDF：最终 PDF bytes 上限（8MB；Web 自动访问 ≠ 本地主动上传 20MB） */
export const MAX_WEB_PDF_FETCH_BYTES = 8 * 1024 * 1024;
/** PDF：压缩传输 bytes 上限（传输编码略有 overhead，但必须有限） */
export const MAX_WEB_PDF_COMPRESSED_BYTES = 10 * 1024 * 1024;

const ALLOWED_TEXT_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const ALLOWED_PDF_CONTENT_TYPES = new Set(["application/pdf"]);

/** 支持的压缩编码（zstd / compress 等 → UNSUPPORTED_CONTENT，不猜） */
const SUPPORTED_ENCODINGS = new Set(["identity", "gzip", "deflate", "br"]);

export interface KiroSafeFetchRequest {
  url: string;
  /** 仅诊断（hostname 记录用）；不参与安全逻辑 */
  sourceId?: string;
  signal?: AbortSignal;
}

export interface KiroSafeFetchSuccess {
  ok: true;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export interface KiroSafeFetchFailure {
  ok: false;
  code:
    | "WEB_FETCH_INVALID_URL"
    | "WEB_FETCH_BLOCKED_HOST"
    | "WEB_FETCH_BLOCKED_IP"
    | "WEB_FETCH_REDIRECT_BLOCKED"
    | "WEB_FETCH_TOO_MANY_REDIRECTS"
    | "WEB_FETCH_TIMEOUT"
    | "WEB_FETCH_TOO_LARGE"
    | "WEB_FETCH_UNSUPPORTED_CONTENT"
    | "WEB_FETCH_HTTP_ERROR"
    | "WEB_FETCH_FAILED";
}

export type KiroSafeFetchOutcome = KiroSafeFetchSuccess | KiroSafeFetchFailure;

/** Task 19A：PDF 二进制成功（bytes 为原始 PDF；不经过 charset decode） */
export interface KiroSafePdfFetchSuccess {
  ok: true;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

export type KiroSafePdfFetchOutcome = KiroSafePdfFetchSuccess | KiroSafeFetchFailure;

/** 单次请求 transport（生产 = Node http/https；测试 = fake） */
export interface KiroHttpTransportRequest {
  protocol: "http:" | "https:";
  /** 原始 hostname（Host header / TLS SNI 使用） */
  hostname: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  /** 已验证的 public address；socket 必须连接到此地址（DNS rebinding 防护） */
  pinnedAddress: string;
  signal: AbortSignal;
}

export interface KiroHttpTransportResponse {
  status: number;
  /** 只保留内部处理需要的字段 */
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
}

export interface KiroHttpTransport {
  request(opts: KiroHttpTransportRequest): Promise<KiroHttpTransportResponse>;
}

export interface KiroSafeFetchDeps {
  /** 生产 = dns.lookup(all, verbatim)；测试 = fake DNS */
  resolveHost?: (hostname: string) => Promise<string[]>;
  transport?: KiroHttpTransport;
  timeoutMs?: number;
  addressTimeoutMs?: number;
  maxBytes?: number;
  maxCompressedBytes?: number;
  maxAddressAttempts?: number;
  maxRedirects?: number;
}

/** 内部 Fetch Policy（module-internal；不导出、不向 Agent 暴露） */
interface SafeWebFetchPolicy {
  allowedContentTypes: ReadonlySet<string>;
  acceptHeader: string;
  maxBytes: number;
  maxCompressedBytes: number;
}

const TEXT_POLICY: SafeWebFetchPolicy = {
  allowedContentTypes: ALLOWED_TEXT_CONTENT_TYPES,
  acceptHeader: "text/html,application/xhtml+xml,text/plain;q=0.8",
  maxBytes: MAX_WEB_FETCH_BYTES,
  maxCompressedBytes: MAX_WEB_FETCH_COMPRESSED_BYTES,
};

const PDF_POLICY: SafeWebFetchPolicy = {
  allowedContentTypes: ALLOWED_PDF_CONTENT_TYPES,
  acceptHeader: "application/pdf",
  maxBytes: MAX_WEB_PDF_FETCH_BYTES,
  maxCompressedBytes: MAX_WEB_PDF_COMPRESSED_BYTES,
};

type VetResult =
  | { ok: true; url: URL; pinnedAddresses: string[] }
  | { ok: false; code: KiroSafeFetchFailure["code"] };

/** hostname 安全归一：lowercase / 去 brackets / 去 zone id / 去 trailing dot */
function hostnameForSafety(rawHost: string): string {
  let h = rawHost.toLowerCase();
  if (h.startsWith("[")) h = h.slice(1);
  if (h.endsWith("]")) h = h.slice(0, -1);
  h = h.split("%")[0];
  return h.replace(/\.$/, "");
}

/**
 * 单跳 URL 验证 + 地址固定（vet）：
 * 域名 → DNS 全量解析，所有地址必须合法且 public（fail-closed，拒绝 mixed）；
 * 全部 vetted 地址按 IPv4 优先排序；直接 IP → 文本分类。
 */
async function vetUrl(
  rawUrl: string,
  resolveHost: (h: string) => Promise<string[]>,
  maxAddressAttempts: number
): Promise<VetResult> {
  const url = normalizeWebFetchUrl(rawUrl);
  if (!url) return { ok: false, code: "WEB_FETCH_INVALID_URL" };
  const host = hostnameForSafety(url.hostname);
  if (isBlockedHostname(host)) return { ok: false, code: "WEB_FETCH_BLOCKED_HOST" };
  if (isIpAddressText(host)) {
    if (isBlockedIpAddress(host)) return { ok: false, code: "WEB_FETCH_BLOCKED_IP" };
    return { ok: true, url, pinnedAddresses: [host] };
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return { ok: false, code: "WEB_FETCH_FAILED" };
  }
  if (!addresses || addresses.length === 0) return { ok: false, code: "WEB_FETCH_FAILED" };
  for (const addr of addresses) {
    if (!isIpAddressText(addr) || isBlockedIpAddress(addr)) {
      return { ok: false, code: "WEB_FETCH_BLOCKED_IP" };
    }
  }
  const v4first = [...addresses].sort((a, b) => (a.includes(":") ? 1 : 0) - (b.includes(":") ? 1 : 0));
  return { ok: true, url, pinnedAddresses: v4first.slice(0, maxAddressAttempts) };
}

/** 生产 DNS：dns.lookup all + verbatim */
async function defaultResolveHost(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

function pickHeader(headers: http.IncomingHttpHeaders, key: string): string {
  const v = headers[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return "";
}

/** 生产 transport：Node http/https；lookup 固定已验证地址，Host/SNI 保留原始 hostname */
const nodeHttpTransport: KiroHttpTransport = {
  request(opts) {
    return new Promise((resolve, reject) => {
      const mod = opts.protocol === "https:" ? https : http;
      const family = opts.pinnedAddress.includes(":") ? 6 : 4;
      const req = mod.request(
        {
          protocol: opts.protocol,
          hostname: opts.hostname,
          port: opts.port,
          path: opts.path,
          method: "GET",
          headers: opts.headers,
          // Node 20+（autoSelectFamily）会以 all:true 调用自定义 lookup（期望地址数组）；
          // 老式调用为 (err, address, family)。两种签名都要兼容。
          lookup: (
            _hostname: string,
            options: unknown,
            callback: (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void
          ) => {
            if ((options as { all?: boolean } | null)?.all === true) {
              callback(null, [{ address: opts.pinnedAddress, family }]);
            } else {
              callback(null, opts.pinnedAddress, family);
            }
          },
          signal: opts.signal,
        },
        (res) => {
          const abortCleanup = () => {
            res.destroy();
          };
          opts.signal?.addEventListener("abort", abortCleanup, { once: true });
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              location: pickHeader(res.headers, "location"),
              "content-type": pickHeader(res.headers, "content-type"),
              "content-length": pickHeader(res.headers, "content-length"),
              "content-encoding": pickHeader(res.headers, "content-encoding"),
            },
            body: (async function* () {
              try {
                for await (const chunk of res) yield chunk as Uint8Array;
              } finally {
                opts.signal?.removeEventListener("abort", abortCleanup);
              }
            })(),
          });
        }
      );
      req.on("error", (err) => reject(err));
      req.end();
    });
  },
};

/** 解压器（gzip / deflate / br）；未知编码 → null */
function decompressorFor(encoding: string): Transform | null {
  switch (encoding) {
    case "gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

type BoundedBytesResult =
  | { ok: true; bytes: Uint8Array; compressedBytes: number }
  | { ok: false; code: KiroSafeFetchFailure["code"] };

/**
 * 有界读取（bytes-oriented；Task 19A 与 charset decode 分离）：
 * - 压缩态 bytes ≤ maxCompressedBytes（压缩侧预算）
 * - 解压后 bytes ≤ maxBytes（解压侧预算，流式 drain，防 zip bomb 扩张）
 * - identity / 无编码：直接有界收集
 * 绝不：charset decode / HTML parse / PDF parse。
 */
async function readBoundedBytes(
  body: AsyncIterable<Uint8Array>,
  contentEncoding: string,
  maxBytes: number,
  maxCompressedBytes: number,
  controller: AbortController,
  isTimedOut: () => boolean
): Promise<BoundedBytesResult> {
  let compressedBytes = 0;
  const rawChunks: Uint8Array[] = [];

  try {
    for await (const chunk of body) {
      compressedBytes += chunk.byteLength;
      if (compressedBytes > maxCompressedBytes) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
      }
      rawChunks.push(chunk);
    }
  } catch {
    controller.abort();
    if (isTimedOut()) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
    return { ok: false, code: "WEB_FETCH_FAILED" };
  }

  const raw = Buffer.concat(rawChunks);

  if (contentEncoding && contentEncoding !== "identity") {
    const decompressor = decompressorFor(contentEncoding);
    if (!decompressor) {
      controller.abort();
      return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" }; // zstd / compress 等：不猜
    }
    try {
      const bytes = await decompressBounded(decompressor, raw, maxBytes);
      return { ok: true, bytes, compressedBytes };
    } catch {
      controller.abort();
      if (isTimedOut()) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
      return { ok: false, code: "WEB_FETCH_FAILED" };
    }
  }

  if (raw.length > maxBytes) {
    controller.abort();
    return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
  }
  return { ok: true, bytes: raw, compressedBytes };
}

/** 有界解压：写入完成后 drain，解压输出累计 ≤ maxBytes（超限即销毁） */
function decompressBounded(decompressor: Transform, input: Buffer, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    let total = 0;
    const pump = () => {
      let chunk: Buffer | null;
      while ((chunk = decompressor.read() as Buffer | null) !== null) {
        total += chunk.length;
        if (total > maxBytes) {
          decompressor.destroy();
          reject(new Error("decompressed size exceeded"));
          return;
        }
        out.push(chunk);
      }
    };
    decompressor.on("readable", pump);
    decompressor.on("error", reject);
    decompressor.on("end", () => {
      pump();
      resolve(Buffer.concat(out));
    });
    decompressor.write(input);
    decompressor.end();
  });
}

/** Task 19A：PDF magic 校验（前 1024 bytes 内出现 %PDF-；容忍 BOM / 少量 leading bytes） */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const window = bytes.slice(0, 1024);
  const head = Buffer.from(window).toString("latin1");
  return head.includes("%PDF-");
}

/**
 * 共享安全核心（module-internal）：完整 Safety 链 + policy 白名单 + 字节预算。
 * 返回 bytes；charset decode 由调用方（text wrapper）负责。
 */
async function safeWebFetchWithPolicy(
  request: KiroSafeFetchRequest,
  policy: SafeWebFetchPolicy,
  deps?: KiroSafeFetchDeps
): Promise<
  | { ok: true; finalUrl: string; status: number; contentType: string; bytes: Uint8Array }
  | KiroSafeFetchFailure
> {
  const resolveHost = deps?.resolveHost ?? defaultResolveHost;
  const transport = deps?.transport ?? nodeHttpTransport;
  const timeoutMs = deps?.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const addressTimeoutMs = deps?.addressTimeoutMs ?? WEB_FETCH_ADDRESS_TIMEOUT_MS;
  const maxBytes = deps?.maxBytes ?? policy.maxBytes;
  const maxCompressedBytes = deps?.maxCompressedBytes ?? policy.maxCompressedBytes;
  const maxAddressAttempts = deps?.maxAddressAttempts ?? MAX_WEB_FETCH_ADDRESS_ATTEMPTS;
  const maxRedirects = deps?.maxRedirects ?? MAX_WEB_FETCH_REDIRECTS;
  const sourceId = request.sourceId ?? "";

  if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };

  const headers: Record<string, string> = {
    "User-Agent": "ClassFlow-Kiro/1.0",
    "Accept": policy.acceptHeader,
    "Accept-Encoding": "gzip, deflate, br",
  };

  let currentUrl = request.url;
  let redirectCount = 0;

  for (;;) {
    const vet = await vetUrl(currentUrl, resolveHost, maxAddressAttempts);
    if (!vet.ok) {
      debugKiroWebRead("native-fetch-rejected", { sourceId, code: vet.code });
      return vet;
    }
    const { url } = vet;
    debugKiroWebRead("native-fetch-start", { sourceId, host: url.hostname, addresses: vet.pinnedAddresses.length });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let response: KiroHttpTransportResponse | null = null;
    for (let i = 0; i < vet.pinnedAddresses.length && response === null; i++) {
      if (controller.signal.aborted) break;
      const pinnedAddress = vet.pinnedAddresses[i];
      const family = pinnedAddress.includes(":") ? 6 : 4;
      const attemptController = new AbortController();
      const onHopAbort = () => attemptController.abort();
      controller.signal.addEventListener("abort", onHopAbort, { once: true });
      const addressTimer = setTimeout(() => attemptController.abort(), addressTimeoutMs);
      try {
        response = await transport.request({
          protocol: url.protocol as "http:" | "https:",
          hostname: url.hostname,
          port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
          path: `${url.pathname}${url.search}`,
          headers: { ...headers },
          pinnedAddress,
          signal: attemptController.signal,
        });
        debugKiroWebRead("address-success", { sourceId, host: url.hostname, family, attempt: i + 1, status: response.status });
      } catch {
        debugKiroWebRead("address-failed", { sourceId, host: url.hostname, family, attempt: i + 1 });
      } finally {
        clearTimeout(addressTimer);
        controller.signal.removeEventListener("abort", onHopAbort);
      }
    }

    if (response === null) {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
      if (timedOut) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
      if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };
      debugKiroWebRead("native-fetch-fail", { sourceId, host: url.hostname, code: "WEB_FETCH_FAILED" });
      return { ok: false, code: "WEB_FETCH_FAILED" };
    }

    try {
      // 3xx：manual redirect（每跳重新 vet；禁 downgrade；上限）
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers["location"];
        if (!location) {
          controller.abort();
          return { ok: false, code: "WEB_FETCH_HTTP_ERROR" };
        }
        if (redirectCount >= maxRedirects) {
          controller.abort();
          return { ok: false, code: "WEB_FETCH_TOO_MANY_REDIRECTS" };
        }
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          controller.abort();
          return { ok: false, code: "WEB_FETCH_INVALID_URL" };
        }
        if (
          (next.protocol !== "http:" && next.protocol !== "https:") ||
          next.username ||
          next.password ||
          next.port
        ) {
          controller.abort();
          return { ok: false, code: "WEB_FETCH_REDIRECT_BLOCKED" };
        }
        if (url.protocol === "https:" && next.protocol === "http:") {
          controller.abort();
          return { ok: false, code: "WEB_FETCH_REDIRECT_BLOCKED" }; // 禁止 downgrade
        }
        redirectCount += 1;
        currentUrl = next.toString();
        controller.abort();
        continue;
      }

      // 4xx / 5xx（以及异常 status）
      if (response.status < 200 || response.status >= 400) {
        controller.abort();
        debugKiroWebRead("native-fetch-fail", { sourceId, host: url.hostname, status: response.status, code: "WEB_FETCH_HTTP_ERROR" });
        return { ok: false, code: "WEB_FETCH_HTTP_ERROR" };
      }

      // 2xx：content-type（policy 白名单）→ encoding → 大小预算
      const contentType = response.headers["content-type"] ?? "";
      const mediaType = contentType.split(";")[0].trim().toLowerCase();
      if (!policy.allowedContentTypes.has(mediaType)) {
        controller.abort();
        debugKiroWebRead("native-fetch-fail", { sourceId, host: url.hostname, contentType: mediaType, code: "WEB_FETCH_UNSUPPORTED_CONTENT" });
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      const contentEncoding = (response.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (contentEncoding && !SUPPORTED_ENCODINGS.has(contentEncoding)) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      // Content-Length 语义：identity → 与最终预算比；压缩传输 → 与压缩预算比
      const contentLength = Number.parseInt(response.headers["content-length"] ?? "", 10);
      const lengthBudget = contentEncoding ? maxCompressedBytes : maxBytes;
      if (Number.isFinite(contentLength) && contentLength > lengthBudget) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
      }

      const bodyResult = await readBoundedBytes(
        response.body,
        contentEncoding,
        maxBytes,
        maxCompressedBytes,
        controller,
        () => timedOut
      );
      if (!bodyResult.ok) return bodyResult;
      controller.abort();

      debugKiroWebRead("native-fetch-ok", {
        sourceId,
        host: url.hostname,
        status: response.status,
        contentType: mediaType,
        contentEncoding: contentEncoding || "identity",
        bytes: bodyResult.bytes.length,
      });

      return {
        ok: true,
        finalUrl: currentUrl,
        status: response.status,
        contentType,
        bytes: bodyResult.bytes,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Text 入口（Task 18A / Compatibility Hotfix）：完整共享安全核心 → bytes → charset decode → string。
 * API 与历史完全兼容（KiroSafeFetchOutcome；调用者无需修改）。
 */
export async function safeWebFetch(
  request: KiroSafeFetchRequest,
  deps?: KiroSafeFetchDeps
): Promise<KiroSafeFetchOutcome> {
  const core = await safeWebFetchWithPolicy(request, TEXT_POLICY, deps);
  if (!core.ok) return core;
  const decoded = decodeWebText(core.bytes, core.contentType);
  debugKiroWebRead("text-decode", {
    sourceId: request.sourceId ?? "",
    charsetSource: decoded.charsetSource,
    host: hostOf(core.finalUrl),
  });
  return {
    ok: true,
    finalUrl: core.finalUrl,
    status: core.status,
    contentType: core.contentType,
    body: decoded.text,
  };
}

/**
 * PDF 入口（Task 19A）：共享安全核心 + application/pdf policy + %PDF- signature 校验。
 * 返回原始二进制 bytes（不经过 charset decode）；假 PDF / 空 body → WEB_FETCH_UNSUPPORTED_CONTENT。
 */
export async function safeWebFetchPdf(
  request: KiroSafeFetchRequest,
  deps?: KiroSafeFetchDeps
): Promise<KiroSafePdfFetchOutcome> {
  const core = await safeWebFetchWithPolicy(request, PDF_POLICY, deps);
  if (!core.ok) return core;

  // Content-Type 不足以证明是真 PDF：magic 校验（前 1024 bytes 内 %PDF-）
  if (!hasPdfSignature(core.bytes)) {
    debugKiroWebRead("native-fetch-fail", {
      sourceId: request.sourceId ?? "",
      host: hostOf(core.finalUrl),
      code: "WEB_FETCH_UNSUPPORTED_CONTENT",
      reason: "pdf-signature",
    });
    return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
  }

  return {
    ok: true,
    finalUrl: core.finalUrl,
    status: core.status,
    contentType: core.contentType,
    bytes: core.bytes,
  };
}

/** 诊断用 hostname（只记录 host，不记录完整 URL / query） */
function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}
