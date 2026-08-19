/**
 * ClassFlow Desktop Bridge V1 — Windows Runtime 实现（Filesystem + Terminal）。
 *
 * 合同：docs/desktop-filesystem-bridge.md（FROZEN FOR DESKTOP HANDOFF）
 * - grantId 是 opaque capability；renderer 永远拿不到真实绝对路径
 * - 所有路径只接受 grantId + relativePath；Runtime 每次 canonicalize + 防逃逸
 * - 结构化错误（无 absolute path / username / stack）
 * - Terminal：non-interactive、不提权、cwd 限授权 root、timeout/cancel 杀整个 process tree
 */
import { app, dialog, BrowserWindow, ipcMain } from "electron";
import { promises as fs, existsSync, realpathSync } from "node:fs";
import { join, sep, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import { runTerminalProcess, TerminalRuntimeHandle } from "@/src/main/terminalRuntime";
import { DesktopTerminalEvent } from "@/lib/desktop/types";

/* ---------------- Grant 管理（grantId → absolute root，renderer 不可见） ---------------- */

interface Grant {
  id: string;
  root: string; // canonical absolute path（已 realpath）
  access: "read-only" | "read-write";
  displayName: string;
}

const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RELATIVE_PARTS = 64;
const MAX_READ_BYTES = 64 * 1024 * 1024; // readBytes 上限（Web 侧有更紧的 bounded 层）
const MAX_PREFIX_BYTES = 1024 * 1024;

let grants = new Map<string, Grant>();
let grantsFile = "";

function grantStorePath(): string {
  return join(app.getPath("userData"), "bridge-grants.json");
}

async function loadGrants(): Promise<void> {
  grantsFile = grantStorePath();
  try {
    const raw = await fs.readFile(grantsFile, "utf8");
    const parsed = JSON.parse(raw) as { grants?: Grant[] };
    if (Array.isArray(parsed.grants)) {
      const map = new Map<string, Grant>();
      for (const g of parsed.grants) {
        if (g && typeof g.id === "string" && GRANT_ID_PATTERN.test(g.id) && typeof g.root === "string" && existsSync(g.root)) {
          map.set(g.id, { id: g.id, root: realpathSync(g.root), access: g.access === "read-write" ? "read-write" : "read-only", displayName: g.displayName ?? g.root });
        }
      }
      grants = map;
    }
  } catch {
    grants = new Map();
  }
}

async function persistGrants(): Promise<void> {
  try {
    await fs.mkdir(dirname(grantsFile), { recursive: true });
    await fs.writeFile(grantsFile, JSON.stringify({ grants: [...grants.values()] }, null, 2), "utf8");
  } catch {
    /* 持久化失败不影响会话内授权 */
  }
}

function newGrantId(): string {
  for (let i = 0; i < 20; i++) {
    const id = `grant_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    if (!grants.has(id)) return id;
  }
  return `grant_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getGrant(grantId: unknown): Grant | null {
  if (typeof grantId !== "string" || !GRANT_ID_PATTERN.test(grantId)) return null;
  return grants.get(grantId) ?? null;
}

function requireWritable(grant: Grant): boolean {
  return grant.access === "read-write";
}

/* ---------------- Sandbox 路径解析（canonicalize + 防逃逸） ---------------- */

/**
 * relativePath → canonical absolute path（限 granted root 内）。
 * - 拒绝 absolute / UNC / ".." / 空段陷阱
 * - 已存在段逐级 realpath：symlink / junction / reparse point 逃逸 → null
 * - 不存在段直接拼接（新创建，无 reparse 风险）
 */
function resolveWithinRoot(root: string, rel: string): string | null {
  if (typeof rel !== "string") return null;
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.length > MAX_RELATIVE_PARTS) return null;
  if (parts.some((p) => p === "..")) return null;

  let built = root;
  try {
    for (let i = 0; i < parts.length; i++) {
      const next = join(built, parts[i]);
      if (existsSync(next)) {
        const real = realpathSync(next);
        if (!isInside(real, root)) return null; // symlink/junction 逃逸
        built = real;
      } else {
        built = next;
      }
    }
  } catch {
    return null;
  }
  return isInside(built, root) ? built : null;
}

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}

function canonicalRoot(raw: string): string {
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

/* ---------------- 结构化错误（绝不泄漏 native path / stack） ---------------- */

interface BridgeError {
  code: "NOT_FOUND" | "ALREADY_EXISTS" | "PERMISSION_DENIED" | "DIRECTORY_NOT_EMPTY" | "INVALID_OPERATION" | "IO_ERROR";
  message?: string;
}

interface TerminalError {
  code: "PERMISSION_DENIED" | "CANCELLED" | "EXECUTION_FAILED" | "INVALID_OPERATION";
  message?: string;
}

function bridgeError(code: BridgeError["code"], message?: string): BridgeError {
  return { code, message };
}

/** 抛给 IPC 的错误：Error.message 内 JSON 编码（Electron IPC 只保留 Error 的 message/name/stack） */
function fail(code: BridgeError["code"] | TerminalError["code"], message?: string): never {
  throw new Error(JSON.stringify({ code, message }));
}

function failFrom(err: unknown, fallback: BridgeError["code"] = "IO_ERROR"): never {
  const m = mapFsError(err, fallback);
  throw new Error(JSON.stringify(m));
}

function failError(code: TerminalError["code"], message?: string): Error {
  return new Error(JSON.stringify({ code, message }));
}

function mapFsError(err: unknown, fallback: BridgeError["code"] = "IO_ERROR"): BridgeError {
  const code = (err as { code?: string } | null | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return bridgeError("NOT_FOUND");
    case "EEXIST":
      return bridgeError("ALREADY_EXISTS");
    case "ENOTEMPTY":
    case "EPERM":
      return bridgeError("DIRECTORY_NOT_EMPTY");
    case "EACCES":
      return bridgeError("PERMISSION_DENIED");
    default:
      return bridgeError(fallback);
  }
}

/* ---------------- 原子写入 ---------------- */

async function atomicWrite(target: string, data: Buffer | Uint8Array): Promise<void> {
  const dir = dirname(target);
  const tmp = join(dir, `.classflow-tmp-${randomUUID().slice(0, 8)}`);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* 清理失败忽略 */
    }
    throw err;
  }
}

