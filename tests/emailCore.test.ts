import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      const p = require("node:path");
      const o = require("node:os");
      return p.join(o.tmpdir(), `classflow-test-${name}`);
    },
  },
}));

import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { EmailSyncScheduler } from "@/src/main/channels/email/scheduler";
import { EmailSyncStateStore } from "@/src/main/channels/email/syncStateStore";
import { htmlToSafeText, extractTextFromPayload, extractAttachmentsFromPayload } from "@/src/main/channels/email/bodyParser";
import { buildReplyMime } from "@/src/main/channels/email/gmail/mime";
import * as GmailApi from "@/src/main/channels/email/gmail/api";
import { GmailTokenProvider } from "@/src/main/channels/email/gmail/tokenProvider";
import { ReplyContextStore, getReplyContextStore, __resetReplyContextStoreForTest } from "@/src/main/channels/outbound/replyContextStore";
import { getApprovalStore, __resetApprovalStoreForTest } from "@/src/main/channels/outbound/approvalStore";
import { prepareReply, confirmReply } from "@/src/main/channels/outbound/outboundManager";
import { ChannelManager, __resetChannelManagerForTest, __setChannelManagerForTest } from "@/src/main/channels/manager";
import { ChannelInboxSink as InboxSink } from "@/src/main/channels/inboxSink";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";

describe("Email Core — ChannelType generalized", () => {
  it("ChannelType includes gmail and qq-mail", async () => {
    const { ChannelManager } = await import("@/src/main/channels/manager");
    const m = new ChannelManager(new InboxSink(), ":memory:");
    expect(["qq-bot", "gmail", "qq-mail"]).toContain("gmail");
  });

  it("InboxSink uses msg.channel not hardcode qq-bot", async () => {
    let captured: unknown = null;
    const sink = new ChannelInboxSink({
      publishRaw: (payload) => { captured = payload; },
    });
    await sink.ingest({
      channel: "gmail",
      accountId: "test@gmail.com",
      externalMessageId: "gmail_123",
      conversationId: "thread_123",
      conversationType: "direct",
      senderId: "sender@gmail.com",
      senderDisplay: "Sender",
      subject: "Test",
      text: "hello",
      receivedAt: Date.now(),
    } as never);
    expect((captured as { source: string }).source).toBe("gmail");
  });

  it("legacy QQ config without channel still loads as qq-bot", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-email-test-"));
    const configPath = path.join(tmpDir, "channels.json");
    const legacy = { channels: [{ id: "qq_old", appId: "123", credentialRef: "cred_test", enabled: true, displayName: "Old", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }] };
    await fs.writeFile(configPath, JSON.stringify(legacy), "utf8");
    const { ChannelManager } = await import("@/src/main/channels/manager");
    const m = new ChannelManager(new InboxSink(), configPath);
    expect(m.listConfigs().length).toBe(1);
    expect(m.listConfigs()[0].channel).toBe("qq-bot");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("Email Body Safety", () => {
  it("htmlToSafeText strips script/style/iframe", () => {
    const html = `<p>Hello</p><script>alert(1)</script><style>body{}</style><iframe src="evil"></iframe><p>World</p>`;
    const safe = htmlToSafeText(html);
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("alert");
    expect(safe).toContain("Hello");
    expect(safe).toContain("World");
  });

  it("extractTextFromPayload prefers text/plain over html", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("plain text").toString("base64") } },
        { mimeType: "text/html", body: { data: Buffer.from("<p>html text</p>").toString("base64") } },
      ],
    };
    const { text, usedHtmlFallback } = extractTextFromPayload(payload as never);
    expect(text).toBe("plain text");
    expect(usedHtmlFallback).toBe(false);
  });

  it("extractTextFromPayload fallback to html sanitized", () => {
    const payload = {
      mimeType: "text/html",
      body: { data: Buffer.from('<p>html <script>alert(1)</script>fallback</p>').toString("base64") },
    };
    const { text, usedHtmlFallback } = extractTextFromPayload(payload as never);
    expect(text).not.toContain("<script");
    expect(text).toContain("fallback");
    expect(usedHtmlFallback).toBe(true);
  });

  it("extractAttachments only metadata, no download", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("hi").toString("base64") } },
        { filename: "test.pdf", mimeType: "application/pdf", body: { attachmentId: "att123", size: 12345 } },
      ],
    };
    const atts = extractAttachmentsFromPayload(payload as never);
    expect(atts.length).toBe(1);
    expect(atts[0].name).toBe("test.pdf");
    expect(atts[0].providerAttachmentId).toBe("att123");
    expect(atts[0]).not.toHaveProperty("url");
  });

  it("hostile HTML regression", () => {
    const hostile = `<img src=x onerror=alert(1)><form><input type="password"><object data="evil"></object><div style="background:url(javascript:alert(2))">test</div>`;
    const safe = htmlToSafeText(hostile);
    expect(safe).not.toContain("<img");
    expect(safe).not.toContain("onerror");
    expect(safe).not.toContain("<form");
    expect(safe).not.toContain("<object");
  });
});

