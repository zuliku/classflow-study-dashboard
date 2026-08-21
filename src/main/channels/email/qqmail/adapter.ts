/**
 * QQ Mail Channel Adapter — Task 18B
 * Implements ChannelAdapter for qq-mail with IMAP/SMTP, 60s scheduler, 7d/50 initial, UIDVALIDITY handling.
 */

import type { ChannelState, ChannelHealth, ChannelInboundMessage, ChannelAdapter } from "../../types";
import type { QQMailChannelConfig } from "../types";
import { EmailSyncScheduler } from "../scheduler";
import { EmailSyncStateStore } from "../syncStateStore";
import { ChannelError } from "../../errors";
import { getReplyContextStore } from "../../outbound/replyContextStore";
import { htmlToSafeText } from "../bodyParser";
import { findTextPart, extractAttachmentsMeta } from "./mime";
import { QQMailImapTransport } from "./transport";

export interface QQMailAdapterDeps {
  config: QQMailChannelConfig;
  authCode?: string;
  inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> };
  syncStateStore?: EmailSyncStateStore;
  imapTransport?: any;
  smtpTransport?: any;
}

export class QQMailChannelAdapter implements ChannelAdapter {
  readonly id: string;
  readonly channel: "qq-mail" = "qq-mail";
  private config: QQMailChannelConfig;
  private inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> };
  private state: ChannelState = "disconnected";
  private lastError?: { code: string; message: string };
  private messageCount = 0;
  private scheduler: EmailSyncScheduler | null = null;
  private syncStateStore: EmailSyncStateStore;
  private authCode: string | null;
  private imapTransport: any;
  private smtpTransport: any;
  private seenIds = new Set<string>();
  private imapConnected = false;

  constructor(deps: QQMailAdapterDeps) {
    this.id = deps.config.id;
    this.config = deps.config;
    this.inboxSink = deps.inboxSink;
    this.syncStateStore = deps.syncStateStore ?? new EmailSyncStateStore();
    this.authCode = deps.authCode ?? null;
    this.imapTransport = deps.imapTransport ?? null;
    this.smtpTransport = deps.smtpTransport ?? null;
  }

  getState(): ChannelState { return this.state; }

  getHealth(): ChannelHealth {
    return {
      channel: "qq-mail",
      id: this.id,
      state: this.state,
      accountId: this.config.emailAddress,
      lastError: this.lastError,
      messageCount: this.messageCount,
    };
  }

  private setState(s: ChannelState, err?: { code: string; message: string }) {
    this.state = s;
    if (err) this.lastError = err;
    if (s === "connected") this.lastError = undefined;
  }

  private getImap(): any {
    if (this.imapTransport) return this.imapTransport;
    if (!this.authCode) {
      try {
        const { getRuntimeSecretVault } = require("@/src/main/secrets/secretRuntime");
        const vault = getRuntimeSecretVault();
        this.authCode = vault.resolveSecretForProvider(this.config.credentialRef, "qq-mail");
      } catch {
        throw new ChannelError("QQ_MAIL_AUTH_FAILED" as never, "Cannot resolve QQ Mail auth code");
      }
    }
    this.imapTransport = new QQMailImapTransport({
      emailAddress: this.config.emailAddress,
      authCode: this.authCode!,
    });
    return this.imapTransport;
  }

  async start(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");
    try {
      const imap = this.getImap();
      if (!this.imapConnected) {
        await imap.connect();
        this.imapConnected = true;
      }
      try {
        if (typeof imap.selectInbox === "function") {
          await imap.selectInbox();
        } else if (typeof imap.mailboxOpen === "function") {
          await imap.mailboxOpen("INBOX");
        } else if (typeof imap.getMailboxLock === "function") {
          const lock = await imap.getMailboxLock("INBOX");
          lock.release();
        }
      } catch (e) {
        throw new ChannelError("EMAIL_SYNC_FAILED" as never, (e as Error).message);
      }
      const existing = this.syncStateStore.getQQMailState(this.id);
      const currentValidity = await this.getCurrentUidValidity(imap);
      if (!existing) {
        await this.doInitialSync(imap, currentValidity);
      } else if (existing.uidValidity !== String(currentValidity)) {
        await this.doRecoverySync(imap, currentValidity);
      } else {
        await this.doIncrementalSync(imap, existing, currentValidity);
      }
      this.scheduler = new EmailSyncScheduler(() => this.doPoll(), this.config.syncIntervalSeconds);
      this.scheduler.start();
      this.setState("connected");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = err?.code ?? (String(e).includes("auth") || String(e).includes("535") ? "QQ_MAIL_AUTH_FAILED" : "EMAIL_SYNC_FAILED");
      const msg = err?.message ?? String(e).slice(0, 200);
      this.setState("error", { code, message: msg });
      throw new ChannelError(code as never, msg);
    }
  }

  private async getCurrentUidValidity(imap: any): Promise<number> {
    if (typeof imap.getUidValidity === "function") return await imap.getUidValidity();
    if (typeof imap.mailboxOpen === "function") {
      const info = await imap.mailboxOpen("INBOX");
      return Number(info.uidValidity);
    }
    if (typeof imap.selectInbox === "function") {
      const info = await imap.selectInbox();
      return Number(info.uidValidity);
    }
    if (imap.mailbox?.uidValidity) return Number(imap.mailbox.uidValidity);
    return 0;
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.scheduler = null;
    const imap = this.imapTransport;
    if (imap) {
      try { await imap.disconnect?.() ?? await imap.close?.() ?? await imap.logout?.(); } catch {}
    }
    this.imapTransport = null;
    this.imapConnected = false;
    this.authCode = null;
    this.setState("disconnected");
  }

  async syncNow(): Promise<{ added: number; durationMs: number }> {
    const start = Date.now();
    const before = this.messageCount;
    if (this.scheduler) {
      await this.scheduler.syncNow();
    } else {
      await this.doPoll();
    }
    return { added: this.messageCount - before, durationMs: Date.now() - start };
  }

  private async doPoll(): Promise<void> {
    const imap = this.getImap();
    const isConnected = typeof (imap as { isConnected?: () => boolean }).isConnected === "function" ? (imap as { isConnected: () => boolean }).isConnected() : this.imapConnected;
    if (!isConnected) {
      await imap.connect();
      this.imapConnected = true;
    }
    const currentValidity = await this.getCurrentUidValidity(imap);
    const existing = this.syncStateStore.getQQMailState(this.id);
    if (!existing) {
      await this.doInitialSync(imap, currentValidity);
    } else if (existing.uidValidity !== String(currentValidity)) {
      await this.doRecoverySync(imap, currentValidity);
    } else {
      await this.doIncrementalSync(imap, existing, currentValidity);
    }
  }

  private parseHeadersToMap(headers: unknown): Map<string, string> {
    const map = new Map<string, string>();
    if (!headers) return map;
    if (headers instanceof Map) {
      for (const [k, v] of headers.entries()) map.set(k.toLowerCase(), String(v));
      return map;
    }
    let raw: string;
    if (Buffer.isBuffer(headers)) raw = headers.toString("utf-8");
    else if (typeof headers === "string") raw = headers;
    else return map;
    // Handle folded headers (continuation lines starting with space/tab)
    const lines = raw.split(/\r?\n/);
    let currentKey = "";
    let currentValue = "";
    for (const line of lines) {
      if (/^\s/.test(line) && currentKey) {
        currentValue += " " + line.trim();
      } else {
        if (currentKey) map.set(currentKey.toLowerCase(), currentValue.trim());
        const idx = line.indexOf(":");
        if (idx > -1) {
          currentKey = line.slice(0, idx).trim();
          currentValue = line.slice(idx + 1).trim();
        } else {
          currentKey = "";
          currentValue = "";
        }
      }
    }
    if (currentKey) map.set(currentKey.toLowerCase(), currentValue.trim());
    return map;
  }

  private async fetchEnvelopes(imap: any, uids: number[]): Promise<any[]> {
    if (uids.length === 0) return [];
    // Prefer dedicated method if mock provides it
    if (typeof imap.fetchEnvelopes === "function") {
      return await imap.fetchEnvelopes(uids);
    }
    if (typeof imap.fetchMessages === "function") {
      // For backward compat with older mock, but we prefer two-stage; however fetchMessages was single-stage
      // We treat it as envelope fetch without body
      return await imap.fetchMessages(uids);
    }
    const out: any[] = [];
    // Correct ImapFlow fetch: range as number[], query as FetchQueryObject, options {uid:true}
    const query = {
      uid: true,
      envelope: true,
      internalDate: true,
      bodyStructure: true,
      flags: true,
      headers: true,
    };
    for await (const msg of imap.fetch(uids, query, { uid: true })) {
      out.push({
        uid: (msg as { uid: number }).uid,
        envelope: (msg as { envelope: unknown }).envelope,
        bodyStructure: (msg as { bodyStructure: unknown }).bodyStructure,
        internalDate: (msg as { internalDate: Date }).internalDate,
        flags: (msg as { flags: Set<string> }).flags,
        headers: (msg as { headers: Buffer }).headers,
      });
    }
    return out;
  }

  private async fetchBodyPart(imap: any, uid: number, partId: string): Promise<string | null> {
    if (typeof imap.fetchBodyPart === "function") {
      const buf = await imap.fetchBodyPart(uid, partId);
      if (Buffer.isBuffer(buf)) return buf.toString("utf-8");
      if (typeof buf === "string") return buf;
      return null;
    }
    if (typeof imap.fetchTextPart === "function") {
      const res = await imap.fetchTextPart(uid, partId);
      if (Buffer.isBuffer(res)) return res.toString("utf-8");
      return res as string | null;
    }
    // Fallback to fetch with bodyParts
    for await (const msg of imap.fetch([uid], { uid: true, bodyParts: [partId] }, { uid: true })) {
      const map = (msg as { bodyParts?: Map<string, Buffer> }).bodyParts;
      if (map) {
        const buf = map.get(partId);
        if (buf) return Buffer.isBuffer(buf) ? buf.toString("utf-8") : String(buf);
      }
      const rec = (msg as { bodyParts?: Record<string, string> }).bodyParts as unknown as Record<string, string> | undefined;
      if (rec && rec[partId]) return rec[partId];
    }
    return null;
  }

  private async doInitialSync(imap: any, uidValidity: number): Promise<void> {
    const since = new Date(Date.now() - 7 * 86400000);
    let uids: number[] = [];
    try {
      if (typeof imap.searchSince === "function") {
        uids = await imap.searchSince(since);
      } else if (typeof imap.search === "function") {
        const res = await imap.search({ since }, { uid: true });
        uids = Array.isArray(res) ? res : [];
      }
    } catch {
      uids = [];
    }
    if (uids.length === 0) {
      this.syncStateStore.setQQMailState(this.id, { uidValidity: String(uidValidity), lastSeenUid: 0, initializedAt: Date.now(), lastSyncAt: Date.now() });
      return;
    }
    // Latest 50: numeric sort, take newest 50
    const sorted = [...uids].sort((a, b) => a - b);
    const newest = sorted.slice(-50);
    // Fetch envelopes for newest
    const envelopes = await this.fetchEnvelopes(imap, newest);
    // Filter by 7d after fetch as safety (in case search didn't filter)
    const filtered = envelopes.filter((m) => {
      const d = m.internalDate instanceof Date ? m.internalDate : new Date(m.internalDate ?? 0);
      return d.getTime() >= since.getTime();
    });
    // Ensure we still respect latest 50 after filtering (if some filtered out, we already have newest, so okay)
    // Ingest in old→new order for stable order
    const toIngest = [...filtered].sort((a, b) => a.uid - b.uid);
    let maxUid = 0;
    let hadFailure = false;
    for (const env of toIngest) {
      try {
        const partInfo = findTextPart(env.bodyStructure as never);
        let bodyContent: string | null = null;
        let isHtml = false;
        if (partInfo.partId) {
          bodyContent = await this.fetchBodyPart(imap, env.uid, partInfo.partId);
          isHtml = partInfo.isHtml;
        }
        const normalized = await this.normalizeFromEnvelope(env, uidValidity, bodyContent, isHtml);
        if (this.seenIds.has(normalized.externalMessageId)) continue;
        this.seenIds.add(normalized.externalMessageId);
        const rfcId = normalized.rfcMessageId ?? `<${normalized.externalMessageId}>`;
        const replyTo = (normalized as unknown as { replyToAddress?: string }).replyToAddress ?? normalized.fromAddress ?? normalized.senderId;
        let replyContextId: string | undefined;
        try {
          const store = getReplyContextStore();
          const ctx = await store.create({
            channel: "qq-mail",
            sourceAccountId: this.id,
            providerMessageId: normalized.externalMessageId,
            rfcMessageId: rfcId,
            subject: normalized.subject ?? "(no subject)",
            replyToAddress: replyTo ?? "",
            references: normalized.references ?? [],
          } as never);
          replyContextId = ctx.replyContextId;
        } catch {}
        const withCtx = replyContextId ? { ...normalized, replyContextId } as ChannelInboundMessage & { replyContextId?: string } : normalized;
        await this.inboxSink.ingest(withCtx);
        this.messageCount++;
        if (env.uid > maxUid) maxUid = env.uid;
      } catch {
        hadFailure = true;
        break;
      }
    }
    if (!hadFailure) {
      this.syncStateStore.setQQMailState(this.id, { uidValidity: String(uidValidity), lastSeenUid: maxUid || 0, initializedAt: Date.now(), lastSyncAt: Date.now() });
    } else {
      const existing = this.syncStateStore.getQQMailState(this.id);
      if (!existing) {
        this.syncStateStore.setQQMailState(this.id, { uidValidity: String(uidValidity), lastSeenUid: 0, initializedAt: Date.now(), lastSyncAt: Date.now() });
      }
    }
  }

  private async doIncrementalSync(imap: any, existing: { uidValidity: string; lastSeenUid: number }, currentValidity: number): Promise<void> {
    let uids: number[] = [];
    try {
      if (typeof imap.searchUidGreater === "function") {
        uids = await imap.searchUidGreater(existing.lastSeenUid);
      } else if (typeof imap.search === "function") {
        const res = await imap.search({ uid: `${existing.lastSeenUid + 1}:*` }, { uid: true });
        uids = Array.isArray(res) ? res : [];
      }
    } catch {
      uids = [];
    }
    const sorted = [...uids].sort((a, b) => a - b).slice(0, 50);
    // debug log removed
    if (sorted.length === 0) {
      this.syncStateStore.setQQMailState(this.id, { uidValidity: String(currentValidity), lastSeenUid: existing.lastSeenUid, lastSyncAt: Date.now(), initializedAt: (existing as unknown as { initializedAt?: number }).initializedAt ?? Date.now() });
      return;
    }
    const envelopes = await this.fetchEnvelopes(imap, sorted);
    // debug log removed
    const toIngest = [...envelopes].sort((a, b) => a.uid - b.uid);
    let maxUid = existing.lastSeenUid;
    let hadFailure = false;
    for (const env of toIngest) {
      try {
        const partInfo = findTextPart(env.bodyStructure as never);
        let bodyContent: string | null = null;
        let isHtml = false;
        if (partInfo.partId) {
          bodyContent = await this.fetchBodyPart(imap, env.uid, partInfo.partId);
          isHtml = partInfo.isHtml;
        }
        const normalized = await this.normalizeFromEnvelope(env, Number(existing.uidValidity), bodyContent, isHtml);
        if (this.seenIds.has(normalized.externalMessageId)) continue;
        this.seenIds.add(normalized.externalMessageId);
        const rfcId = normalized.rfcMessageId ?? `<${normalized.externalMessageId}>`;
        const replyTo = (normalized as unknown as { replyToAddress?: string }).replyToAddress ?? normalized.fromAddress ?? normalized.senderId;
        let replyContextId: string | undefined;
        try {
          const store = getReplyContextStore();
          const ctx = await store.create({
            channel: "qq-mail",
            sourceAccountId: this.id,
            providerMessageId: normalized.externalMessageId,
            rfcMessageId: rfcId,
            subject: normalized.subject ?? "",
            replyToAddress: replyTo ?? "",
            references: normalized.references ?? [],
          } as never);
          replyContextId = ctx.replyContextId;
        } catch {}
        const withCtx = replyContextId ? { ...normalized, replyContextId } as ChannelInboundMessage & { replyContextId?: string } : normalized;
        await this.inboxSink.ingest(withCtx);
        this.messageCount++;
        if (env.uid > maxUid) maxUid = env.uid;
      } catch {
        hadFailure = true;
        break;
      }
    }
    if (!hadFailure) {
      this.syncStateStore.setQQMailState(this.id, { uidValidity: String(currentValidity), lastSeenUid: maxUid, lastSyncAt: Date.now(), initializedAt: (existing as unknown as { initializedAt?: number }).initializedAt ?? Date.now() });
    }
  }

  private async doRecoverySync(imap: any, newValidity: number): Promise<void> {
    await this.doInitialSync(imap, newValidity);
  }

  private async normalizeFromEnvelope(env: any, uidValidity: number, bodyContent: string | null, isHtml: boolean): Promise<ChannelInboundMessage> {
    const envelope = env.envelope ?? {};
    const internalDate: Date = env.internalDate instanceof Date ? env.internalDate : new Date(env.internalDate ?? Date.now());
    const bodyStructure = env.bodyStructure;
    const rawHeaders: unknown = env.headers;

    const subject: string = envelope.subject ?? "(no subject)";
    const fromAddr: string = envelope.from?.[0]?.address ?? envelope.from?.[0]?.name ?? "";
    const fromDisplay: string = envelope.from?.[0]?.name ?? fromAddr;
    const replyToAddr: string = envelope.replyTo?.[0]?.address ?? fromAddr;
    const messageId: string = envelope.messageId ?? `<${env.uid}@qqmail>`;
    const date: Date | undefined = envelope.date ? new Date(envelope.date) : undefined;
    const receivedAt = date && !isNaN(date.getTime()) ? date.getTime() : internalDate.getTime();

    const hasValidMessageId = typeof messageId === "string" && messageId.includes("@") && messageId.trim().startsWith("<") && messageId.trim().endsWith(">");
    const externalMessageId = hasValidMessageId ? `mid:${messageId.trim().toLowerCase()}` : `uid:${uidValidity}:${env.uid}`;

    const headersMap = this.parseHeadersToMap(rawHeaders);
    // References handling with folding support
    const referencesRaw = headersMap.get("references") ?? "";
    const references = referencesRaw.split(/\s+/).filter(Boolean);
    const inReplyTo = headersMap.get("in-reply-to") ?? undefined;
    // Also consider envelope.inReplyTo if headers missing
    const finalInReplyTo = inReplyTo ?? envelope.inReplyTo ?? undefined;
    // Merge envelope references if needed? For now use headers

    let text = "";
    if (bodyContent !== null && bodyContent !== undefined) {
      if (isHtml) {
        text = htmlToSafeText(bodyContent);
      } else {
        text = bodyContent;
      }
    } else {
      // Fallback: try to decode from bodyStructure if no fetch
      text = "";
    }
    text = text.slice(0, 10000);

    const headersForReplyTo = headersMap;
    // Prefer Reply-To header, fallback to envelope
    let replyToAddress = headersForReplyTo.get("reply-to") ?? replyToAddr;
    if (!replyToAddress || !replyToAddress.includes("@")) replyToAddress = fromAddr;
    // Extract email
    const match = replyToAddress.match(/<([^>]+)>/);
    replyToAddress = (match ? match[1] : replyToAddress).trim().split(/\s+/)[0] ?? "";
    if (/[\r\n]/.test(replyToAddress)) replyToAddress = fromAddr.match(/<([^>]+)>/)?.[1] ?? fromAddr;

    const attachmentsMeta = extractAttachmentsMeta(bodyStructure as never).map((a) => ({
      id: `${a.partId}`,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
    }));

    return {
      channel: "qq-mail",
      accountId: this.id,
      externalMessageId,
      conversationId: messageId ?? externalMessageId,
      conversationType: "direct",
      senderId: fromAddr,
      senderDisplay: fromDisplay || fromAddr,
      subject,
      text,
      receivedAt,
      attachments: attachmentsMeta,
      rfcMessageId: messageId,
      threadId: undefined,
      references,
      inReplyTo: finalInReplyTo,
      fromAddress: fromAddr,
      replyToAddress,
    } as unknown as ChannelInboundMessage & { replyToAddress?: string };
  }

  private async normalizeAndIngest(msg: any, uidValidity: number): Promise<ChannelInboundMessage> {
    // Legacy path for tests that call normalize directly with old mock structure (with bodyParts)
    // Convert old mock's bodyParts Record<string,string> to new envelope flow
    const envelope = msg.envelope ?? {};
    const internalDate: Date = msg.internalDate instanceof Date ? msg.internalDate : new Date(msg.internalDate ?? Date.now());
    const bodyStructure = msg.bodyStructure;
    const bodyParts: Record<string, string> = msg.bodyParts ?? {};
    const subject: string = envelope.subject ?? "(no subject)";
    const fromAddr: string = envelope.from?.[0]?.address ?? envelope.from ?? "";
    const fromDisplay: string = envelope.from?.[0]?.name ?? fromAddr;
    const replyToAddr: string = envelope.replyTo?.[0]?.address ?? fromAddr;
    const messageId: string = envelope.messageId ?? `<${msg.uid}@qqmail>`;
    const hasValidMessageId = typeof messageId === "string" && messageId.includes("@") && messageId.trim().startsWith("<") && messageId.trim().endsWith(">");
    const externalMessageId = hasValidMessageId ? `mid:${messageId.trim().toLowerCase()}` : `uid:${uidValidity}:${msg.uid}`;
    const headersMap = this.parseHeadersToMap(msg.headers);
    const referencesRaw = headersMap.get("references") ?? "";
    const references = referencesRaw.split(/\s+/).filter(Boolean);
    const inReplyTo = headersMap.get("in-reply-to") ?? undefined;
    let text = "";
    const textPart = findTextPart(bodyStructure as never);
    if (textPart.partId) {
      const raw = bodyParts[textPart.partId] ?? bodyParts["1"] ?? "";
      if (textPart.isHtml) text = htmlToSafeText(raw);
      else text = raw;
    } else if (bodyParts["1"]) {
      const raw = bodyParts["1"];
      if (raw.includes("<") && raw.includes(">")) text = htmlToSafeText(raw);
      else text = raw;
    }
    text = text.slice(0, 10000);
    const attachmentsMeta = extractAttachmentsMeta(bodyStructure as never).map((a) => ({
      id: `${a.partId}`,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
    }));
    const sanitizedReplyTo = /[\r\n]/.test(replyToAddr) ? fromAddr : replyToAddr;
    return {
      channel: "qq-mail",
      accountId: this.id,
      externalMessageId,
      conversationId: messageId ?? externalMessageId,
      conversationType: "direct",
      senderId: fromAddr,
      senderDisplay: fromDisplay || fromAddr,
      subject,
      text,
      receivedAt: internalDate.getTime(),
      attachments: attachmentsMeta,
      rfcMessageId: messageId,
      threadId: undefined,
      references,
      inReplyTo,
      fromAddress: fromAddr,
      replyToAddress: sanitizedReplyTo,
    } as unknown as ChannelInboundMessage & { replyToAddress?: string };
  }
}
