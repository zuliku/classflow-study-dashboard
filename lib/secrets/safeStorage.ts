/**
 * SafeStorage 抽象 — 对 Electron safeStorage 的最小门面。
 * Renderer 永远无法直接访问此模块（Main Process only）。
 *
 * - isEncryptionAvailable(): 对应 safeStorage.isEncryptionAvailable()
 * - encryptString / decryptString: 对应 safeStorage.encryptString / decryptString
 *
 * Web/Test 下通过 MockSafeStorage 注入；Electron 下包装真实 safeStorage。
 */

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * 测试/回退用的 Mock：可用时做 base64 编码模拟加密；不可用时 isEncryptionAvailable=false。
 * 真实 Electron 环境应注入 real safeStorage adapter。
 */
export class MockSafeStorage implements SafeStorage {
  private available: boolean;
  constructor(available = true) {
    this.available = available;
  }

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  encryptString(plain: string): Buffer {
    if (!this.available) throw new Error("SECRET_STORAGE_UNAVAILABLE");
    // 模拟：前缀 + base64，避免明文直接出现在存储中
    return Buffer.from(`enc:v1:${Buffer.from(plain, "utf8").toString("base64")}`, "utf8");
  }

  decryptString(encrypted: Buffer): string {
    if (!this.available) throw new Error("SECRET_STORAGE_UNAVAILABLE");
    const s = encrypted.toString("utf8");
    if (!s.startsWith("enc:v1:")) throw new Error("CIPHERTEXT_CORRUPTED");
    const b64 = s.slice("enc:v1:".length);
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      throw new Error("CIPHERTEXT_CORRUPTED");
    }
  }
}

/**
 * 尝试获取 Electron safeStorage（Main Process）。
 * Web 环境返回 null，调用方应 fail closed（SECRET_STORAGE_UNAVAILABLE）。
 */
export function getElectronSafeStorage(): SafeStorage | null {
  // 仅在 Electron Main 中存在；Web 下 typeof window/electron 均无此对象
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = typeof require !== "undefined" ? require("electron") : null;
    const ss = electron?.safeStorage as
      | { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string }
      | undefined;
    if (!ss) return null;
    return {
      isEncryptionAvailable: () => ss.isEncryptionAvailable(),
      encryptString: (plain: string) => ss.encryptString(plain),
      decryptString: (encrypted: Buffer) => ss.decryptString(encrypted),
    };
  } catch {
    return null;
  }
}
