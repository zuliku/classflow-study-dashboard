/**
 * QQ Mail SMTP — Task 18B
 * Nodemailer transport for QQ Mail passive Reply only.
 */

import nodemailer from "nodemailer";
import { QQMAIL_SMTP_HOST, QQMAIL_SMTP_PORT, QQMAIL_SMTP_SECURE } from "./config";
import { ChannelError } from "../../errors";

export interface QQMailSmtpConfig {
  emailAddress: string;
  authCode: string;
}

export interface QQMailReplyOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

function sanitizeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new ChannelError("EMAIL_SEND_REJECTED" as never, "Header injection");
  return value;
}

function encodeSubject(subject: string): string {
  const raw = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const sanitized = sanitizeHeader(raw);
  if (/^[\x00-\x7F]*$/.test(sanitized)) return sanitized;
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf-8").toString("base64")}?=`;
}

export function createQQMailTransporter(config: QQMailSmtpConfig) {
  const transporter = nodemailer.createTransport({
    host: QQMAIL_SMTP_HOST,
    port: QQMAIL_SMTP_PORT,
    secure: QQMAIL_SMTP_SECURE,
    auth: {
      user: config.emailAddress,
      pass: config.authCode,
    },
  });
  return transporter;
}

export async function verifyQQMailTransporter(transporter: ReturnType<typeof createQQMailTransporter>): Promise<void> {
  try {
    await transporter.verify();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (raw.toLowerCase().includes("auth") || raw.includes("535") || raw.includes("530")) {
      throw new ChannelError("QQ_MAIL_AUTH_FAILED" as never, raw.slice(0, 200));
    }
    throw new ChannelError("EMAIL_SYNC_FAILED" as never, raw.slice(0, 200));
  }
}

export async function sendQQMailReply(
  transporter: ReturnType<typeof createQQMailTransporter>,
  opts: QQMailReplyOptions
): Promise<{ messageId?: string }> {
  const to = sanitizeHeader(opts.to);
  if (!to || !to.includes("@")) throw new ChannelError("EMAIL_SEND_REJECTED" as never, "Invalid To");
  if (/[\r\n]/.test(to)) throw new ChannelError("EMAIL_SEND_REJECTED" as never, "Header injection");

  const subject = encodeSubject(opts.subject);
  const text = opts.text;
  if (!text || !text.trim()) throw new ChannelError("INVALID_INPUT" as never, "Text required");

  const mailOptions: Record<string, unknown> = {
    from: sanitizeHeader(opts.from),
    to,
    subject,
    text: text.trim(),
    headers: {} as Record<string, string>,
  };
  if (opts.inReplyTo) (mailOptions.headers as Record<string, string>)["In-Reply-To"] = sanitizeHeader(opts.inReplyTo);
  if (opts.references) (mailOptions.headers as Record<string, string>)["References"] = sanitizeHeader(opts.references);

  // V1: no CC, BCC, no HTML, no attachments, passive reply only

  try {
    const info = (await transporter.sendMail(mailOptions)) as { messageId?: string };
    return { messageId: info.messageId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const lower = raw.toLowerCase();
    if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("socket") || lower.includes("closed") || lower.includes("reset")) {
      throw new ChannelError("EMAIL_SEND_UNCERTAIN" as never, raw.slice(0, 200));
    }
    throw new ChannelError("EMAIL_SEND_REJECTED" as never, raw.slice(0, 200));
  }
}
