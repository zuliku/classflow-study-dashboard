/**
 * QQ Allowlist Policy + Self Protection + Rate Limit — Task 13
 * Executed before Unified Inbox ingest. Must be side-effect free and not log content.
 */

export interface QQPolicyInput {
  senderId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  text: string;
  isMentioned?: boolean; // whether bot was @
  isSelf?: boolean;
}

export interface QQChannelPolicy {
  allowedUsers: string[];
  allowedGroups: string[];
  requireMentionInGroup: boolean;
  receiveDirectMessages: boolean;
  receiveGroupMessages: boolean;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export function evaluateQQPolicy(input: QQPolicyInput, policy: QQChannelPolicy): PolicyDecision {
  // 0. self protection
  if (input.isSelf) return { allowed: false, reason: "self_message" };

  // 1. conversation type gate
  if (input.conversationType === "direct" && !policy.receiveDirectMessages) {
    return { allowed: false, reason: "direct_disabled" };
  }
  if (input.conversationType === "group" && !policy.receiveGroupMessages) {
    return { allowed: false, reason: "group_disabled" };
  }

  // 2. allowedUsers (non-empty = allowlist)
  if (policy.allowedUsers.length > 0 && !policy.allowedUsers.includes(input.senderId)) {
    return { allowed: false, reason: "user_not_allowed" };
  }

  // 3. allowedGroups (only for group)
  if (input.conversationType === "group" && policy.allowedGroups.length > 0 && !policy.allowedGroups.includes(input.conversationId)) {
    return { allowed: false, reason: "group_not_allowed" };
  }

  // 4. requireMentionInGroup
  if (input.conversationType === "group" && policy.requireMentionInGroup && !input.isMentioned) {
    return { allowed: false, reason: "mention_required" };
  }

  return { allowed: true };
}

/**
 * Bounded rate limiter per sender / conversation / global
 * V1: simple token bucket with window, drop when exceed.
 */
export class QQRateLimiter {
  private senderMap = new Map<string, { count: number; windowStart: number }>();
  private convMap = new Map<string, { count: number; windowStart: number }>();
  private global: { count: number; windowStart: number } = { count: 0, windowStart: Date.now() };
  private windowMs: number;
  private maxPerSender: number;
  private maxPerConversation: number;
  private maxGlobal: number;

  constructor(opts?: { windowMs?: number; maxPerSender?: number; maxPerConversation?: number; maxGlobal?: number }) {
    this.windowMs = opts?.windowMs ?? 60_000;
    this.maxPerSender = opts?.maxPerSender ?? 10;
    this.maxPerConversation = opts?.maxPerConversation ?? 20;
    this.maxGlobal = opts?.maxGlobal ?? 50;
  }

  private check(map: Map<string, { count: number; windowStart: number }>, key: string, max: number): boolean {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now - entry.windowStart > this.windowMs) {
      map.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
  }

  allow(input: { senderId: string; conversationId: string }): PolicyDecision {
    const now = Date.now();
    if (now - this.global.windowStart > this.windowMs) {
      this.global = { count: 1, windowStart: now };
    } else {
      if (this.global.count >= this.maxGlobal) return { allowed: false, reason: "rate_limited_global" };
      this.global.count += 1;
    }
    if (!this.check(this.senderMap, input.senderId, this.maxPerSender)) return { allowed: false, reason: "rate_limited_sender" };
    if (!this.check(this.convMap, input.conversationId, this.maxPerConversation)) return { allowed: false, reason: "rate_limited_conversation" };
    return { allowed: true };
  }

  reset(): void {
    this.senderMap.clear();
    this.convMap.clear();
    this.global = { count: 0, windowStart: Date.now() };
  }
}
