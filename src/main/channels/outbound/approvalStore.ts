/**
 * Channel Send Approval Store — ephemeral, 5min TTL, one-shot, immutable
 */

import { randomUUID, createHash } from "node:crypto";
import type { ChannelSendApproval } from "./types";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export class ApprovalStore {
  private approvals = new Map<string, ChannelSendApproval>();
  private ttlMs = 5 * 60 * 1000;

  create(replyContextId: string, text: string): ChannelSendApproval {
    const now = Date.now();
    const approval: ChannelSendApproval = {
      approvalId: `send_${randomUUID()}`,
      replyContextId,
      text,
      textHash: hashText(text),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      used: false,
    };
    this.approvals.set(approval.approvalId, approval);
    return { ...approval };
  }

  get(id: string): ChannelSendApproval | undefined {
    const a = this.approvals.get(id);
    if (!a) return undefined;
    if (a.expiresAt < Date.now()) {
      this.approvals.delete(id);
      return undefined;
    }
    return a;
  }

  consume(id: string): ChannelSendApproval | null {
    const a = this.get(id);
    if (!a) return null;
    if (a.used) return null;
    a.used = true;
    this.approvals.set(id, a);
    return { ...a };
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [id, a] of this.approvals) {
      if (a.expiresAt < now) this.approvals.delete(id);
    }
  }

  cancel(id: string): boolean {
    const a = this.get(id);
    if (!a) return false;
    if (a.used) return false;
    this.approvals.delete(id);
    return true;
  }

  // For tests
  __clearForTest(): void { this.approvals.clear(); }
  __getForTest(id: string): ChannelSendApproval | undefined { return this.approvals.get(id); }
}

let store: ApprovalStore | null = null;
export function getApprovalStore(): ApprovalStore {
  if (!store) store = new ApprovalStore();
  return store;
}
export function __resetApprovalStoreForTest(): void { store = null; }
