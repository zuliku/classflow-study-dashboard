import { describe, it, expect, beforeEach } from "vitest";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";

describe("SecretVault — Task 03", () => {
  let vault: SecretVault;
  let store: InMemorySecretStore;
  let safeStorage: MockSafeStorage;

  beforeEach(() => {
    store = new InMemorySecretStore();
    safeStorage = new MockSafeStorage(true);
    vault = new SecretVault({ store, safeStorage });
  });

  it("1. 新建 secret 后磁盘没有 plaintext", () => {
    const secret = "my-super-secret-token-123";
    const { metadata } = vault.createCredential({ provider: "mcp", label: "Test MCP", secret });
    // 检查存储中不含明文
    expect(store.__containsPlaintext!(secret)).toBe(false);
    // ciphertext 存在但不是明文
    const rec = store.getRecord(metadata.credentialRef);
    expect(rec).not.toBeNull();
    expect(rec!.ciphertext).not.toContain(secret);
    expect(rec!.ciphertext.length).toBeGreaterThan(0);
  });

  it("2. Renderer API 返回 metadata，不返回 secret", () => {
    const secret = "qq-bot-secret-abc";
    const result = vault.createCredential({ provider: "qq-bot", label: "QQ Bot", secret });
    // 返回对象不应含 secret / token 等字段
    expect((result as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect((result.metadata as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect(result.metadata.credentialRef).toBeTruthy();
    expect(result.metadata.provider).toBe("qq-bot");
    // list 也不含 secret
    const list = vault.listCredentialMetadata();
    expect(list.length).toBe(1);
    for (const m of list) {
      expect((m as unknown as Record<string, unknown>).secret).toBeUndefined();
    }
    expect(JSON.stringify(list)).not.toContain(secret);
  });

  it("3. Main Process 可以 resolve", () => {
    const secret = "google-refresh-token-xyz";
    const { credentialRef } = vault.createCredential({ provider: "google", label: "Google", secret });
    const resolved = vault.resolveSecretInternal(credentialRef);
    expect(resolved).toBe(secret);
  });

  it("4. Renderer 无法 resolve（无 getCredentialPlaintext 暴露）", () => {
    // 检查 vault 暴露的 Renderer 允许方法不含 resolvePlaintext
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(vault));
    // Renderer 允许的方法
    expect(proto).toContain("createCredential");
    expect(proto).toContain("replaceCredential");
    expect(proto).toContain("deleteCredential");
    expect(proto).toContain("listCredentialMetadata");
    // resolveSecretInternal 是内部方法，不应通过 preload 暴露；此处模拟检查：Renderer bridge 不应有 getSecret
    const rendererAllowed = ["createCredential", "replaceCredential", "deleteCredential", "listCredentialMetadata"];
    for (const m of rendererAllowed) {
      expect(proto).toContain(m);
    }
    // 确保没有名为 getSecret / readSecret / exportSecret / getCredentialPlaintext
    expect(proto).not.toContain("getSecret");
    expect(proto).not.toContain("readSecret");
    expect(proto).not.toContain("exportSecret");
    expect(proto).not.toContain("getCredentialPlaintext");
  });

  it("5. replace 后旧 secret 不可继续使用", () => {
    const oldSecret = "old-secret-111";
    const newSecret = "new-secret-222";
    const { credentialRef } = vault.createCredential({ provider: "mcp", label: "MCP", secret: oldSecret });
    expect(vault.resolveSecretInternal(credentialRef)).toBe(oldSecret);
    vault.replaceCredential(credentialRef, newSecret);
    expect(vault.resolveSecretInternal(credentialRef)).toBe(newSecret);
    expect(vault.resolveSecretInternal(credentialRef)).not.toBe(oldSecret);
  });

  it("6. delete 后无法 resolve", () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-mail", label: "QQ Mail", secret: "secret-qq-mail" });
    expect(vault.resolveSecretInternal(credentialRef)).toBe("secret-qq-mail");
    vault.deleteCredential(credentialRef);
    expect(() => vault.resolveSecretInternal(credentialRef)).toThrow();
    // list 也不再包含
    expect(vault.listCredentialMetadata().some((m) => m.credentialRef === credentialRef)).toBe(false);
  });

  it("7. invalid credentialRef fail closed", () => {
    expect(() => vault.resolveSecretInternal("nonexistent")).toThrow();
    expect(() => vault.resolveSecretInternal("")).toThrow();
    expect(() => vault.replaceCredential("invalid-ref", "new-secret")).toThrow();
    expect(() => vault.deleteCredential("invalid-ref")).toThrow();
  });

  it("8. corrupted encrypted payload fail closed", () => {
    const { credentialRef } = vault.createCredential({ provider: "mcp", label: "MCP", secret: "real-secret" });
    // 注入损坏的密文
    store.__injectCorrupted!(credentialRef, "corrupted-not-base64!!!");
    expect(() => vault.resolveSecretInternal(credentialRef)).toThrow();
    // 错误码应为 CIPHERTEXT_CORRUPTED 或 DECRYPTION_FAILED
    try {
      vault.resolveSecretInternal(credentialRef);
    } catch (e) {
      const err = e as { code: string };
      expect(["CIPHERTEXT_CORRUPTED", "DECRYPTION_FAILED"]).toContain(err.code);
    }
  });

  it("9. safeStorage unavailable 不写明文", () => {
    safeStorage.setAvailable(false);
    const secret = "should-not-be-stored";
    expect(() => vault.createCredential({ provider: "google", label: "Google", secret })).toThrow();
    // 检查错误码
    try {
      vault.createCredential({ provider: "google", label: "Google", secret });
    } catch (e) {
      expect((e as { code: string }).code).toBe("SECRET_STORAGE_UNAVAILABLE");
    }
    // 存储应为空，未写入明文
    expect(store.listRecords().length).toBe(0);
    expect(store.__containsPlaintext!(secret)).toBe(false);

    // 已有数据时，resolve 也应 fail closed
    safeStorage.setAvailable(true);
    const { credentialRef } = vault.createCredential({ provider: "mcp", label: "MCP", secret: "stored-secret" });
    safeStorage.setAvailable(false);
    expect(() => vault.resolveSecretInternal(credentialRef)).toThrow();
    try {
      vault.resolveSecretInternal(credentialRef);
    } catch (e) {
      expect((e as { code: string }).code).toBe("SECRET_STORAGE_UNAVAILABLE");
    }
  });

  it("10. 日志与 error 不泄漏 secret", () => {
    const secret = "super-secret-999";
    const { credentialRef } = vault.createCredential({ provider: "google", label: "Google", secret });
    // 错误消息不含 secret
    try {
      vault.resolveSecretInternal("invalid-ref-123");
    } catch (e) {
      const err = e as { message: string; code: string };
      expect(err.message).not.toContain(secret);
      expect(JSON.stringify(err)).not.toContain(secret);
    }
    // 即使 replace 时传入恶意大 secret，错误也不泄漏
    try {
      vault.createCredential({ provider: "mcp" as never, label: "", secret });
    } catch (e) {
      expect(JSON.stringify(e)).not.toContain(secret);
    }
    // 存储快照不含 secret
    const snapshot = JSON.stringify(vault.listCredentialMetadata());
    expect(snapshot).not.toContain(secret);
    // ciphertext 本身是编码后，也不包含明文子串（Mock 用 base64，但检查不直接包含明文）
    const rec = store.getRecord(credentialRef);
    expect(rec!.ciphertext).not.toContain(secret);
  });

  it("provider mismatch 被拒绝", () => {
    const { credentialRef } = vault.createCredential({ provider: "google", label: "Google", secret: "google-secret" });
    expect(() => vault.resolveSecretForProvider(credentialRef, "mcp")).toThrow();
    try {
      vault.resolveSecretForProvider(credentialRef, "mcp");
    } catch (e) {
      expect((e as { code: string }).code).toBe("PROVIDER_MISMATCH");
    }
    // 正确 provider 放行
    expect(vault.resolveSecretForProvider(credentialRef, "google")).toBe("google-secret");
  });
});
