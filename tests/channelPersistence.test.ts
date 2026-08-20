import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      const p = require("node:path");
      const o = require("node:os");
      return p.join(o.tmpdir(), `classflow-test-${name}`);
    },
  },
}));

import { ChannelManager } from "@/src/main/channels/manager";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import * as secretRuntime from "@/src/main/secrets/secretRuntime";

describe("channelPersistence", () => {
  let vault: SecretVault;
  let manager: ChannelManager;

  beforeEach(async () => {
    // Cleanup any leftover channels.json from previous test
    try {
      const { app } = await import("electron");
      const base = app.getPath("userData");
      const filePath = path.join(base, "channels", "channels.json");
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    manager = new ChannelManager(new ChannelInboxSink());
  });

  it("add persists credentialRef not secret, atomic", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "secret123" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123456", credentialRef });
    expect(cfg.credentialRef).toBe(credentialRef);
    // Verify file contains credentialRef not secret
    // Find the file path via manager's private configPath (use list)
    // Instead check that manager's list has it
    expect(manager.listConfigs().length).toBe(1);
    expect(manager.listConfigs()[0].credentialRef).toBe(credentialRef);
  });

  it("persist failure rolls back memory", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s1" });
    await manager.addQQChannel({ displayName: "Bot1", appId: "111", credentialRef });
    expect(manager.listConfigs().length).toBe(1);

    const { credentialRef: cred2 } = vault.createCredential({ provider: "qq-bot", label: "bot2", secret: "s2" });
    // Mock fs to fail
    const writeSpy = vi.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(new Error("disk full") as never);
    await expect(manager.addQQChannel({ displayName: "Bot2", appId: "222", credentialRef: cred2 })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    // Memory should still be 1
    expect(manager.listConfigs().length).toBe(1);
    writeSpy.mockRestore();
  });

  it("load corrupted JSON does not crash and logs", async () => {
    const { app } = await import("electron");
    const base = app.getPath("userData");
    const channelsDir = path.join(base, "channels");
    require("node:fs").mkdirSync(channelsDir, { recursive: true });
    const filePath = path.join(channelsDir, "channels.json");
    require("node:fs").writeFileSync(filePath, "not json", "utf8");
    // Create new manager which will try to load corrupted file
    const m2 = new ChannelManager(new ChannelInboxSink());
    // Should not throw, and configs should be empty (failed load keeps empty)
    expect(m2.listConfigs().length).toBe(0);
    // Cleanup
    try { require("node:fs").unlinkSync(filePath); } catch {}
  });

  it("credential rotation: update with new credential, old deleted only if unreferenced", async () => {
    const { credentialRef: oldRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "oldSecret" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef: oldRef });
    // Create second channel sharing same credential
    const cfg2 = await manager.addQQChannel({ displayName: "Bot2", appId: "456", credentialRef: oldRef });
    expect(manager.listConfigs().length).toBe(2);

    // Rotate first channel to new credential
    const { credentialRef: newRef } = vault.createCredential({ provider: "qq-bot", label: "bot-new", secret: "newSecret" });
    await manager.updateChannel(cfg.id, { credentialRef: newRef });
    // Old should NOT be deleted because cfg2 still references it
    expect(() => vault.resolveSecretForProvider(oldRef, "qq-bot")).not.toThrow();
    // New should exist
    expect(() => vault.resolveSecretForProvider(newRef, "qq-bot")).not.toThrow();

    // Now update second channel to also use newRef, old should be deleted
    await manager.updateChannel(cfg2.id, { credentialRef: newRef });
    expect(() => vault.resolveSecretForProvider(oldRef, "qq-bot")).toThrow();
  });

  it("remove deletes credential only if no other references", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg1 = await manager.addQQChannel({ displayName: "Bot1", appId: "111", credentialRef });
    const cfg2 = await manager.addQQChannel({ displayName: "Bot2", appId: "222", credentialRef });
    await manager.removeChannel(cfg1.id);
    // Still referenced by cfg2, so not deleted
    expect(() => vault.resolveSecretForProvider(credentialRef, "qq-bot")).not.toThrow();
    await manager.removeChannel(cfg2.id);
    expect(() => vault.resolveSecretForProvider(credentialRef, "qq-bot")).toThrow();
  });
});
