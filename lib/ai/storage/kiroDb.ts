/**
 * Kiro 统一 IndexedDB（classflow-kiro v2）。
 * v1：conversations（History）
 * v2：+ memories（长期学习记忆）
 * 升级采用增量 onupgradeneeded（只补建缺失 store），禁止删库重建。
 */

export const KIRO_DB_NAME = "classflow-kiro";
export const KIRO_DB_VERSION = 2;

export const KIRO_CONVERSATIONS_STORE = "conversations";
export const KIRO_MEMORIES_STORE = "memories";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openKiroDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(KIRO_DB_NAME, KIRO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // v1 → conversations
      if (!db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)) {
        const store = db.createObjectStore(KIRO_CONVERSATIONS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      // v2 → memories
      if (!db.objectStoreNames.contains(KIRO_MEMORIES_STORE)) {
        const store = db.createObjectStore(KIRO_MEMORIES_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** 通用 store 请求辅助 */
export function kiroTx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openKiroDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** 仅供测试：重置缓存的 DB 连接（删除数据库后使用） */
export function resetKiroDbForTests(): void {
  dbPromise = null;
}
