import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as realFs from "node:fs";
import { promises as fsp } from "node:fs";
import { SecretVault } from "@/lib/secrets/secretVault";
import { FileSecretStore, FileSecretStoreFs } from "@/src/main/secrets/fileSecretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";

function failingFs(method: "writeFileSync" | "renameSync", errorMsg: string): FileSecretStoreFs {
  return {
    existsSync: realFs.existsSync.bind(realFs),
    readFileSync: realFs.readFileSync.bind(realFs) as never,
    writeFileSync: method === "writeFileSync" ? (() => { throw new Error(errorMsg); }) as never : realFs.writeFileSync.bind(realFs) as never,
    mkdirSync: realFs.mkdirSync.bind(realFs) as never,
    renameSync: method === "renameSync" ? (() => { throw new Error(errorMsg); }) as never : realFs.renameSync.bind(realFs) as never,
    unlinkSync: realFs.unlinkSync.bind(realFs) as never,
  };
}

describe("Task 17 — SecretVault Persistence Fail-Closed", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cf-secrets-fail-"));
    filePath = path.join(tmpDir, "vault.json");
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("1. CREATE — write failure must throw SECRET_PERSISTENCE_FAILED and leave cache empty", async () => {
    const store = new FileSecretStore(filePath, failingFs("writeFileSync", "EACCES write C:\\Users\\someone\\AppData\\Roaming\\ClassFlow\\secrets\\vault.json"));
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });

    let thrown: unknown = null;
    try {
      vault.createCredential({ provider: "mcp", label: "MCP", secret: "secret-1" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeTruthy();
    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    const sanitized = JSON.stringify(thrown);
    expect(sanitized).not.toContain("C:\\Users");
    expect(sanitized).not.toContain("vault.json");
    expect(sanitized).not.toContain("EACCES");
    expect(sanitized).not.toContain("secret-1");

    expect(vault.listCredentialMetadata()).toHaveLength(0);
    expect(store.listRecords()).toHaveLength(0);
    const exists = realFs.existsSync(filePath);
    if (exists) {
      const raw = await fsp.readFile(filePath, "utf8").catch(() => "{}");
      expect(raw).not.toContain("secret-1");
    }
  });

  it("2. CREATE — rename failure must throw and leave cache empty", async () => {
    const store = new FileSecretStore(filePath, failingFs("renameSync", "EACCES rename C:\\Users\\someone\\AppData\\Roaming\\ClassFlow\\secrets\\vault.json"));
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });

    let thrown: unknown = null;
    try {
      vault.createCredential({ provider: "mcp", label: "MCP", secret: "secret-2" });
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault.listCredentialMetadata()).toHaveLength(0);
    expect(store.listRecords()).toHaveLength(0);
  });

  it("3. REPLACE — persistence failure must keep old secret (memory and disk)", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault1.createCredential({ provider: "mcp", label: "MCP", secret: "old-secret" });
    await store1.flush();
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("old-secret");

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = failingFs("writeFileSync", "EACCES write vault.json");

    let thrown: unknown = null;
    try {
      vault1.replaceCredential(credentialRef, "new-secret");
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("old-secret");

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.resolveSecretInternal(credentialRef)).toBe("old-secret");
  });

  it("4. REPLACE — rename failure must keep old secret", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault1.createCredential({ provider: "google", label: "G", secret: "old-google" });
    await store1.flush();

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = failingFs("renameSync", "EPERM rename vault.json");

    let thrown: unknown = null;
    try {
      vault1.replaceCredential(credentialRef, "new-google");
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("old-google");

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.resolveSecretInternal(credentialRef)).toBe("old-google");
  });

  it("5. DELETE — write failure must keep credential", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault1.createCredential({ provider: "qq-bot", label: "QQ", secret: "qq-secret" });
    await store1.flush();

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = failingFs("writeFileSync", "ENOSPC write vault.json");

    let thrown: unknown = null;
    try {
      vault1.deleteCredential(credentialRef);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("qq-secret");
    expect(vault1.listCredentialMetadata()).toHaveLength(1);

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.resolveSecretInternal(credentialRef)).toBe("qq-secret");
  });

  it("6. DELETE — rename failure must keep credential after restart", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault1.createCredential({ provider: "mcp", label: "M", secret: "del-secret2" });
    await store1.flush();

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = failingFs("renameSync", "EACCES rename vault.json");

    let thrown: unknown = null;
    try {
      vault1.deleteCredential(credentialRef);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault1.listCredentialMetadata()).toHaveLength(1);

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.listCredentialMetadata()).toHaveLength(1);
    expect(vault2.resolveSecretInternal(credentialRef)).toBe("del-secret2");
  });

  it("7. Error sanitization must not leak path, errno, or secret", async () => {
    const store = new FileSecretStore(filePath, failingFs("writeFileSync", "EACCES rename C:\\Users\\someone\\AppData\\Roaming\\ClassFlow\\secrets\\vault.json tmp"));
    const vault = new SecretVault({ store, safeStorage: new MockSafeStorage(true) });

    let thrown: unknown = null;
    try {
      vault.createCredential({ provider: "mcp", label: "MCP", secret: "super-secret-sanitize" });
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect((thrown as { message?: string })?.message).toBe("Secret persistence failed");
    const s = JSON.stringify(thrown);
    expect(s).not.toContain("C:\\Users");
    expect(s).not.toContain("vault.json");
    expect(s).not.toContain("EACCES");
    expect(s).not.toContain("super-secret-sanitize");
    expect(s).not.toContain("tmp");
  });

  it("8. Retry after failure must succeed and not be poisoned", async () => {
    const store1 = new FileSecretStore(filePath);
    const vault1 = new SecretVault({ store: store1, safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault1.createCredential({ provider: "mcp", label: "M", secret: "old-retry" });
    await store1.flush();

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = failingFs("renameSync", "EACCES rename vault.json");

    let firstThrown: unknown = null;
    try {
      vault1.replaceCredential(credentialRef, "new-retry");
    } catch (e) {
      firstThrown = e;
    }
    expect((firstThrown as { code?: string })?.code).toBe("SECRET_PERSISTENCE_FAILED");
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("old-retry");

    (store1 as unknown as { fs: FileSecretStoreFs }).fs = {
      existsSync: realFs.existsSync.bind(realFs),
      readFileSync: realFs.readFileSync.bind(realFs) as never,
      writeFileSync: realFs.writeFileSync.bind(realFs) as never,
      mkdirSync: realFs.mkdirSync.bind(realFs) as never,
      renameSync: realFs.renameSync.bind(realFs) as never,
      unlinkSync: realFs.unlinkSync.bind(realFs) as never,
    };

    const meta = vault1.replaceCredential(credentialRef, "new-retry");
    expect(meta).toBeTruthy();
    expect(vault1.resolveSecretInternal(credentialRef)).toBe("new-retry");

    const store2 = new FileSecretStore(filePath);
    const vault2 = new SecretVault({ store: store2, safeStorage: new MockSafeStorage(true) });
    expect(vault2.resolveSecretInternal(credentialRef)).toBe("new-retry");
  });
});
