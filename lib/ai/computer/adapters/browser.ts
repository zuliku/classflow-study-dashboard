import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import {
  getBrowserWorkspaceDirectoryHandle,
  queryBrowserGrant,
  BrowserWorkspaceDirectoryHandle,
  BrowserFileHandle,
} from "@/lib/ai/computer/workspace/grants";

/**
 * Browser（File System Access）Adapter —— 真实文件夹 IO（Part 2 / Part 3）。
 *
 * 安全契约：
 * - 只由 Computer Executor 在 policy/grant 通过后调用。
 * - 绝不 requestPermission / showDirectoryPicker（仍只属于显式用户手势 helper）。
 * - 每次 IO 前 queryBrowserGrant() 必须为 granted，否则 RESOURCE_NOT_FOUND / 明确失败。
 * - FileSystemDirectoryHandle 只存在于 runtime，不进入 Store/Chat/History/Model。
 * - grant store 的 DB 常量 / handle 查找统一由 workspace/grants.ts 提供（Part 3 边界清理）。
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

async function requireGrantedHandle(adapterRef: string): Promise<BrowserWorkspaceDirectoryHandle> {
  const handle = await getBrowserWorkspaceDirectoryHandle(adapterRef);
  if (!handle) throw new ComputerError("RESOURCE_NOT_FOUND", "授权句柄缺失，需要重新授权");
  const grant = await queryBrowserGrant(adapterRef);
  if (grant !== "granted") {
    throw new ComputerError("RESOURCE_NOT_FOUND", `授权已失效（${grant}），需要重新授权`);
  }
  return handle;
}

async function resolveHandlePath(
  dir: BrowserWorkspaceDirectoryHandle,
  path: string
): Promise<{ dir: BrowserWorkspaceDirectoryHandle; name: string }> {
  const parts = path.split("/").filter(Boolean);
  let current = dir;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part).catch(() => {
      throw new ComputerError("RESOURCE_NOT_FOUND", `目录不存在：${part}`);
    });
  }
  return { dir: current, name: parts[parts.length - 1] ?? "" };
}

export async function browserListDirectory(
  adapterRef: string,
  dirPath: string
): Promise<{ name: string; kind: "file" | "directory"; size: number; mtime?: number }[]> {
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
      const file = await (handle as BrowserFileHandle).getFile().catch(() => null);
      out.push({ name, kind: "file", size: file?.size ?? 0 });
    } else {
      out.push({ name, kind: "directory", size: 0 });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
}

export async function browserStat(
  adapterRef: string,
  path: string
): Promise<{ kind: "file" | "directory"; size: number; type: string } | null> {
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

/** Undo 专用（非 Model Tool）：non-recursive remove；目录非空时浏览器拒绝 → 抛错（undo fail） */
export async function browserRemove(adapterRef: string, path: string, kind: "file" | "directory"): Promise<void> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  if (!name) throw new ComputerError("VERIFICATION_FAILED", "不能删除根目录");
  if (kind === "file") {
    const file = await dir.getFileHandle(name).catch(() => {
      throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
    });
    await file.remove().catch(() => {
      throw new ComputerError("VERIFICATION_FAILED", `无法删除文件：${path}`);
    });
    return;
  }
  const dirHandle = await dir.getDirectoryHandle(name).catch(() => {
    throw new ComputerError("RESOURCE_NOT_FOUND", `目录不存在：${path}`);
  });
  await dirHandle.remove().catch(() => {
    throw new ComputerError("VERIFICATION_FAILED", `目录非空或无法删除：${path}`);
  });
}

/** V3 Part 1：bounded text prefix（File.slice(0, maxBytes) 后才 decode；绝不先读全文） */
export async function browserReadTextPrefix(
  adapterRef: string,
  path: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const root = await requireGrantedHandle(adapterRef);
  const { dir, name } = await resolveHandlePath(root, path);
  const file = await dir.getFileHandle(name).catch(() => {
    throw new ComputerError("RESOURCE_NOT_FOUND", `文件不存在：${path}`);
  });
  const f = await file.getFile();
  const sliced = f.slice(0, maxBytes);
  const text = await sliced.text();
  return { text, truncated: f.size > maxBytes };
}

/** V2：file-only verified relocation（same browser root；Executor/relocate 已做 policy/覆盖检查） */
export async function browserMove(adapterRef: string, from: string, to: string): Promise<void> {
  const root = await requireGrantedHandle(adapterRef);
  const src = await resolveHandlePath(root, from);
  const srcHandle = await src.dir.getFileHandle(src.name).catch(() => {
    throw new ComputerError("RESOURCE_NOT_FOUND", `源文件不存在：${from}`);
  });
  const dst = await resolveHandlePath(root, to);
  const targetExists = await dst.dir
    .getFileHandle(dst.name)
    .then(() => true)
    .catch(() => false);
  if (targetExists) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `目标已存在：${to}`);
  const file = await srcHandle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const writable = await dst.dir.getFileHandle(dst.name, { create: true }).then((h) => h.createWritable());
  await writable.write(bytes);
  await writable.close();
  // Verify target
  const after = await dst.dir.getFileHandle(dst.name).then((h) => h.getFile()).catch(() => null);
  if (!after || after.size !== bytes.byteLength) {
    await dst.dir.getFileHandle(dst.name).then((h) => h.remove()).catch(() => undefined);
    throw new ComputerError("VERIFICATION_FAILED", "目标写入校验失败");
  }
  // Remove source + verify absent
  try {
    await srcHandle.remove();
    const sourceAfter = await src.dir.getFileHandle(src.name).catch(() => null);
    if (sourceAfter) throw new ComputerError("VERIFICATION_FAILED", "源文件删除校验失败");
  } catch (err) {
    await dst.dir.getFileHandle(dst.name).then((h) => h.remove()).catch(() => undefined);
    if (err instanceof ComputerError) throw err;
    throw new ComputerError("VERIFICATION_FAILED", "文件移动校验失败");
  }
}
