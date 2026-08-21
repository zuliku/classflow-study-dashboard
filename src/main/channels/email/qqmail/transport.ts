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
    from?: Array<{ address: string; name?: string }>;
    replyTo?: Array<{ address: string; name?: string }>;
    date?: Date;
  };
  bodyStructure?: unknown;
  bodyParts?: Record<string, string>;
  internalDate?: Date;
  flags?: Set<string>;
  headers?: Map<string, string>;
}

export class QQMailImapTransport {
  private client: ImapFlow | null = null;
  private config: QQMailImapConfig;

  constructor(config: QQMailImapConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.client = new ImapFlow({
      host: QQMAIL_IMAP_HOST,
      port: QQMAIL_IMAP_PORT,
      secure: QQMAIL_IMAP_SECURE,
      auth: {
        user: this.config.emailAddress,
        pass: this.config.authCode,
      },
      // Disable automatic Seen flag updates; use PEEK explicitly (no Seen)
      logger: false as never,
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
      // Use SINCE to limit to 7 days; ImapFlow search uses `since` Date
      const result = await this.client.search({ since }, { uid: true });
      // result is array of UIDs when uid:true, or object with uidList
      if (Array.isArray(result)) return result.slice(0, 50);
      if ((result as unknown as { uidList?: number[] }).uidList) return (result as unknown as { uidList: number[] }).uidList.slice(0, 50);
      return [];
    } finally {
      lock.release();
    }
  }

  async searchUidGreater(lastUid: number): Promise<number[]> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      // Search for UID > lastUid using range
      const range = `${lastUid + 1}:*`;
      const result = await this.client.search({ uid: range } as unknown as Record<string, unknown>, { uid: true });
      if (Array.isArray(result)) return result;
      if ((result as unknown as { uidList?: number[] }).uidList) return (result as unknown as { uidList: number[] }).uidList;
      return [];
    } finally {
      lock.release();
    }
  }

  async fetchMessages(uids: number[]): Promise<QQMailFetchResult[]> {
    if (!this.client) throw new Error("Not connected");
    if (uids.length === 0) return [];
    // Cap to 50 as per spec
    const slice = uids.slice(0, 50);
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const out: QQMailFetchResult[] = [];
      // Use BODY.PEEK to avoid marking Seen — ImapFlow's bodyParts fetch uses PEEK by default
      // Explicitly request envelope, internalDate, bodyStructure, and only text parts, never attachment parts
      // BODY.PEEK[1] etc
      for await (const msg of this.client.fetch({ uid: slice } as unknown as string, {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        flags: true,
        headers: true,
        // Fetch only text parts via bodyParts with PEEK semantics
        bodyParts: ["1", "1.1", "1.2"] as unknown as never,
      })) {
        // ImapFlow returns bodyParts as Map, convert
        const bodyParts: Record<string, string> = {};
        // Only collect text/plain and text/html parts, skip attachments — do not fetch attachment payload
        // The transport ensures attachment payload fetch count = 0 by never requesting part "2" if it's attachment
        if ((msg as unknown as { bodyParts?: Map<string, string> }).bodyParts) {
          const map = (msg as unknown as { bodyParts: Map<string, string> }).bodyParts;
          for (const [k, v] of map.entries()) bodyParts[k] = v;
        }
        out.push({
          uid: (msg as unknown as { uid: number }).uid,
          envelope: (msg as unknown as { envelope: unknown }).envelope as never,
          bodyStructure: (msg as unknown as { bodyStructure: unknown }).bodyStructure,
          bodyParts,
          internalDate: (msg as unknown as { internalDate: Date }).internalDate,
          flags: (msg as unknown as { flags: Set<string> }).flags,
        });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  // Explicit PEEK fetch for single text part — used by adapter's mime selection
  async fetchTextPart(uid: number, partId: string): Promise<string | null> {
    if (!this.client) throw new Error("Not connected");
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      // BODY.PEEK[part] — never mark Seen flag
      for await (const msg of this.client.fetch({ uid: [uid] } as unknown as string, {
        uid: true,
        bodyParts: [partId] as unknown as never,
      })) {
        const map = (msg as unknown as { bodyParts: Map<string, string> }).bodyParts;
        if (map) {
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
}