/* ---------------- Filesystem 方法实现 ---------------- */

function validateInputObject(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
}

async function handlePickDirectory(input: unknown): Promise<{ grantId: string; displayName: string; access: "read-only" | "read-write" } | null> {
  const obj = validateInputObject(input);
  const access = obj?.access === "read-write" ? "read-write" : "read-only";
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = win
    ? await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "选择 ClassFlow 工作区文件夹" })
    : await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择 ClassFlow 工作区文件夹" });
  if (result.canceled || result.filePaths.length === 0) return null;
  const root = canonicalRoot(result.filePaths[0]);
  const grant: Grant = { id: newGrantId(), root, access, displayName: basename(root) };
  grants.set(grant.id, grant);
  await persistGrants();
  return { grantId: grant.id, displayName: grant.displayName, access: grant.access };
}

async function handleGetGrantStatus(input: unknown): Promise<{ status: "granted" | "missing" | "denied" }> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) return { status: "missing" };
  if (!existsSync(grant.root)) {
    grants.delete(grant.id);
    await persistGrants();
    return { status: "missing" };
  }
  return { status: "granted" };
}

async function handleForgetGrant(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const grantId = typeof obj?.grantId === "string" ? obj.grantId : "";
  if (grants.has(grantId)) {
    grants.delete(grantId);
    await persistGrants();
  }
}

function resolvePathFor(grant: Grant, pathInput: unknown): string | null {
  if (typeof pathInput !== "string") return null;
  return resolveWithinRoot(grant.root, pathInput);
}