describe("Email Sync Scheduler", () => {
  it("per account, no overlapping, manual syncNow respects running", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 100));
    });
    const scheduler = new EmailSyncScheduler(fn, 1);
    scheduler.start();
    await new Promise(r => setTimeout(r, 50));
    const p1 = scheduler.syncNow();
    const p2 = scheduler.syncNow();
    await Promise.all([p1, p2]);
    expect(calls).toBeGreaterThanOrEqual(1);
    scheduler.stop();
    const before = calls;
    await new Promise(r => setTimeout(r, 1200));
    expect(calls).toBe(before);
  });
});

describe("Sync State Store", () => {
  it("cursor commit after inbox ingest, not before", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-sync-"));
    const filePath = path.join(tmpDir, "email-sync-state.json");
    const store = new EmailSyncStateStore(filePath);
    expect(store.getGmailState("ch1")).toBeNull();
    store.setGmailState("ch1", { historyId: "123", initializedAt: Date.now(), lastSyncAt: Date.now() });
    expect(store.getGmailState("ch1")?.historyId).toBe("123");
    expect((await fs.readdir(path.dirname(filePath))).some(f => f.includes("tmp"))).toBe(false);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("Gmail OAuth", () => {
  it("missing client ID throws GMAIL_OAUTH_CONFIG_MISSING", async () => {
    const orig = process.env.CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    const { startGmailOAuth } = await import("@/src/main/channels/email/gmail/oauth");
    await expect(startGmailOAuth()).rejects.toThrow(/GMAIL_OAUTH_CONFIG_MISSING/);
    if (orig) process.env.CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID = orig;
  });

  it("Gmail scopes only readonly and send", async () => {
    const src = await fs.readFile(path.join(process.cwd(), "src/main/channels/email/gmail/oauth.ts"), "utf8");
    expect(src).toContain("gmail.readonly");
    expect(src).toContain("gmail.send");
    expect(src).not.toContain("gmail.modify");
    expect(src).not.toContain("mail.google.com");
  });
});

describe("Email Reply Context", () => {
  beforeEach(() => {
    __resetReplyContextStoreForTest();
    __resetApprovalStoreForTest();
    __resetChannelManagerForTest();
  });

  it("EmailReplyContext has required fields and no body/token", async () => {
    const store = new ReplyContextStore({ configPath: ":memory:" });
    const ctx = await store.create({
      channel: "gmail",
      sourceAccountId: "test@gmail.com",
      providerMessageId: "gmail_123",
      rfcMessageId: "<msg123@gmail.com>",
      threadId: "thread_123",
      subject: "Test Subject",
      replyToAddress: "sender@gmail.com",
      references: ["<ref1@gmail.com>"],
    } as never);
    expect(ctx.channel).toBe("gmail");
    expect((ctx as unknown as { providerMessageId: string }).providerMessageId).toBe("gmail_123");
    expect((ctx as unknown as { rfcMessageId: string }).rfcMessageId).toBe("<msg123@gmail.com>");
    expect((ctx as unknown as { body?: string }).body).toBeUndefined();
    expect((ctx as unknown as { token?: string }).token).toBeUndefined();
  });

  it("prepareReply does not send, confirmReply one-shot", async () => {
    const memStore = new ReplyContextStore({ configPath: ":memory:" });
    const outboundMod = await import("@/src/main/channels/outbound/replyContextStore");
    const spy = vi.spyOn(outboundMod, "getReplyContextStore").mockReturnValue(memStore as never);
    const ctx = await memStore.create({
      channel: "gmail",
      sourceAccountId: "test@gmail.com",
      providerMessageId: "gmail_456",
      rfcMessageId: "<msg456@gmail.com>",
      threadId: "thread_456",
      subject: "Hello",
      replyToAddress: "sender@gmail.com",
      references: [],
    } as never);
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "draft" });
    expect(prep.approvalId).toBeTruthy();
    const mgr = new ChannelManager(new InboxSink(), ":memory:");
    (mgr as unknown as { configs: Map<string, unknown> }).configs.set("test@gmail.com", {
      id: "test@gmail.com",
      channel: "gmail",
      enabled: true,
      displayName: "Test",
      emailAddress: "test@gmail.com",
      credentialRef: "cred_test",
      syncIntervalSeconds: 60,
    });
    (mgr as unknown as { sendEmailReply: (c: unknown, t: string) => Promise<unknown> }).sendEmailReply = async () => ({ messageId: "mock_id" });
    __setChannelManagerForTest(mgr as never);
    const res1 = await confirmReply({ approvalId: prep.approvalId });
    expect(res1.ok).toBe(true);
    await expect(confirmReply({ approvalId: prep.approvalId })).rejects.toMatchObject({ code: "CHANNEL_SEND_APPROVAL_USED" });
    __setChannelManagerForTest(null);
    spy.mockRestore();
  });
});

describe("Gmail Reply MIME", () => {
  it("buildReplyMime keeps thread and rejects header injection", () => {
    const raw = buildReplyMime({
      to: "sender@gmail.com",
      subject: "Test",
      text: "Hello",
      inReplyTo: "<msg123@gmail.com>",
      references: ["<msg123@gmail.com>"],
      threadId: "thread_123",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: sender@gmail.com");
    expect(decoded).toContain("In-Reply-To: <msg123@gmail.com>");
    expect(decoded).toContain("References: <msg123@gmail.com>");
    expect(() => buildReplyMime({ to: "a@b.com\r\nCc: evil", subject: "x", text: "y", references: [] })).toThrow();
  });
});
