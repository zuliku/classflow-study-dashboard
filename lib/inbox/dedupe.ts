/**
 * Inbox Deduplication — Task 10
 * 优先 provider + externalMessageId，否则 stable content hash
 */

export function createHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getInboxDedupeKey(input: { source: string; externalMessageId?: string; text: string; senderDisplay?: string; sourceAccountId?: string }): string {
  const accountPart = input.sourceAccountId ? `:${input.sourceAccountId}` : "";
  if (input.externalMessageId) return `${input.source}${accountPart}:${input.externalMessageId}`;
  return `${input.source}${accountPart}:${createHash(input.text + (input.senderDisplay ?? ""))}`;
}
