/**
 * MCP Approval — Main Process
 * ApprovalRecord for side-effect MCP tools
 */

import { randomUUID } from "node:crypto";

export interface McpApprovalRecord {
  id: string;
  invocationId: string;
  connectionId: string;
  toolName: string;
  arguments: unknown;
  argumentsHash: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const APPROVAL_TTL_MS = 10 * 60 * 1000; // 10 分钟
const records = new Map<string, McpApprovalRecord>();

function hashArgs(args: unknown): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

export function createMcpApproval(input: {
  invocationId: string;
  connectionId: string;
  toolName: string;
  arguments: unknown;
}): McpApprovalRecord {
  const id = `mcp_approval_${randomUUID()}`;
  const now = Date.now();
  const rec: McpApprovalRecord = {
    id,
    invocationId: input.invocationId,
    connectionId: input.connectionId,
    toolName: input.toolName,
    arguments: input.arguments,
    argumentsHash: hashArgs(input.arguments),
    createdAt: now,
    expiresAt: now + APPROVAL_TTL_MS,
    used: false,
  };
  records.set(id, rec);
  // 清理过期
  for (const [k, v] of records) {
    if (v.expiresAt < now) records.delete(k);
  }
  return rec;
}

export function getMcpApproval(id: string): McpApprovalRecord | undefined {
  const rec = records.get(id);
  if (!rec) return undefined;
  if (rec.expiresAt < Date.now()) {
    records.delete(id);
    return undefined;
  }
  return rec;
}

export function consumeMcpApproval(id: string): McpApprovalRecord | null {
  const rec = getMcpApproval(id);
  if (!rec) return null;
  if (rec.used) return null;
  rec.used = true;
  records.set(id, rec);
  return rec;
}

export function __clearAllMcpApprovalsForTest(): void {
  records.clear();
}

export function __getMcpApprovalCountForTest(): number {
  return records.size;
}
