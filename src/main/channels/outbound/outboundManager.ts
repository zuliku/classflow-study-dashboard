/**
 * Outbound Manager — Task 14 explicit QQ reply flow
 * Handles prepareReply -> approval, confirmReply -> send, with one-shot, rate limit, audit, anti-loop
 */

import { randomUUID, createHash } from "node:crypto";
import { ChannelError } from "../errors";
import { getReplyContextStore } from "./replyContextStore";
import { getApprovalStore } from "./approvalStore";
import { getChannelManager } from "../manager";
import { QQOutboundRateLimiter } from "./rateLimiter";
import { getOutboundAuditStore } from "./audit";
import { getRuntimeSecretVault } from "@/src/main/secrets/secretRuntime";
import type { EmailReplyContext, QQReplyContext } from "./types";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function validateText(text: string): void {
  if (typeof text !== "string" || text.trim().length === 0) throw new ChannelError("INVALID_INPUT" as never, "回复正文不能为空");
  if (text.trim().length === 0) throw new ChannelError("INVALID_INPUT" as never, "不能发送空白消息");
  if (text.includes("\u0000")) throw new ChannelError("INVALID_INPUT" as never, "包含非法字符");
  // ClassFlow internal limit (not claiming QQ official)
  const MAX = 2000;
  if (text.length > MAX) throw new ChannelError("INVALID_INPUT" as never, `回复不能超过 ${MAX} 字符`);
}

const rateLimiter = new QQOutboundRateLimiter();

export async function prepareReply(input: { replyContextId: string; text: string }): Promise<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } }> {
  const { replyContextId, text } = input;
  if (!replyContextId || typeof replyContextId !== "string") throw new ChannelError("INVALID_INPUT" as never, "replyContextId required");
  validateText(text);

  const ctxStore = getReplyContextStore();
  const ctx = ctxStore.get(replyContextId);
  if (!ctx) throw new ChannelError("CHANNEL_REPLY_CONTEXT_NOT_FOUND" as never, "Reply context not found");
  if (ctx.expiresAt < Date.now()) throw new ChannelError("CHANNEL_REPLY_CONTEXT_EXPIRED" as never, "Reply context expired");
  if (ctx.channel !== "qq-bot" && ctx.channel !== "gmail" && ctx.channel !== "qq-mail") throw new ChannelError("CHANNEL_REPLY_CONTEXT_INVALID" as never, "Invalid channel");
  if (!ctx.inboundMessageId) throw new ChannelError(ctx.channel === "gmail" || ctx.channel === "qq-mail" ? "EMAIL_REPLY_CONTEXT_INVALID" as never : "QQ_REPLY_CONTEXT_INVALID" as never, "Missing inboundMessageId");

  const approvalStore = getApprovalStore();
  const approval = approvalStore.create(replyContextId, text.trim());

  return {
    approvalId: approval.approvalId,
    expiresAt: approval.expiresAt,
    preview: {
      channel: ctx.channel === "gmail" ? "Gmail" : ctx.channel === "qq-mail" ? "QQ Mail" : "QQ",
      conversationType: (ctx as unknown as { conversationType: string }).conversationType ?? "direct",
      text: text.trim(),
    },
  };
}

