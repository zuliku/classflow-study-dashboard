/**
 * QQ Mail MIME helpers — Task 18B
 * Selects safe text part, extracts attachment metadata, normalizes headers.
 * Reuses Email Core bodyParser for HTML sanitization.
 */

import { htmlToSafeText } from "../bodyParser";

export interface QqMailBodyStructureNode {
  type?: string;
  subtype?: string;
  part?: string;
  disposition?: string;
  filename?: string;
  size?: number;
  encoding?: string;
  childNodes?: QqMailBodyStructureNode[];
}

export interface QqMailAttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
  partId: string;
}

export function findTextPart(structure: QqMailBodyStructureNode | null | undefined): { partId: string | null; isHtml: boolean } {
  if (!structure) return { partId: null, isHtml: false };
  const queue: QqMailBodyStructureNode[] = [structure];
  let htmlCandidate: string | null = null;
  while (queue.length) {
    const node = queue.shift()!;
    const mime = `${node.type ?? ""}/${node.subtype ?? ""}`.toLowerCase();
    const isAttachment = node.disposition === "attachment" || !!node.filename;
    if (!isAttachment) {
      if (mime === "text/plain" && node.part) {
        return { partId: node.part, isHtml: false };
      }
      if (mime === "text/html" && node.part && !htmlCandidate) {
        htmlCandidate = node.part;
      }
    }
    if (node.childNodes) {
      for (const child of node.childNodes) queue.push(child);
    }
  }
  if (htmlCandidate) return { partId: htmlCandidate, isHtml: true };
  return { partId: null, isHtml: false };
}

export function extractAttachmentsMeta(structure: QqMailBodyStructureNode | null | undefined): QqMailAttachmentMeta[] {
  const out: QqMailAttachmentMeta[] = [];
  if (!structure) return out;
  const queue: QqMailBodyStructureNode[] = [structure];
  while (queue.length) {
    const node = queue.shift()!;
    const isAttachment = node.disposition === "attachment" || !!node.filename;
    if (isAttachment && node.part) {
      const mime = `${node.type ?? "application"}/${node.subtype ?? "octet-stream"}`.toLowerCase();
      out.push({
        name: node.filename ?? `attachment-${node.part}`,
        mimeType: mime,
        size: node.size ?? 0,
        partId: node.part,
      });
    }
    if (node.childNodes) for (const child of node.childNodes) queue.push(child);
  }
  return out.slice(0, 20);
}

export function decodeBodyPartContent(content: string, encoding?: string): string {
  if (!content) return "";
  // ImapFlow typically returns decoded string already, but handle base64 if needed
  try {
    if (encoding?.toLowerCase() === "base64") {
      return Buffer.from(content, "base64").toString("utf-8");
    }
  } catch {}
  return content;
}

export function toSafeText(plainText: string | null, htmlText: string | null, isHtmlFallback: boolean): { text: string; usedHtmlFallback: boolean } {
  if (plainText && plainText.trim()) {
    return { text: plainText.trim().slice(0, 10000), usedHtmlFallback: false };
  }
  if (htmlText) {
    const safe = htmlToSafeText(htmlText);
    return { text: safe.slice(0, 10000), usedHtmlFallback: true };
  }
  return { text: "", usedHtmlFallback: isHtmlFallback };
}

export function normalizeHeaderValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim();
}

export function extractReplyToAddress(headers: Map<string, string>, envelopeFrom: string): string {
  const replyTo = headers.get("reply-to") ?? headers.get("reply_to") ?? "";
  const from = headers.get("from") ?? envelopeFrom ?? "";
  const raw = replyTo || from;
  // Extract email via angle brackets or raw
  const match = raw.match(/<([^>]+)>/);
  const addr = (match ? match[1] : raw).trim().split(/\s+/)[0] ?? "";
  // Reject header injection
  if (/[\r\n]/.test(addr)) return "";
  return addr;
}
