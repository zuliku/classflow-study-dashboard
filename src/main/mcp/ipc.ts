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

  // Bounded Gateway: mcp_call_tool (with invocation + approval)
  ipcMain.handle("bridge:mcp:callTool", async (event, input: unknown) => {
    if (!guard("bridge:mcp:callTool", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { connectionId, toolName, arguments: args, invocationId } = input as {
        connectionId?: string;
        toolName?: string;
        arguments?: unknown;
        invocationId?: string;
      };
      if (!connectionId || !toolName) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "connectionId and toolName required" }));
      if (!invocationId) throw new Error(JSON.stringify({ code: "INVOCATION_REQUIRED", message: "invocationId required" }));
      const { resolveInvocationOrThrow } = await import("@/src/main/security/invocationTrust");
      const invocation = resolveInvocationOrThrow(invocationId);
      const origin = invocation.origin;

      const mgr = getMcpManager();
      const found = getMcpToolForCall(mgr.getConnectionsMap(), connectionId, toolName);
      if (!found) throw new Error(JSON.stringify({ code: "TOOL_NOT_FOUND", message: `Tool not found: ${toolName}` }));
      const { tool, connection } = found;
      if (!connection.config.enabled) throw new Error(JSON.stringify({ code: "DISABLED", message: "Connection disabled" }));

      const risk = classifyMcpToolRisk(tool);
      // Remote-channel strict: only mcp_search_tools allowed, mcp_call_tool denied
      if (origin === "remote-channel") {
        throw new Error(JSON.stringify({ code: "PERMISSION_DENIED_REMOTE_MCP", message: "remote-channel cannot call MCP tools" }));
      }

      const originCheck = isMcpToolAllowedForOrigin(risk, origin);
      if (!originCheck.allowed) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED", message: originCheck.reason }));

      if (requiresMcpToolConfirmation(risk)) {
        // For local-user side-effect, require approval: first call returns APPROVAL_REQUIRED
        const { createMcpApproval } = await import("@/src/main/mcp/approval");
        const approval = createMcpApproval({ invocationId, connectionId, toolName, arguments: args });
        throw new Error(JSON.stringify({ code: "APPROVAL_REQUIRED", message: "Approval required", approvalRequestId: approval.id }));
      }

      const result = await connection.callTool(toolName, args);
      return result;
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:mcp:approveAndCall", async (event, input: unknown) => {
    if (!guard("bridge:mcp:approveAndCall", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { approvalRequestId } = input as { approvalRequestId?: string };
      if (!approvalRequestId) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "approvalRequestId required" }));
      const { getMcpApproval, consumeMcpApproval } = await import("@/src/main/mcp/approval");
      const { resolveInvocationOrThrow } = await import("@/src/main/security/invocationTrust");
      const rec = getMcpApproval(approvalRequestId);
      if (!rec) throw new Error(JSON.stringify({ code: "APPROVAL_NOT_FOUND", message: "Approval not found" }));
      if (rec.used) throw new Error(JSON.stringify({ code: "APPROVAL_ALREADY_USED", message: "Approval already used" }));
      if (rec.expiresAt < Date.now()) throw new Error(JSON.stringify({ code: "APPROVAL_EXPIRED", message: "Approval expired" }));
      // 验证 invocation 仍有效且匹配
      const invocation = resolveInvocationOrThrow(rec.invocationId);
      if (invocation.origin !== "local-user") throw new Error(JSON.stringify({ code: "PERMISSION_DENIED", message: "Invalid invocation for approval" }));
      const mgr = getMcpManager();
      const conn = mgr.getConnection(rec.connectionId);
      if (!conn || !conn.config.enabled) throw new Error(JSON.stringify({ code: "DISABLED", message: "Connection disabled" }));
      const tool = conn.tools.find((t) => t.name === rec.toolName);
      if (!tool) throw new Error(JSON.stringify({ code: "TOOL_NOT_FOUND", message: "Tool not found" }));
      // 验证 arguments 未被篡改（hash 比较）
      const currentHash = JSON.stringify(rec.arguments);
      const storedHash = rec.argumentsHash;
      if (currentHash !== storedHash) throw new Error(JSON.stringify({ code: "APPROVAL_ARGS_MISMATCH", message: "Arguments mismatch" }));

      const consumed = consumeMcpApproval(approvalRequestId);
      if (!consumed) throw new Error(JSON.stringify({ code: "APPROVAL_ALREADY_USED", message: "Already used" }));

      const result = await conn.callTool(rec.toolName, rec.arguments);
      return result;
    } catch (e) {
      toIpcError(e);
    }
  });
}
