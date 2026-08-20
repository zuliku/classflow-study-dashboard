/**
 * MCP Connection — Single Remote MCP via Streamable HTTP
 */

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { validateMcpUrl } from "@/src/main/mcp/transport";
import { getRuntimeSecretVault } from "@/src/main/secrets/secretRuntime";
import type { McpConnectionConfig, McpConnectionState, McpServerInfo, McpTool, McpResource, McpPrompt } from "@/src/main/mcp/types";

export class McpConnection {
  public config: McpConnectionConfig;
  public state: McpConnectionState = "disconnected";
  public serverInfo: McpServerInfo | null = null;
  public tools: McpTool[] = [];
  public resources: McpResource[] = [];
  public prompts: McpPrompt[] = [];
  public errorMessage?: string;

  private client: InstanceType<typeof Client> | null = null;
  private transport: InstanceType<typeof StreamableHTTPClientTransport> | null = null;

  constructor(config: McpConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.state === "connecting") return;
    this.state = "connecting";
    this.errorMessage = undefined;

    // URL 校验（SSRF 防护）
    const validation = validateMcpUrl(this.config.endpoint, { allowLocalHttp: process.env.NODE_ENV === "development" });
    if (!validation.ok) {
      this.state = "error";
      this.errorMessage = validation.reason;
      throw new Error(validation.reason);
    }

    // 凭据解析（SecretVault，禁止明文进 Zustand）
    let token: string | undefined;
    if (this.config.credentialRef) {
      try {
        const vault = getRuntimeSecretVault();
        token = vault.resolveSecretForProvider(this.config.credentialRef, "mcp");
      } catch (e) {
        this.state = "error";
        this.errorMessage = (e as Error).message;
        throw e;
      }
    }

    const url = new URL(this.config.endpoint);
    const authProvider = token
      ? {
          token: async () => token as string,
        }
      : undefined;

    this.client = new Client({ name: "classflow-desktop", version: "1.0.0" });
    this.transport = new StreamableHTTPClientTransport(url, {
      authProvider: authProvider as never,
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    } as never);

    try {
      // 官方 SDK 负责 2026-07-28 的 Streamable HTTP + session
      await this.client.connect(this.transport as never);
      this.serverInfo = {
        name: (this.client.getServerVersion() as { name?: string } | undefined)?.name ?? "Unknown",
        version: (this.client.getServerVersion() as { version?: string } | undefined)?.version ?? "",
        instructions: (this.client.getInstructions() as string | undefined) ?? undefined,
      };
      // 发现 Tools / Resources / Prompts
      await this.discover();
      this.state = "connected";
    } catch (e) {
      this.state = "error";
      this.errorMessage = (e as Error).message;
      await this.cleanup();
      throw e;
    }
  }

  async discover(): Promise<void> {
    if (!this.client || this.state !== "connected") return;
    try {
      const toolsRes = await this.client.listTools();
      this.tools = ((toolsRes as { tools?: McpTool[] }).tools ?? []).map((t) => ({
        name: t.name,
        description: (t as { description?: string }).description ?? "",
        inputSchema: (t as { inputSchema?: unknown }).inputSchema,
        annotations: (t as { annotations?: McpTool["annotations"] }).annotations,
      }));
    } catch {
      this.tools = [];
    }
    try {
      const resRes = await this.client.listResources();
      this.resources = ((resRes as { resources?: McpResource[] }).resources ?? []).map((r) => ({
        uri: r.uri,
        name: (r as { name?: string }).name ?? r.uri,
        description: (r as { description?: string }).description,
        mimeType: (r as { mimeType?: string }).mimeType,
      }));
    } catch {
      this.resources = [];
    }
    try {
      const promptsRes = await this.client.listPrompts();
      this.prompts = ((promptsRes as { prompts?: McpPrompt[] }).prompts ?? []).map((p) => ({
        name: p.name,
        description: (p as { description?: string }).description,
        arguments: (p as { arguments?: McpPrompt["arguments"] }).arguments,
      }));
    } catch {
      this.prompts = [];
    }
  }

  async callTool(toolName: string, args: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
    if (this.state !== "connected" || !this.client) {
      throw new Error("NOT_CONNECTED");
    }
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) throw new Error("TOOL_NOT_FOUND");
    if (!this.config.enabled) throw new Error("DISABLED");

    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args as Record<string, unknown> } as never,
        { signal } as never
      );
      // 标记为 untrusted external content（调用方需包装）
      return {
        _untrusted: true,
        _source: this.config.id,
        content: result,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanup();
    this.state = "disconnected";
    this.serverInfo = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.transport) {
        // terminate session if available
        const t = this.transport as { terminateSession?: () => Promise<void> };
        if (typeof t.terminateSession === "function") {
          await t.terminateSession().catch(() => {});
        }
      }
    } catch {}
    try {
      if (this.client) await this.client.close().catch(() => {});
    } catch {}
    this.client = null;
    this.transport = null;
  }

  isConnected(): boolean {
    return this.state === "connected" && !!this.client;
  }
}
