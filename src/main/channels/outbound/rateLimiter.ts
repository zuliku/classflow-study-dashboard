/**
 * QQ Outbound Rate Limiter — per account + global, bounded, no reuse of inbound limiter
 */

export class QQOutboundRateLimiter {
  private accountMap = new Map<string, { count: number; windowStart: number }>();
  private global: { count: number; windowStart: number } = { count: 0, windowStart: Date.now() };
  private windowMs: number;
  private maxPerAccount: number;
  private maxGlobal: number;

  constructor(opts?: { windowMs?: number; maxPerAccount?: number; maxGlobal?: number }) {
    this.windowMs = opts?.windowMs ?? 60_000;
    this.maxPerAccount = opts?.maxPerAccount ?? 5;
    this.maxGlobal = opts?.maxGlobal ?? 20;
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

  allow(accountId: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    if (now - this.global.windowStart > this.windowMs) {
      this.global = { count: 1, windowStart: now };
    } else {
      if (this.global.count >= this.maxGlobal) return { allowed: false, reason: "rate_limited_global" };
      this.global.count += 1;
    }
    if (!this.check(this.accountMap, accountId, this.maxPerAccount)) return { allowed: false, reason: "rate_limited_account" };
    return { allowed: true };
  }

  reset(): void {
    this.accountMap.clear();
    this.global = { count: 0, windowStart: Date.now() };
  }
}
