/**
 * Kiro Conversation History — IndexedDB 存储层。
 * 独立 DB（classflow-kiro），不污染 classflow-files（课程资料 Blob）。
 * v1：conversations store + updatedAt index（排序）。结构预留未来 migration（不删除重建）。
 */

import { KiroConversationRecord } from "@/lib/ai/history/types";

export const KIRO_HISTORY_DB_NAME = "classflow-kiro";
export const KIRO_HISTORY_STORE = "conversations";
export const KIRO_HISTORY_DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(KIRO_HISTORY_DB_NAME, KIRO_HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KIRO_HISTORY_STORE)) {
        const store = db.createObjectStore(KIRO_HISTORY_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** 仅供测试：重置缓存的 DB 连接（删除数据库后使用） */
export function resetKiroHistoryDbForTests(): void {
  dbPromise = null;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(KIRO_HISTORY_STORE, mode);
        const req = fn(t.objectStore(KIRO_HISTORY_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** 列表：updatedAt DESC；损坏记录跳过（console.warn，不打印内容） */
export async function listConversations(): Promise<KiroConversationRecord[]> {
  try {
    const db = await openDB();
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
    const rec = await tx<KiroConversationRecord | undefined>("readonly", (s) => s.get(id));
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
  await tx("readwrite", (s) => s.put(record));
}

export async function deleteConversationRecord(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function renameConversationRecord(id: string, title: string): Promise<void> {
  await openDB().then(
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
  await openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(KIRO_HISTORY_STORE, "readwrite");
        t.objectStore(KIRO_HISTORY_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}
