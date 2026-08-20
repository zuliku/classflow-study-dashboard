/**
 * Invocation Trust — Task 12
 * Main Process 是唯一事实源，管理 Kiro Turn 的 Invocation Origin
 */

import { randomUUID } from "node:crypto";

export type InvocationOrigin = "local-user" | "remote-channel";

export type InvocationCapability =
  | "read"
  | "propose"
  | "write"
  | "delete"
  | "terminal"
  | "filesystem-write"
  | "computer-mutation"
  | "mcp-call";

export function isInvocationCapabilityAllowed(
  origin: InvocationOrigin,
  capability: InvocationCapability
): boolean {
  if (origin === "local-user") {
    // local-user 后续仍由 Agent Mode / Tool policy 约束，此处仅作 origin 层 allow
    return true;
  }
  // remote-channel: 仅 read/propose 允许，其余全部拒绝，workspace-auto 亦不覆盖
  if (capability === "read" || capability === "propose") return true;
  return false;
}

export interface InvocationTrustRecord {
  id: string;
  origin: InvocationOrigin;
  source?: "qq-bot" | "gmail" | "qq-mail";
  inboxItemId?: string;
  createdAt: number;
  expiresAt: number;
}

const INVOCATION_TTL_MS = 30 * 60 * 1000; // 30 分钟
const records = new Map<string, InvocationTrustRecord>();

export function beginInvocation(
  origin: InvocationOrigin,
  opts?: { source?: InvocationTrustRecord["source"]; inboxItemId?: string }
): string {
  const id = `inv_${randomUUID()}`;
  const now = Date.now();
  const rec: InvocationTrustRecord = {
    id,
    origin,
    source: opts?.source,
    inboxItemId: opts?.inboxItemId,
    createdAt: now,
    expiresAt: now + INVOCATION_TTL_MS,
  };
  records.set(id, rec);
  // 清理过期
  for (const [k, v] of records) {
    if (v.expiresAt < now) records.delete(k);
  }
  return id;
}

export function resolveInvocation(invocationId: string): InvocationTrustRecord | null {
  const rec = records.get(invocationId);
  if (!rec) return null;
  if (rec.expiresAt < Date.now()) {
    records.delete(invocationId);
    return null;
  }
  return rec;
}

export function resolveInvocationOrThrow(invocationId: string | undefined): InvocationTrustRecord {
  if (!invocationId) throw new Error(JSON.stringify({ code: "INVOCATION_REQUIRED", message: "invocationId required" }));
  const rec = records.get(invocationId);
  if (!rec) throw new Error(JSON.stringify({ code: "INVALID_INVOCATION", message: `Invalid invocation: ${invocationId}` }));
  if (rec.expiresAt < Date.now()) {
    records.delete(invocationId);
    throw new Error(JSON.stringify({ code: "INVOCATION_EXPIRED", message: `Invocation expired: ${invocationId}` }));
  }
  return rec;
}

export function getInvocationOrigin(invocationId?: string): InvocationOrigin {
  // Fail closed version for legacy callers: use resolveInvocationOrThrow instead
  if (!invocationId) throw new Error(JSON.stringify({ code: "INVOCATION_REQUIRED", message: "invocationId required" }));
  return resolveInvocationOrThrow(invocationId).origin;
}

export function clearExpiredInvocations(): void {
  const now = Date.now();
  for (const [k, v] of records) {
    if (v.expiresAt < now) records.delete(k);
  }
}

// 仅测试
export function __clearAllInvocationsForTest(): void {
  records.clear();
}

export function __getInvocationCountForTest(): number {
  return records.size;
}
