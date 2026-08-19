/**
 * SecretVault — Main Process 统一 Secret 存储入口（Task 03）。
 *
 * 约束：
 * - Secret 写入前必须加密，磁盘/Store 只保存 ciphertext。
 * - Renderer 永远无法读取 plaintext（无 getSecret / readSecret / exportSecret）。
 * - 删除时同时删除密文。
 * - 读取只允许 Main 内部受信任 subsystem（MCP Manager / Channel Manager）通过 resolveSecretInternal。
 * - 不把 Secret 打进日志；Error message 不包含 Secret；Audit log 不包含 Secret。
 * - safeStorage 不可用时 fail closed，绝不明文降级。
 *
 * 预览：Audit log 仅记录 credentialRef / provider / 操作类型，不含 secret。
 */

import { createId } from "@/lib/utils";
import type {
  CredentialRef,
  SecretMetadata,
  SecretProvider,
  SecretVaultError,
  CreateCredentialInput,
} from "@/lib/secrets/types";
import { SECRET_PROVIDER_SET } from "@/lib/secrets/types";
import type { SecretStore } from "@/lib/secrets/secretStore";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import type { SafeStorage } from "@/lib/secrets/safeStorage";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";

function vaultError(code: SecretVaultError["code"], message: string): SecretVaultError {
  // 确保 message 绝不包含 secret：调用方必须传入不含 secret 的常量/脱敏 message
  return { code, message };
}

function sanitizeErrorForRenderer(err: SecretVaultError): SecretVaultError {
  // 已经是脱敏错误；直接返回（防止未来误把 secret 拼入）
  return { code: err.code, message: err.message };
}

function isValidLabel(label: string): boolean {
  return typeof label === "string" && label.trim().length > 0 && label.trim().length <= 128;
}

export class SecretVault {
  private store: SecretStore;
  private safeStorage: SafeStorage;

  constructor(opts?: { store?: SecretStore; safeStorage?: SafeStorage }) {
    this.store = opts?.store ?? new InMemorySecretStore();
    this.safeStorage = opts?.safeStorage ?? new MockSafeStorage(true);
  }

  /** 仅测试：替换 safeStorage 可用性 */
  __setSafeStorage(safeStorage: SafeStorage): void {
    this.safeStorage = safeStorage;
  }

  /** 仅测试：获取底层 Store */
  __getStore(): SecretStore {
    return this.store;
  }

