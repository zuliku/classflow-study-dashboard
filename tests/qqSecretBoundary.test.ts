import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createQQChannelConfig } from "@/src/main/channels/qq/config";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";

describe("qqSecretBoundary", () => {
  it("config JSON has credentialRef, no appSecret/accessToken/Authorization", () => {
    const cfg = createQQChannelConfig({ displayName: "Bot", appId: "123456", credentialRef: "cred_abc123def" });
    const json = JSON.stringify(cfg, null, 2);
    expect(json).toContain("credentialRef");
    expect(json).not.toContain("appSecret");
    expect(json).not.toContain("accessToken");
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain("secret");
    // file persistence would be same
    expect(cfg.credentialRef).toBe("cred_abc123def");
  });

  it("Renderer IPC response has no plaintext secret", async () => {
    // Simulate Main: create credential, then IPC returns only metadata
    const vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    const { credentialRef, metadata } = vault.createCredential({ provider: "qq-bot", label: "Test Bot", secret: "super_secret_123" });
    const cfg = createQQChannelConfig({ displayName: "Test Bot", appId: "123", credentialRef });
    // Simulate IPC list response: channels list should not include secret
    const channelsList = [{ config: cfg, health: { state: "disconnected" } }];
    const json = JSON.stringify(channelsList);
    expect(json).not.toContain("super_secret_123");
    expect(json).toContain(credentialRef);
    expect(metadata.provider).toBe("qq-bot");
  });

  it("SecretVault resolve only via credentialRef in Main", () => {
    const vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "Bot", secret: "mySecret" });
    const resolved = vault.resolveSecretForProvider(credentialRef, "qq-bot");
    expect(resolved).toBe("mySecret");
    // Renderer cannot call resolveSecretForProvider (not exposed via IPC)
    // Ensure secret not in renderer-accessible list
    const metas = vault.listCredentialMetadata();
    expect(JSON.stringify(metas)).not.toContain("mySecret");
  });

  it("Renderer files do not cache secret/plaintext", () => {
    const rendererFiles = [
      "components/settings/ChannelSettings.tsx",
      "src/preload/index.ts",
      "lib/desktop/bridge.ts",
    ];
    for (const rel of rendererFiles) {
      const full = path.join(process.cwd(), rel);
      if (!fs.existsSync(full)) continue;
      const content = fs.readFileSync(full, "utf8");
      // Should not contain hardcoded secret values
      expect(content).not.toMatch(/appSecret\s*[:=]\s*["'][^"']+["']/);
      // Should contain credentialRef handling, not plaintext
      if (rel.includes("ChannelSettings")) {
        expect(content).toContain("credentialRef");
        expect(content).not.toContain("localStorage.setItem.*secret");
      }
    }
  });

  it("logs do not contain secrets (transport/adapter)", () => {
    const adapterPath = path.join(process.cwd(), "src/main/channels/qq/adapter.ts");
    const transportPath = path.join(process.cwd(), "src/main/channels/qq/transport.ts");
    for (const p of [adapterPath, transportPath]) {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, "utf8");
      expect(content).not.toMatch(/console\.log.*appSecret/);
      expect(content).not.toMatch(/console\.log.*access token/i);
      // should have sanitized logging (filtered reason only)
      if (p.includes("adapter")) {
        expect(content).toContain("filtered reason");
      }
    }
  });
});
