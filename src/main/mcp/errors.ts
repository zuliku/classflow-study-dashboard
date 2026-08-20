/**
 * MCP Errors — Task 09
 */

export type McpErrorCode =
  | "INVALID_URL"
  | "INVALID_CREDENTIAL"
  | "CONNECTION_FAILED"
  | "NOT_CONNECTED"
  | "TOOL_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "DISABLED"
  | "TIMEOUT"
  | "UNKNOWN";

export interface McpError {
  code: McpErrorCode;
  message: string;
}

export function mcpError(code: McpErrorCode, message: string): McpError {
  return { code, message };
}

export function toMcpIpcError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    throw new Error(JSON.stringify({ code: parsed.code ?? e?.code ?? "UNKNOWN", message: parsed.message ?? e?.message ?? raw }));
  } catch {
    throw new Error(JSON.stringify({ code: e?.code ?? "UNKNOWN", message: e?.message ?? raw }));
  }
}
