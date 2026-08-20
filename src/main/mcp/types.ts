/**
 * MCP Types — Task 09
 */

export type McpConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface McpConnectionConfig {
  id: string;
  name: string;
  endpoint: string;
  credentialRef?: string;
  enabled: boolean;
}

export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export interface McpToolAnnotations {
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  title?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: McpToolAnnotations;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export type McpToolRisk = "read-only" | "external-side-effect" | "destructive" | "unknown";
