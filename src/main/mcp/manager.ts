/**
 * MCP Manager — Task 09
 * 管理多个 Remote MCP 连接（Streamable HTTP）
 */

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { McpConnection } from "@/src/main/mcp/connection";
import { validateMcpUrl } from "@/src/main/mcp/transport";
import type { McpConnectionConfig } from "@/src/main/mcp/types";

function getMcpConfigPath(): string {
  return join(app.getPath("userData"), "mcp", "connections.json");
}

function ensureMcpDir(): void {
  mkdirSync(dirname(getMcpConfigPath()), { recursive: true });
}

export class McpManager {
  private connections = new Map<string, McpConnection>();
  private configPath: string;

  constructor() {
    this.configPath = getMcpConfigPath();
    this.loadConfigsSync();
  }

  private loadConfigsSync(): void {
    try {
      ensureMcpDir();
      if (!existsSync(this.configPath)) return;
      const raw = require("node:fs").readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as { connections?: McpConnectionConfig[] };
      if (Array.isArray(parsed.connections)) {
        for (const cfg of parsed.connections) {
          if (cfg.id && cfg.endpoint && cfg.name) {
            this.connections.set(cfg.id, new McpConnection(cfg));
          }
        }
      }
    } catch {}
  }

  private persistConfigs(): void {
    try {
      ensureMcpDir();
      const data = JSON.stringify({ connections: Array.from(this.connections.values()).map((c) => c.config) }, null, 2);
      const tmp = join(dirname(this.configPath), `.connections-tmp-${randomUUID().slice(0, 8)}`);
      require("node:fs").writeFileSync(tmp, data, "utf8");
      require("node:fs").renameSync(tmp, this.configPath);
    } catch {}
  }

  listConnections(): Array<{ config: McpConnectionConfig; state: string; serverInfo: unknown; toolCount: number; resourceCount: number; promptCount: number; error?: string }> {
    return Array.from(this.connections.values()).map((c) => ({
      config: c.config,
      state: c.state,
      serverInfo: c.serverInfo,
      toolCount: c.tools.length,
      resourceCount: c.resources.length,
      promptCount: c.prompts.length,
      error: c.errorMessage,
    }));
  }

  getConnection(id: string): McpConnection | undefined {
    return this.connections.get(id);
  }

  async addConnection(input: { name: string; endpoint: string; credentialRef?: string }): Promise<McpConnection> {
    const validation = validateMcpUrl(input.endpoint, { allowLocalHttp: process.env.NODE_ENV === "development" });
    if (!validation.ok) throw new Error(JSON.stringify({ code: "INVALID_URL", message: validation.reason }));
    const id = `mcp_${randomUUID().slice(0, 8)}`;
    const config: McpConnectionConfig = {
      id,
      name: input.name,
      endpoint: input.endpoint,
      credentialRef: input.credentialRef,
      enabled: true,
    };
    const conn = new McpConnection(config);
    this.connections.set(id, conn);
    this.persistConfigs();
    return conn;
  }

  async testConnection(endpoint: string, credentialRef?: string): Promise<{ ok: boolean; serverInfo?: unknown; tools?: unknown[]; error?: string }> {
    const validation = validateMcpUrl(endpoint, { allowLocalHttp: process.env.NODE_ENV === "development" });
    if (!validation.ok) return { ok: false, error: validation.reason };
    const tmpConfig: McpConnectionConfig = {
      id: `tmp_${randomUUID().slice(0, 8)}`,
      name: "test",
      endpoint,
      credentialRef,
      enabled: true,
    };
    const conn = new McpConnection(tmpConfig);
    try {
      await conn.connect();
      return { ok: true, serverInfo: conn.serverInfo, tools: conn.tools };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      await conn.disconnect().catch(() => {});
    }
  }

  async connect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Connection not found: ${id}` }));
    if (!conn.config.enabled) throw new Error(JSON.stringify({ code: "DISABLED", message: "Connection disabled" }));
    await conn.connect();
  }

  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Connection not found: ${id}` }));
    await conn.disconnect();
  }

  async removeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (conn) {
      await conn.disconnect().catch(() => {});
      this.connections.delete(id);
      this.persistConfigs();
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Connection not found: ${id}` }));
    conn.config.enabled = enabled;
    if (!enabled) await conn.disconnect().catch(() => {});
    this.persistConfigs();
  }

  getConnectionsMap(): Map<string, McpConnection> {
    return this.connections;
  }

  async disconnectAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      await conn.disconnect().catch(() => {});
    }
  }
}

let manager: McpManager | null = null;

export function getMcpManager(): McpManager {
  if (!manager) manager = new McpManager();
  return manager;
}

export function __resetMcpManagerForTest(): void {
  manager = null;
}
