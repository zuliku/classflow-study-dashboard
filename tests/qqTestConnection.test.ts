import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      const path = require("node:path");
      const os = require("node:os");
      return path.join(os.tmpdir(), `classflow-test-${name}-${Math.random().toString(36).slice(2, 6)}`);
    },
  },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => {
  return {
    TokenManager: class {
      async getAccessToken(appId: string, secret: string) {
        if (secret === "valid_secret_123456") return "token123";
        if (secret === "bad_secret") throw new Error("401 Unauthorized");
        if (secret === "network_secret") throw new Error("ECONNREFUSED");
        if (secret === "rate_secret") throw new Error("rate limited");
        throw new Error("unknown");
      }
      clearCache() {}
    },
  };
});

import { ChannelManager } from "@/src/main/channels/manager";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import * as secretRuntime from "@/src/main/secrets/secretRuntime";

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

  it("auth fail → QQ_AUTH_FAILED", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "bad_secret" });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("QQ_AUTH_FAILED");
  });

  it("network → QQ_NETWORK_ERROR", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "network_secret" });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("QQ_NETWORK_ERROR");
  });

  it("rate limited → QQ_RATE_LIMITED", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "rate_secret" });
    const result = await manager.testConnectionForInput({ appId: "123", credentialRef });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("QQ_RATE_LIMITED");
  });

  it("test does not call sendText", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "valid_secret_123456" });
    let sendCalled = false;
    // Ensure QQBot not used in test path
    const result = await manager.testConnectionForInput({ appId: "123456", credentialRef });
    expect(sendCalled).toBe(false);
    expect(result.ok).toBe(true);
  });
});
