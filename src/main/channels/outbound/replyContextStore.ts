/**
 * Reply Context Store — Task 14 persistent, bounded, TTL 24h, atomic
 */

import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { ChannelError } from "../errors";
import type { ChannelReplyContext } from "./types";
import type { EmailReplyContext } from "../email/types";

function getReplyContextPath(): string {
  return join(app.getPath("userData"), "channels", "reply-contexts.json");
}

function ensureDir(): void {
  mkdirSync(dirname(getReplyContextPath()), { recursive: true });
}

export class ReplyContextStore {
  private contexts = new Map<string, ChannelReplyContext>();
  private max = 1000;
  private ttlMs = 24 * 60 * 60 * 1000;
  private configPath: string;

  constructor(opts?: { max?: number; ttlMs?: number; configPath?: string }) {
    this.configPath = opts?.configPath ?? getReplyContextPath();
    if (opts?.max) this.max = opts.max;
    if (opts?.ttlMs) this.ttlMs = opts.ttlMs;
    this.loadSync();
  }

  private loadSync(): void {
    if (this.configPath === ":memory:") return;
    try {
      ensureDir();
      if (!existsSync(this.configPath)) return;
      const raw = require("node:fs").readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as { contexts?: ChannelReplyContext[] };
      if (Array.isArray(parsed.contexts)) {
        const now = Date.now();
        for (const c of parsed.contexts) {
          if (c.replyContextId && c.expiresAt > now) {
            this.contexts.set(c.replyContextId, c);
          }
        }
        this.enforceMax();
      }
    } catch (e) {
      console.warn(`[replyContext] load failed path=${this.configPath} code=${(e as Error).message.slice(0,100)}`);
    }
  }

  private enforceMax(): void {
    if (this.contexts.size <= this.max) return;
    const sorted = Array.from(this.contexts.values()).sort((a, b) => a.createdAt - b.createdAt);
    const toDelete = sorted.slice(0, this.contexts.size - this.max);
    for (const c of toDelete) this.contexts.delete(c.replyContextId);
  }

  private async persistAtomic(): Promise<void> {
    if (this.configPath === ":memory:") return;
    let tmp: string | null = null;
    let handle: fs.FileHandle | null = null;
    try {
      ensureDir();
      const data = JSON.stringify({ contexts: Array.from(this.contexts.values()) }, null, 2);
      tmp = join(dirname(this.configPath), `.reply-tmp-${randomUUID().slice(0,8)}`);
      await fs.writeFile(tmp, data, "utf8");
      handle = await fs.open(tmp, "r");
      try {
        await handle.sync();
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EINVAL") throw e;
      }
      await handle.close();
      handle = null;
      await fs.rename(tmp, this.configPath);
      tmp = null;
    } catch (e) {
      if (handle) try { await handle.close(); } catch {}
      if (tmp) try { await fs.unlink(tmp); } catch {}
      throw new ChannelError("PERSISTENCE_FAILED", `reply context persist failed: ${(e as Error).message}`);
    }
  }

  async create(context: Omit<ChannelReplyContext, "replyContextId" | "createdAt" | "expiresAt">): Promise<ChannelReplyContext> {
    this.expireSync();
    const now = Date.now();
    const ctx: ChannelReplyContext = {
      replyContextId: `reply_${randomUUID()}`,
      ...context,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    } as ChannelReplyContext;
    let sanitized: ChannelReplyContext;
    if ((ctx as unknown as { channel: string }).channel === "gmail" || (ctx as unknown as { channel: string }).channel === "qq-mail") {
      const emailCtx = ctx as unknown as EmailReplyContext;
      sanitized = {
        replyContextId: ctx.replyContextId,
        channel: emailCtx.channel,
        sourceAccountId: emailCtx.sourceAccountId,
        providerMessageId: emailCtx.providerMessageId,
        rfcMessageId: emailCtx.rfcMessageId,
        threadId: emailCtx.threadId,
        subject: emailCtx.subject,
        replyToAddress: emailCtx.replyToAddress,
        references: emailCtx.references,
        createdAt: ctx.createdAt,
        expiresAt: ctx.expiresAt,
        conversationId: emailCtx.threadId ?? emailCtx.providerMessageId,
        conversationType: "direct",
        inboundMessageId: emailCtx.providerMessageId,
      } as unknown as ChannelReplyContext;
    } else {
      const qqCtx = ctx as unknown as import("./types").QQReplyContext;
      sanitized = {
        replyContextId: ctx.replyContextId,
        channel: "qq-bot",
        sourceAccountId: qqCtx.sourceAccountId,
        conversationId: qqCtx.conversationId,
        conversationType: qqCtx.conversationType,
        inboundMessageId: qqCtx.inboundMessageId,
        createdAt: ctx.createdAt,
        expiresAt: ctx.expiresAt,
      };
    }
    const backup = new Map(this.contexts);
    this.contexts.set(sanitized.replyContextId, sanitized);
    this.enforceMax();
    try {
      await this.persistAtomic();
    } catch (e) {
      this.contexts = backup;
      throw e;
    }
    return sanitized;
  }

  get(id: string): ChannelReplyContext | undefined {
    const c = this.contexts.get(id);
    if (!c) return undefined;
    if (c.expiresAt < Date.now()) {
      this.contexts.delete(id);
      return undefined;
    }
    return c;
  }

  async deleteForAccount(sourceAccountId: string): Promise<void> {
    const backup = new Map(this.contexts);
    let changed = false;
    for (const [id, c] of this.contexts) {
      if (c.sourceAccountId === sourceAccountId) {
        this.contexts.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    try {
      await this.persistAtomic();
    } catch (e) {
      this.contexts = backup;
      throw e;
    }
  }

  expireSync(): void {
    const now = Date.now();
    for (const [id, c] of this.contexts) {
      if (c.expiresAt < now) this.contexts.delete(id);
    }
  }

  list(): ChannelReplyContext[] {
    this.expireSync();
    return Array.from(this.contexts.values());
  }

  // For tests
  __clearForTest(): void {
    this.contexts.clear();
  }
  __setForTest(contexts: ChannelReplyContext[]): void {
    this.contexts.clear();
    for (const c of contexts) this.contexts.set(c.replyContextId, c);
  }
}

let store: ReplyContextStore | null = null;
export function getReplyContextStore(): ReplyContextStore {
  if (!store) store = new ReplyContextStore();
  return store;
}
export function __resetReplyContextStoreForTest(): void { store = null; }
