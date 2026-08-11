/**
 * Task 18A：Kiro Safe Web Fetch —— Server-side / SSRF-safe / redirect-safe /
 * size-bounded / timeout-bounded 的第一方 Web Fetch 基础层。
 *
 * 只做安全读取（bytes / network safety）：
 * - 不解析 HTML 正文、不识别正文、不接入 read_web_source（后续独立 Task）
 * - Agent 永不直接调用本层；未来唯一调用者是 Kiro Native Reader
 *
 * 安全流程（每一跳 redirect 都完整重跑）：
 *   normalize URL（protocol/credentials/port）
 *   → hostname blocklist
 *   → 直接 IP URL 分类（IPv4/IPv6/v4-mapped）
 *   → DNS 全量解析 + 全部地址 fail-closed 校验
 *   → lookup pin 已验证地址发起请求（Host/SNI 仍用原始 hostname，防 DNS rebinding）
 *   → manual redirect（每跳重验证，禁 downgrade，上限 3）
 *   → content-type / content-encoding / Content-Length / 流式字节预算 / 超时
 */
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import {
  isBlockedHostname,
  isBlockedIpAddress,
  isIpAddressText,
  normalizeWebFetchUrl,
} from "@/lib/ai/web/native/networkSafety";

export const MAX_WEB_FETCH_REDIRECTS = 3;
export const WEB_FETCH_TIMEOUT_MS = 8_000;
export const MAX_WEB_FETCH_BYTES = 1_500_000;

const SAFE_REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": "ClassFlow-Kiro/1.0",
  "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
  "Accept-Encoding": "identity",
};

/** 只接受可读的文本类 content-type（忽略 charset 等参数） */
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export interface KiroSafeFetchRequest {
  url: string;
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
  maxBytes?: number;
  maxRedirects?: number;
}

type VetResult =
  | { ok: true; url: URL; pinnedAddress: string }
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
 * 直接 IP → 文本分类；blocklist / 私网 → 拒绝。
 */
async function vetUrl(rawUrl: string, resolveHost: (h: string) => Promise<string[]>): Promise<VetResult> {
  const url = normalizeWebFetchUrl(rawUrl);
  if (!url) return { ok: false, code: "WEB_FETCH_INVALID_URL" };
  const host = hostnameForSafety(url.hostname);
  if (isBlockedHostname(host)) return { ok: false, code: "WEB_FETCH_BLOCKED_HOST" };
  if (isIpAddressText(host)) {
    if (isBlockedIpAddress(host)) return { ok: false, code: "WEB_FETCH_BLOCKED_IP" };
    return { ok: true, url, pinnedAddress: host };
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return { ok: false, code: "WEB_FETCH_FAILED" }; // DNS 细节不返回上层
  }
  if (!addresses || addresses.length === 0) return { ok: false, code: "WEB_FETCH_FAILED" };
  for (const addr of addresses) {
    // 非 IP 文本（异常 DNS 返回）也按 blocked 处理；任一地址 blocked → 整体拒绝
    if (!isIpAddressText(addr) || isBlockedIpAddress(addr)) {
      return { ok: false, code: "WEB_FETCH_BLOCKED_IP" };
    }
  }
  return { ok: true, url, pinnedAddress: addresses[0] }; // 多 public 地址：第一版取第一个
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
  const maxBytes = deps?.maxBytes ?? MAX_WEB_FETCH_BYTES;
  const maxRedirects = deps?.maxRedirects ?? MAX_WEB_FETCH_REDIRECTS;

  if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };

  let currentUrl = request.url;
  let redirectCount = 0;

  for (;;) {
    const vet = await vetUrl(currentUrl, resolveHost);
    if (!vet.ok) return vet;
    const { url } = vet;

    // 每跳独立 timeout + 外部 signal 合并；timer 生命周期覆盖整跳（含 body 读取）
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let response: KiroHttpTransportResponse;
    try {
      response = await transport.request({
        protocol: url.protocol as "http:" | "https:",
        hostname: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: { ...SAFE_REQUEST_HEADERS },
        pinnedAddress: vet.pinnedAddress,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
      if (timedOut) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
      if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };
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
        controller.abort(); // 关闭未消费的 socket，进入下一跳
        continue;
      }

      // 4xx / 5xx（以及异常 status）：不把 error HTML 返回给调用方
      if (response.status < 200 || response.status >= 400) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_HTTP_ERROR" };
      }

      // 2xx：content-type / encoding / 大小预算
      const contentType = response.headers["content-type"] ?? "";
      const mediaType = contentType.split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      const contentEncoding = (response.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (contentEncoding && contentEncoding !== "identity") {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_UNSUPPORTED_CONTENT" };
      }
      const contentLength = Number.parseInt(response.headers["content-length"] ?? "", 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        controller.abort();
        return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
      }

      // 流式读取：即使无 Content-Length / Content-Length 欺骗，也按真实 bytes 计数
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            controller.abort();
            return { ok: false, code: "WEB_FETCH_TOO_LARGE" };
          }
          chunks.push(chunk);
        }
      } catch {
        controller.abort();
        if (timedOut) return { ok: false, code: "WEB_FETCH_TIMEOUT" };
        if (request.signal?.aborted) return { ok: false, code: "WEB_FETCH_FAILED" };
        return { ok: false, code: "WEB_FETCH_FAILED" };
      }
      controller.abort(); // 读取完成，清理 socket

      return {
        ok: true,
        finalUrl: currentUrl,
        status: response.status,
        contentType,
        body: Buffer.concat(chunks).toString("utf8"),
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}
