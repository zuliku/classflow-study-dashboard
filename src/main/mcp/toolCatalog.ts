/**
 * MCP Tool Catalog — Bounded Gateway
 * 禁止所有 MCP tools * 每轮全部传给模型，使用 mcp_search_tools / mcp_call_tool
 */

import type { McpTool } from "@/src/main/mcp/types";
import { classifyMcpToolRisk } from "@/src/main/mcp/permissions";
import type { McpConnection } from "@/src/main/mcp/connection";

export interface McpSearchResult {
  connectionId: string;
  connectionName: string;
  toolName: string;
  description: string;
  risk: string;
}

const MAX_SEARCH_RESULTS = 20;

export function searchMcpTools(
  connections: Map<string, McpConnection>,
  query?: string,
  limit = MAX_SEARCH_RESULTS
): McpSearchResult[] {
  const results: McpSearchResult[] = [];
  const q = query?.trim().toLowerCase() ?? "";
  for (const conn of connections.values()) {
    if (conn.state !== "connected") continue;
    for (const tool of conn.tools) {
      if (q) {
        const hay = `${tool.name} ${tool.description}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const risk = classifyMcpToolRisk(tool);
      results.push({
        connectionId: conn.config.id,
        connectionName: conn.config.name,
        toolName: tool.name,
        description: tool.description,
        risk,
      });
      if (results.length >= limit) return results.slice(0, limit);
    }
  }
  return results.slice(0, limit);
}

export function getMcpToolForCall(
  connections: Map<string, McpConnection>,
  connectionId: string,
  toolName: string
): { tool: McpTool; connection: McpConnection } | null {
  const conn = connections.get(connectionId);
  if (!conn || conn.state !== "connected") return null;
  const tool = conn.tools.find((t) => t.name === toolName);
  if (!tool) return null;
  return { tool, connection: conn };
}
