/**
 * Secret IPC — Task 06 Production
 * 注册 bridge:credential:* 通道（Renderer 只允许 create/replace/delete/list）。
 * 禁止 resolve/getSecret/readPlaintext/exportSecret。
 */
import { ipcMain } from "electron";
import type { SecretVault } from "@/lib/secrets/secretVault";
import { getRuntimeSecretVault } from "@/src/main/secrets/secretRuntime";

function toIpcError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  throw new Error(JSON.stringify({ code: e?.code ?? "UNKNOWN", message: e?.message ?? "Secret operation failed" }));
}

export function registerSecretIpc(opts?: {
  vault?: SecretVault;
  validateSender?: (channel: string, event: Electron.IpcMainInvokeEvent) => boolean;
}): void {
  const vault = opts?.vault ?? getRuntimeSecretVault();

  const guard = (channel: string, event: Electron.IpcMainInvokeEvent): boolean => {
    if (!opts?.validateSender) return true;
    return opts.validateSender(channel, event);
  };

  ipcMain.handle("bridge:credential:create", (event, input: unknown) => {
    if (!guard("bridge:credential:create", event)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    try {
      const i = input as { provider?: string; label?: string; secret?: string };
      const result = vault.createCredential({
        provider: (i?.provider ?? "") as never,
        label: i?.label ?? "",
        secret: i?.secret ?? "",
      });
      return { credentialRef: result.credentialRef, metadata: result.metadata };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:credential:replace", (event, input: unknown) => {
    if (!guard("bridge:credential:replace", event)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    try {
      const i = input as { credentialRef?: string; secret?: string };
      const metadata = vault.replaceCredential(i?.credentialRef ?? "", i?.secret ?? "");
      return { metadata };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:credential:delete", (event, input: unknown) => {
    if (!guard("bridge:credential:delete", event)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    try {
      const i = input as { credentialRef?: string };
      vault.deleteCredential(i?.credentialRef ?? "");
      return { ok: true };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:credential:list", (event) => {
    if (!guard("bridge:credential:list", event)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    try {
      return { metadata: vault.listCredentialMetadata() };
    } catch (err) {
      toIpcError(err);
    }
  });

  // 显式不注册：resolve / getSecret / readPlaintext / exportSecret
}
