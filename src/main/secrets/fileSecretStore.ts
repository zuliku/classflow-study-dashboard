/**
 * File SecretStore — Task 06 Production
 * 位置：<userData>/secrets/vault.json
 * 磁盘只允许出现 { credentialRef, ciphertext, metadata }；禁止明文。
 * 写入采用 atomic replace（tmp + rename）。
 */
import * as fs from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { CredentialRef } from "@/lib/secrets/types";
import type { EncryptedRecord, SecretStore } from "@/lib/secrets/secretStore";

export interface FileSecretStoreFs {
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  mkdirSync: typeof fs.mkdirSync;
  renameSync: typeof fs.renameSync;
  unlinkSync: typeof fs.unlinkSync;
}

const FORBIDDEN_PLAINTEXT_KEYS = new Set([
  "secret",
  "password",
  "accessToken",
  "refreshToken",
  "apiKey",
  "token",
]);

export class FileSecretStore implements SecretStore {
  private filePath: string;
  private cache = new Map<CredentialRef, EncryptedRecord>();
  private loaded = false;
  private fs: FileSecretStoreFs;

  constructor(filePath?: string, fsImpl?: FileSecretStoreFs) {
    this.fs = fsImpl ?? fs;
    this.filePath = filePath ?? join(app.getPath("userData"), "secrets", "vault.json");
    // 同步加载，避免 Vault 同步 API 读不到已持久化的数据
    this.loadSync();
  }

  getFilePath(): string {
    return this.filePath;
  }

  private loadSync(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!this.fs.existsSync(this.filePath)) {
        this.cache = new Map();
        return;
      }
      const raw = this.fs.readFileSync(this.filePath, "utf8") as string;
      const parsed = JSON.parse(raw) as { records?: EncryptedRecord[] };
      if (Array.isArray(parsed.records)) {
        const map = new Map<CredentialRef, EncryptedRecord>();
        for (const r of parsed.records) {
          if (
            r &&
            typeof r.credentialRef === "string" &&
            r.credentialRef.length > 0 &&
            typeof r.ciphertext === "string" &&
            r.metadata &&
            typeof r.metadata === "object"
          ) {
            map.set(r.credentialRef, r);
          }
        }
        this.cache = map;
      }
    } catch {
      this.cache = new Map();
    }
  }

  private persistSnapshotSync(snapshot: Map<CredentialRef, EncryptedRecord>): void {
    const dir = dirname(this.filePath);
    const tmp = join(dir, `.vault-tmp-${randomUUID().slice(0, 8)}`);
    try {
      this.fs.mkdirSync(dir, { recursive: true });
      const data = JSON.stringify({ records: [...snapshot.values()] }, null, 2);
      this.fs.writeFileSync(tmp, data, "utf8");
      this.fs.renameSync(tmp, this.filePath);
    } catch {
      try {
        this.fs.unlinkSync(tmp);
      } catch {
        // ignore cleanup error
      }
      const err = new Error("Secret persistence failed") as Error & { code: "SECRET_PERSISTENCE_FAILED" };
      (err as unknown as { code: string }).code = "SECRET_PERSISTENCE_FAILED";
      throw err;
    }
  }

  private persistSync(): void {
    // Legacy wrapper kept for internal helpers that still call it directly (now delegates to snapshot)
    this.persistSnapshotSync(this.cache);
  }

  getRecord(credentialRef: CredentialRef): EncryptedRecord | null {
    this.loadSync();
    return this.cache.get(credentialRef) ?? null;
  }

  putRecord(record: EncryptedRecord): void {
    this.loadSync();
    // 防御：任何明文键都不得进入磁盘
    const forbidden: string[] = [];
    for (const key of FORBIDDEN_PLAINTEXT_KEYS) {
      if (key in record.metadata) forbidden.push(key);
      if (key in record) forbidden.push(key);
    }
    if (forbidden.length > 0) {
      throw new Error("INVALID_INPUT: plaintext key in record");
    }
    const candidate = new Map(this.cache);
    candidate.set(record.credentialRef, record);
    this.persistSnapshotSync(candidate);
    this.cache = candidate;
  }

  deleteRecord(credentialRef: CredentialRef): void {
    this.loadSync();
    const candidate = new Map(this.cache);
    candidate.delete(credentialRef);
    this.persistSnapshotSync(candidate);
    this.cache = candidate;
  }

  listRecords(): EncryptedRecord[] {
    this.loadSync();
    const out: EncryptedRecord[] = [];
    this.cache.forEach((v) => out.push(v));
    return out;
  }

  async flush(): Promise<void> {
    // 同步已持久化，保留 async 接口供测试兼容
    return;
  }

  __injectCorrupted(credentialRef: CredentialRef, ciphertext: string): void {
    this.loadSync();
    const existing = this.cache.get(credentialRef);
    if (existing) {
      const candidate = new Map(this.cache);
      candidate.set(credentialRef, { ...existing, ciphertext });
      this.persistSnapshotSync(candidate);
      this.cache = candidate;
    }
  }

  __clearAll(): void {
    this.loadSync();
    const candidate = new Map(this.cache);
    candidate.clear();
    this.persistSnapshotSync(candidate);
    this.cache = candidate;
  }

  __containsPlaintext(plaintext: string): boolean {
    this.loadSync();
    for (const rec of this.cache.values()) {
      if (rec.ciphertext.includes(plaintext)) return true;
      if (JSON.stringify(rec.metadata).includes(plaintext)) return true;
    }
    return false;
  }

  existsOnDisk(): boolean {
    return this.fs.existsSync(this.filePath);
  }
}
