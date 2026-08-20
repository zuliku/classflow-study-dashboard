/**
 * Channel Manager — Task 13B closure
 * Load configs, start enabled channels, stop/restart/list, registry abstraction
 * Fixes: atomic persistence with rollback, load logging, real TokenManager test with timeout, credential ownership, auto start non-blocking
 */

import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import type { ChannelHealth } from "./types";
import type { ChannelType } from "./types";
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
    registerChannelFactory("qq-bot", () => {
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
    } catch (e) {
      console.warn(`[channel] config load failed path=${getChannelConfigPath()} code=${(e as Error).message.slice(0, 100)}`);
      // Don't crash App; keep empty configs, UI health will show disconnected
    }
  }

  private async persistConfigsAtomic(): Promise<void> {
    try {
      ensureChannelDir();
      const data = JSON.stringify({ channels: Array.from(this.configs.values()) }, null, 2);
      const tmp = join(dirname(this.configPath), `.channels-tmp-${randomUUID().slice(0, 8)}`);
      await fs.writeFile(tmp, data, "utf8");
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
    // Atomic with rollback
    const backup = new Map(this.configs);
    this.configs.set(id, cfg);
    try {
      await this.persistConfigsAtomic();
    } catch (e) {
      this.configs = backup;
      throw e;
    }
    return cfg;
  }

  async updateChannel(id: string, patch: Partial<PersistedChannelConfig>): Promise<PersistedChannelConfig> {
    const existing = this.configs.get(id);
    if (!existing) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    if (patch.credentialRef && patch.credentialRef !== existing.credentialRef) {
      try {
        const vault = getRuntimeSecretVault();
        vault.resolveSecretForProvider(patch.credentialRef, "qq-bot");
      } catch {
        throw new ChannelError("QQ_AUTH_FAILED", "新凭据不存在");
      }
    }
    const updated: PersistedChannelConfig = { ...existing, ...patch, id: existing.id, channel: "qq-bot" as const };
    const validated = validateQQChannelConfig(updated);
    if (!validated.ok) throw new ChannelError("QQ_INVALID_CONFIG", validated.message);
    const backup = new Map(this.configs);
    this.configs.set(id, updated);
    try {
      await this.persistConfigsAtomic();
    } catch (e) {
      this.configs = backup;
      throw e;
    }
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
    const backup = new Map(this.configs);
    // Create new object to avoid mutating backup reference
    const updated = { ...cfg, enabled };
    this.configs.set(id, updated);
    try {
      await this.persistConfigsAtomic();
    } catch (e) {
      this.configs = backup;
      throw e;
    }
    if (!enabled) {
      const adapter = this.adapters.get(id);
      if (adapter) {
        await adapter.stop().catch(() => {});
        this.adapters.delete(id);
      }
    }
  }

  async connect(id: string): Promise<void> {
    const cfg = this.configs.get(id);
    if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    if (!cfg.enabled) throw new ChannelError("CHANNEL_DISABLED", "Channel disabled");
    let appSecret: string;
    try {
      const vault = getRuntimeSecretVault();
      appSecret = vault.resolveSecretForProvider(cfg.credentialRef, "qq-bot");
    } catch {
      throw new ChannelError("QQ_AUTH_FAILED", "无法解析 AppSecret");
    }
    let secretToClear = appSecret;
    try {
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
    } finally {
      // Release secret memory
      secretToClear = "";
      appSecret = "";
    }
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) return;
    await adapter.stop();
    this.adapters.delete(id);
  }

  private mapTokenError(e: unknown): { code: string; message: string } {
    const raw = e instanceof Error ? e.message : String(e);
    if (raw.includes("timeout") || raw.includes("Timeout")) return { code: "QQ_NETWORK_ERROR", message: "连接超时" };
    if (raw.includes("401") || raw.includes("auth") || raw.includes("QQ_AUTH_FAILED") || raw.toLowerCase().includes("credential") || raw.toLowerCase().includes("secret")) return { code: "QQ_AUTH_FAILED", message: "QQ 机器人认证失败" };
    if (raw.toLowerCase().includes("rate")) return { code: "QQ_RATE_LIMITED", message: "请求过于频繁" };
    if (raw.includes("QQ_GATEWAY_DISCONNECTED")) return { code: "QQ_GATEWAY_DISCONNECTED", message: "网关连接失败" };
    return { code: "QQ_NETWORK_ERROR", message: raw.slice(0, 200) };
  }

  async testChannel(id: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.configs.get(id);
    if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND", `Channel not found: ${id}`);
    let secret: string;
    try {
      const vault = getRuntimeSecretVault();
      secret = vault.resolveSecretForProvider(cfg.credentialRef, "qq-bot");
    } catch (e) {
      const mapped = this.mapTokenError(e);
      return { ok: false, error: mapped.message };
    }
    // Real token fetch with timeout 10s, not just existence
    try {
      const { TokenManager } = await import("@tencent-connect/qqbot-nodejs/protocol") as unknown as { TokenManager: new (opts?: unknown) => { getAccessToken: (a: string, s: string) => Promise<string>; clearCache: (a?: string) => void } };
      const tm = new TokenManager();
      const tokenPromise = tm.getAccessToken(cfg.appId, secret);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(JSON.stringify({ code: "QQ_NETWORK_ERROR", message: "Test connection timeout" }))), 10_000));
      await Promise.race([tokenPromise, timeoutPromise]);
      try { tm.clearCache(cfg.appId); } catch {}
      secret = "";
      return { ok: true };
    } catch (e) {
      secret = "";
      const mapped = this.mapTokenError(e);
      // Preserve specific code in message for caller, but return ok false
      try {
        const parsed = JSON.parse((e as Error).message) as { code?: string };
        if (parsed.code) return { ok: false, error: parsed.code };
      } catch {}
      return { ok: false, error: mapped.code };
    }
  }

  async testConnectionForInput(input: { appId: string; credentialRef: string }): Promise<{ ok: boolean; error?: string }> {
    if (!input.appId || !input.credentialRef) return { ok: false, error: "appId/credentialRef required" };
    let secret: string;
    try {
      const vault = getRuntimeSecretVault();
      secret = vault.resolveSecretForProvider(input.credentialRef, "qq-bot");
    } catch (e) {
      const mapped = this.mapTokenError(e);
      return { ok: false, error: mapped.code };
    }
    try {
      const { TokenManager } = await import("@tencent-connect/qqbot-nodejs/protocol") as unknown as { TokenManager: new (opts?: unknown) => { getAccessToken: (a: string, s: string) => Promise<string>; clearCache: (a?: string) => void } };
      const tm = new TokenManager();
      const tokenPromise = tm.getAccessToken(input.appId, secret);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(JSON.stringify({ code: "QQ_NETWORK_ERROR", message: "Test connection timeout" }))), 10_000));
      await Promise.race([tokenPromise, timeoutPromise]);
      try { tm.clearCache(input.appId); } catch {}
      secret = "";
      return { ok: true };
    } catch (e) {
      secret = "";
      const mapped = this.mapTokenError(e);
      try {
        const parsed = JSON.parse((e as Error).message) as { code?: string };
        if (parsed.code) return { ok: false, error: parsed.code };
      } catch {}
      return { ok: false, error: mapped.code };
    }
  }

  async removeChannel(id: string): Promise<void> {
    const cfg = this.configs.get(id);
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.stop().catch(() => {});
      this.adapters.delete(id);
    }
    if (!cfg) return;
    const credentialRef = cfg.credentialRef;
    const backup = new Map(this.configs);
    this.configs.delete(id);
    try {
      await this.persistConfigsAtomic();
    } catch (e) {
      this.configs = backup;
      throw e;
    }
    // Credential ownership: if no other channel references same credentialRef, delete it
    const stillReferenced = Array.from(this.configs.values()).some((c) => c.credentialRef === credentialRef);
    if (!stillReferenced) {
      try {
        const vault = getRuntimeSecretVault();
        vault.deleteCredential(credentialRef);
      } catch {}
    }
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
    // Each channel independent, one fail shouldn't block others or App
    const promises = Array.from(this.configs.values())
      .filter((c) => c.enabled)
      .map((cfg) =>
        this.connect(cfg.id).catch((e) => {
          console.warn(`[channel] auto-start ${cfg.id} failed`, (e as Error).message);
        })
      );
    await Promise.allSettled(promises);
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
