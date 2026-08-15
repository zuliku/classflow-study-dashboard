/**
 * Kiro 统一 IndexedDB（classflow-kiro v4）。
 * v1：conversations（History）
 * v2：+ memories（长期学习记忆）
 * v3：+ projects（Kiro 项目）；conversations 增量补 projectId index
 * v4：+ project-files（Kiro Project 持久化文档 metadata；Blob 在 classflow-files）
 * 升级采用增量 onupgradeneeded（只补建缺失 store/index，绝不 deleteDatabase 重建）。
 */

export const KIRO_DB_NAME = "classflow-kiro";
export const KIRO_DB_VERSION = 4;

export const KIRO_CONVERSATIONS_STORE = "conversations";
export const KIRO_MEMORIES_STORE = "memories";
export const KIRO_PROJECTS_STORE = "projects";
export const KIRO_PROJECT_FILES_STORE = "project-files";

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
      // v3 → projects（Conversation membership 单一事实源 = conversation.projectId）
      if (!db.objectStoreNames.contains(KIRO_PROJECTS_STORE)) {
        const store = db.createObjectStore(KIRO_PROJECTS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      // v3 → conversations 增量补 projectId index（旧 store 已存在时必须通过
      // 升级事务（request.transaction）取得 existing store 后补 index，禁止删 store 再建。
      // 注意：不能在此再开 db.transaction(...)——fake-indexeddb/规范实现会 abort 新事务）
      const upgradeTx = request.transaction;
      if (upgradeTx && db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)) {
        const store = upgradeTx.objectStore(KIRO_CONVERSATIONS_STORE);
        if (!store.indexNames.contains("projectId")) {
          store.createIndex("projectId", "projectId", { unique: false });
        }
      }
      // v4 → project-files（Project 文档 metadata；Blob 存 classflow-files，keyPath=storageKey）
      if (!db.objectStoreNames.contains(KIRO_PROJECT_FILES_STORE)) {
        const store = db.createObjectStore(KIRO_PROJECT_FILES_STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
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

/** 仅供测试：关闭缓存的 DB 连接并清空 promise（多连接/版本升级测试前使用） */
export function closeKiroDbForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (!p) return Promise.resolve();
  return p
    .then((db) => {
      db.close();
    })
    .catch(() => {});
}