async function handleList(input: unknown): Promise<Array<{ name: string; kind: "file" | "directory"; size: number }>> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    const out: Array<{ name: string; kind: "file" | "directory"; size: number }> = [];
    for (const e of entries) {
      try {
        const full = join(target, e.name);
        const st = await fs.stat(full);
        out.push({ name: e.name, kind: e.isDirectory() ? "directory" : "file", size: st.size });
      } catch {
        /* 单项失败跳过（竞争删除） */
      }
    }
    return out;
  } catch (err) {
    failFrom(err);
  }
}

async function handleStat(input: unknown): Promise<{ kind: "file" | "directory"; size: number; type?: string } | null> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  try {
    const st = await fs.stat(target);
    return { kind: st.isDirectory() ? "directory" : "file", size: st.size, type: st.isDirectory() ? undefined : mimeGuess(target) };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    failFrom(err);
  }
}

function mimeGuess(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json",
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    csv: "text/csv", html: "text/html", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext];
}

async function handleReadText(input: unknown): Promise<string> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  try {
    const buf = await fs.readFile(target);
    if (buf.length > MAX_READ_BYTES) fail("INVALID_OPERATION", "文件过大。");
    return buf.toString("utf8");
  } catch (err) {
    if (isBridgeError(err)) throw err;
    failFrom(err);
  }
}

async function handleReadBytes(input: unknown): Promise<Uint8Array> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  try {
    const buf = await fs.readFile(target);
    if (buf.length > MAX_READ_BYTES) fail("INVALID_OPERATION", "文件过大。");
    return new Uint8Array(buf);
  } catch (err) {
    if (isBridgeError(err)) throw err;
    failFrom(err);
  }
}

async function handleReadTextPrefix(input: unknown): Promise<{ text: string; truncated: boolean }> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  const maxBytes = typeof obj?.maxBytes === "number" && obj.maxBytes > 0 ? Math.min(Math.floor(obj.maxBytes), MAX_PREFIX_BYTES) : MAX_PREFIX_BYTES;
  try {
    const fh = await fs.open(target, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      const text = buf.subarray(0, bytesRead).toString("utf8");
      // 按 byte prefix：避免把 UTF-8 多字节字符截断成乱码，回退到最近的完整字符边界
      let end = text.length;
      while (end > 0 && (buf.subarray(0, Buffer.byteLength(text.slice(0, end))).length > bytesRead)) end--;
      const st = await fh.stat();
      return { text: text.slice(0, end), truncated: bytesRead < st.size };
    } finally {
      await fh.close();
    }
  } catch (err) {
    if (isBridgeError(err)) throw err;
    failFrom(err);
  }
}

async function handleCreateDirectory(input: unknown): Promise<"created" | "exists"> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  if (!requireWritable(grant)) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  try {
    await fs.mkdir(target);
    return "created";
  } catch (err) {
    if ((err as { code?: string }).code === "EEXIST") return "exists";
    failFrom(err);
  }
}

async function handleWriteText(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  if (!requireWritable(grant)) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  if (typeof obj?.content !== "string") fail("INVALID_OPERATION");
  try {
    await atomicWrite(target, Buffer.from(obj.content, "utf8"));
  } catch (err) {
    failFrom(err);
  }
}

async function handleWriteBytes(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  if (!requireWritable(grant)) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  const content = obj?.content;
  if (!(content instanceof Uint8Array)) fail("INVALID_OPERATION");
  try {
    await atomicWrite(target, Buffer.from(content));
  } catch (err) {
    failFrom(err);
  }
}

async function handleRemove(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  if (!requireWritable(grant)) fail("PERMISSION_DENIED");
  const target = resolvePathFor(grant, obj?.path);
  if (!target) fail("INVALID_OPERATION");
  const kind = obj?.kind === "directory" ? "directory" : "file";
  try {
    if (kind === "directory") await fs.rmdir(target);
    else await fs.unlink(target);
  } catch (err) {
    failFrom(err);
  }
}

