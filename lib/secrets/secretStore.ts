/**
 * SecretStore — 低层密文持久化（Main Process only）。
 * 职责：只保存 ciphertext，永不保存 plaintext。
 * 本模块与 safeStorage 解耦：上层 SecretVault 负责加密/解密，本层只负责存储 Buffer/string。
 *
 * 磁盘实现（Electron Main）：文件或 userData JSON（仅 ciphertext）。
 * Web/Test 实现：内存 Map（用于 Vitest）；行为与磁盘实现一致（fail closed）。
 */

import type { CredentialRef, SecretMetadata } from "@/lib/secrets/types";

export interface EncryptedRecord {
  credentialRef: CredentialRef;
  ciphertext: string; // base64 / hex，取决于 safeStorage 实现；本层不解析
  metadata: SecretMetadata;
}

export interface SecretStore {
  getRecord(credentialRef: CredentialRef): EncryptedRecord | null;
  putRecord(record: EncryptedRecord): void;
  deleteRecord(credentialRef: CredentialRef): void;
  listRecords(): EncryptedRecord[];
  /** 仅测试：注入损坏的密文便于校验 fail-closed */
  __injectCorrupted?(credentialRef: CredentialRef, ciphertext: string): void;
  /** 仅测试：清空全部 */
  __clearAll?(): void;
  /** 仅测试：检查原始存储中是否含明文（应永远 false） */
  __containsPlaintext?(plaintext: string): boolean;
}

/**
 * 内存实现（Web / Vitest）。
 * ciphertext 以 string 存储；__containsPlaintext 用于回归测试「磁盘没有 plaintext」。
 */
export class InMemorySecretStore implements SecretStore {
  private map = new Map<CredentialRef, EncryptedRecord>();

  getRecord(credentialRef: CredentialRef): EncryptedRecord | null {
    return this.map.get(credentialRef) ?? null;
  }

  putRecord(record: EncryptedRecord): void {
    this.map.set(record.credentialRef, record);
  }

  deleteRecord(credentialRef: CredentialRef): void {
    this.map.delete(credentialRef);
  }

  listRecords(): EncryptedRecord[] {
    const out: EncryptedRecord[] = [];
    this.map.forEach((v) => out.push(v));
    return out;
  }

  __injectCorrupted(credentialRef: CredentialRef, ciphertext: string): void {
    const existing = this.map.get(credentialRef);
    if (existing) {
      this.map.set(credentialRef, { ...existing, ciphertext });
    }
  }

  __clearAll(): void {
    this.map.clear();
  }

  __containsPlaintext(plaintext: string): boolean {
    let found = false;
    this.map.forEach((rec) => {
      if (rec.ciphertext.includes(plaintext)) found = true;
      if (JSON.stringify(rec.metadata).includes(plaintext)) found = true;
    });
    return found;
  }
}

/** 辅助：生成不含 secret 的存储快照（用于调试；永不包含 plaintext） */
export function snapshotMetadataOnly(store: SecretStore): SecretMetadata[] {
  return store.listRecords().map((r) => r.metadata);
}
