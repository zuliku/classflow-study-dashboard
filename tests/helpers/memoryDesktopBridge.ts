/**
 * Test-only：ClassFlow Desktop Bridge Mock（memory filesystem）。
 *
 * 只被 Vitest / Playwright 使用（production 代码绝不 import 本文件 →
 * 不会进入 Web bundle）。纯内存实现，不用 Node fs（保持 browser-safe）。
 *
 * installMemoryDesktopBridgeMock() 是 fully self-contained 函数（无任何模块引用），
 * E2E 通过 `(${fn.toString()})()` 经 addInitScript 注入页面；
 * 同时暴露 window.__desktopBridgeControl 供测试读取 calls / files / 撤销 grant。
 */
import { ClassFlowDesktopBridgeV1 } from "@/lib/desktop/types";
export function installMemoryDesktopBridgeMock() {
  const grants = new Map<string, { displayName: string; access: string; granted: boolean }>();
  const files = new Map<string, { kind: string; bytes: Uint8Array | null; type?: string }>();
  const calls: Record<string, number> = { pick: 0, list: 0, stat: 0, readText: 0, readBytes: 0, readTextPrefix: 0, createDirectory: 0, writeText: 0, writeBytes: 0, remove: 0, move: 0, forgetGrant: 0, getGrantStatus: 0, terminalExecute: 0, terminalCancel: 0 };
  const cancelled = { value: false };
  const holdNextTerminal = { value: false };
  const pendingTerminal: { resolve: null | ((r: unknown) => void); reject: null | ((e: unknown) => void); command: string; isPending: boolean } = { resolve: null, reject: null, command: "", isPending: false };
  let lastTerminalInput: null | Record<string, unknown> = null;
  let terminalResultHook: null | ((input: { command: string }) => unknown) = null;
  let terminalRejectCode: null | string = null;
  let seq = 0;

  const key = (grantId: string, path: string) => grantId + "::" + (path || "").replace(/\/+$/, "");
  const ensureParents = (grantId: string, path: string) => {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts.slice(0, -1)) {
      cur = cur ? cur + "/" + part : part;
      if (!files.has(key(grantId, cur))) files.set(key(grantId, cur), { kind: "directory", bytes: null });
    }
  };

  const grantOf = (grantId: string) => {
    const g = grants.get(grantId);
    if (!g) throw { code: "PERMISSION_DENIED", message: "grant missing" };
    if (!g.granted) throw { code: "PERMISSION_DENIED", message: "grant revoked" };
    return g;
  };

  const failIfMissing = (grantId: string, path: string) => {
    if (!files.has(key(grantId, path))) throw { code: "NOT_FOUND", message: "no such entry" };
  };

  const filesystem = {
    async pickDirectory(input: { access?: string }) {
      calls.pick += 1;
      if (cancelled.value) return null;
      seq += 1;
      const grantId = "grant_mock_" + seq;
      grants.set(grantId, { displayName: "论文资料", access: input.access || "read-write", granted: true });
      return { grantId, displayName: "论文资料", access: input.access || "read-write" };
    },
    async getGrantStatus(input: { grantId: string }) {
      calls.getGrantStatus += 1;
      const g = grants.get(input.grantId);
      if (!g) return { status: "missing" };
      return { status: g.granted ? "granted" : "denied" };
    },
    async forgetGrant(input: { grantId: string }) {
      calls.forgetGrant += 1;
      grants.delete(input.grantId);
    },
    async list(input: { grantId: string; path: string }) {
      calls.list += 1;
      grantOf(input.grantId);
      const prefix = key(input.grantId, input.path);
      const out: { name: string; kind: string; size: number }[] = [];
      files.forEach((v, k) => {
        if (!k.startsWith(prefix + "/")) return;
        const rest = k.slice(prefix.length + 1);
        if (rest.includes("/")) return;
        out.push({ name: rest, kind: v.kind, size: v.bytes ? v.bytes.length : 0 });
      });
      return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
    },
    async stat(input: { grantId: string; path: string }) {
      calls.stat += 1;
      grantOf(input.grantId);
      const k = key(input.grantId, input.path);
      const v = files.get(k);
      if (!v) return null;
      return { kind: v.kind, size: v.bytes ? v.bytes.length : 0, type: v.type || "" };
    },
    async readText(input: { grantId: string; path: string }) {
      calls.readText += 1;
      grantOf(input.grantId);
      failIfMissing(input.grantId, input.path);
      const v = files.get(key(input.grantId, input.path));
      if (!v || v.kind !== "file") throw { code: "INVALID_OPERATION" };
      return new TextDecoder().decode(v.bytes || new Uint8Array(0));
    },
    async readBytes(input: { grantId: string; path: string }) {
      calls.readBytes += 1;
      grantOf(input.grantId);
      failIfMissing(input.grantId, input.path);
      const v = files.get(key(input.grantId, input.path));
      if (!v || v.kind !== "file") throw { code: "INVALID_OPERATION" };
      return (v.bytes || new Uint8Array(0)).slice();
    },
    async readTextPrefix(input: { grantId: string; path: string; maxBytes: number }) {
      calls.readTextPrefix += 1;
      grantOf(input.grantId);
      failIfMissing(input.grantId, input.path);
      const v = files.get(key(input.grantId, input.path));
      const bytes = v?.bytes || new Uint8Array(0);
      const sliced = bytes.slice(0, input.maxBytes);
      return { text: new TextDecoder().decode(sliced), truncated: bytes.length > input.maxBytes };
    },
    async createDirectory(input: { grantId: string; path: string }) {
      calls.createDirectory += 1;
      grantOf(input.grantId);
      const k = key(input.grantId, input.path);
      if (files.has(k)) return "exists";
      ensureParents(input.grantId, input.path);
      files.set(k, { kind: "directory", bytes: null });
      return "created";
    },
    async writeText(input: { grantId: string; path: string; content: string; type?: string }) {
      calls.writeText += 1;
      grantOf(input.grantId);
      ensureParents(input.grantId, input.path);
      files.set(key(input.grantId, input.path), { kind: "file", bytes: new TextEncoder().encode(input.content), type: input.type || "text/plain" });
    },
    async writeBytes(input: { grantId: string; path: string; content: Uint8Array; type?: string }) {
      calls.writeBytes += 1;
      grantOf(input.grantId);
      ensureParents(input.grantId, input.path);
      files.set(key(input.grantId, input.path), { kind: "file", bytes: input.content.slice(), type: input.type || "application/octet-stream" });
    },
    async remove(input: { grantId: string; path: string; kind: "file" | "directory" }) {
      calls.remove += 1;
      grantOf(input.grantId);
      const k = key(input.grantId, input.path);
      const v = files.get(k);
      if (!v) throw { code: "NOT_FOUND" };
      if (input.kind === "directory") {
        let nonEmpty = false;
        files.forEach((_fv, fk) => {
          if (fk.startsWith(k + "/")) nonEmpty = true;
        });
        if (nonEmpty) throw { code: "DIRECTORY_NOT_EMPTY" };
      }
      files.delete(k);
    },
    async move(input: { grantId: string; from: string; to: string }) {
      calls.move += 1;
      grantOf(input.grantId);
      const fromK = key(input.grantId, input.from);
      const toK = key(input.grantId, input.to);
      const v = files.get(fromK);
      if (!v) throw { code: "NOT_FOUND" };
      if (files.has(toK)) throw { code: "ALREADY_EXISTS" };
      ensureParents(input.grantId, input.to);
      files.set(toK, v);
      files.delete(fromK);
    },
  };

  const bridge: ClassFlowDesktopBridgeV1 = {
    version: 1,
    platform: "windows",
    filesystem: filesystem as unknown as ClassFlowDesktopBridgeV1["filesystem"],
    terminal: {
      version: 1,
      async execute(input: {
        executionId: string;
        shell: string;
        grantId: string;
        cwd: string;
        command: string;
        timeoutMs: number;
      }): Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        durationMs: number;
        stdoutTruncated: boolean;
        stderrTruncated: boolean;
      }> {
        calls.terminalExecute += 1;
        lastTerminalInput = {
          executionId: input.executionId,
          shell: input.shell,
          grantId: input.grantId,
          cwd: input.cwd,
          command: input.command,
          timeoutMs: input.timeoutMs,
        };
        // V1.0.1：bridge reject fixture（结构化 reject；timeout 永远 resolve 不 reject）
        if (terminalRejectCode) {
          const code = terminalRejectCode;
          terminalRejectCode = null;
          throw { code, message: "C:\\Users\\Alice\\secret.txt raw" };
        }
        const canned = () =>
          (terminalResultHook
            ? terminalResultHook({ command: input.command })
            : {
                exitCode: 0,
                stdout: "OK " + input.command,
                stderr: "",
                timedOut: false,
                durationMs: 100,
                stdoutTruncated: false,
                stderrTruncated: false,
              }) as {
            exitCode: number | null;
            stdout: string;
            stderr: string;
            timedOut: boolean;
            durationMs: number;
            stdoutTruncated: boolean;
            stderrTruncated: boolean;
          };
        if (holdNextTerminal.value) {
          holdNextTerminal.value = false;
          pendingTerminal.command = input.command;
          pendingTerminal.isPending = true;
          return new Promise((resolve, reject) => {
            pendingTerminal.resolve = resolve as (r: unknown) => void;
            pendingTerminal.reject = reject;
          });
        }
        return canned();
      },
      async cancel(input: { executionId: string }) {
        calls.terminalCancel += 1;
        // V1.0.1 Handoff 冻结：cancel 后 execute promise 必须 reject CANCELLED（不是 resolve exitCode=null）
        if (pendingTerminal.isPending && pendingTerminal.reject) {
          pendingTerminal.isPending = false;
          pendingTerminal.reject({ code: "CANCELLED", message: "cancelled by user" });
          pendingTerminal.resolve = null;
          pendingTerminal.reject = null;
        }
      },
    },
  };

  (window as unknown as Record<string, unknown>).classflowDesktop = bridge;
  (window as unknown as Record<string, unknown>).__desktopBridgeControl = {
    calls,
    files,
    grants,
    cancelled,
    cancelNextPick: () => {
      cancelled.value = true;
    },
    resetCancel: () => {
      cancelled.value = false;
    },
    revokeGrant: (grantId: string) => {
      const g = grants.get(grantId);
      if (g) g.granted = false;
    },
    uninstall: () => {
      delete (window as unknown as Record<string, unknown>).classflowDesktop;
    },
    opCount: (op: string) => calls[op] || 0,
    fileExists: (grantId: string, path: string) => files.has(grantId + "::" + (path || "").replace(/\/+$/, "")),
    // Desktop Terminal V1 控制
    lastTerminalInput: () => lastTerminalInput,
    setTerminalResultHook: (hook: null | ((input: { command: string }) => unknown)) => {
      terminalResultHook = hook;
    },
    setTerminalRejectCode: (code: null | string) => {
      terminalRejectCode = code;
    },
    holdNextTerminal,
    pendingTerminal,
    releasePendingTerminal: () => {
      if (pendingTerminal.isPending && pendingTerminal.resolve) {
        pendingTerminal.isPending = false;
        pendingTerminal.resolve({
          exitCode: 0,
          stdout: "released " + pendingTerminal.command,
          stderr: "",
          timedOut: false,
          durationMs: 100,
          stdoutTruncated: false,
          stderrTruncated: false,
        });
        pendingTerminal.resolve = null;
        pendingTerminal.reject = null;
      }
    },
  };
}
