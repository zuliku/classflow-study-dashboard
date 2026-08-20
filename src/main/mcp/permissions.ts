/**
 * MCP Tool Permission — Task 09
 * read-only 可自动，external-side-effect/destructive/unknown 需确认
 * remote-channel 只能 read/propose
 */

import type { McpTool, McpToolRisk } from "@/src/main/mcp/types";

export function classifyMcpToolRisk(tool: McpTool): McpToolRisk {
  const ann = tool.annotations ?? {};
  // 明确 destructive
  if (ann.destructiveHint === true) return "destructive";
  // readOnlyHint 明确只读
  if (ann.readOnlyHint === true) return "read-only";
  // openWorldHint 暗示外部副作用
  if (ann.openWorldHint === true) return "external-side-effect";
  // 无明确注解 → unknown（需确认）
  return "unknown";
}

export function requiresMcpToolConfirmation(risk: McpToolRisk): boolean {
  return risk === "external-side-effect" || risk === "destructive" || risk === "unknown";
}

export function isMcpToolAllowedForOrigin(
  risk: McpToolRisk,
  origin: "local-user" | "remote-channel"
): { allowed: boolean; reason: string } {
  if (origin === "remote-channel") {
    // remote-channel 只能 read/propose，即仅 read-only
    if (risk !== "read-only") {
      return { allowed: false, reason: `remote-channel denied ${risk} MCP tool` };
    }
    return { allowed: true, reason: "remote-channel read-only allowed" };
  }
  return { allowed: true, reason: "local-user allowed" };
}
