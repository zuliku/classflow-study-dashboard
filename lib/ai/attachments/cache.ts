import { ExtractedDocument } from "@/lib/ai/attachments/extractors";
import { EXTRACTOR_VERSION } from "@/lib/ai/attachments/limits";

/**
 * 提取结果缓存：只缓存「文件 → 文本」，不缓存 AI request。
 * 已有资料用 storageKey；临时文件用 name+size+lastModified（session 级）。
 */

const DB_NAME = "classflow-kiro-extract";
const STORE_NAME = "cache";
const DB_VERSION = 1;

export interface ExtractCacheEntry {
  text: string;
  pages?: { page: number; text: string }[];
  /** PDF 总页数（Task 12：扫描件 Vision fallback 需要） */
  pageCount?: number;
  /** 扫描型 PDF 标记（必须缓存，避免旧 cache 把扫描件读成空文本却丢失标记） */
  possiblyScanned?: boolean;
  extractedAt: string;
  extractorVersion: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function extractCacheKey(input: { storageKey?: string; name?: string; size?: number; lastModified?: number }): string {
  if (input.storageKey) return `kiro-extract:${input.storageKey}:${EXTRACTOR_VERSION}`;
  return `kiro-extract:local:${input.name ?? ""}:${input.size ?? 0}:${input.lastModified ?? 0}:${EXTRACTOR_VERSION}`;
}

export async function getExtractCache(key: string): Promise<ExtractCacheEntry | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as ExtractCacheEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setExtractCache(key: string, entry: ExtractCacheEntry): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 缓存失败不阻断主流程 */
  }
}

export async function deleteExtractCache(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}