async function handleMove(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const grant = getGrant(obj?.grantId);
  if (!grant) fail("PERMISSION_DENIED");
  if (!requireWritable(grant)) fail("PERMISSION_DENIED");
  const from = resolvePathFor(grant, obj?.from);
  const to = resolvePathFor(grant, obj?.to);
  if (!from || !to) fail("INVALID_OPERATION");
  try {
    const srcStat = await fs.stat(from);
    if (!srcStat.isFile()) fail("INVALID_OPERATION", "仅支持移动文件。");
    try {
      await fs.access(to);
      fail("ALREADY_EXISTS");
    } catch (err) {
      if (isBridgeError(err)) throw err;
      // to 不存在 → 继续
    }
    try {
      await fs.rename(from, to);
    } catch (err) {
      // 跨卷 rename 失败 → copy + delete（尽力回滚）
      const code = (err as { code?: string }).code;
      if (code === "EXDEV" || code === "EPERM" || code === "EACCES") {
        await fs.copyFile(from, to);
        try {
          await fs.unlink(from);
        } catch (unlinkErr) {
          try {
            await fs.unlink(to); // 回滚目标
          } catch {
            /* 尽力 */
          }
          throw unlinkErr;
        }
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (isBridgeError(err)) throw err;
    failFrom(err);
  }
}

function isBridgeError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  try {
    const parsed = JSON.parse(err.message) as { code?: unknown };
    return typeof parsed?.code === "string";
  } catch {
    return false;
  }
}

/* ---------------- Terminal V1 ---------------- */

interface ActiveExecution {
  child: ChildProcess;
  timer: NodeJS.Timeout | null;
  cancelled: boolean;
  resolve: (result: TerminalResult) => void;
  reject: (err: Error) => void;
}

interface TerminalResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

const activeExecutions = new Map<string, ActiveExecution>();
const MAX_OUTPUT_BYTES = 512 * 1024; // Runtime 第一层 bound（Web 有第二层）

/** Windows：taskkill /T /F 终止整个 process tree */
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
    setTimeout(() => resolve(), 3000);
  });
}

function collectOutput(child: ChildProcess): { stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean } {
  // 共享引用对象：data 事件闭包直接修改 state 字段（返回对象与闭包同一引用）
  const state = { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false };
  child.stdout?.on("data", (chunk: Buffer) => {
    if (state.stdout.length < MAX_OUTPUT_BYTES) {
      const room = MAX_OUTPUT_BYTES - state.stdout.length;
      state.stdout += chunk.toString("utf8", 0, Math.min(chunk.length, room));
      if (chunk.length > room) state.stdoutTruncated = true;
    } else {
      state.stdoutTruncated = true;
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (state.stderr.length < MAX_OUTPUT_BYTES) {
      const room = MAX_OUTPUT_BYTES - state.stderr.length;
      state.stderr += chunk.toString("utf8", 0, Math.min(chunk.length, room));
      if (chunk.length > room) state.stderrTruncated = true;
    } else {
      state.stderrTruncated = true;
    }
  });
  return state;
}

async function handleTerminalExecute(input: unknown): Promise<TerminalResult> {
  const obj = validateInputObject(input);
  if (!obj) fail("INVALID_OPERATION");
  const executionId = typeof obj.executionId === "string" && obj.executionId.length > 0 && obj.executionId.length <= 128 ? obj.executionId : null;
  const shell = obj.shell === "cmd" ? "cmd" : obj.shell === "powershell" ? "powershell" : null;
  const command = typeof obj.command === "string" && obj.command.length > 0 && obj.command.length <= 8192 ? obj.command : null;
  const timeoutMs = typeof obj.timeoutMs === "number" ? Math.min(Math.max(Math.floor(obj.timeoutMs), 1000), 120000) : 60000;
  if (!executionId || !shell || !command) fail("INVALID_OPERATION");

  if (activeExecutions.has(executionId)) fail("INVALID_OPERATION", "执行 ID 冲突。");
  const grant = getGrant(obj.grantId);
  if (!grant) fail("PERMISSION_DENIED");

  const cwdRaw = typeof obj.cwd === "string" ? obj.cwd : "";
  const resolvedCwd = resolveWithinRoot(grant.root, cwdRaw);
  if (!resolvedCwd) fail("PERMISSION_DENIED");

  const start = Date.now();
  return new Promise<TerminalResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      const args =
        shell === "powershell"
          ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
          : ["/d", "/s", "/c", command];
      child = spawn(shell === "powershell" ? "powershell.exe" : "cmd.exe", args, {
        cwd: resolvedCwd,
        windowsHide: true,
        shell: false,
      });
    } catch {
      reject(failError("EXECUTION_FAILED"));
      return;
    }

    child.on("error", () => {
      const entry = activeExecutions.get(executionId);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      activeExecutions.delete(executionId);
      reject(failError("EXECUTION_FAILED"));
    });

    const output = collectOutput(child);

    const finish = (result: TerminalResult) => {
      const entry = activeExecutions.get(executionId);
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        activeExecutions.delete(executionId);
      }
      resolve(result);
    };

    const entry: ActiveExecution = {
      child,
      timer: null,
      cancelled: false,
      resolve: finish,
      reject,
    };
    activeExecutions.set(executionId, entry);

    child.on("close", (code) => {
      if (entry.cancelled) return; // cancel 已 reject
      finish({
        exitCode: code,
        stdout: output.stdout,
        stderr: output.stderr,
        timedOut: false,
        durationMs: Date.now() - start,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      });
    });

    entry.timer = setTimeout(() => {
      const e = activeExecutions.get(executionId);
      if (!e) return;
      e.cancelled = true;
      activeExecutions.delete(executionId);
      void killProcessTree(e.child.pid ?? 0).then(() => {
        finish({
          exitCode: null,
          stdout: output.stdout,
          stderr: output.stderr,
          timedOut: true,
          durationMs: Date.now() - start,
          stdoutTruncated: output.stdoutTruncated,
          stderrTruncated: output.stderrTruncated,
        });
      });
    }, timeoutMs);
  });
}

