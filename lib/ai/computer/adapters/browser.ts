import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { queryBrowserGrant } from "@/lib/ai/computer/workspace/grants";

/**
 * Browser（File System Access）Adapter —— 真实文件夹 IO（Part 2）。
 *
 * 安全契约：
 * - 只由 Computer Executor 在 policy/grant 通过后调用。
 * - 绝不 requestPermission / showDirectoryPicker（仍只属于显式用户手势 helper）。
 * - 每次 IO 前 queryBrowserGrant() 必须为 granted，否则 RESOURCE_NOT_FOUND / 明确失败。
 * - FileSystemDirectoryHandle 只存在于 runtime，不进入 Store/Chat/History/Model。
 */

export function browserAdapterCapabilities(): ComputerAdapterCapabilities {
  return {
    kind: "browser",
    nativeWorkspace: true,
    canRead: true,
    canWrite: true,
    canOpenNativeFile: false,
    canRevealNativeFile: false,
  };
}

/** 窄化 File System Access 接口（DOM typings 不完整时使用；不 spread any） */
interface WritableLike {
  write: (data: string | Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemHandleLike {
  kind: "file" | "directory";
  name: string;
}

interface FileHandleLike extends FileSystemHandleLike {
  kind: "file";
  createWritable: () => Promise<WritableLike>;
  getFile: () => Promise<{ size: number; type: string; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }>;
}

interface DirectoryHandleLike extends FileSystemHandleLike {
  kind: "directory";
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
  entries: () => AsyncIterable<[string, FileSystemHandleLike]>;
}

const GRANT_DB = "classflow-kiro-grants-v1";
const GRANT_STORE = "handles";
const GRANT_VERSION = 1;

/** runtime-only：从 grant store 取 handle（Adapter 专用；不进任何持久化 UI 层） */
async function getBrowserWorkspaceDirectoryHandle(adapterRef: string): Promise<DirectoryHandleLike | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(GRANT_DB, GRANT_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
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

async function requireGrantedHandle(adapterRef: string): Promise<DirectoryHandleLike> {
  const handle = await getBrowserWorkspaceDirectoryHandle(adapterRef);
  if (!handle) throw new ComputerError("RESOURCE_NOT_FOUND", "授权句柄缺失，需要重新授权");
  const grant = await queryBrowserGrant(adapterRef);
  if (grant !== "granted") {
    throw new ComputerError("RESOURCE_NOT_FOUND", `授权已失效（${grant}），需要重新授权`);
  }
  return handle;
}

async function resolveHandlePath(dir: DirectoryHandleLike, path: string): Promise<{ dir: DirectoryHandleLike; name: string }> {
  const parts = path.split("/").filter(Boolean);
  let current = dir;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part).catch(() => {
      throw new ComputerError("RESOURCE_NOT_FOUND", `目录不存在：${part}`);
    });
  }
  return { dir: current, name: parts[parts.length - 1] ?? "" };
}

export async function browserListDirectory(adapterRef: string, dirPath: string): Promise<{ name: string; kind: "file" | "directory"; size: number; mtime?: number }[]> {
  const root = await requireGrantedHandle(adapterRef);
  let dir = root;
  if (dirPath) {
    const parts = dirPath.split("/").filter(Boolean);
    for (const part of parts) {
      const next = await dir.getDirectoryHandle(part).catch(() => {
        throw new ComputerError("RESOURCE_NOT_FOUND", `目录不存在：${part}`);
      });
      dir = next;
    }
  }
  const out: { name: string; kind: "file" | "directory"; size: number; mtime?: number }[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") {
      const file = await (handle as FileHandleLike).getFile().catch(() => null);
      out.push({ name, kind: "file", size: file?.size ?? 0 });
    } else {
      out.push({ name, kind: "directory", size: 0 });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
}

export async function browserStat(adapterRef: string, path: string): Promise<{ kind: "file" | "directory"; size: number; type: string } | null> {
  const root = await requireGrantedHandle(adapterRef);
  const parts = path.split("/").filter(Boolean);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part).catch(() => {
      throw new ComputerError("RESOURCE_NOT_FOUND", `目录不存在：${part}`);
    });
  }
  const name = parts[parts.length - 1];
  if (!name) return { kind: "directory", size: 0, type: "" };
  const file = await current.getFileHandle(name).catch(() => null);
  if (file) {
    const f = await file.getFile();
    return { kind: "file", size: f.size, type: f.type };
  }
  const dir = await current.getDirectoryHandle(name).catch(() => null);
  if (dir) return { kind: "directory", size: 0, type: "" };
  return null;
}

export async function browserReadText(adapterRef: string, path: string): Promise<string> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  const file = await dir.getFileHandle(name).catch(() => {
    throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
  });
  return file.getFile().then((f) => f.text());
}

export async function browserReadBytes(adapterRef: string, path: string): Promise<Uint8Array> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  const file = await dir.getFileHandle(name).catch(() => {
    throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
  });
  const buf = await file.getFile().then((f) => f.arrayBuffer());
  return new Uint8Array(buf);
}

export async function browserCreateDirectory(adapterRef: string, path: string): Promise<"created" | "exists"> {
  const root = await requireGrantedHandle(adapterRef);
  const parts = path.split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    const existing = await current.getDirectoryHandle(part).catch(() => null);
    if (existing) {
      current = existing;
      continue;
    }
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return "created";
}

export async function browserWriteText(adapterRef: string, path: string, content: string): Promise<void> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function browserWriteBytes(adapterRef: string, path: string, content: Uint8Array): Promise<void> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
