/**
 * Gmail MIME — Task 18A
 * Build plain-text RFC message for reply, keep thread.
 */

export interface BuildReplyOptions {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references: string[];
  threadId?: string;
}

function sanitizeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Header injection");
  return value;
}

function encodeSubject(subject: string): string {
  // Simple: if ascii, return as is, else encode
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

export function buildReplyMime(opts: BuildReplyOptions): string {
  const to = sanitizeHeader(opts.to);
  if (!to || !to.includes("@")) throw new Error("Invalid To");
  const subjectRaw = opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`;
  const subject = encodeSubject(sanitizeHeader(subjectRaw));
  const inReplyTo = opts.inReplyTo ? sanitizeHeader(opts.inReplyTo) : undefined;
  const refs = opts.references.map(sanitizeHeader).join(" ");

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (refs) headers.push(`References: ${refs}`);

  const body = Buffer.from(opts.text, "utf-8").toString("base64");

  const raw = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(raw, "utf-8").toString("base64url");
}

export function sanitizeTextForKiro(text: string): string {
  return text.slice(0, 10000);
}
