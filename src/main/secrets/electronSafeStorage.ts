/**
 * Electron SafeStorage Adapter — Task 06 Production
 * 真实使用 electron.safeStorage（Windows DPAPI）。
 */
import { safeStorage } from "electron";
import type { SafeStorage } from "@/lib/secrets/safeStorage";

export class ElectronSafeStorage implements SafeStorage {
  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  encryptString(plain: string): Buffer {
    if (!this.isEncryptionAvailable()) {
      throw new Error("SECRET_STORAGE_UNAVAILABLE");
    }
    return safeStorage.encryptString(plain);
  }

  decryptString(encrypted: Buffer): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error("SECRET_STORAGE_UNAVAILABLE");
    }
    return safeStorage.decryptString(encrypted);
  }
}

/** 创建 Electron SafeStorage adapter（safeStorage 不可用 → isEncryptionAvailable=false，fail closed） */
export function createElectronSafeStorage(): ElectronSafeStorage {
  return new ElectronSafeStorage();
}