async function handleTerminalCancel(input: unknown): Promise<void> {
  const obj = validateInputObject(input);
  const executionId = typeof obj?.executionId === "string" ? obj.executionId : "";
  // V2 registry 优先（runtime handle；cancel → runtime reject CANCELLED）
  const v2 = activeV2Executions.get(executionId);
  if (v2) {
    await v2.cancel();
    return;
  }
  const entry = activeExecutions.get(executionId);
  if (!entry) return; // 已结束：幂等
  entry.cancelled = true;
  if (entry.timer) clearTimeout(entry.timer);
  activeExecutions.delete(executionId);
  await killProcessTree(entry.child.pid ?? 0);
  // 契约：cancel 必须让 execute reject { code: "CANCELLED" }
  entry.reject(failError("CANCELLED"));
}

/* ---------------- Terminal V2（Streaming / Lifecycle；向后兼容 V1） ---------------- */

/** V2 活跃执行注册表（runtime handle；cancel/清理统一入口） */
const activeV2Executions = new Map<string, TerminalRuntimeHandle>();

/** Stop Kiro / App 关闭时终止全部活跃 terminal 进程（V1 + V2；含 process tree） */
export async function cancelAllTerminalExecutions(): Promise<void> {
  // V2 runtime handles
  const v2Handles = Array.from(activeV2Executions.values());
  activeV2Executions.clear();
  // V1 entries
  const v1Entries = Array.from(activeExecutions.values());
  activeExecutions.clear();
  for (const entry of v1Entries) {
    if (entry.cancelled) continue;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    await killProcessTree(entry.child.pid ?? 0);
    entry.reject(failError("CANCELLED"));
  }
  await Promise.allSettled(v2Handles.map((h) => h.cancel()));
}

/** 兼容导出：仅 V2（Stop Kiro 由 Web 侧 cancelAllActiveTerminalExecutions 走 bridge.cancel 处理） */
export async function cancelAllV2TerminalExecutions(): Promise<void> {
  const handles = Array.from(activeV2Executions.values());
  activeV2Executions.clear();
  await Promise.allSettled(handles.map((h) => h.cancel()));
}

