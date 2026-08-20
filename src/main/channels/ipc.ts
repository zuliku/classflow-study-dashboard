/**
 * Channel IPC — Task 13
 * Exposes bridge:channels:* with validateIpcSender. Renderer cannot send secret plaintext, origin, invocationId.
 * Test only validates credential, no real message sent.
 */

import { ipcMain } from "electron";
import { getChannelManager } from "./manager";
import { ChannelError, channelErrorToIpc } from "./errors";

function toIpcError(err: unknown): never {
  if (err instanceof ChannelError) throw new Error(JSON.stringify({ code: err.code, message: err.message }));
  const raw = err instanceof Error ? err.message : String(err);
  let parsed: { code?: string; message?: string } | null = null;
  try {
    parsed = JSON.parse(raw) as { code?: string; message?: string };
  } catch {}
  if (parsed?.code) {
    throw new Error(JSON.stringify({ code: parsed.code, message: parsed.message ?? raw }));
  }
  // Preserve known QQ codes if present in raw string
  const known = ["QQ_AUTH_FAILED", "QQ_NETWORK_ERROR", "QQ_GATEWAY_DISCONNECTED", "QQ_RATE_LIMITED", "QQ_INVALID_CONFIG", "QQ_SDK_ERROR"];
  for (const c of known) {
    if (raw.includes(c)) throw new Error(JSON.stringify({ code: c, message: raw.slice(0, 300) }));
  }
  const sanitized = raw.replace(/appSecret|access_token|Authorization|credentialRef/gi, "[redacted]").slice(0, 300);
  throw new Error(JSON.stringify({ code: "QQ_SDK_ERROR", message: sanitized }));
}

export function registerChannelIpc(opts?: { validateSender?: (channel: string, event: Electron.IpcMainInvokeEvent) => boolean }): void {
  const guard = (channel: string, event: Electron.IpcMainInvokeEvent): boolean => {
    if (!opts?.validateSender) return true;
    return opts.validateSender(channel, event);
  };

  ipcMain.handle("bridge:channels:list", (event) => {
    if (!guard("bridge:channels:list", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      return { channels: mgr.listStatus() };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:addQQ", async (event, input: unknown) => {
    if (!guard("bridge:channels:addQQ", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as {
        displayName?: string;
        appId?: string;
        credentialRef?: string;
        requireMentionInGroup?: boolean;
        allowedUsers?: string[];
        allowedGroups?: string[];
        receiveDirectMessages?: boolean;
        receiveGroupMessages?: boolean;
      };
      if (!i.displayName || !i.appId || !i.credentialRef) throw new ChannelError("INVALID_INPUT", "displayName/appId/credentialRef required");
      const cfg = await mgr.addQQChannel({
        displayName: i.displayName,
        appId: i.appId,
        credentialRef: i.credentialRef,
        requireMentionInGroup: i.requireMentionInGroup,
        allowedUsers: i.allowedUsers,
        allowedGroups: i.allowedGroups,
        receiveDirectMessages: i.receiveDirectMessages,
        receiveGroupMessages: i.receiveGroupMessages,
      });
      return { channel: cfg };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:update", async (event, input: unknown) => {
    if (!guard("bridge:channels:update", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string; patch?: Record<string, unknown> };
      if (!i.id) throw new ChannelError("INVALID_INPUT", "id required");
      // Prevent secret plaintext via update (only credentialRef allowed)
      if (i.patch && ("appSecret" in (i.patch as Record<string, unknown>) || "secret" in (i.patch as Record<string, unknown>))) {
        throw new ChannelError("INVALID_INPUT", "secret plaintext not allowed via update");
      }
      const cfg = await mgr.updateChannel(i.id, i.patch as never);
      return { channel: cfg };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:setEnabled", async (event, input: unknown) => {
    if (!guard("bridge:channels:setEnabled", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string; enabled?: boolean };
      if (!i.id) throw new ChannelError("INVALID_INPUT", "id required");
      await mgr.setEnabled(i.id, Boolean(i.enabled));
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:connect", async (event, input: unknown) => {
    if (!guard("bridge:channels:connect", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string };
      if (!i.id) throw new ChannelError("INVALID_INPUT", "id required");
      await mgr.connect(i.id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:disconnect", async (event, input: unknown) => {
    if (!guard("bridge:channels:disconnect", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string };
      if (!i.id) throw new ChannelError("INVALID_INPUT", "id required");
      await mgr.disconnect(i.id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:test", async (event, input: unknown) => {
    if (!guard("bridge:channels:test", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string; appId?: string; credentialRef?: string };
      if (i.id) {
        const res = await mgr.testChannel(i.id);
        return res;
      }
      if (i.appId && i.credentialRef) {
        const res = await mgr.testConnectionForInput({ appId: i.appId, credentialRef: i.credentialRef });
        return res;
      }
      throw new ChannelError("INVALID_INPUT", "id or appId+credentialRef required");
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:remove", async (event, input: unknown) => {
    if (!guard("bridge:channels:remove", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const mgr = getChannelManager();
      const i = input as { id?: string };
      if (!i.id) throw new ChannelError("INVALID_INPUT", "id required");
      await mgr.removeChannel(i.id);
      return { ok: true };
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:prepareReply", async (event, input: unknown) => {
    if (!guard("bridge:channels:prepareReply", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { prepareReply } = await import("./outbound/outboundManager");
      const i = input as { replyContextId?: string; text?: string };
      if (!i.replyContextId || typeof i.text !== "string") throw new ChannelError("INVALID_INPUT" as never, "replyContextId and text required");
      // Prevent renderer from sending target fields
      if ((i as Record<string, unknown>).target || (i as Record<string, unknown>).conversationId || (i as Record<string, unknown>).inboundMessageId) {
        throw new ChannelError("INVALID_INPUT" as never, "target fields not allowed");
      }
      const res = await prepareReply({ replyContextId: i.replyContextId, text: i.text });
      return res;
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:confirmReply", async (event, input: unknown) => {
    if (!guard("bridge:channels:confirmReply", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { confirmReply } = await import("./outbound/outboundManager");
      const i = input as { approvalId?: string };
      if (!i.approvalId) throw new ChannelError("INVALID_INPUT" as never, "approvalId required");
      if ((i as Record<string, unknown>).text || (i as Record<string, unknown>).target) {
        throw new ChannelError("INVALID_INPUT" as never, "text/target not allowed in confirm");
      }
      const res = await confirmReply({ approvalId: i.approvalId });
      return res;
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:cancelReply", async (event, input: unknown) => {
    if (!guard("bridge:channels:cancelReply", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { cancelReply } = await import("./outbound/outboundManager");
      const i = input as { approvalId?: string };
      if (!i.approvalId) throw new ChannelError("INVALID_INPUT" as never, "approvalId required");
      const res = await cancelReply({ approvalId: i.approvalId });
      return res;
    } catch (e) {
      toIpcError(e);
    }
  });

  ipcMain.handle("bridge:channels:canReply", async (event, input: unknown) => {
    if (!guard("bridge:channels:canReply", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { canReply } = await import("./outbound/outboundManager");
      const i = input as { replyContextId?: string };
      if (!i.replyContextId) throw new ChannelError("INVALID_INPUT" as never, "replyContextId required");
      const res = await canReply({ replyContextId: i.replyContextId });
      return res;
    } catch (e) {
      toIpcError(e);
    }
  });
}
