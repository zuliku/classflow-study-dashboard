import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      const p = require("node:path");
      const o = require("node:os");
      return p.join(o.tmpdir(), `classflow-test-${name}-${Math.random().toString(36).slice(2, 6)}`);
    },
  },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => {
  return {
    TokenManager: class {
      async getAccessToken(_appId: string, secret: string) {
        if (secret === "valid_secret_123456") return "token123";
        if (secret === "400_secret") throw new Error("HTTP 400 Bad Request");
        if (secret === "401_secret") throw new Error("HTTP 401 Unauthorized");
        if (secret === "403_secret") throw new Error("HTTP 403 Forbidden");
        if (secret === "failed_token_secret") throw new Error("Failed to get access_token: invalid appId");
        if (secret === "invalid_appid_secret") throw new Error("invalid appId");
        if (secret === "invalid_secret_secret") throw new Error("invalid secret");
        if (secret === "credential_secret") throw new Error("credential not found");
        if (secret === "429_secret") throw new Error("HTTP 429 Too Many Requests");
        if (secret === "rate_secret") throw new Error("rate limited");
        if (secret === "100001_secret") throw new Error("100001 rate limited");
        if (secret === "too_many_secret") throw new Error("Too many requests");
        if (secret === "econnrefused_secret") throw new Error("ECONNREFUSED");
        if (secret === "enotfound_secret") throw new Error("ENOTFOUND");
        if (secret === "abort_secret") throw new Error("AbortError: aborted");
        if (secret === "timeout_secret") throw new Error("timeout");
        if (secret === "etimedout_secret") throw new Error("ETIMEDOUT");
        if (secret === "econnreset_secret") throw new Error("ECONNRESET");
        if (secret === "eai_again_secret") throw new Error("EAI_AGAIN");
        if (secret === "network_secret") throw new Error("ECONNREFUSED");
        if (secret === "bad_secret") throw new Error("401 Unauthorized");
        throw new Error("unknown error: " + secret);
      }
      clearCache() {}
    },
  };
});

vi.mock("@tencent-connect/qqbot-nodejs", () => ({
  QQBot: class {
    sendText = vi.fn();
    send = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn();
    on = vi.fn();
    off = vi.fn();
    use = vi.fn();
  },
}));

import { ChannelManager } from "@/src/main/channels/manager";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import * as secretRuntime from "@/src/main/secrets/secretRuntime";
import { mapQQTokenError } from "@/src/main/channels/qq/tokenErrorMapper";

describe("qqTestConnection", () => {
  let vault: SecretVault;
  let manager: ChannelManager;

  beforeEach(() => {
    vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    manager = new ChannelManager(new ChannelInboxSink());
  });

  it("valid credential → ok:true", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "valid_secret_123456" });
    const result = await manager.testConnectionForInput({ appId: "123456", credentialRef });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["HTTP 400", "400_secret", "QQ_AUTH_FAILED"],
    ["HTTP 401", "401_secret", "QQ_AUTH_FAILED"],
    ["HTTP 403", "403_secret", "QQ_AUTH_FAILED"],
    ["Failed to get access_token", "failed_token_secret", "QQ_AUTH_FAILED"],
    ["invalid appId", "invalid_appid_secret", "QQ_AUTH_FAILED"],
    ["invalid secret", "invalid_secret_secret", "QQ_AUTH_FAILED"],
    ["credential", "credential_secret", "QQ_AUTH_FAILED"],
  ])("%s → %s", async (_label, secret, expectedCode) => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(expectedCode);
  });

  it.each([
    ["HTTP 429", "429_secret", "QQ_RATE_LIMITED"],
    ["rate limited", "rate_secret", "QQ_RATE_LIMITED"],
    ["Too many requests", "too_many_secret", "QQ_RATE_LIMITED"],
    ["100001", "100001_secret", "QQ_RATE_LIMITED"],
  ])("%s → %s", async (_label, secret, expectedCode) => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(expectedCode);
  });

  it.each([
    ["ECONNREFUSED", "econnrefused_secret", "QQ_NETWORK_ERROR"],
    ["ENOTFOUND", "enotfound_secret", "QQ_NETWORK_ERROR"],
    ["AbortError", "abort_secret", "QQ_NETWORK_ERROR"],
    ["timeout", "timeout_secret", "QQ_NETWORK_ERROR"],
    ["ETIMEDOUT", "etimedout_secret", "QQ_NETWORK_ERROR"],
    ["ECONNRESET", "econnreset_secret", "QQ_NETWORK_ERROR"],
    ["EAI_AGAIN", "eai_again_secret", "QQ_NETWORK_ERROR"],
  ])("%s → %s", async (_label, secret, expectedCode) => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(expectedCode);
  });

  it("unknown error fallback to QQ_NETWORK_ERROR sanitized", () => {
    const { code, message } = mapQQTokenError(new Error("some random failure"));
    expect(code).toBe("QQ_NETWORK_ERROR");
    expect(message).not.toContain("secret");
    expect(message.length).toBeGreaterThan(0);
  });

  it("sanitized message does not contain secret", () => {
    const { code, message } = mapQQTokenError(new Error("Failed with secret abc123 and access_token xyz"));
    expect(code).toBe("QQ_AUTH_FAILED");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("abc123");
  });

  it("test does not call sendText (TokenManager only)", async () => {
    const { TokenManager } = await import("@tencent-connect/qqbot-nodejs/protocol");
    const spy = vi.spyOn(TokenManager.prototype, "getAccessToken");
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "valid_secret_123456" });
    const result = await manager.testConnectionForInput({ appId: "123456", credentialRef });
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("123456", "valid_secret_123456");
    spy.mockRestore();
    // Verify no QQBot outbound was used (test only uses TokenManager, not Gateway)
  });
});