async function handleTerminalStart(
  input: unknown,
  event: Electron.IpcMainInvokeEvent
): Promise<TerminalResult> {
  const obj = validateInputObject(input);
  if (!obj) fail("INVALID_OPERATION");
  const executionId = typeof obj.executionId === "string" && obj.executionId.length > 0 && obj.executionId.length <= 128 ? obj.executionId : null;
  const shell = obj.shell === "cmd" ? "cmd" : obj.shell === "powershell" ? "powershell" : null;
  const command = typeof obj.command === "string" && obj.command.length > 0 && obj.command.length <= 8192 ? obj.command : null;
  const timeoutMs = typeof obj.timeoutMs === "number" ? Math.floor(obj.timeoutMs) : 60000;
  const executionMode = obj.executionMode === "long-running" ? "long-running" : "foreground";
  if (!executionId || !shell || !command) fail("INVALID_OPERATION");

  if (activeExecutions.has(executionId) || activeV2Executions.has(executionId)) fail("INVALID_OPERATION", "执行 ID 冲突。");
  const grant = getGrant(obj.grantId);
  if (!grant) fail("PERMISSION_DENIED");

  const cwdRaw = typeof obj.cwd === "string" ? obj.cwd : "";
  const resolvedCwd = resolveWithinRoot(grant.root, cwdRaw);
  if (!resolvedCwd) fail("PERMISSION_DENIED");

  // 事件只经 sanitized 内容（runtime 已做 ANSI/path/secret redaction + char bound）；
  // 发送给发起请求的 renderer（webContents）
  const { promise, handle } = runTerminalProcess({
    executionId,
    shell,
    cwd: resolvedCwd,
    command,
    timeoutMs,
    executionMode,
    onEvent: (e: DesktopTerminalEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("bridge:terminal:event", e);
      }
    },
  });
  activeV2Executions.set(executionId, handle);
  promise.finally(() => {
    activeV2Executions.delete(executionId);
  });

  // runtime 错误 code → Bridge failError 契约（preload 只认 Error.message 内 JSON）
  return promise.catch((err: Error & { code?: string }) => {
    if (err?.code === "CANCELLED") throw failError("CANCELLED");
    throw failError("EXECUTION_FAILED");
  });
}

/* ---------------- IPC 注册 ---------------- */

export function registerDesktopBridgeIpc(): void {
  void loadGrants().then(() => {
    /* grants 就绪 */
  });

  ipcMain.handle("bridge:fs:pickDirectory", (_e, input) => handlePickDirectory(input));
  ipcMain.handle("bridge:fs:getGrantStatus", (_e, input) => handleGetGrantStatus(input));
  ipcMain.handle("bridge:fs:forgetGrant", (_e, input) => handleForgetGrant(input));
  ipcMain.handle("bridge:fs:list", (_e, input) => handleList(input));
  ipcMain.handle("bridge:fs:stat", (_e, input) => handleStat(input));
  ipcMain.handle("bridge:fs:readText", (_e, input) => handleReadText(input));
  ipcMain.handle("bridge:fs:readBytes", (_e, input) => handleReadBytes(input));
  ipcMain.handle("bridge:fs:readTextPrefix", (_e, input) => handleReadTextPrefix(input));
  ipcMain.handle("bridge:fs:createDirectory", (_e, input) => handleCreateDirectory(input));
  ipcMain.handle("bridge:fs:writeText", (_e, input) => handleWriteText(input));
  ipcMain.handle("bridge:fs:writeBytes", (_e, input) => handleWriteBytes(input));
  ipcMain.handle("bridge:fs:remove", (_e, input) => handleRemove(input));
  ipcMain.handle("bridge:fs:move", (_e, input) => handleMove(input));

  ipcMain.handle("bridge:terminal:execute", (_e, input) => handleTerminalExecute(input));
  ipcMain.handle("bridge:terminal:cancel", (_e, input) => handleTerminalCancel(input));
  ipcMain.handle("bridge:terminal:start", (e, input) => handleTerminalStart(input, e));
}
