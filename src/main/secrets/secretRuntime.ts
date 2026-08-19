/**
 * Secret Runtime — Task 06 Production
 * Main Process 唯一 SecretVault 实例（Electron safeStorage + FileSecretStore）。
 * resolveSecretForProvider 是 Main Process private API（不通过 preload 暴露）。
 */
import { SecretVault } from "@/lib/secrets/secretVault";
import { createElectronSafeStorage } from "@/src/main/secrets/electronSafeStorage";
import { FileSecretStore } from "@/src/main/secrets/fileSecretStore";

let runtimeVault: SecretVault | null = null;
let runtimeStore: FileSecretStore | null = null;

/** 生产 runtime 单例：Electron safeStorage + <userData>/secrets/vault.json */
export function getRuntimeSecretVault(): SecretVault {
  if (!runtimeVault) {
    runtimeStore = new FileSecretStore();
    runtimeVault = new SecretVault({
      store: runtimeStore,
      safeStorage: createElectronSafeStorage(),
    });
  }
  return runtimeVault;
}

/** 仅测试：重置 runtime */
export function __resetRuntimeSecretVault(): void {
  runtimeVault = null;
  runtimeStore = null;
}
