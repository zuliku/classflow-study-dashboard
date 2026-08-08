/**
 * 课程资料文件持久化：IndexedDB 保存 Blob，Zustand 只保存 metadata。
 * blob: URL 仅在会话内有效，刷新后失效；这里用 storageKey 关联 IndexedDB 中的文件。
 */

const DB_NAME = "classflow-files";
const STORE_NAME = "files";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 生成新的文件存储键（crypto.randomUUID，无该 API 时回退时间戳+随机） */
export function createStorageKey(): string {
  const c = globalThis.crypto;
  const random = c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `file_${random}`;
}

/** 将 Blob 保存到 IndexedDB */
export async function saveFileBlob(storageKey: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 读取 Blob；不存在时返回 null */
export async function getFileBlob(storageKey: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(storageKey);
    request.onsuccess = () => resolve((request.result as Blob) || null);
    request.onerror = () => reject(request.error);
  });
}

/** 从 IndexedDB 删除 Blob */
export async function deleteFileBlob(storageKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 清空所有已保存的文件 Blob（用于重置演示数据） */
export async function clearAllFileBlobs(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 枚举全部已保存的 Blob key（孤儿清理用） */
export async function listFileKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () =>
      resolve((request.result as IDBValidKey[]).map((k) => String(k)));
    request.onerror = () => reject(request.error);
  });
}

/**
 * 孤儿 Blob 对账：删除不在 validKeys 集合中的 Blob。
 * 用于应用启动清理（刷新/关闭浏览器遗留的文件），单事务批量删除。
 */
export async function reconcileOrphanBlobs(validKeys: Set<string>): Promise<{ deleted: number }> {
  const keys = await listFileKeys();
  const orphans = keys.filter((k) => !validKeys.has(k));
  if (orphans.length === 0) return { deleted: 0 };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of orphans) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return { deleted: orphans.length };
}
