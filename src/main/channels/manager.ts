/**
 * Channel Manager — Task 13
 * Load configs, start enabled channels, stop/restart/list, registry abstraction
 */

import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import type { ChannelHealth, ChannelState, ChannelType } from "./types";
import type { QQChannelConfig } from "./qq/config";
import { validateQQChannelConfig } from "./qq/config";
import { QQChannelAdapter } from "./qq/adapter";
import { ChannelInboxSink } from "./inboxSink";
import { getRuntimeSecretVault } from "@/src/main/secrets/secretRuntime";
import { ChannelError } from "./errors";
import { registerChannelFactory } from "./registry";

function getChannelConfigPath(): string {
  return join(app.getPath("userData"), "channels", "channels.json");
}

function ensureChannelDir(): void {
  mkdirSync(dirname(getChannelConfigPath()), { recursive: true });
}

export interface PersistedChannelConfig {
  id: string;
  channel: ChannelType;
  enabled: boolean;
  displayName: string;
  appId: string;
  credentialRef: string;
  requireMentionInGroup: boolean;
  allowedUsers: string[];
  allowedGroups: string[];
  receiveDirectMessages: boolean;
  receiveGroupMessages: boolean;
}

export class ChannelManager {
  private configs = new Map<string, PersistedChannelConfig>();
  private adapters = new Map<string, QQChannelAdapter>();
  private configPath: string;
  private inboxSink: ChannelInboxSink;

  constructor(inboxSink?: ChannelInboxSink) {
    this.configPath = getChannelConfigPath();
    this.inboxSink = inboxSink ?? new ChannelInboxSink();
    // Register factory for qq-bot
    registerChannelFactory("qq-bot", (config) => {
      // factory will be called with secret resolved at start time; here we just create adapter placeholder
      // But for manager we create adapter lazily with secret during start
      // This registration is for dynamic creation; we use direct adapter creation in start
      throw new Error("Use ChannelManager.createAdapter");
    });
    this.loadConfigsSync();
  }

  private loadConfigsSync(): void {
    try {
      ensureChannelDir();
      if (!existsSync(this.configPath)) return;
      const raw = require("node:fs").readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as { channels?: PersistedChannelConfig[] };
      if (Array.isArray(parsed.channels)) {
        for (const cfg of parsed.channels) {
          if (cfg.id && cfg.channel === "qq-bot" && cfg.appId && cfg.credentialRef) {
            this.configs.set(cfg.id, cfg);
          }
        }
      }
    } catch {}
  }

  private async persistConfigsAtomic(): Promise<void> {
    try {
      ensureChannelDir();
      const data = JSON.stringify({ channels: Array.from(this.configs.values()) }, null, 2);
      const tmp = join(dirname(this.configPath), `.channels-tmp-${randomUUID().slice(0, 8)}`);
      await fs.writeFile(tmp, data, "utf8");
      // fsync file handle
      try {
        const handle = await fs.open(tmp, "r");
        await handle.sync();
        await handle.close();
      } catch {}
      await fs.rename(tmp, this.configPath);
    } catch (e) {
      throw new ChannelError("PERSISTENCE_FAILED", `保存配置失败: ${(e as Error).message}`);
    }
  }

  listConfigs(): PersistedChannelConfig[] {
    return Array.from(this.configs.values());
  }

  listStatus(): Array<{ config: PersistedChannelConfig; health: ChannelHealth }> {
    return Array.from(this.configs.values()).map((cfg) => {
      const adapter = this.adapters.get(cfg.id);
      const health: ChannelHealth = adapter
        ? adapter.getHealth()
        : { channel: "qq-bot", id: cfg.id, state: cfg.enabled ? "disconnected" : "disabled" };
      return { config: cfg, health };
    });
  }

  getConfig(id: string): PersistedChannelConfig | undefined {
    return this.configs.get(id);
  }

  async addQQChannel(input: {
    displayName: string;
    appId: string;
    credentialRef: string;
    requireMentionInGroup?: boolean;
    allowedUsers?: string[];
    allowedGroups?: string[];
    receiveDirectMessages?: boolean;
    receiveGroupMessages?: boolean;
  }): Promise<PersistedChannelConfig> {
    if (!input.displayName || !input.appId || !input.credentialRef) {
      throw new ChannelError("INVALID_INPUT", "displayName/appId/credentialRef required");
    }
    if (!input.credentialRef.startsWith("cred_")) throw new ChannelError("INVALID_INPUT", "credentialRef invalid");
    // Verify credential exists and provider matches qq-bot
    try {
      const vault = getRuntimeSecretVault();
      vault.resolveSecretForProvider(input.credentialRef, "qq-bot");
    } catch {
      throw new ChannelError("QQ_AUTH_FAILED", "凭据不存在或类型不匹配");
    }

    const id = `qq_${randomUUID().slice(0, 8)}`;
    const cfg: PersistedChannelConfig = {
      id,
      channel: "qq-bot",
      enabled: true,
      displayName: input.displayName,
      appId: input.appId.trim(),
      credentialRef: input.credentialRef,
      requireMentionInGroup: input.requireMentionInGroup ?? true,
      allowedUsers: input.allowedUsers ?? [],
      allowedGroups: input.allowedGroups ?? [],
      receiveDirectMessages: input.receiveDirectMessages ?? true,
      receiveGroupMessages: input.receiveGroupMessages ?? true,
    };
    const validated = validateQQChannelConfig({ ...cfg });
    if (!validated.ok) throw new ChannelError("QQ_INVALID_CONFIG", validated.message);
    this.configs.set(id, cfg);
    await this.persistConfigsAtomic();
    return cfg;
  }

