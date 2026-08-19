import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { SecretVault } from "@/lib/secrets/secretVault";
import { ElectronSafeStorage } from "@/src/main/secrets/electronSafeStorage";
import { FileSecretStore } from "@/src/main/secrets/fileSecretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";

describe("Task 06 — Production SecretVault (FileSecretStore + ElectronSafeStorage contract)", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-secrets-"));
    filePath = path.join(tmpDir, "vault.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("FileSecretStore 磁盘只含 ciphertext，不含明文（atomic replace）", async () => {
    const store = new FileSecretStore(filePath);
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });
    const secret = "super-secret-disk-abc";
    const { credentialRef } = vault.createCredential({ provider: "mcp", label: "MCP", secret });
    await store.flush();

    expect(store.existsOnDisk()).toBe(true);
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toContain("ciphertext");
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("secret");
    expect(store.__containsPlaintext!(secret)).toBe(false);
    expect(vault.resolveSecretInternal(credentialRef)).toBe(secret);
  });

  it("FileSecretStore 拒绝明文键写入（防御）", () => {
    const store = new FileSecretStore(filePath);
    expect(() =>
      store.putRecord({
        credentialRef: "cred_1",
        ciphertext: "abc",
        metadata: { credentialRef: "cred_1", provider: "mcp", label: "x", createdAt: 1, updatedAt: 1, accessToken: "leak" } as never,
      })
    ).toThrow();
  });

  it("FileSecretStore 持久化跨实例可加载（vault.json 重读）", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const secret = "persist-secret-xyz";
    const { credentialRef } = vault1.createCredential({ provider: "google", label: "G", secret });
    await store1.flush();

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.resolveSecretInternal(credentialRef)).toBe(secret);
    expect(vault2.listCredentialMetadata()[0].label).toBe("G");
  });

  it("ElectronSafeStorage adapter：不可用时 fail closed（无 safeStorage 环境返回不可用）", () => {
    // 在 Vitest 环境无真实 electron.safeStorage → isEncryptionAvailable 应返回 false（fail closed）
    const adapter = new ElectronSafeStorage();
    expect(adapter.isEncryptionAvailable()).toBe(false);
    expect(() => adapter.encryptString("x")).toThrow("SECRET_STORAGE_UNAVAILABLE");
  });

  it("resolve 为 Main private API（带 provider 校验）", async () => {
    const store = new FileSecretStore(filePath);
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "QQ", secret: "qq-secret" });
    await store.flush();
    expect(vault.resolveSecretForProvider(credentialRef, "qq-bot")).toBe("qq-secret");
    expect(() => vault.resolveSecretForProvider(credentialRef, "mcp")).toThrow();
  });

  it("删除后密文同步删除（磁盘不再含该记录）", async () => {
    const store = new FileSecretStore(filePath);
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault.createCredential({ provider: "mcp", label: "M", secret: "del-secret" });
    await store.flush();
    vault.deleteCredential(credentialRef);
    await store.flush();
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).not.toContain(credentialRef);
    expect(vault.listCredentialMetadata()).toHaveLength(0);
  });
});
