/**
 * Workspace Knowledge IndexedDB（classflow-kiro-knowledge-v1）。
 * stores: workspaces(keyPath workspaceId) / files(keyPath key, by-workspace index) /
 *         chunks(keyPath key, by-workspace / by-file indexes)。
 * 只存逻辑 metadata + 有界 chunks；绝不存 adapterRef/native path/handle/bytes。
 */
import {
  KIRO_KNOWLEDGE_DB,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  KiroKnowledgeWorkspaceState,
  knowledgeChunkKey,
  knowledgeFileKey,
} from "@/lib/ai/computer/knowledge/types";
import { ComputerError } from "@/lib/ai/computer/errors";

const KNOWLEDGE_VERSION = 1;
const STORE_WORKSPACES = "workspaces";
const STORE_FILES = "files";
const STORE_CHUNKS = "chunks";

function openKnowledgeDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(KIRO_KNOWLEDGE_DB, KNOWLEDGE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
        db.createObjectStore(STORE_WORKSPACES, { keyPath: "workspaceId" });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const files = db.createObjectStore(STORE_FILES, { keyPath: "key" });
        files.createIndex("by-workspace", "workspaceId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: "key" });
        chunks.createIndex("by-workspace", "workspaceId", { unique: false });
        chunks.createIndex("by-file", "fileKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function getKnowledgeWorkspaceState(
  workspaceId: string
): Promise<KiroKnowledgeWorkspaceState | null> {
  const db = await openKnowledgeDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_WORKSPACES, "readonly");
      const req = tx.objectStore(STORE_WORKSPACES).get(workspaceId);
      req.onsuccess = () => resolve((req.result as KiroKnowledgeWorkspaceState | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function putKnowledgeWorkspaceState(state: KiroKnowledgeWorkspaceState): Promise<void> {
  const db = await openKnowledgeDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_WORKSPACES, "readwrite");
      tx.objectStore(STORE_WORKSPACES).put(state);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function listKnowledgeFiles(workspaceId: string): Promise<KiroKnowledgeFileRecord[]> {
  const db = await openKnowledgeDb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_FILES, "readonly");
      const idx = tx.objectStore(STORE_FILES).index("by-workspace");
      const req = idx.getAll(IDBKeyRange.only(workspaceId));
      req.onsuccess = () => resolve((req.result as KiroKnowledgeFileRecord[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

export async function listKnowledgeChunks(workspaceId: string): Promise<KiroKnowledgeChunkRecord[]> {
  const db = await openKnowledgeDb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_CHUNKS, "readonly");
      const idx = tx.objectStore(STORE_CHUNKS).index("by-workspace");
      const req = idx.getAll(IDBKeyRange.only(workspaceId));
      req.onsuccess = () => resolve((req.result as KiroKnowledgeChunkRecord[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

/**
 * 原子替换单个文件记录及其全部 chunks（同一 readwrite 事务）：
 * 先收集该 fileKey 的旧 chunk keys → 删除 → 写入新 chunks → 写入新 file record。
 */
export async function replaceKnowledgeFile(
  file: KiroKnowledgeFileRecord,
  chunks: KiroKnowledgeChunkRecord[]
): Promise<void> {
  const db = await openKnowledgeDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_FILES, STORE_CHUNKS], "readwrite");
      const chunkStore = tx.objectStore(STORE_CHUNKS);
      const fileStore = tx.objectStore(STORE_FILES);
      const oldKeysReq = chunkStore.index("by-file").getAllKeys(IDBKeyRange.only(file.key));
      oldKeysReq.onsuccess = () => {
        for (const key of oldKeysReq.result as string[]) {
          chunkStore.delete(key);
        }
        for (const chunk of chunks) {
          chunkStore.put(chunk);
        }
        fileStore.put(file);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function removeKnowledgeFile(fileKey: string): Promise<void> {
  const db = await openKnowledgeDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_FILES, STORE_CHUNKS], "readwrite");
      tx.objectStore(STORE_FILES).delete(fileKey);
      const oldKeysReq = tx.objectStore(STORE_CHUNKS).index("by-file").getAllKeys(IDBKeyRange.only(fileKey));
      oldKeysReq.onsuccess = () => {
        for (const key of oldKeysReq.result as string[]) {
          tx.objectStore(STORE_CHUNKS).delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** 只清理当前 Workspace 的 Knowledge 记录（不影响其它 Workspace / Artifact / chat / 真实文件） */
export async function clearWorkspaceKnowledge(workspaceId: string): Promise<void> {
  const db = await openKnowledgeDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_WORKSPACES, STORE_FILES, STORE_CHUNKS], "readwrite");
      tx.objectStore(STORE_WORKSPACES).delete(workspaceId);
      const fileKeysReq = tx.objectStore(STORE_FILES).index("by-workspace").getAllKeys(IDBKeyRange.only(workspaceId));
      fileKeysReq.onsuccess = () => {
        for (const key of fileKeysReq.result as string[]) {
          tx.objectStore(STORE_FILES).delete(key);
        }
      };
      const chunkKeysReq = tx.objectStore(STORE_CHUNKS).index("by-workspace").getAllKeys(IDBKeyRange.only(workspaceId));
      chunkKeysReq.onsuccess = () => {
        for (const key of chunkKeysReq.result as string[]) {
          tx.objectStore(STORE_CHUNKS).delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