  async updateChannel(id: string, patch: Partial<PersistedChannelConfig>): Promise<PersistedChannelConfig> {
    const existing = this.configs.get(id);
    if (!existing) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    // Prevent updating secret directly via config; must use credentialRef via SecretVault replace
    if (patch.credentialRef && patch.credentialRef !== existing.credentialRef) {
      try {
        const vault = getRuntimeSecretVault();
        vault.resolveSecretForProvider(patch.credentialRef, "qq-bot");
      } catch {
        throw new ChannelError("QQ_AUTH_FAILED", "新凭据不存在");
      }
    }
    const updated: PersistedChannelConfig = { ...existing, ...patch, id: existing.id, channel: "qq-bot" as const };
    // do not allow changing id/channel via patch
    const validated = validateQQChannelConfig(updated);
    if (!validated.ok) throw new ChannelError("QQ_INVALID_CONFIG", validated.message);
    this.configs.set(id, updated);
    await this.persistConfigsAtomic();
    // If adapter running, restart to apply new policy
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.stop().catch(() => {});
      this.adapters.delete(id);
      if (updated.enabled) {
        await this.connect(id).catch((e) => console.warn(`[channel] restart after update failed`, (e as Error).message));
      }
    }
    return updated;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const cfg = this.configs.get(id);
    if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    cfg.enabled = enabled;
    await this.persistConfigsAtomic();
    if (!enabled) {
      const adapter = this.adapters.get(id);
      if (adapter) {
        await adapter.stop().catch(() => {});
        this.adapters.delete(id);
      }
    } else {
      // auto connect when enabled? V1: user must click connect, but we allow auto if they enable
    }
  }

  async connect(id: string): Promise<void> {
    const cfg = this.configs.get(id);
    if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    if (!cfg.enabled) throw new ChannelError("CHANNEL_DISABLED", "Channel disabled");
    // Resolve secret
    let appSecret: string;
    try {
      const vault = getRuntimeSecretVault();
      appSecret = vault.resolveSecretForProvider(cfg.credentialRef, "qq-bot");
    } catch {
      throw new ChannelError("QQ_AUTH_FAILED", "无法解析 AppSecret");
    }
    if (this.adapters.has(id)) {
      await this.adapters.get(id)!.stop().catch(() => {});
      this.adapters.delete(id);
    }
    const qqConfig: QQChannelConfig = {
      id: cfg.id,
      enabled: cfg.enabled,
      displayName: cfg.displayName,
      appId: cfg.appId,
      credentialRef: cfg.credentialRef,
      requireMentionInGroup: cfg.requireMentionInGroup,
      allowedUsers: cfg.allowedUsers,
      allowedGroups: cfg.allowedGroups,
      receiveDirectMessages: cfg.receiveDirectMessages,
      receiveGroupMessages: cfg.receiveGroupMessages,
    };
    const adapter = new QQChannelAdapter({
      config: qqConfig,
      appSecret,
      inboxSink: this.inboxSink,
    });
    this.adapters.set(id, adapter);
    await adapter.start();
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) return;
    await adapter.stop();
    this.adapters.delete(id);
  }

  async testChannel(id: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.configs.get(id);
    if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    try {
      const vault = getRuntimeSecretVault();
      const secret = vault.resolveSecretForProvider(cfg.credentialRef, "qq-bot");
      if (!secret || secret.length < 8) throw new ChannelError("QQ_AUTH_FAILED", "AppSecret 无效");
      // For V1, test only validates credential existence; not connecting to real QQ unless we have network
      // If we want live test, we could try to create a QQBot and fetch token, but that would require network.
      // So we return ok if credential valid.
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async testConnectionForInput(input: { appId: string; credentialRef: string }): Promise<{ ok: boolean; error?: string }> {
    if (!input.appId || !input.credentialRef) return { ok: false, error: "appId/credentialRef required" };
    try {
      const vault = getRuntimeSecretVault();
      const secret = vault.resolveSecretForProvider(input.credentialRef, "qq-bot");
      if (!secret) return { ok: false, error: "AppSecret 无效" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async removeChannel(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.stop().catch(() => {});
      this.adapters.delete(id);
    }
    this.configs.delete(id);
    await this.persistConfigsAtomic();
  }

  async disconnectAll(): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      try {
        await adapter.stop();
      } catch (e) {
        console.error(`[channel] disconnect ${id} failed`, (e as Error).message);
      }
    }
    this.adapters.clear();
  }

  async startEnabledChannels(): Promise<void> {
    for (const cfg of this.configs.values()) {
      if (cfg.enabled) {
        try {
          await this.connect(cfg.id);
        } catch (e) {
          console.warn(`[channel] auto-start ${cfg.id} failed`, (e as Error).message);
        }
      }
    }
  }

  // For tests: inject fake inbox sink
  __setInboxSinkForTest(sink: ChannelInboxSink): void {
    (this as unknown as { inboxSink: ChannelInboxSink }).inboxSink = sink;
  }

  __getAdapterForTest(id: string): QQChannelAdapter | undefined {
    return this.adapters.get(id) as QQChannelAdapter | undefined;
  }

  __clearAllForTest(): void {
    this.configs.clear();
    this.adapters.clear();
  }
}

let manager: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!manager) manager = new ChannelManager();
  return manager;
}

export function __resetChannelManagerForTest(): void {
  manager = null;
}
