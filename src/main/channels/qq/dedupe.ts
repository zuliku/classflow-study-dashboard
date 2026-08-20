/**
 * QQ Message Dedupe — Task 13 bounded LRU/TTL cache
 * Primary key: channel + accountId + externalMessageId
 * Fallback stable hash: conversationId + senderId + timestamp bucket + normalized content
 */

function hashContent(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

export interface QQDedupeKeyInput {
  channel: string;
  accountId: string;
  externalMessageId?: string;
  conversationId?: string;
  senderId?: string;
  timestamp?: number;
  text?: string;
}

export function getQQDedupeKey(input: QQDedupeKeyInput): string {
  if (input.externalMessageId) {
    return `${input.channel}:${input.accountId}:${input.externalMessageId}`;
  }
  const bucket = input.timestamp ? Math.floor(input.timestamp / 60000) : 0; // minute bucket
  const contentHash = hashContent(`${input.conversationId ?? ""}:${input.senderId ?? ""}:${(input.text ?? "").trim().slice(0, 200)}`);
  return `${input.channel}:${input.accountId}:fallback:${input.conversationId ?? ""}:${contentHash}:${bucket}`;
}

export class QQMessageDedupe {
  private cache = new Map<string, number>(); // key -> expiresAt
  private maxSize: number;
  private ttlMs: number;
  constructor(opts?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = opts?.maxSize ?? 500;
    this.ttlMs = opts?.ttlMs ?? 10 * 60 * 1000; // 10 min
  }

  has(key: string): boolean {
    this.pruneExpired();
    const exp = this.cache.get(key);
    if (exp === undefined) return false;
    if (exp < Date.now()) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    this.pruneExpired();
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (first inserted)
      const first = this.cache.keys().next().value as string | undefined;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, Date.now() + this.ttlMs);
  }

  /** Returns true if newly added, false if duplicate */
  checkAndAdd(input: QQDedupeKeyInput): boolean {
    const key = getQQDedupeKey(input);
    if (this.has(key)) return false;
    this.add(key);
    return true;
  }

  pruneExpired(): void {
    const now = Date.now();
    for (const [k, exp] of this.cache) {
      if (exp < now) this.cache.delete(k);
    }
  }

  size(): number {
    this.pruneExpired();
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
