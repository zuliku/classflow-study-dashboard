/**
 * Task 18A / Compatibility Hotfix：Kiro Safe Web Fetch —— Server-side / SSRF-safe /
 * redirect-safe / size-bounded / timeout-bounded 的第一方 Web Fetch 基础层。
 *
 * 只做安全读取（bytes / network safety）：
 * - 不解析 HTML 正文、不识别正文；Agent 永不直接调用本层
 *
 * 安全流程（每一跳 redirect 都完整重跑）：
 *   normalize URL（protocol/credentials/port）
 *   → hostname blocklist
 *   → 直接 IP URL 分类（IPv4/IPv6/v4-mapped）
 *   → DNS 全量解析 + 全部地址 fail-closed 校验（任一 private → 整体拒绝）
 *   → 全部 vetted public 地址按 IPv4 优先排序，逐个 pinned socket 尝试（≤3，防 DNS rebinding）
 *   → manual redirect（每跳重验证，禁 downgrade，上限 3）
 *   → content-type / content-encoding（gzip/deflate/br 流式解压，双预算）/
 *     Content-Length / 字节预算 / 超时（总 10s + 每地址 3.5s）
 *   → charset 解码（header → meta → UTF-8；GBK/GB18030/Big5 兼容）
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
import { decodeWebText, CharsetSource } from "@/lib/ai/web/native/textDecode";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";

export const MAX_WEB_FETCH_REDIRECTS = 3;
/** 每跳总超时（Hotfix：8s → 10s；外部 Tool budget 15s 仍是硬上限） */
export const WEB_FETCH_TIMEOUT_MS = 10_000;
/** 每地址 attempt 超时（总超时仍是绝对硬上限） */
export const WEB_FETCH_ADDRESS_TIMEOUT_MS = 3_500;
/** 地址尝试上限（不逐个试几十个 CDN IP） */
export const MAX_WEB_FETCH_ADDRESS_ATTEMPTS = 3;
/** 最终解压后的正文 bytes 上限 */
export const MAX_WEB_FETCH_BYTES = 1_500_000;
/** 压缩态 bytes 上限（防 zip bomb 的压缩侧预算） */
export const MAX_WEB_FETCH_COMPRESSED_BYTES = 2_000_000;

const SAFE_REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": "ClassFlow-Kiro/1.0",
  "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};

/** 只接受可读的文本类 content-type（忽略 charset 等参数） */
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

/** 支持的压缩编码（其它如 zstd/compress → UNSUPPORTED_CONTENT，不猜） */
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

