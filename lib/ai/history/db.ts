/**
 * Kiro Conversation History — IndexedDB 存储层（复用统一 classflow-kiro v2 DB）。
 */

import { KiroConversationRecord } from "@/lib/ai/history/types";
import { openKiroDB, kiroTx, KIRO_CONVERSATIONS_STORE, resetKiroDbForTests } from "@/lib/ai/storage/kiroDb";

export const KIRO_HISTORY_DB_NAME = "classflow-kiro";
export const KIRO_HISTORY_STORE = KIRO_CONVERSATIONS_STORE;
export const KIRO_HISTORY_DB_VERSION = 2;

/** 列表：updatedAt DESC；损坏记录跳过（console.warn，不打印内容） */
export async function listConversations(): Promise<KiroConversationRecord[]> {
  try {
    const db = await openKiroDB();
    const all = await new Promise<KiroConversationRecord[]>((resolve, reject) => {
      const t = db.transaction(KIRO_HISTORY_STORE, "readonly");
      const req = t.objectStore(KIRO_HISTORY_STORE).getAll();
      req.onsuccess = () => resolve((req.result as KiroConversationRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return all
      .filter((r) => {
        const ok = r && typeof r.id === "string" && Array.isArray(r.messages);
        if (!ok) console.warn("kiro history: skipped malformed conversation record");
        return ok;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  } catch (err) {
    console.warn("kiro history: list failed", err);
    return [];
  }
}

/** 读取单条；损坏 / 不存在返回 null */
export async function getConversation(id: string): Promise<KiroConversationRecord | null> {
  try {
    const rec = await kiroTx<KiroConversationRecord | undefined>(KIRO_HISTORY_STORE, "readonly", (s) => s.get(id));
    if (!rec || typeof rec.id !== "string" || !Array.isArray(rec.messages)) {
      console.warn("kiro history: skipped malformed conversation record");
      return null;
    }
    return rec;
  } catch (err) {
    console.warn("kiro history: get failed", err);
    return null;
  }
}

export async function saveConversation(record: KiroConversationRecord): Promise<void> {
  await kiroTx(KIRO_HISTORY_STORE, "readwrite", (s) => s.put(record));
}

export async function deleteConversationRecord(id: string): Promise<void> {
  await kiroTx(KIRO_HISTORY_STORE, "readwrite", (s) => s.delete(id));
}

export async function renameConversationRecord(id: string, title: string): Promise<void> {
  await openKiroDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(KIRO_HISTORY_STORE, "readwrite");
        const getReq = t.objectStore(KIRO_HISTORY_STORE).get(id);
        getReq.onsuccess = () => {
          const rec = getReq.result as KiroConversationRecord | undefined;
          if (!rec) {
            resolve();
            return;
          }
          rec.title = title;
          rec.updatedAt = new Date().toISOString();
          t.objectStore(KIRO_HISTORY_STORE).put(rec);
        };
        getReq.onerror = () => reject(getReq.error);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}

export async function clearConversationHistory(): Promise<void> {
  await openKiroDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(KIRO_HISTORY_STORE, "readwrite");
        t.objectStore(KIRO_HISTORY_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}

/** 仅供测试 */
export { resetKiroDbForTests };
