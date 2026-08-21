/**
 * QQ Mail IMAP transport — Task 18B
 * Wraps ImapFlow with QQ's imap.qq.com defaults.
 * Ensures PEEK (no Seen) and no attachment payload fetch.
 */

import { ImapFlow } from "imapflow";
import { QQMAIL_IMAP_HOST, QQMAIL_IMAP_PORT, QQMAIL_IMAP_SECURE } from "./config";

export interface QQMailImapConfig {
  emailAddress: string;
  authCode: string;
}

export interface QQMailMailboxInfo {
  uidValidity: number;
  exists: number;
}

export interface QQMailFetchResult {
  uid: number;
  envelope: {
    messageId?: string;
    subject?: string;
    from?: Array<{ address?: string; name?: string }>;
    replyTo?: Array<{ address?: string; name?: string }>;
    date?: Date;
  };
  bodyStructure?: unknown;
  bodyParts?: Map<string, Buffer>;
  internalDate?: Date;
  flags?: Set<string>;
  headers?: Buffer;
}

export class QQMailImapTransport {
  private client: ImapFlow | null = null;
  private config: QQMailImapConfig;

  constructor(config: QQMailImapConfig) {
    this.config = config;
  }

  isConnected(): boolean {
    // ImapFlow v1 exposes `usable` + `close` but not a typed `closing`; use runtime check with fallback
    const c = this.client as unknown as { usable?: boolean; closing?: boolean } | null;
    if (!c) return false;
    if (typeof c.closing === "boolean") return !c.closing;
    if (typeof c.usable === "boolean") return c.usable;
    return !!this.client;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    this.client = new ImapFlow({
      host: QQMAIL_IMAP_HOST,
      port: QQMAIL_IMAP_PORT,
      secure: QQMAIL_IMAP_SECURE,
      auth: {
        user: this.config.emailAddress,
        pass: this.config.authCode,
      },
      logger: false,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {}
      this.client = null;
    }
  }

  async selectInbox(): Promise<QQMailMailboxInfo> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const mailbox = this.client.mailbox;
      if (!mailbox) throw new Error("No mailbox");
      return { uidValidity: Number(mailbox.uidValidity), exists: mailbox.exists };
    } finally {
      lock.release();
    }
  }

  async getUidValidity(): Promise<number> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const mailbox = this.client.mailbox;
      if (!mailbox) throw new Error("No mailbox");
      return Number(mailbox.uidValidity);
    } finally {
      lock.release();
    }
  }

  async searchSince(since: Date): Promise<number[]> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const result = await this.client.search({ since }, { uid: true });
      if (Array.isArray(result)) return result.slice(0, 1000);
      return [];
    } finally {
      lock.release();
    }
  }

  async searchUidGreater(lastUid: number): Promise<number[]> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const range = `${lastUid + 1}:*`;
      const result = await this.client.search({ uid: range }, { uid: true });
      if (Array.isArray(result)) return result;
      return [];
    } finally {
      lock.release();
    }
  }

  async fetchEnvelopes(uids: number[]): Promise<QQMailFetchResult[]> {
    if (!this.client) throw new Error("Not connected");
    if (uids.length === 0) return [];
    const slice = [...uids].sort((a, b) => a - b).slice(0, 50);
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const out: QQMailFetchResult[] = [];
      // Phase 1: only envelope/structure/headers, no bodyParts — PEEK semantics, no Seen
      for await (const msg of this.client.fetch(slice, {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        flags: true,
        headers: true,
      }, { uid: true })) {
        out.push({
          uid: msg.uid,
          envelope: msg.envelope as import("imapflow").MessageEnvelopeObject,
          bodyStructure: msg.bodyStructure,
          bodyParts: msg.bodyParts,
          internalDate: msg.internalDate ? new Date(String(msg.internalDate)) : undefined,
          flags: msg.flags,
          headers: msg.headers,
        });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async fetchBodyPart(uid: number, partId: string): Promise<Buffer | null> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      // Phase 2: only fetch the exact text part, PEEK, never attachment
      for await (const msg of this.client.fetch([uid], {
        uid: true,
        bodyParts: [partId],
      }, { uid: true })) {
        const map = msg.bodyParts;
        if (map) {
          const buf = map.get(partId);
          if (buf) return buf;
          // Also check first entry if key mismatch
          for (const [k, v] of map.entries()) {
            if (k === partId) return v;
          }
        }
      }
      return null;
    } finally {
      lock.release();
    }
  }

  // Backward compat for older tests that call fetchMessages (now delegates to fetchEnvelopes)
  async fetchMessages(uids: number[]): Promise<QQMailFetchResult[]> {
    return this.fetchEnvelopes(uids);
  }
}
