import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import {
  normalizeWebSearchCredentialRef,
  resolveKiroWebSearchAccess,
} from "@/lib/ai/web/credentials";
import {
  resolveKiroWebSearchAccessWithStoredRef,
  resolveStoredWebSearchKeyWithVault,
} from "@/lib/ai/web/storedCredentials";
import {
  deleteTavilyCredential,
  isWebSearchSecretStorageAvailable,
  listTavilyCredentialMetadata,
  saveTavilyCredential,
} from "@/lib/ai/web/secretStorage";
import { validateAIChatBody } from "@/lib/ai/server";

const REF = "cred_s_11111111-1111-4111-8111-111111111111";

describe("BYOK Tavily SecretVault", () => {
  let vault: SecretVault;

  beforeEach(() => {
    vault = new SecretVault({
      store: new InMemorySecretStore(),
      safeStorage: new MockSafeStorage(true),
    });
  });

  it("tavily provider 可创建 / resolve；错误 provider 拒绝", () => {
    const { credentialRef, metadata } = vault.createCredential({
      provider: "tavily",
      label: "Kiro Search",
      secret: "tvly-secret",
    });
    expect(metadata.provider).toBe("tavily");
    expect(vault.resolveSecretForProvider(credentialRef, "tavily")).toBe("tvly-secret");
    expect(() => vault.resolveSecretForProvider(credentialRef, "mcp")).toThrow();
  });

  it("stored resolver：合法 ref 返回 key；非法 ref / 空 ref / 抛错 → null", () => {
    const fake = {
      resolveSecretForProvider: vi.fn((ref: string, provider: "tavily") => {
        if (provider !== "tavily") throw new Error("provider mismatch");
        return ref === REF ? " tvly-keyed " : "";
      }),
    };
    expect(resolveStoredWebSearchKeyWithVault(REF, fake)).toBe("tvly-keyed");
    expect(resolveStoredWebSearchKeyWithVault("bad-ref", fake)).toBeNull();
    expect(resolveStoredWebSearchKeyWithVault(undefined, fake)).toBeNull();
    expect(
      resolveStoredWebSearchKeyWithVault(REF, {
        resolveSecretForProvider: () => {
          throw new Error("boom");
        },
      })
    ).toBeNull();
  });

  it("BYOK route helper：ref 优先；ref 失效回退 session key；server 模式忽略 ref", async () => {
    const fromRef = await resolveKiroWebSearchAccessWithStoredRef(
      { mode: "byok", credentialRef: REF },
      { resolveStoredKey: async () => "tvly-from-vault" }
    );
    expect(fromRef).toMatchObject({ ok: true, kind: "keyed", apiKey: "tvly-from-vault" });

    const fallback = await resolveKiroWebSearchAccessWithStoredRef(
      { mode: "byok", credentialRef: REF, userApiKey: "tvly-session" },
      { resolveStoredKey: async () => null }
    );
    expect(fallback).toMatchObject({ ok: true, kind: "keyed", apiKey: "tvly-session" });

    const server = await resolveKiroWebSearchAccessWithStoredRef(
      { mode: "server", credentialRef: REF },
      { resolveStoredKey: async () => "must-not-use" }
    );
    expect(server).toEqual(resolveKiroWebSearchAccess({ mode: "server" }));
  });

  it("credentialRef 只接受 cred_ 形态", () => {
    expect(normalizeWebSearchCredentialRef(REF)).toBe(REF);
    expect(normalizeWebSearchCredentialRef("  tvly-key  ")).toBeUndefined();
    expect(normalizeWebSearchCredentialRef("cred_")).toBeUndefined();
  });

  it("chat body 只透传合法 credentialRef；非法值丢弃", () => {
    const base = {
      provider: "opencode-go",
      model: "deepseek-v4.1-flash",
      apiKey: "sk-test",
      webSearchConfig: { enabled: true, credentialMode: "byok", credentialRef: REF },
    };
    const valid = validateAIChatBody(base);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.webSearchConfig?.credentialRef).toBe(REF);

    const invalid = validateAIChatBody({
      ...base,
      webSearchConfig: { enabled: true, credentialMode: "byok", credentialRef: "tvly-plaintext" },
    });
    expect(invalid.ok).toBe(true);
    if (invalid.ok) expect(invalid.webSearchConfig?.credentialRef).toBeUndefined();
  });
});

describe("renderer SecretVault bridge helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBridge(overrides?: {
    create?: ReturnType<typeof vi.fn>;
    replace?: ReturnType<typeof vi.fn>;
    delete?: ReturnType<typeof vi.fn>;
    list?: ReturnType<typeof vi.fn>;
  }) {
    const bridge = {
      create: overrides?.create ?? vi.fn().mockResolvedValue({ credentialRef: REF }),
      replace: overrides?.replace ?? vi.fn().mockResolvedValue({}),
      delete: overrides?.delete ?? vi.fn().mockResolvedValue({ ok: true }),
      list:
        overrides?.list ??
        vi.fn().mockResolvedValue({
          metadata: [
            { credentialRef: REF, provider: "tavily", label: "Kiro Search" },
            { credentialRef: "cred_other", provider: "mcp", label: "Other" },
          ],
        }),
    };
    vi.stubGlobal("window", { classflowDesktop: { credentials: bridge } });
    return bridge;
  }

  it("create / replace / delete / list 只走受限 bridge", async () => {
    const bridge = stubBridge();
    expect(isWebSearchSecretStorageAvailable()).toBe(true);
    expect(await listTavilyCredentialMetadata()).toEqual([
      { credentialRef: REF, provider: "tavily", label: "Kiro Search" },
    ]);

    expect(await saveTavilyCredential("  tvly-new  ")).toBe(REF);
    expect(bridge.create).toHaveBeenCalledWith({
      provider: "tavily",
      label: "Kiro Search",
      secret: "tvly-new",
    });

    expect(await saveTavilyCredential("tvly-replaced", REF)).toBe(REF);
    expect(bridge.replace).toHaveBeenCalledWith({ credentialRef: REF, secret: "tvly-replaced" });

    await deleteTavilyCredential(REF);
    expect(bridge.delete).toHaveBeenCalledWith({ credentialRef: REF });
  });

  it("旧 ref replace 失败 → create 新记录", async () => {
    const bridge = stubBridge({
      replace: vi.fn().mockRejectedValue(new Error(JSON.stringify({ code: "CREDENTIAL_NOT_FOUND" }))),
      create: vi.fn().mockResolvedValue({ credentialRef: "cred_s_new" }),
    });
    expect(await saveTavilyCredential("tvly-new", "cred_s_old")).toBe("cred_s_new");
    expect(bridge.replace).toHaveBeenCalledTimes(1);
    expect(bridge.create).toHaveBeenCalledTimes(1);
  });

  it("bridge 不可用 → 明确失败，不静默写 sessionStorage", async () => {
    vi.stubGlobal("window", {});
    expect(isWebSearchSecretStorageAvailable()).toBe(false);
    await expect(saveTavilyCredential("tvly-key")).rejects.toThrow("桌面安全存储不可用");
    expect(await listTavilyCredentialMetadata()).toBeNull();
  });
});