/** 单次请求 transport（生产 = Node http/https；测试 = fake）。不暴露 raw Error / socket / DNS 细节给上层 */
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
  /** 只保留内部处理需要的字段：location / content-type / content-length / content-encoding */
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
 * 全部 vetted 地址按 IPv4 优先排序（IPv6 路由不完整环境优先走 v4），各 family 内保持 DNS 顺序；
 * 直接 IP → 文本分类；blocklist / 私网 → 拒绝。
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
    return { ok: false, code: "WEB_FETCH_FAILED" }; // DNS 细节不返回上层
  }
  if (!addresses || addresses.length === 0) return { ok: false, code: "WEB_FETCH_FAILED" };
  for (const addr of addresses) {
    // 非 IP 文本（异常 DNS 返回）也按 blocked 处理；任一地址 blocked → 整体拒绝（fail-closed）
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

type BodyReadResult =
  | { ok: true; text: string; bytes: number; charsetSource: CharsetSource; charset: string | null }
  | { ok: false; code: KiroSafeFetchFailure["code"] };

/**
 * 有界读取 + 解压 + charset 解码：
 * - 压缩态 bytes ≤ MAX_WEB_FETCH_COMPRESSED_BYTES（压缩侧预算）
 * - 解压后 bytes ≤ maxBytes（解压侧预算，流式 drain，防 zip bomb 扩张）
 * - identity / 无编码：直接有界收集
 * - 最终经 decodeWebText（header charset → meta → UTF-8）解码
 */
async function readBoundedBody(
  body: AsyncIterable<Uint8Array>,
  contentEncoding: string,
  maxBytes: number,
  maxCompressedBytes: number,
  contentType: string,
  controller: AbortController,
  isTimedOut: () => boolean
): Promise<BodyReadResult> {
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

  let decodedBytes: Uint8Array;
  if (contentEncoding && contentEncoding !== "identity") {
    const decompressor = decompressorFor(contentEncoding);
    if (!decompressor) {
      controller.abort();
      return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" }; // zstd / compress 等：不猜
    }
    try {
      decodedBytes = await decompressBounded(decompressor, raw, maxBytes);
    } catch {
      controller.abort();
      if (isTimedOut()) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
      return { ok: false, code: "WEB_FETCH_FAILED" };
    }
  } else {
    if (raw.length > maxBytes) {
      controller.abort();
      return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
    }
    decodedBytes = raw;
  }

  const decoded = decodeWebText(decodedBytes, contentType);
  return { ok: true, text: decoded.text, bytes: decodedBytes.length, charsetSource: decoded.charsetSource, charset: decoded.charset };
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

/**
 * 安全 Fetch 主流程。所有限制常量可经 deps 覆盖（测试用），生产使用默认值。
 */
export async function safeWebFetch(
  request: KiroSafeFetchRequest,
  deps?: KiroSafeFetchDeps
): Promise<KiroSafeFetchOutcome> {
  const resolveHost = deps?.resolveHost ?? defaultResolveHost;
  const transport = deps?.transport ?? nodeHttpTransport;
  const timeoutMs = deps?.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const addressTimeoutMs = deps?.addressTimeoutMs ?? WEB_FETCH_ADDRESS_TIMEOUT_MS;
  const maxBytes = deps?.maxBytes ?? MAX_WEB_FETCH_BYTES;
  const maxCompressedBytes = deps?.maxCompressedBytes ?? MAX_WEB_FETCH_COMPRESSED_BYTES;
  const maxAddressAttempts = deps?.maxAddressAttempts ?? MAX_WEB_FETCH_ADDRESS_ATTEMPTS;
  const maxRedirects = deps?.maxRedirects ?? MAX_WEB_FETCH_REDIRECTS;
  const sourceId = request.sourceId ?? "";

  if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };

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

    // 每跳总超时（10s）+ 外部 signal 合并；timer 生命周期覆盖整跳（含 body 读取）
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });

    // 地址 failover：transport/网络层失败 → 下一个 vetted 地址（每 socket 仍 pinned）；
    // HTTP response 到达后不再 failover（403/404/429/500 走正常 HTTP 语义）
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
          headers: { ...SAFE_REQUEST_HEADERS },
          pinnedAddress,
          signal: attemptController.signal,
        });
        debugKiroWebRead("address-success", { sourceId, host: url.hostname, family, attempt: i + 1, status: response.status });
      } catch {
        debugKiroWebRead("address-failed", { sourceId, host: url.hostname, family, attempt: i + 1 });
        // 总超时 / 外部 abort → 不再 failover
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
      return { ok: false, code: "WEB_FETCH_FAILED" }; // 地址全部失败：不泄漏 ECONNRESET/ENETUNREACH/ETIMEDOUT
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
        controller.abort(); // 关闭未消费的 socket，进入下一跳
        continue;
      }

      // 4xx / 5xx（以及异常 status）：不把 error HTML 返回给调用方
      if (response.status < 200 || response.status >= 400) {
        controller.abort();
        debugKiroWebRead("native-fetch-fail", { sourceId, host: url.hostname, status: response.status, code: "WEB_FETCH_HTTP_ERROR" });
        return { ok: false, code: "WEB_FETCH_HTTP_ERROR" };
      }

      // 2xx：content-type / encoding / 大小预算
      const contentType = response.headers["content-type"] ?? "";
      const mediaType = contentType.split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
        controller.abort();
        debugKiroWebRead("native-fetch-fail", { sourceId, host: url.hostname, contentType: mediaType, code: "WEB_FETCH_UNSUPPORTED_CONTENT" });
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      const contentEncoding = (response.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (contentEncoding && !SUPPORTED_ENCODINGS.has(contentEncoding)) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      const contentLength = Number.parseInt(response.headers["content-length"] ?? "", 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes && !contentEncoding) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
      }

      const bodyResult = await readBoundedBody(
        response.body,
        contentEncoding,
        maxBytes,
        maxCompressedBytes,
        contentType,
        controller,
        () => timedOut
      );
      if (!bodyResult.ok) return bodyResult;
      controller.abort(); // 读取完成，清理 socket

      debugKiroWebRead("native-fetch-ok", {
        sourceId,
        host: url.hostname,
        status: response.status,
        contentEncoding: contentEncoding || "identity",
        charsetSource: bodyResult.charsetSource,
        bytes: bodyResult.bytes,
      });

      return {
        ok: true,
        finalUrl: currentUrl,
        status: response.status,
        contentType,
        body: bodyResult.text,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}
