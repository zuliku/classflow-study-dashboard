/**
 * MCP Gateway — Bounded Kiro Integration
 * Kiro 使用 mcp_search_tools / mcp_call_tool 发现和调用 MCP Tools
 * 限制最大数量，防止 Tool Context 爆炸
 */

export interface McpSearchToolsInput {
  query?: string;
  limit?: number;
}

export interface McpCallToolInput {
  connectionId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export async function mcpSearchTools(input: McpSearchToolsInput): Promise<{ tools: Array<{ connectionId: string; connectionName: string; toolName: string; description: string; risk: string }> }> {
  const bridge = (window as unknown as { classflowDesktop?: { mcp?: { searchTools: (input: unknown) => Promise<unknown> } } }).classflowDesktop?.mcp;
  if (!bridge) return { tools: [] };
  const result = (await bridge.searchTools({ query: input.query, limit: input.limit ?? 20 })) as { tools: Array<{ connectionId: string; connectionName: string; toolName: string; description: string; risk: string }> };
  return result;
}

export async function mcpCallTool(input: McpCallToolInput & { origin?: "local-user" | "remote-channel" }): Promise<unknown> {
  const bridge = (window as unknown as { classflowDesktop?: { mcp?: { callTool: (input: unknown) => Promise<unknown> } } }).classflowDesktop?.mcp;
  if (!bridge) throw new Error("MCP not available");
  const result = await bridge.callTool({
    connectionId: input.connectionId,
    toolName: input.toolName,
    arguments: input.arguments,
    origin: input.origin ?? "local-user",
  });
  // 标记为 untrusted external content（调用方需包装 EXTERNAL UNTRUSTED CONTENT）
  return {
    _untrusted: true,
    content: result,
  };
}
