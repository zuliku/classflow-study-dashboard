/**
 * Kiro Search — Keyless hosted MCP JSON-RPC Client（Exa / Parallel）。
 *
 * 安全边界：
 * - endpoint 由 adapter 固定，绝不接受模型/用户传入 URL；
 * - 只发送 query / objective / filters，不发送对话、文件、Persona、API Key；
 * - 响应有界读取（默认 256KiB）与单次 attempt 超时（默认 5s）；
 * - 错误一律归一为安全 code，绝不把 provider 原始 body 传给模型。
 */
import { APP_VERSION } from "@/lib/version";
import { KEYLESS_MCP_MAX_BYTES, KEYLESS_SEARCH_ATTEMPT_TIMEOUT_MS } from "@/lib/ai/web/types";

export type KiroMcpErrorCode = "RATE_LIMITED" | "AUTH_FAILED" | "TIMEOUT" | "FAILED";

export class KiroMcpError extends Error {
  readonly code: KiroMcpErrorCode;

  constructor(code: KiroMcpErrorCode, message = "mcp request failed") {
    super(message);
    this.name = "KiroMcpError";
    this.code = code;
  }
}

export interface KiroMcpToolCallInput {
  endpoint: string;
  toolName: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  /** 测试注入；默认使用 ClassFlow/<version> */
  userAgent?: string;
}

export interface KiroMcpToolCallResult {
  /** `result` 字段（可能是 structuredContent / content 数组） */
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  const message = value.message;
  if (typeof message === "string") return message;
  const error = value.error;
  if (typeof error === "string") return error;
  return "";
}

function classifyMessage(message: string): KiroMcpErrorCode {
  if (/rate\s*limit|too\s*many|quota|daily\s*(?:limit|cap)|free-tier/i.test(message)) {
    return "RATE_LIMITED";
  }
  if (/unauthori[sz]ed|forbidden|invalid\s*(?:api\s*)?key|authentication/i.test(message)) {
    return "AUTH_FAILED";
  }
  return "FAILED";
}

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new KiroMcpError("FAILED", "response too large");
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new KiroMcpError("FAILED", "response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

function parseJsonRpcPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  };

  const direct = parse(trimmed);
  if (direct !== null) return direct;

  // Streamable HTTP MCP：event: message / data: {...}
  for (const line of trimmed.split("\n")) {
    const value = line.trim();
    if (!value.startsWith("data:")) continue;
    const parsed = parse(value.slice("data:".length).trim());
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * 调用远端 MCP tools/call。固定 endpoint；不做 initialize/session 握手
 * （Exa / Parallel hosted endpoint 支持直接 tools/call，与 OpenCode 的用法一致）。
 */
export async function callKiroMcpTool(input: KiroMcpToolCallInput): Promise<KiroMcpToolCallResult> {
  const timeoutMs = input.timeoutMs ?? KEYLESS_SEARCH_ATTEMPT_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? KEYLESS_MCP_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    if (input.signal?.aborted) throw new KiroMcpError("TIMEOUT");
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": input.userAgent ?? `ClassFlow/${APP_VERSION}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextRequestId(),
        method: "tools/call",
        params: { name: input.toolName, arguments: input.args },
      }),
      signal: controller.signal,
    });

    if (response.status === 429) throw new KiroMcpError("RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw new KiroMcpError("AUTH_FAILED");
    if (!response.ok) throw new KiroMcpError("FAILED");

    const raw = await readResponseTextBounded(response, maxBytes);
    const payload = parseJsonRpcPayload(raw);
    if (!isRecord(payload)) throw new KiroMcpError("FAILED");

    const rpcError = payload.error;
    if (rpcError !== undefined) {
      const message = errorText(rpcError);
      throw new KiroMcpError(classifyMessage(message), message);
    }
    if (!("result" in payload)) throw new KiroMcpError("FAILED");
    return { result: payload.result };
  } catch (err) {
    if (err instanceof KiroMcpError) throw err;
    if (timedOut || input.signal?.aborted) throw new KiroMcpError("TIMEOUT");
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new KiroMcpError("TIMEOUT");
    }
    throw new KiroMcpError("FAILED");
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onExternalAbort);
  }
}

let requestId = 0;
function nextRequestId(): number {
  requestId += 1;
  return requestId;
}

/** 从 MCP result 中取第一个 text content（Exa 与 Parallel 都使用 content[].text）。 */
export function firstMcpText(result: unknown): string {
  if (!isRecord(result)) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (typeof item.text === "string" && item.text.length > 0) return item.text;
  }
  return "";
}

export { isRecord };
