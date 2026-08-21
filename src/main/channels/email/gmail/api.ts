/**
 * Gmail API — Task 18A
 * Uses tokenProvider for auth, fetch for Gmail REST.
 */

import { GmailTokenProvider } from "./tokenProvider";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageListItem {
  id: string;
  threadId?: string;
}

export interface GmailMessageDetail {
  id: string;
  threadId?: string;
  labelIds?: string[];
  payload?: import("../bodyParser").GmailPayloadPart;
  internalDate?: string;
  headers?: Array<{ name: string; value: string }>;
}

export async function listInboxMessages(tokenProvider: GmailTokenProvider, maxResults = 50): Promise<GmailMessageListItem[]> {
  const token = await tokenProvider.getAccessToken();
  const params = new URLSearchParams({
    q: "in:inbox newer_than:7d",
    maxResults: String(maxResults),
  });
  const res = await fetch(`${GMAIL_BASE}/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail list failed ${res.status}`);
  const data = await res.json() as { messages?: GmailMessageListItem[] };
  return data.messages ?? [];
}

export async function getMessageDetail(tokenProvider: GmailTokenProvider, messageId: string): Promise<GmailMessageDetail> {
  const token = await tokenProvider.getAccessToken();
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail get failed ${res.status}`);
  const data = await res.json() as GmailMessageDetail & { payload?: unknown };
  return data;
}

export async function getHistory(tokenProvider: GmailTokenProvider, startHistoryId: string): Promise<{ historyId: string; messages: Array<{ id: string; threadId?: string }> }> {
  const token = await tokenProvider.getAccessToken();
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
  });
  const res = await fetch(`${GMAIL_BASE}/history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 404 || err.includes("notFound") || err.includes("invalid")) {
      throw new Error(JSON.stringify({ code: "HISTORY_EXPIRED", message: "historyId expired" }));
    }
    throw new Error(`Gmail history failed ${res.status}`);
  }
  const data = await res.json() as { historyId?: string; history?: Array<{ messages?: Array<{ id: string; threadId?: string }> }> };
  const messages: Array<{ id: string; threadId?: string }> = [];
  for (const h of data.history ?? []) {
    for (const m of h.messages ?? []) messages.push(m);
  }
  return { historyId: data.historyId ?? startHistoryId, messages };
}

export async function getProfileHistoryId(tokenProvider: GmailTokenProvider): Promise<string> {
  const token = await tokenProvider.getAccessToken();
  const res = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as { historyId?: string };
  return data.historyId ?? "";
}

export async function sendMessage(tokenProvider: GmailTokenProvider, rawBase64Url: string, threadId?: string): Promise<{ id?: string }> {
  const token = await tokenProvider.getAccessToken();
  const body: Record<string, string> = { raw: rawBase64Url };
  if (threadId) body.threadId = threadId;
  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (txt.includes("invalid") || txt.toLowerCase().includes("rejected")) {
      throw new Error(JSON.stringify({ code: "EMAIL_SEND_REJECTED", message: txt.slice(0, 200) }));
    }
    throw new Error(JSON.stringify({ code: "EMAIL_SEND_UNCERTAIN", message: txt.slice(0, 200) }));
  }
  return await res.json() as { id?: string };
}
