import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";
import { ComputerError } from "@/lib/ai/computer/errors";

/**
 * Kiro Sandbox（IndexedDB 虚拟工作区）Adapter —— 真实文件记录实现（Part 2）。
 *
 * - DB: classflow-kiro-sandbox-v1，store: files
 * - Key: `${adapterRef}\u0000${normalized relative path}`（不同 adapterRef 完全隔离）
 * - 支持 directory / text file / binary file（用于 Markdown 与 DOCX）
 * - UI 必须明确「Sandbox · 当前浏览器」，绝不称为本地文件夹
 */

export function sandboxAdapterCapabilities(): ComputerAdapterCapabilities {
  return {
    kind: "sandbox",
    nativeWorkspace: false,
    canRead: true,
    canWrite: true,
    canOpenNativeFile: false,
    canRevealNativeFile: false,
  };
}

export const KIRO_SANDBOX_DB = "classflow-kiro-sandbox-v1";
export const KIRO_SANDBOX_FILES_STORE = "files";
const DB_VERSION = 1;

export type SandboxEntryKind = "file" | "directory";

export interface SandboxEntry {
  kind: SandboxEntryKind;
  /** UTF-8 文本（text file）或 undefined（binary file / directory） */
  text?: string;
  /** 二进制内容（binary file） */
  bytes?: ArrayBuffer;
  /** 文件 MIME 类型 */
  type?: string;
  size: number;
  mtime: string;
}

function sandboxKey(adapterRef: string, path: string): string {
  return `${adapterRef}\u0000${path}`;
}

function openSandboxDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(KIRO_SANDBOX_DB, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KIRO_SANDBOX_FILES_STORE)) {
        req.result.createObjectStore(KIRO_SANDBOX_FILES_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function dbGet(key: string): Promise<SandboxEntry | null> {
  const db = await openSandboxDb();
  if (!db) throw new ComputerError("UNSUPPORTED_BROWSER", "当前环境不支持 Kiro Sandbox（无 IndexedDB）");
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readonly");
      const req = tx.objectStore(KIRO_SANDBOX_FILES_STORE).get(key);
      req.onsuccess = () => resolve((req.result as SandboxEntry | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

async function dbPut(key: string, entry: SandboxEntry): Promise<void> {
  const db = await openSandboxDb();
  if (!db) throw new ComputerError("UNSUPPORTED_BROWSER", "当前环境不支持 Kiro Sandbox（无 IndexedDB）");
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readwrite");
      tx.objectStore(KIRO_SANDBOX_FILES_STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new ComputerError("VERIFICATION_FAILED", "写入 Sandbox 失败"));
    });
  } finally {
    db.close();
  }
}

async function dbDelete(key: string): Promise<void> {
  const db = await openSandboxDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readwrite");
      tx.objectStore(KIRO_SANDBOX_FILES_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** 列出某 adapterRef 下、某目录的直接子项（不递归；目录 entry 以 `path/` 结尾） */
async function dbList(adapterRef: string, dirPath: string): Promise<{ name: string; entry: SandboxEntry }[]> {
  const db = await openSandboxDb();
  if (!db) return [];
  try {
    const prefix = sandboxKey(adapterRef, dirPath === "" ? "" : dirPath + "/");
    return await new Promise((resolve) => {
      const out: { name: string; entry: SandboxEntry }[] = [];
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readonly");
      const store = tx.objectStore(KIRO_SANDBOX_FILES_STORE);
      const req = store.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const key = String(cursor.key);
          // 排除祖先目录 entry（如 "a/" 对 dir "a/b" 不是直接子项）
          if (key.startsWith(prefix) && key !== prefix) {
            const rest = key.slice(prefix.length);
            const isDir = (cursor.value as SandboxEntry).kind === "directory";
            const childName = isDir ? rest.replace(/\/$/, "") : rest;
            if (childName && !childName.includes("/")) {
              out.push({ name: childName, entry: cursor.value as SandboxEntry });
            }
          }
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => resolve(out);
    });
  } finally {
    db.close();
  }
}

function now(): string {
  return new Date().toISOString();
}

/** 确保父目录链存在（目录 entry 记作 `path/`，方便祖先检测） */
async function ensureParentDirectories(adapterRef: string, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    const key = sandboxKey(adapterRef, dir + "/");
    const existing = await dbGet(key);
    if (!existing) {
      await dbPut(key, { kind: "directory", size: 0, mtime: now() });
    }
  }
}

export async function sandboxStat(adapterRef: string, path: string): Promise<SandboxEntry | null> {
  // 目录 entry 与文件 entry 都尝试；目录 path 可能不带尾部 /
  const exact = await dbGet(sandboxKey(adapterRef, path));
  if (exact) return exact;
  return dbGet(sandboxKey(adapterRef, path + "/"));
}

export async function sandboxListDirectory(adapterRef: string, dirPath: string): Promise<{ name: string; entry: SandboxEntry }[]> {
  return dbList(adapterRef, dirPath);
}

export async function sandboxReadText(adapterRef: string, path: string): Promise<string> {
  const entry = await sandboxStat(adapterRef, path);
  if (!entry) throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
  if (entry.kind !== "file") throw new ComputerError("UNSUPPORTED_FILE_TYPE", `不是文件：${path}`);
  if (entry.text !== undefined) return entry.text;
  if (entry.bytes) {
    return new TextDecoder().decode(entry.bytes);
  }
  throw new ComputerError("UNSUPPORTED_FILE_TYPE", `无法读取文本：${path}`);
}

export async function sandboxReadBytes(adapterRef: string, path: string): Promise<Uint8Array> {
  const entry = await sandboxStat(adapterRef, path);
  if (!entry) throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
  if (entry.kind !== "file") throw new ComputerError("UNSUPPORTED_FILE_TYPE", `不是文件：${path}`);
  if (entry.bytes) return new Uint8Array(entry.bytes);
  if (entry.text !== undefined) return new TextEncoder().encode(entry.text);
  return new Uint8Array();
}

export async function sandboxCreateDirectory(adapterRef: string, path: string): Promise<"created" | "exists"> {
  const existing = await sandboxStat(adapterRef, path);
  if (existing?.kind === "directory") return "exists";
  if (existing?.kind === "file") {
    throw new ComputerError("RESOURCE_ALREADY_EXISTS", `路径已被文件占用：${path}`);
  }
  await ensureParentDirectories(adapterRef, path);
  await dbPut(sandboxKey(adapterRef, path + "/"), { kind: "directory", size: 0, mtime: now() });
  return "created";
}

export async function sandboxWriteText(adapterRef: string, path: string, content: string, type?: string): Promise<void> {
  await ensureParentDirectories(adapterRef, path);
  await dbPut(sandboxKey(adapterRef, path), {
    kind: "file",
    text: content,
    type,
    size: new TextEncoder().encode(content).byteLength,
    mtime: now(),
  });
}

export async function sandboxWriteBytes(adapterRef: string, path: string, content: Uint8Array, type?: string): Promise<void> {
  const bytes = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  await ensureParentDirectories(adapterRef, path);
  await dbPut(sandboxKey(adapterRef, path), {
    kind: "file",
    bytes,
    type,
    size: content.byteLength,
    mtime: now(),
  });
}

/** 仅测试 / 内部工具：删除沙箱 entry（不属于 LLM capability） */
export async function sandboxDelete(adapterRef: string, path: string): Promise<void> {
  await dbDelete(sandboxKey(adapterRef, path));
}

/**
 * 清理某 adapterRef 的整个 Sandbox namespace（Settings 显式删除 Workspace 时调用）。
 * 只删除 `${adapterRef}\u0000` 前缀的 keys；绝不 deleteDatabase、不影响其它 adapter。
 */
export async function clearSandboxAdapter(adapterRef: string): Promise<void> {
  const db = await openSandboxDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readwrite");
      const store = tx.objectStore(KIRO_SANDBOX_FILES_STORE);
      const prefix = `${adapterRef}\u0000`;
      const req = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
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

/** Undo 专用（非 Model Tool）：只删除单个文件或空目录；非空目录 → VERIFICATION_FAILED（undo fail） */
export async function sandboxRemove(adapterRef: string, path: string, kind: "file" | "directory"): Promise<void> {
  const entry = await sandboxStat(adapterRef, path);
  if (!entry) throw new ComputerError("RESOURCE_NOT_FOUND", `不存在：${path}`);
  if (kind === "file") {
    if (entry.kind !== "file") throw new ComputerError("VERIFICATION_FAILED", `不是文件：${path}`);
    await dbDelete(sandboxKey(adapterRef, path));
    return;
  }
  // directory：只删除空目录（目录 marker `path/`；存在子项 → 拒绝）
  if (entry.kind !== "directory") throw new ComputerError("VERIFICATION_FAILED", `不是目录：${path}`);
  const prefix = sandboxKey(adapterRef, path + "/");
  const children = await new Promise<number>((resolve) => {
    const dbPromise = openSandboxDb();
    void dbPromise.then((db) => {
      if (!db) {
        resolve(0);
        return;
      }
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readonly");
      const store = tx.objectStore(KIRO_SANDBOX_FILES_STORE);
      let count = 0;
      const req = store.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          // 排除目录自身 marker（key === prefix）
          if (String(cursor.key) !== prefix) count += 1;
          cursor.continue();
        } else {
          db.close();
          resolve(count);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(count);
      };
      tx.onabort = () => {
        db.close();
        resolve(count);
      };
    });
  });
  if (children > 0) throw new ComputerError("VERIFICATION_FAILED", `目录非空，无法撤销：${path}`);
  await dbDelete(sandboxKey(adapterRef, path + "/"));
}
