/**
 * Outbound Audit — bounded, no secret/text, hash only
 */

import type { ChannelOutboundAudit } from "./types";

export class OutboundAuditStore {
  private audits: ChannelOutboundAudit[] = [];
  private max = 200;

  add(entry: ChannelOutboundAudit): void {
    this.audits.unshift(entry);
    if (this.audits.length > this.max) this.audits = this.audits.slice(0, this.max);
  }

  list(): ChannelOutboundAudit[] {
    return [...this.audits];
  }

  clear(): void {
    this.audits = [];
  }
}

let auditStore: OutboundAuditStore | null = null;
export function getOutboundAuditStore(): OutboundAuditStore {
  if (!auditStore) auditStore = new OutboundAuditStore();
  return auditStore;
}
export function __resetOutboundAuditForTest(): void { auditStore = null; }
