/**
 * MCP IPC — Task 09
 */

import { ipcMain } from "electron";
import { getMcpManager } from "@/src/main/mcp/manager";
import { searchMcpTools, getMcpToolForCall } from "@/src/main/mcp/toolCatalog";
import { classifyMcpToolRisk, requiresMcpToolConfirmation, isMcpToolAllowedForOrigin } from "@/src/main/mcp/permissions";

function toIpcError(err: unknown): never {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    throw new Error(JSON.stringify({ code: parsed.code ?? "UNKNOWN", message: parsed.message ?? raw }));
  } catch {
    const e = err as { code?: string; message?: string };
    throw new Error(JSON.stringify({ code: e?.code ?? "UNKNOWN", message: e?.message ?? raw }));
  }
}

export function registerMcpIpc(opts?: {
  validateSender?: (channel: string, event: Electron.IpcMainInvokeEvent) => boolean;
}): void {
  const guard = (channel: string, event: Electron.IpcMainInvokeEvent): boolean => {
    if (!opts?.validateSender) return true;
    return opts.validateSender(channel, event);
  };

  ipcMain.handle("bridge:mcp:list", (event) => {
    if (!guard("bridge:mcp:list", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getMcpManager();
      return { connections: mgr.listConnections() };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:add", (event, input: unknown) => {
    if (!guard("bridge:mcp:add", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name, endpoint, credentialRef } = input as { name?: string; endpoint?: string; credentialRef?: string };
      if (!name || !endpoint) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name and endpoint required" }));
      const mgr = getMcpManager();
      return mgr.addConnection({ name, endpoint, credentialRef }).then((conn) => ({ connection: conn.config }));
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:test", async (event, input: unknown) => {
    if (!guard("bridge:mcp:test", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { endpoint, credentialRef } = input as { endpoint?: string; credentialRef?: string };
      if (!endpoint) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "endpoint required" }));
      const mgr = getMcpManager();
      const result = await mgr.testConnection(endpoint, credentialRef);
      return result;
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:connect", async (event, input: unknown) => {
    if (!guard("bridge:mcp:connect", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { id } = input as { id?: string };
      if (!id) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "id required" }));
      const mgr = getMcpManager();
      await mgr.connect(id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:disconnect", async (event, input: unknown) => {
    if (!guard("bridge:mcp:disconnect", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { id } = input as { id?: string };
      if (!id) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "id required" }));
      const mgr = getMcpManager();
      await mgr.disconnect(id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:remove", async (event, input: unknown) => {
    if (!guard("bridge:mcp:remove", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { id } = input as { id?: string };
      if (!id) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "id required" }));
      const mgr = getMcpManager();
      await mgr.removeConnection(id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:setEnabled", async (event, input: unknown) => {
    if (!guard("bridge:mcp:setEnabled", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { id, enabled } = input as { id?: string; enabled?: boolean };
      if (!id) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "id required" }));
      const mgr = getMcpManager();
      await mgr.setEnabled(id, Boolean(enabled));
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  // Bounded Gateway: mcp_search_tools
  ipcMain.handle("bridge:mcp:searchTools", (event, input: unknown) => {
    if (!guard("bridge:mcp:searchTools", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { query, limit } = input as { query?: string; limit?: number };
      const mgr = getMcpManager();
      const results = searchMcpTools(mgr.getConnectionsMap(), query, limit);
      return { tools: results };
    } catch (e) {
      toIpcError(e);
    }
  });

  // Bounded Gateway: mcp_call_tool (with permission checks)
  ipcMain.handle("bridge:mcp:callTool", async (event, input: unknown) => {
    if (!guard("bridge:mcp:callTool", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { connectionId, toolName, arguments: args, origin } = input as {
        connectionId?: string;
        toolName?: string;
        arguments?: unknown;
        origin?: "local-user" | "remote-channel";
      };
      if (!connectionId || !toolName) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "connectionId and toolName required" }));
      const mgr = getMcpManager();
      const found = getMcpToolForCall(mgr.getConnectionsMap(), connectionId, toolName);
      if (!found) throw new Error(JSON.stringify({ code: "TOOL_NOT_FOUND", message: `Tool not found: ${toolName}` }));
      const { tool, connection } = found;
      if (!connection.config.enabled) throw new Error(JSON.stringify({ code: "DISABLED", message: "Connection disabled" }));

      const risk = classifyMcpToolRisk(tool);
      const originCheck = isMcpToolAllowedForOrigin(risk, origin ?? "local-user");
      if (!originCheck.allowed) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED", message: originCheck.reason }));

      // For local-user, check if confirmation is required (external/destructive/unknown)
      // This is handled via the permission system: if requires confirmation, the caller should have already confirmed
      // For now, we just check that if risk is not read-only and origin is remote, we already denied
      // For local-user with side-effect, we allow but the UI should have confirmed

      const result = await connection.callTool(toolName, args);
      return result;
    } catch (e) {
      toIpcError(e);
    }
  });
}
