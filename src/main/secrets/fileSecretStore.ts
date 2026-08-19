/**
 * File SecretStore — Task 06 Production
 * 位置：<userData>/secrets/vault.json
 * 磁盘只允许出现 { credentialRef, ciphertext, metadata }；禁止明文。
 * 写入采用 atomic replace（tmp + rename）。
 */
import { promises as fs, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { CredentialRef } from "@/lib/secrets/types";
import type { EncryptedRecord, SecretStore } from "@/lib/secrets/secretStore";

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
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath("userData"), "secrets", "vault.json");
  }

  getFilePath(): string {
    return this.filePath;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
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

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const dir = dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      const tmp = join(dir, `.vault-tmp-${randomUUID().slice(0, 8)}`);
      const data = JSON.stringify({ records: [...this.cache.values()] }, null, 2);
      await fs.writeFile(tmp, data, "utf8");
      await fs.rename(tmp, this.filePath);
    });
    await this.writeQueue;
  }

  getRecord(credentialRef: CredentialRef): EncryptedRecord | null {
    void this.load();
    return this.cache.get(credentialRef) ?? null;
  }

  putRecord(record: EncryptedRecord): void {
    // 防御：任何明文键都不得进入磁盘
    const forbidden: string[] = [];
    for (const key of FORBIDDEN_PLAINTEXT_KEYS) {
      if (key in record.metadata) forbidden.push(key);
      if (key in record) forbidden.push(key);
    }
    if (forbidden.length > 0) {
      throw new Error("INVALID_INPUT: plaintext key in record");
    }
    this.cache.set(record.credentialRef, record);
    void this.persist().catch(() => {
      /* 持久化失败：由 vault 层 fail closed */
    });
  }

  deleteRecord(credentialRef: CredentialRef): void {
    this.cache.delete(credentialRef);
    void this.persist().catch(() => {
      /* 同 putRecord */
    });
  }

  listRecords(): EncryptedRecord[] {
    void this.load();
    const out: EncryptedRecord[] = [];
    this.cache.forEach((v) => out.push(v));
    return out;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  __injectCorrupted(credentialRef: CredentialRef, ciphertext: string): void {
    const existing = this.cache.get(credentialRef);
    if (existing) {
      this.cache.set(credentialRef, { ...existing, ciphertext });
      void this.persist();
    }
  }

  __clearAll(): void {
    this.cache.clear();
    void this.persist();
  }

  __containsPlaintext(plaintext: string): boolean {
    for (const rec of this.cache.values()) {
      if (rec.ciphertext.includes(plaintext)) return true;
      if (JSON.stringify(rec.metadata).includes(plaintext)) return true;
    }
    return false;
  }

  existsOnDisk(): boolean {
    return existsSync(this.filePath);
  }
}
