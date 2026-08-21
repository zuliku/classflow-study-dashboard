/**
 * Email Body Safety — Task 18A
 * text/plain first, text/html fallback sanitized to plain text.
 * Never return raw HTML to Renderer or Kiro.
 */

function stripHtmlToText(html: string): string {
  // Remove script/style/iframe/form/object/embed and their content
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<input[^>]*>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "");
  // Convert <br> and <p> to newlines
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<\/li>/gi, "\n");
  // Strip all remaining tags (including onerror etc)
  s = s.replace(/<[^>]+>/g, "");
  // Decode entities (basic + numeric)
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&#x2F;/gi, "/");
  // Remove any remaining javascript: or data: fragments that might have leaked via text
  s = s.replace(/javascript:/gi, "").replace(/data:\s*text\/html[^ ]*/gi, "");
  // Collapse whitespace but preserve paragraph breaks
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim().slice(0, 20000);
}

function decodeGmailBase64(data: string): string {
  // Gmail uses base64url (RFC 4648) without padding; Node handles but we normalize
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "===".slice(pad) : normalized;
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function htmlToSafeText(html: string): string {
  if (!html || typeof html !== "string") return "";
  return stripHtmlToText(html);
}

export interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  filename?: string;
  parts?: GmailPayloadPart[];
  headers?: Array<{ name: string; value: string }>;
}

export function extractTextFromPayload(payload: GmailPayloadPart | null | undefined): { text: string; usedHtmlFallback: boolean } {
  if (!payload) return { text: "", usedHtmlFallback: false };

  // Collect all text/plain and text/html parts recursively
  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  function walk(part: GmailPayloadPart) {
    const mime = (part.mimeType || "").toLowerCase();
    if (mime === "text/plain" && part.body?.data) {
      try {
        plainParts.push(decodeGmailBase64(part.body.data));
      } catch {}
    } else if (mime === "text/html" && part.body?.data) {
      try {
        const html = decodeGmailBase64(part.body.data);
        htmlParts.push(html);
      } catch {}
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }

  walk(payload);

  if (plainParts.length > 0) {
    return { text: plainParts.join("\n\n").trim().slice(0, 20000), usedHtmlFallback: false };
  }
  if (htmlParts.length > 0) {
    const safe = htmlToSafeText(htmlParts.join("\n\n"));
    return { text: safe, usedHtmlFallback: true };
  }
  return { text: "", usedHtmlFallback: false };
}

export function extractAttachmentsFromPayload(payload: GmailPayloadPart | null | undefined): Array<{ name: string; mimeType: string; size: number; providerAttachmentId: string }> {
  const out: Array<{ name: string; mimeType: string; size: number; providerAttachmentId: string }> = [];
  if (!payload) return out;

  function walk(part: GmailPayloadPart) {
    // Attachment is a part with filename and attachmentId, not text/plain/html
    const mime = (part.mimeType || "").toLowerCase();
    if (part.filename && part.body?.attachmentId) {
      out.push({
        name: part.filename,
        mimeType: mime || "application/octet-stream",
        size: part.body.size ?? 0,
        providerAttachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }

  walk(payload);
  // Do not call messages.attachments.get — only metadata
  return out.slice(0, 20);
}
