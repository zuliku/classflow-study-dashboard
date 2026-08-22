import { describe, it, expect, vi, beforeEach } from "vitest";
import { isChannelErrorCode, userMessageForChannelCode, resolveChannelUserMessage, CHANNEL_ERROR_CODES } from "@/lib/channels/errorContract";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      const p = require("node:path");
      const o = require("node:os");
      return p.join(o.tmpdir(), `classflow-test-${name}-${Math.random().toString(36).slice(2,6)}`);
    },
  },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => ({
  TokenManager: class {
    async getAccessToken() { return "token"; }
    clearCache() {}
  },
}));
vi.mock("@tencent-connect/qqbot-nodejs", () => ({
  QQBot: class { sendText = vi.fn(); start = vi.fn().mockResolvedValue(undefined); stop = vi.fn(); on = vi.fn(); },
}));

describe("Shared Channel Error Contract", () => {
  it("isChannelErrorCode identifies known codes", () => {
    expect(isChannelErrorCode("QQ_AUTH_FAILED")).toBe(true);
    expect(isChannelErrorCode("INVALID_INPUT")).toBe(true);
    expect(isChannelErrorCode("FUTURE_PROVIDER_FAILURE")).toBe(false);
    expect(isChannelErrorCode(undefined)).toBe(false);
    expect(isChannelErrorCode(123)).toBe(false);
  });

  it("userMessageForChannelCode returns known message and fallback", () => {
    expect(userMessageForChannelCode("QQ_AUTH_FAILED")).toBe("QQ 机器人认证失败，请检查 App ID / Secret");
    expect(userMessageForChannelCode("QQ_NETWORK_ERROR")).toBe("网络连接失败，请稍后重试");
    expect(userMessageForChannelCode("GMAIL_OAUTH_STATE_MISMATCH")).toBe("Gmail 登录验证失败，请重新连接");
    // unknown should fallback
    expect(userMessageForChannelCode("FUTURE_CODE" as never)).toBe("操作失败，请稍后重试");
  });

  it("resolveChannelUserMessage handles various shapes and unknown fallback", () => {
    expect(resolveChannelUserMessage({ code: "QQ_AUTH_FAILED" })).toBe("QQ 机器人认证失败，请检查 App ID / Secret");
    expect(resolveChannelUserMessage({ error: "QQ_NETWORK_ERROR" })).toBe("网络连接失败，请稍后重试");
    expect(resolveChannelUserMessage("QQ_RATE_LIMITED")).toBe("请求过于频繁，请稍后重试");
    expect(resolveChannelUserMessage({ code: "FUTURE_PROVIDER_FAILURE" }, "连接失败，请稍后重试")).toBe("连接失败，请稍后重试");
    expect(resolveChannelUserMessage({ code: "UNKNOWN_CODE" })).toBe("操作失败，请稍后重试");
    expect(resolveChannelUserMessage({ message: "QQ_AUTH_FAILED" })).toBe("QQ 机器人认证失败，请检查 App ID / Secret");
    expect(resolveChannelUserMessage(null)).toBe("操作失败，请稍后重试");
    expect(resolveChannelUserMessage(undefined, "自定义 fallback")).toBe("自定义 fallback");
  });

  it("CHANNEL_ERROR_CODES includes all expected codes", () => {
    expect(CHANNEL_ERROR_CODES).toContain("QQ_AUTH_FAILED");
    expect(CHANNEL_ERROR_CODES).toContain("INVALID_INPUT");
    expect(CHANNEL_ERROR_CODES).toContain("EMAIL_SYNC_FAILED");
  });

  it("GMAIL productized messages", () => {
    expect(userMessageForChannelCode("GMAIL_OAUTH_CONFIG_MISSING")).toBe("Gmail 授权服务暂不可用，请稍后重试");
    expect(userMessageForChannelCode("GMAIL_OAUTH_STATE_MISMATCH")).toBe("Gmail 登录验证失败，请重新连接");
    expect(userMessageForChannelCode("GMAIL_OAUTH_TIMEOUT")).toBe("授权超时，请重试");
    expect(userMessageForChannelCode("GMAIL_OAUTH_DENIED")).toBe("已拒绝授权");
  });
});