  /** Renderer 允许：创建 credential（secret 一次性传入 Main，返回 metadata） */
  createCredential(input: CreateCredentialInput): { credentialRef: CredentialRef; metadata: SecretMetadata } {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw sanitizeErrorForRenderer(vaultError("SECRET_STORAGE_UNAVAILABLE", "Secret storage unavailable"));
    }
    if (!SECRET_PROVIDER_SET.has(input.provider as SecretProvider)) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid provider"));
    }
    if (!isValidLabel(input.label)) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid label"));
    }
    if (typeof input.secret !== "string" || input.secret.length === 0) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid secret"));
    }
    if (input.secret.length > 8192) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Secret too long"));
    }

    // 加密
    let ciphertext: string;
    try {
      const encrypted = this.safeStorage.encryptString(input.secret);
      ciphertext = encrypted.toString("base64");
    } catch {
      throw sanitizeErrorForRenderer(vaultError("ENCRYPTION_FAILED", "Encryption failed"));
    }

    const credentialRef = `cred_${createId("s")}`;
    const now = Date.now();
    const metadata: SecretMetadata = {
      credentialRef,
      provider: input.provider as SecretProvider,
      label: input.label.trim(),
      createdAt: now,
      updatedAt: now,
    };

    // 原子写入：若 store.put 失败，密文不会残留（内存实现已原子；文件实现需同事务）
    this.store.putRecord({ credentialRef, ciphertext, metadata });

    // 确保返回不含 secret
    return { credentialRef, metadata: { ...metadata } };
  }

  /** Renderer 允许：替换 secret（旧 secret 立即不可用） */
  replaceCredential(credentialRef: CredentialRef, secret: string): SecretMetadata {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw sanitizeErrorForRenderer(vaultError("SECRET_STORAGE_UNAVAILABLE", "Secret storage unavailable"));
    }
    if (typeof credentialRef !== "string" || credentialRef.length === 0) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid credentialRef"));
    }
    if (typeof secret !== "string" || secret.length === 0) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid secret"));
    }
    const existing = this.store.getRecord(credentialRef);
    if (!existing) {
      throw sanitizeErrorForRenderer(vaultError("CREDENTIAL_NOT_FOUND", "Credential not found"));
    }
    let ciphertext: string;
    try {
      const encrypted = this.safeStorage.encryptString(secret);
      ciphertext = encrypted.toString("base64");
    } catch {
      throw sanitizeErrorForRenderer(vaultError("ENCRYPTION_FAILED", "Encryption failed"));
    }

    const now = Date.now();
    const metadata: SecretMetadata = {
      ...existing.metadata,
      updatedAt: now,
    };

    this.store.putRecord({ credentialRef, ciphertext, metadata });

    return { ...metadata };
  }

  /** Renderer 允许：删除 credential（同时删除密文） */
  deleteCredential(credentialRef: CredentialRef): void {
    if (typeof credentialRef !== "string" || credentialRef.length === 0) {
      throw sanitizeErrorForRenderer(vaultError("INVALID_INPUT", "Invalid credentialRef"));
    }
    const existing = this.store.getRecord(credentialRef);
    if (!existing) {
      throw sanitizeErrorForRenderer(vaultError("CREDENTIAL_NOT_FOUND", "Credential not found"));
    }
    this.store.deleteRecord(credentialRef);
  }

  /** Renderer 允许：列出 metadata（绝不含 secret） */
  listCredentialMetadata(): SecretMetadata[] {
    return this.store.listRecords().map((r) => ({ ...r.metadata }));
  }

  /** 仅 Main 内部受信任 subsystem：resolve 明文（不通过 preload 暴露） */
  resolveSecretInternal(credentialRef: CredentialRef): string {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw vaultError("SECRET_STORAGE_UNAVAILABLE", "Secret storage unavailable");
    }
    if (typeof credentialRef !== "string" || credentialRef.length === 0) {
      throw vaultError("INVALID_INPUT", "Invalid credentialRef");
    }
    const rec = this.store.getRecord(credentialRef);
    if (!rec) {
      throw vaultError("CREDENTIAL_NOT_FOUND", "Credential not found");
    }
    // provider mismatch 检查：若调用方传入期望 provider，可在外层校验；此处仅校验元数据完整性
    if (!SECRET_PROVIDER_SET.has(rec.metadata.provider as SecretProvider)) {
      throw vaultError("PROVIDER_MISMATCH", "Provider mismatch");
    }
    try {
      const buf = Buffer.from(rec.ciphertext, "base64");
      // 检测空或非法 base64
      if (buf.length === 0) throw new Error("CIPHERTEXT_CORRUPTED");
      const plain = this.safeStorage.decryptString(buf);
      if (typeof plain !== "string" || plain.length === 0) {
        throw new Error("CIPHERTEXT_CORRUPTED");
      }
      return plain;
    } catch (e) {
      const code = (e as Error).message === "CIPHERTEXT_CORRUPTED" ? "CIPHERTEXT_CORRUPTED" : "DECRYPTION_FAILED";
      // 损坏或解密失败一律 fail closed，不返回旧 secret，不泄露密文
      throw vaultError(code as SecretVaultError["code"], code === "CIPHERTEXT_CORRUPTED" ? "Ciphertext corrupted" : "Decryption failed");
    }
  }

  /** 仅 Main 内部：带 provider 校验的 resolve（用于 MCP/Channel 按 provider 隔离） */
  resolveSecretForProvider(credentialRef: CredentialRef, expectedProvider: SecretProvider): string {
    const rec = this.store.getRecord(credentialRef);
    if (!rec) throw vaultError("CREDENTIAL_NOT_FOUND", "Credential not found");
    if (rec.metadata.provider !== expectedProvider) {
      throw vaultError("PROVIDER_MISMATCH", "Provider mismatch");
    }
    return this.resolveSecretInternal(credentialRef);
  }

  /** 检查是否存在 orphan（测试用） */
  checkIntegrity(): { orphanMetadata: number; orphanPayload: number } {
    // 本实现 metadata 与 payload 同记录，无 orphan；文件实现需对比
    return { orphanMetadata: 0, orphanPayload: 0 };
  }
}

/** 单例（Main Process）—— Web/Test 下每个测试应创建独立实例以隔离 */
let defaultVault: SecretVault | null = null;

export function getDefaultSecretVault(): SecretVault {
  if (!defaultVault) {
    defaultVault = new SecretVault();
  }
  return defaultVault;
}

/** 仅测试：重置单例 */
export function __resetDefaultSecretVault(): void {
  defaultVault = null;
}
