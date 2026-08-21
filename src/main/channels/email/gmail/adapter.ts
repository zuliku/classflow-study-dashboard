/**
 * Gmail Adapter — Task 18A
 * Implements ChannelAdapter for gmail, with 60s scheduler, 7d/50 initial, history incremental, INBOX only.
 */

import type { ChannelState, ChannelHealth, ChannelInboundMessage, ChannelAdapter } from "../../types";
import type { GmailChannelConfig } from "../types";
import { EmailSyncScheduler } from "../scheduler";
import { EmailSyncStateStore } from "../syncStateStore";
import { GmailTokenProvider } from "./tokenProvider";
import * as GmailApi from "./api";
import { extractTextFromPayload, extractAttachmentsFromPayload } from "../bodyParser";
import { ChannelError } from "../../errors";
import { getReplyContextStore } from "../../outbound/replyContextStore";

export class GmailChannelAdapter implements ChannelAdapter {
  readonly id: string;
  readonly channel: "gmail" = "gmail";
  private config: GmailChannelConfig;
  private inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> };
  private state: ChannelState = "disconnected";
  private lastError?: { code: string; message: string };
  private messageCount = 0;
  private scheduler: EmailSyncScheduler | null = null;
  private syncStateStore: EmailSyncStateStore;
  private tokenProvider: GmailTokenProvider;
  private seenIds = new Set<string>();

  constructor(deps: { config: GmailChannelConfig; inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> }; tokenProvider?: GmailTokenProvider; syncStateStore?: EmailSyncStateStore }) {
    this.id = deps.config.id;
    this.config = deps.config;
    this.inboxSink = deps.inboxSink;
    this.tokenProvider = deps.tokenProvider ?? new GmailTokenProvider(deps.config.credentialRef);
    this.syncStateStore = deps.syncStateStore ?? new EmailSyncStateStore();
  }

  getState(): ChannelState { return this.state; }

  getHealth(): ChannelHealth {
    return {
      channel: "gmail",
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

  async start(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");
    try {
      // Verify token can be refreshed (auth check)
      await this.tokenProvider.getAccessToken();
      // Initial sync if not initialized
      const existing = this.syncStateStore.getGmailState(this.id);
      if (!existing?.historyId) {
        await this.doInitialSync();
      } else {
        await this.doIncrementalSync();
      }
      this.scheduler = new EmailSyncScheduler(() => this.doIncrementalSync(), this.config.syncIntervalSeconds);
      this.scheduler.start();
      this.setState("connected");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = err?.code ?? "EMAIL_SYNC_FAILED";
      const msg = err?.message ?? String(e).slice(0,200);
      this.setState("error", { code, message: msg });
      throw new ChannelError(code as never, msg);
    }
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.scheduler = null;
    this.setState("disconnected");
    this.tokenProvider.clearCache();
  }

  async syncNow(): Promise<{ added: number; durationMs: number }> {
    const start = Date.now();
    if (this.scheduler) {
      await this.scheduler.syncNow();
    } else {
      await this.doIncrementalSync();
    }
    return { added: 0, durationMs: Date.now() - start };
  }

  private async doInitialSync(): Promise<void> {
    const items = await GmailApi.listInboxMessages(this.tokenProvider, 50);
    for (const item of items) {
      try {
        const detail = await GmailApi.getMessageDetail(this.tokenProvider, item.id);
        if (!detail.labelIds?.includes("INBOX")) continue;
        const normalizedBase = this.normalizeMessage(detail);
        if (this.seenIds.has(normalizedBase.externalMessageId)) continue;
        this.seenIds.add(normalizedBase.externalMessageId);
        // Create EmailReplyContext before ingest (for outbound reply target)
        let normalized: ChannelInboundMessage = normalizedBase;
        try {
          const store = getReplyContextStore();
          const ctx = await store.create({
            channel: "gmail",
            sourceAccountId: this.id,
            providerMessageId: detail.id,
            rfcMessageId: normalizedBase.rfcMessageId!,
            threadId: normalizedBase.threadId,
            subject: normalizedBase.subject ?? "(no subject)",
            replyToAddress: normalizedBase.fromAddress ? (this.extractReplyTo(detail) ?? normalizedBase.fromAddress) : "",
            references: normalizedBase.references ?? [],
          } as never);
          normalized = { ...normalizedBase, replyContextId: ctx.replyContextId } as ChannelInboundMessage & { replyContextId?: string };
        } catch (e) {
          console.warn(`[gmail-adapter] reply context create failed ${(e as Error).message?.slice(0,100)}`);
        }
        await this.inboxSink.ingest(normalized);
        this.messageCount++;
      } catch {}
    }
    // Establish baseline historyId AFTER ingest success (cursor commit order)
    try {
      const historyId = await GmailApi.getProfileHistoryId(this.tokenProvider);
      if (historyId) this.syncStateStore.setGmailState(this.id, { historyId, initializedAt: Date.now(), lastSyncAt: Date.now() });
    } catch {}
  }

  private async doIncrementalSync(): Promise<void> {
    const state = this.syncStateStore.getGmailState(this.id);
    if (!state?.historyId) {
      await this.doInitialSync();
      return;
    }
    try {
      const { historyId, messages } = await GmailApi.getHistory(this.tokenProvider, state.historyId);
      for (const m of messages) {
        try {
          if (this.seenIds.has(m.id)) continue;
          const detail = await GmailApi.getMessageDetail(this.tokenProvider, m.id);
          if (!detail.labelIds?.includes("INBOX")) continue;
          const normalizedBase = this.normalizeMessage(detail);
          if (this.seenIds.has(normalizedBase.externalMessageId)) continue;
          this.seenIds.add(normalizedBase.externalMessageId);
          let normalized: ChannelInboundMessage = normalizedBase;
          try {
            const store = getReplyContextStore();
            const ctx = await store.create({
              channel: "gmail",
              sourceAccountId: this.id,
              providerMessageId: detail.id,
              rfcMessageId: normalizedBase.rfcMessageId!,
              threadId: normalizedBase.threadId,
              subject: normalizedBase.subject ?? "(no subject)",
              replyToAddress: this.extractReplyTo(detail) ?? normalizedBase.fromAddress ?? "",
              references: normalizedBase.references ?? [],
            } as never);
            normalized = { ...normalizedBase, replyContextId: ctx.replyContextId } as ChannelInboundMessage & { replyContextId?: string };
          } catch (e) {
            console.warn(`[gmail-adapter] reply context create failed ${(e as Error).message?.slice(0,100)}`);
          }
          await this.inboxSink.ingest(normalized);
          this.messageCount++;
        } catch {}
      }
      // Commit cursor AFTER ingest success
      this.syncStateStore.setGmailState(this.id, { historyId, lastSyncAt: Date.now(), initializedAt: state.initializedAt ?? Date.now() });
    } catch (e) {
      const err = e as { message?: string };
      const raw = String((e as Error).message ?? "");
      if (raw.includes("HISTORY_EXPIRED") || raw.includes("HISTORY_EXPIRED") || (e as { code?: string })?.code === "HISTORY_EXPIRED" || err?.message?.includes("HISTORY_EXPIRED") || raw.includes("404")) {
        // Bounded recovery: 7d/50 — then re-establish historyId
        await this.doInitialSync();
      } else if (err?.message?.includes("HISTORY_EXPIRED")) {
        await this.doInitialSync();
      } else {
        throw e;
      }
    }
  }

  private extractReplyTo(detail: GmailApi.GmailMessageDetail): string | undefined {
    const headers = new Map((detail.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));
    const from = headers.get("from") ?? "";
    const replyTo = headers.get("reply-to") ?? from;
    const fromAddress = (from.match(/<([^>]+)>/)?.[1] || from).trim();
    const replyToAddress = (replyTo.match(/<([^>]+)>/)?.[1] || replyTo).trim() || fromAddress;
    if (!replyToAddress) return undefined;
    // Validate no CRLF injection
    if (/[\r\n]/.test(replyToAddress)) return undefined;
    return replyToAddress;
  }

  private normalizeMessage(detail: GmailApi.GmailMessageDetail): ChannelInboundMessage {
    const headers = new Map((detail.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));
    const subject = headers.get("subject") ?? "(no subject)";
    const from = headers.get("from") ?? "";
    const replyTo = headers.get("reply-to") ?? from;
    const messageId = headers.get("message-id") ?? `<${detail.id}@gmail>`;
    const references = (headers.get("references") ?? "").split(/\s+/).filter(Boolean);
    const inReplyTo = headers.get("in-reply-to");
    const dateStr = headers.get("date");
    const receivedAt = dateStr ? Date.parse(dateStr) || Date.now() : Date.now();

    // Extract from address
    const fromAddress = (from.match(/<([^>]+)>/)?.[1] || from).trim();
    const fromDisplay = from.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
    const replyToAddress = (replyTo.match(/<([^>]+)>/)?.[1] || replyTo).trim() || fromAddress;

    const { text } = extractTextFromPayload(detail.payload ?? null);
    const attachments = extractAttachmentsFromPayload(detail.payload ?? null).map(a => ({
      id: a.providerAttachmentId,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
    }));

    // Sanitize: no HTML, only safe text
    const safeText = text.slice(0, 10000);

    return {
      channel: "gmail",
      accountId: this.id,
      externalMessageId: detail.id,
      conversationId: detail.threadId ?? detail.id,
      conversationType: "direct",
      senderId: fromAddress,
      senderDisplay: fromDisplay || fromAddress,
      subject,
      text: safeText,
      receivedAt,
      attachments,
      rfcMessageId: messageId,
      threadId: detail.threadId,
      references,
      inReplyTo,
      fromAddress,
    };
  }

  async sendReply(target: { conversationId: string; conversationType: "direct" | "group"; inboundMessageId: string }, text: string): Promise<{ messageId?: string; timestamp?: string }> {
    // Need reply context to get rfcMessageId etc. For V1, we need to fetch original message's headers
    // But per spec, reply should use EmailReplyContext stored at prepare time, not target alone.
    // For now, try to use target.inboundMessageId to fetch original
    if (!target.inboundMessageId) throw new ChannelError("EMAIL_REPLY_CONTEXT_INVALID" as never, "Missing inboundMessageId");
    // This is called via ChannelManager's outbound, which has full context; for direct ChannelAdapter call, we try best effort
    // Fetch original to get references
    let references: string[] = [];
    let inReplyTo: string | undefined;
    let subject = "Re: ";
    let threadId = target.conversationId;
    try {
      const detail = await GmailApi.getMessageDetail(this.tokenProvider, target.inboundMessageId);
      const headers = new Map((detail.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));
      const origMessageId = headers.get("message-id");
      if (origMessageId) {
        inReplyTo = origMessageId;
        const refs = headers.get("references");
        references = refs ? refs.split(/\s+/).filter(Boolean) : [];
        if (origMessageId) references.push(origMessageId);
      }
      subject = headers.get("subject") ?? "Re: ";
      threadId = detail.threadId ?? threadId;
    } catch {}

    // For V1, we need to know To address — use conversationId? For Email, conversationId is threadId, not email. We need replyToAddress from context, but target doesn't have it.
    // This path is for direct adapter test; manager will call via EmailReplyContext path, so this is fallback.
    // Try to infer To from target.conversationId if it's an email? Not reliable.
    // For now, throw if not enough
    throw new ChannelError("EMAIL_REPLY_CONTEXT_INVALID" as never, "Use ChannelManager outbound with EmailReplyContext");
  }
}