describe("Manager Contract — testChannel / testConnectionForInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("CASE 9 QQ vault secret failure returns code not message", async () => {
    const { ChannelManager } = await import("@/src/main/channels/manager");
    const { ChannelInboxSink } = await import("@/src/main/channels/inboxSink");
    const { SecretVault } = await import("@/lib/secrets/secretVault");
    const { InMemorySecretStore } = await import("@/lib/secrets/secretStore");
    const { MockSafeStorage } = await import("@/lib/secrets/safeStorage");
    const secretRuntime = await import("@/src/main/secrets/secretRuntime");
    const vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    const manager = new ChannelManager(new ChannelInboxSink(), ":memory:");
    // create a channel with valid cred, then delete cred to simulate vault failure
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "valid_secret_123456" });
    // manually add channel then delete credential
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    // delete credential to cause vault failure on test
    vault.deleteCredential(credentialRef);
    // Now testChannel should try resolveSecret and fail, returning code
    const res = await manager.testChannel(cfg.id);
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(isChannelErrorCode(res.error)).toBe(true);
    expect(res.error).not.toContain(" ");
    // specifically should be QQ_AUTH_FAILED or mapped code, not raw message with spaces
    expect(["QQ_AUTH_FAILED", "QQ_NETWORK_ERROR", "QQ_RATE_LIMITED", "QQ_GATEWAY_DISCONNECTED"]).toContain(res.error);
  });

  it("CASE 10 testConnectionForInput missing appId returns INVALID_INPUT", async () => {
    const { ChannelManager } = await import("@/src/main/channels/manager");
    const { ChannelInboxSink } = await import("@/src/main/channels/inboxSink");
    const { SecretVault } = await import("@/lib/secrets/secretVault");
    const { InMemorySecretStore } = await import("@/lib/secrets/secretStore");
    const { MockSafeStorage } = await import("@/lib/secrets/safeStorage");
    const secretRuntime = await import("@/src/main/secrets/secretRuntime");
    const vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    const manager = new ChannelManager(new ChannelInboxSink(), ":memory:");
    const res1 = await manager.testConnectionForInput({ appId: "", credentialRef: "" });
    expect(res1.ok).toBe(false);
    expect(res1.error).toBe("INVALID_INPUT");
    const res2 = await manager.testConnectionForInput({ appId: "123", credentialRef: "" });
    expect(res2.error).toBe("INVALID_INPUT");
    const res3 = await manager.testConnectionForInput({ appId: "", credentialRef: "cred_abc" });
    expect(res3.error).toBe("INVALID_INPUT");
  });

  it("CASE 11 all failure returns are ChannelErrorCode (static audit)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/channels/manager.ts"), "utf8");
    // Check early return for testConnectionForInput is INVALID_INPUT
    expect(src).toContain('return { ok: false, error: "INVALID_INPUT" }');
    expect(src).not.toContain('return { ok: false, error: "appId/credentialRef required" }');
    // Check testChannel vault failure returns code
    // Should have error: mapped.code not mapped.message for first catch
    const hasMappedMessageBug = src.includes('return { ok: false, error: mapped.message }');
    expect(hasMappedMessageBug).toBe(false);
    // Ensure all testChannel error assignments are via mapped.code or parsed.code
    expect(src).toContain('return { ok: false, error: mapped.code }');
  });

  it("channelErrorToIpc is dead helper (imported but not used)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ipcSrc = fs.readFileSync(path.join(process.cwd(), "src/main/channels/ipc.ts"), "utf8");
    // channelErrorToIpc is imported but not called; toIpcError is used
    expect(ipcSrc).toContain('channelErrorToIpc');
    // Check that toIpcError is the actual handler, and channelErrorToIpc has no call sites
    const managerUsage = ipcSrc.match(/channelErrorToIpc\s*\(/g);
    expect(managerUsage).toBeNull();
  });
});
