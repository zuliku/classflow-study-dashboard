/**
 * Invocation IPC — Task 12
 * Main 返回 opaque invocationId, Renderer 不能 resolve/setOrigin
 */

import { ipcMain } from "electron";
import { beginInvocation } from "@/src/main/security/invocationTrust";

export function registerInvocationIpc(opts?: {
  validateSender?: (channel: string, event: Electron.IpcMainInvokeEvent) => boolean;
}): void {
  const guard = (channel: string, event: Electron.IpcMainInvokeEvent): boolean => {
    if (!opts?.validateSender) return true;
    return opts.validateSender(channel, event);
  };

  ipcMain.handle("bridge:invocation:beginLocal", (event) => {
    if (!guard("bridge:invocation:beginLocal", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    const id = beginInvocation("local-user");
    return { invocationId: id };
  });

  ipcMain.handle("bridge:invocation:beginRemoteInbox", (event, input: unknown) => {
    if (!guard("bridge:invocation:beginRemoteInbox", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    const { source, inboxItemId } = (input as { source?: string; inboxItemId?: string }) ?? {};
    if (!source || !["qq-bot", "gmail", "qq-mail"].includes(source)) {
      throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "invalid source" }));
    }
    const id = beginInvocation("remote-channel", { source: source as "qq-bot" | "gmail" | "qq-mail", inboxItemId });
    return { invocationId: id };
  });
}
