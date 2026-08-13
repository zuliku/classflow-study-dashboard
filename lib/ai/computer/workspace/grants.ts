/**
 * Browser（File System Access）Grant Store：
 * FileSystemDirectoryHandle 存入专用 IndexedDB，以 opaque adapterRef 关联。
 * 绝不进入 localStorage / Zustand persisted JSON / chat state / request body。
 *
 * 安全契约：
 * - showDirectoryPicker 只能由显式用户手势 helper（chooseBrowserWorkspaceDirectory）调用；
 *   禁止 Agent tool / 后台 effect / 页面 mount 自动打开。
 * - 授权丢失必须显式「需要重新授权」，不允许静默全盘权限 / 假装成功。
 */

const GRANT_DB = "classflow-kiro-grants-v1";
const GRANT_STORE = "handles";
const GRANT_VERSION = 1;

/** 窄化的 File System Access DOM 接口（DOM typings 不完整时使用，不 spread any） */
interface DirectoryHandleLike {
  queryPermission?: (desc: { mode?: "read" | "readwrite" }) => Promise<"granted" | "prompt" | "denied">;
  requestPermission?: (desc: { mode?: "read" | "readwrite" }) => Promise<"granted" | "prompt" | "denied">;
  name: string;
}

/** runtime-only：Browser Adapter 消费的统一 handle 类型（不进任何持久化 UI 层） */
export interface BrowserWorkspaceDirectoryHandle extends DirectoryHandleLike {
  kind: "directory";
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserWorkspaceDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  entries: () => AsyncIterable<[string, BrowserWorkspaceDirectoryHandle | BrowserFileHandle]>;
  remove: () => Promise<void>;
}

export interface BrowserFileHandle extends DirectoryHandleLike {
  kind: "file";
  createWritable: () => Promise<{ write: (data: string | Uint8Array) => Promise<void>; close: () => Promise<void> }>;
  getFile: () => Promise<{
    size: number;
    type: string;
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }>;
  remove: () => Promise<void>;
}

function openGrantDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(GRANT_DB, GRANT_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(GRANT_STORE)) {
        req.result.createObjectStore(GRANT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function getHandle(adapterRef: string): Promise<DirectoryHandleLike | null> {
  const db = await openGrantDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(GRANT_STORE, "readonly");
      const req = tx.objectStore(GRANT_STORE).get(adapterRef);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

async function saveHandle(adapterRef: string, handle: DirectoryHandleLike): Promise<boolean> {
  const db = await openGrantDb();
  if (!db) return false;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(GRANT_STORE, "readwrite");
      tx.objectStore(GRANT_STORE).put(handle, adapterRef);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * 显式用户手势授权 helper（唯一允许调用 showDirectoryPicker 的地方）。
 * 返回 opaque adapterRef + 文件夹名；用户取消返回 null。
 */
export async function chooseBrowserWorkspaceDirectory(): Promise<{
  adapterRef: string;
  label: string;
} | null> {
  if (!supportsFileSystemAccess() || typeof window === "undefined") return null;
  const picker = (
    window as unknown as {
      showDirectoryPicker: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
  if (typeof picker !== "function") return null;

  try {
    const handle = await picker({ mode: "readwrite" });
    const adapterRef = `browser-grant-${crypto.randomUUID()}`;
    const ok = await saveHandle(adapterRef, handle);
    if (!ok) return null;
    return { adapterRef, label: handle.name || "本地文件夹" };
  } catch {
    // 用户取消（AbortError）或环境不支持
    return null;
  }
}

export type BrowserGrantStatus = "granted" | "prompt" | "denied" | "missing";

/** runtime-only：从 grant store 取 handle（统一入口；Browser Adapter 只消费，不重复维护 DB 常量） */
export async function getBrowserWorkspaceDirectoryHandle(
  adapterRef: string
): Promise<BrowserWorkspaceDirectoryHandle | null> {
  const handle = await getHandle(adapterRef);
  if (!handle) return null;
  return handle as BrowserWorkspaceDirectoryHandle;
}

/** 查询授权状态（不触发任何权限请求） */
export async function queryBrowserGrant(adapterRef: string): Promise<BrowserGrantStatus> {
  const handle = await getHandle(adapterRef);
  if (!handle) return "missing";
  if (typeof handle.queryPermission !== "function") return "granted";
  try {
    const state = await handle.queryPermission({ mode: "readwrite" });
    return state;
  } catch {
    return "denied";
  }
}

/** 用户手势触发的重新授权（返回是否 granted） */
export async function requestBrowserGrant(adapterRef: string): Promise<boolean> {
  const handle = await getHandle(adapterRef);
  if (!handle) return false;
  if (typeof handle.requestPermission !== "function") return true;
  try {
    const state = await handle.requestPermission({ mode: "readwrite" });
    return state === "granted";
  } catch {
    return false;
  }
}