export async function confirmReply(input: { approvalId: string }): Promise<{ ok: boolean; platformMessageId?: string }> {
  const { approvalId } = input;
  if (!approvalId) throw new ChannelError("INVALID_INPUT" as never, "approvalId required");

  const approvalStore = getApprovalStore();
  const approval = approvalStore.get(approvalId);
  if (!approval) throw new ChannelError("CHANNEL_SEND_APPROVAL_NOT_FOUND" as never, "Approval not found");
  if (approval.expiresAt < Date.now()) throw new ChannelError("CHANNEL_SEND_APPROVAL_EXPIRED" as never, "Approval expired");
  if (approval.used) throw new ChannelError("CHANNEL_SEND_APPROVAL_USED" as never, "Approval already used");

  const ctxStore = getReplyContextStore();
  const ctx = ctxStore.get(approval.replyContextId);
  if (!ctx) throw new ChannelError("CHANNEL_REPLY_CONTEXT_NOT_FOUND" as never, "Reply context not found");
  if (ctx.expiresAt < Date.now()) throw new ChannelError("CHANNEL_REPLY_CONTEXT_EXPIRED" as never, "Reply context expired");
  if (!ctx.inboundMessageId) throw new ChannelError((ctx.channel === "gmail" || ctx.channel === "qq-mail" ? "EMAIL_REPLY_CONTEXT_INVALID" : "QQ_REPLY_CONTEXT_INVALID") as never, "Missing inboundMessageId");

  // Rate limit per account/global
  const rate = rateLimiter.allow(ctx.sourceAccountId);
  if (!rate.allowed) throw new ChannelError("QQ_RATE_LIMITED" as never, "发送过于频繁");

  // One-shot consume BEFORE dispatch to prevent double click
  const consumed = approvalStore.consume(approvalId);
  if (!consumed) throw new ChannelError("CHANNEL_SEND_APPROVAL_USED" as never, "Approval already used");

  // Find channel config via sourceAccountId (via outboundManager's manager, not renderer-provided)
  const channelManager = getChannelManager();
  const cfg = channelManager.getConfig(ctx.sourceAccountId);
  if (!cfg) throw new ChannelError("CHANNEL_NOT_FOUND" as never, "Channel not found for reply context");

  // Build target with msgId (must not be empty, no fallback) — already validated above, but double-check
  if (!ctx.inboundMessageId) {
    const auditStore = getOutboundAuditStore();
    auditStore.add({
      outboundId: `out_${randomUUID().slice(0, 8)}`,
      channel: "qq-bot",
      sourceAccountId: ctx.sourceAccountId,
      replyContextId: ctx.replyContextId,
      textHash: approval.textHash,
      textLength: approval.text.length,
      attemptedAt: Date.now(),
      status: "failed",
      errorCode: "QQ_REPLY_CONTEXT_INVALID",
    });
    throw new ChannelError("QQ_REPLY_CONTEXT_INVALID" as never, "Missing inboundMessageId, cannot send as passive reply");
  }

  let result: { messageId?: string; timestamp?: string } | null = null;
  let status: "sent" | "failed" | "uncertain" = "sent";
  let errorCode: string | undefined;
  let platformMessageId: string | undefined;
  const isEmail = ctx.channel === "gmail" || ctx.channel === "qq-mail";

  try {
    if (isEmail) {
      result = await (channelManager as unknown as { sendEmailReply: (c: EmailReplyContext, t: string) => Promise<{ messageId?: string }> }).sendEmailReply(ctx as EmailReplyContext, approval.text);
    } else {
      result = await channelManager.sendQQReply(ctx as QQReplyContext, approval.text);
    }
    platformMessageId = result?.messageId;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const lower = raw.toLowerCase();
    // Uncertain cases: timeout, reset, network closed after dispatch
    if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("network") || lower.includes("abort") || lower.includes("reset") || lower.includes("closed")) {
      status = "uncertain";
      errorCode = isEmail ? "EMAIL_SEND_UNCERTAIN" : "QQ_SEND_UNCERTAIN";
    } else if (raw.includes("QQ_REPLY_REJECTED") || raw.includes("EMAIL_SEND_REJECTED") || lower.includes("rejected") || lower.includes("lifecycle") || lower.includes("passive")) {
      status = "failed";
      errorCode = isEmail ? "EMAIL_SEND_REJECTED" : "QQ_REPLY_REJECTED";
    } else if (lower.includes("429") || lower.includes("rate")) {
      status = "failed";
      errorCode = isEmail ? "EMAIL_SEND_REJECTED" : "QQ_RATE_LIMITED";
    } else if (lower.includes("401") || lower.includes("403") || lower.includes("auth")) {
      status = "failed";
      errorCode = isEmail ? "GMAIL_AUTH_FAILED" : "QQ_AUTH_FAILED";
    } else {
      status = "failed";
      errorCode = isEmail ? "EMAIL_SEND_REJECTED" : "QQ_SEND_REJECTED";
    }
    const auditStore = getOutboundAuditStore();
    auditStore.add({
      outboundId: `out_${randomUUID().slice(0, 8)}`,
      channel: ctx.channel,
      sourceAccountId: ctx.sourceAccountId,
      replyContextId: ctx.replyContextId,
      textHash: approval.textHash,
      textLength: approval.text.length,
      attemptedAt: Date.now(),
      status,
      platformMessageId,
      errorCode,
    });
    if (status === "uncertain") throw new ChannelError((isEmail ? "EMAIL_SEND_UNCERTAIN" : "QQ_SEND_UNCERTAIN") as never, isEmail ? "发送结果不确定，请先检查 Gmail，避免重复发送。" : "发送结果不确定，请先检查 QQ，避免重复发送。");
    throw new ChannelError((errorCode as never) ?? (isEmail ? "EMAIL_SEND_REJECTED" : "QQ_SEND_REJECTED"), raw.slice(0, 200));
  }

  // Success audit
  const auditStore = getOutboundAuditStore();
  auditStore.add({
    outboundId: `out_${randomUUID().slice(0, 8)}`,
    channel: ctx.channel,
    sourceAccountId: ctx.sourceAccountId,
    replyContextId: ctx.replyContextId,
    textHash: approval.textHash,
    textLength: approval.text.length,
    attemptedAt: Date.now(),
    status: "sent",
    platformMessageId,
  });

  return { ok: true, platformMessageId };
}

export async function cancelReply(input: { approvalId: string }): Promise<{ ok: boolean }> {
  const store = getApprovalStore();
  const ok = store.cancel(input.approvalId);
  if (!ok) throw new ChannelError("CHANNEL_SEND_APPROVAL_NOT_FOUND" as never, "Approval not found or already used");
  return { ok: true };
}

export async function canReply(input: { replyContextId: string }): Promise<{ ok: boolean; reason?: string }> {
  const ctx = getReplyContextStore().get(input.replyContextId);
  if (!ctx) return { ok: false, reason: "CHANNEL_REPLY_CONTEXT_NOT_FOUND" };
  if (ctx.expiresAt < Date.now()) return { ok: false, reason: "CHANNEL_REPLY_CONTEXT_EXPIRED" };
  if (!ctx.inboundMessageId) return { ok: false, reason: ctx.channel === "gmail" || (ctx as unknown as { channel: string }).channel === "qq-mail" ? "EMAIL_REPLY_CONTEXT_INVALID" : "QQ_REPLY_CONTEXT_INVALID" };
  return { ok: true };
}
