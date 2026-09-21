// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { UiaWorker, UiaWorkerRequestError, UiaWorkerUnavailableError } from "@/src/main/computer/uiaWorker";
import { createUiaWorkerClient } from "@/src/main/computer/uiaWorkerClient";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";
import type { NativeGuiActionResult } from "@/src/main/computer/guiAction";

/** 假 worker：Node 脚本，实现 ping/windows/resolve/act/activate + hang/crash 控制 */
const FAKE_SERVER = `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    if (req.op === "hang") continue;
    if (req.op === "crash") process.exit(1);
    let data;
    if (req.op === "ping") data = { pong: true };
    else if (req.op === "windows") data = { foreground: 101, windows: [{ hwnd: 101, pid: 1, title: "T", appName: "app", x: 0, y: 0, width: 100, height: 50, isActive: true, isOffscreen: false, zIndex: 0 }] };
    else if (req.op === "inspect") data = { elements: [{ nativeRef: "42.1", role: "Button", name: "OK", enabled: true, focused: false, isPassword: false, x: 1, y: 2, width: 3, height: 4, depth: 0 }], truncated: false };
    else if (req.op === "resolve") data = { element: req.payload.nativeRef ? { nativeRef: req.payload.nativeRef, role: "Button", name: "OK", enabled: true, focused: false, isPassword: false, x: 1, y: 2, width: 3, height: 4, depth: 0 } : null };
    else if (req.op === "act") data = { ok: true, method: "uia-invoke" };
    else if (req.op === "activate") data = { active: true };
    else data = { ok: true };
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, data }) + "\\n");
  }
});
`;

function fakeSpawn(): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["-e", FAKE_SERVER], { stdio: ["pipe", "pipe", "pipe"] });
}

function makeWorker(options: Partial<ConstructorParameters<typeof UiaWorker>[0]> = {}) {
  return new UiaWorker({ spawnFn: fakeSpawn, enableIdleTimer: false, ...options });
}

describe("UiaWorker — 常驻进程管理", () => {
  it("ping / windows / inspect / resolve / act 走同一进程", async () => {
    const worker = makeWorker();
    try {
      await expect(worker.request("ping")).resolves.toMatchObject({ pong: true });
      const windows = await worker.request<{ windows: Array<{ hwnd: number }> }>("windows");
      expect(windows.windows[0].hwnd).toBe(101);
      const tree = await worker.request<{ elements: Array<{ nativeRef: string }> }>("inspect", { hwnd: 101 });
      expect(tree.elements[0].nativeRef).toBe("42.1");
      const resolved = await worker.request<{ element: { name: string } }>("resolve", { hwnd: 101, nativeRef: "42.1" });
      expect(resolved.element.name).toBe("OK");
      const acted = await worker.request<{ ok: boolean; method: string }>("act", { hwnd: 101, action: "click" });
      expect(acted).toEqual({ ok: true, method: "uia-invoke" });
    } finally {
      worker.dispose();
    }
  });

  it("并发请求按 id 正确关联", async () => {
    const worker = makeWorker();
    try {
      const [a, b, c] = await Promise.all([
        worker.request<{ pong: boolean }>("ping"),
        worker.request<{ windows: unknown[] }>("windows"),
        worker.request<{ active: boolean }>("activate", { hwnd: 101 }),
      ]);
      expect(a).toMatchObject({ pong: true });
      expect(Array.isArray(b.windows)).toBe(true);
      expect(c.active).toBe(true);
    } finally {
      worker.dispose();
    }
  });

  it("请求超时 → UnavailableError + 自动重启（后续请求恢复）", async () => {
    let spawnCount = 0;
    const worker = new UiaWorker({
      spawnFn: () => {
        spawnCount += 1;
        return fakeSpawn();
      },
      enableIdleTimer: false,
    });
    try {
      await expect(worker.request("hang", {}, 300)).rejects.toBeInstanceOf(UiaWorkerUnavailableError);
      // 超时后进程被重启：下一次请求重新拉起
      await expect(worker.request("ping", {}, 3000)).resolves.toMatchObject({ pong: true });
      expect(spawnCount).toBeGreaterThanOrEqual(2);
    } finally {
      worker.dispose();
    }
  });

  it("子进程崩溃 → pending 全部 reject + 下一次请求重启", async () => {
    let spawnCount = 0;
    const worker = new UiaWorker({
      spawnFn: () => {
        spawnCount += 1;
        return fakeSpawn();
      },
      enableIdleTimer: false,
    });
    try {
      await expect(worker.request("crash", {}, 3000)).rejects.toBeInstanceOf(UiaWorkerUnavailableError);
      await expect(worker.request("ping", {}, 3000)).resolves.toMatchObject({ pong: true });
      expect(spawnCount).toBeGreaterThanOrEqual(2);
    } finally {
      worker.dispose();
    }
  });

  it("启动失败（spawn 抛错）→ UnavailableError（调用方 fallback）", async () => {
    const worker = new UiaWorker({
      spawnFn: () => {
        throw new Error("no powershell");
      },
      enableIdleTimer: false,
    });
    await expect(worker.request("ping")).rejects.toBeInstanceOf(UiaWorkerUnavailableError);
  });

  it("空闲回收：超过 idleTimeout 且无 pending → 释放进程；下次请求重启", async () => {
    let now = 1_000;
    let spawnCount = 0;
    const worker = new UiaWorker({
      spawnFn: () => {
        spawnCount += 1;
        return fakeSpawn();
      },
      enableIdleTimer: false,
      idleTimeoutMs: 100,
      now: () => now,
    });
    try {
      await worker.request("ping");
      expect(worker.isRunning()).toBe(true);
      expect(worker.recycleIfIdle()).toBe(false); // 未超时
      now += 200;
      expect(worker.recycleIfIdle()).toBe(true); // 回收
      expect(worker.isRunning()).toBe(false);
      await worker.request("ping");
      expect(spawnCount).toBe(2);
    } finally {
      worker.dispose();
    }
  });

  it("dispose 后请求被拒绝", async () => {
    const worker = makeWorker();
    await worker.request("ping");
    worker.dispose();
    await expect(worker.request("ping")).rejects.toBeInstanceOf(UiaWorkerUnavailableError);
  });
});

/* ---------------- 客户端 fallback 契约（CI 可测，无需 PowerShell） ---------------- */

const RAW_WINDOW = {
  hwnd: 101,
  pid: 1,
  title: "T",
  appName: "app",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  isActive: true,
  isOffscreen: false,
  zIndex: 0,
};
const WINDOW_RECORD: NativeWindowRecord = {
  hwnd: 101,
  pid: 1,
  title: "T",
  appName: "app",
  bounds: { x: 0, y: 0, width: 100, height: 50 },
  isActive: true,
  isOffscreen: false,
  zIndex: 0,
};
const UI_ELEMENT: NativeUiElement = {
  nativeRef: "42.1",
  role: "Button",
  name: "OK",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 1, y: 2, width: 3, height: 4 },
  depth: 0,
};
const ACTION_RESULT: NativeGuiActionResult = { ok: true, method: "uia-invoke" };

function makeClient(overrides: {
  request: (op: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  fallback?: Partial<Parameters<typeof createUiaWorkerClient>[0]["fallback"]>;
}) {
  const fallbackCalls = {
    listWindows: vi.fn(async () => [WINDOW_RECORD]),
    inspectUiTree: vi.fn(async () => ({ elements: [UI_ELEMENT], truncated: false })),
    resolveUiElement: vi.fn(async () => UI_ELEMENT),
    runGuiAction: vi.fn(async () => ACTION_RESULT),
    activateWindow: vi.fn(async () => true),
    ...overrides.fallback,
  };
  const client = createUiaWorkerClient({
    request: overrides.request as never,
    fallback: fallbackCalls as never,
  });
  return { client, fallbackCalls };
}

describe("UiaWorkerClient — fallback 契约", () => {
  it("worker 可用 → 走 worker，不触发 fallback", async () => {
    const request = vi.fn(async (op: string) => {
      if (op === "windows") return { foreground: 101, windows: [RAW_WINDOW] };
      if (op === "inspect") return { elements: [UI_ELEMENT], truncated: false };
      if (op === "resolve") return { element: UI_ELEMENT };
      if (op === "act") return ACTION_RESULT;
      if (op === "activate") return { active: true };
      throw new Error("unexpected");
    });
    const { client, fallbackCalls } = makeClient({ request: request as never });
    await expect(client.listNativeWindows()).resolves.toHaveLength(1);
    await expect(client.inspectNativeUiTree(101)).resolves.toMatchObject({ truncated: false });
    await expect(client.resolveNativeUiElement(101, "42.1")).resolves.toMatchObject({ name: "OK" });
    await expect(client.runNativeGuiAction({ hwnd: 101, nativeRef: null, action: "click" })).resolves.toEqual(ACTION_RESULT);
    await expect(client.activateNativeWindow(101)).resolves.toBe(true);
    expect(fallbackCalls.listWindows).not.toHaveBeenCalled();
    expect(fallbackCalls.runGuiAction).not.toHaveBeenCalled();
  });

  it("worker 基础设施失败（Unavailable）→ 回退一次性脚本", async () => {
    const request = vi.fn(async () => {
      throw new UiaWorkerUnavailableError("no worker");
    });
    const { client, fallbackCalls } = makeClient({ request: request as never });
    await expect(client.listNativeWindows()).resolves.toEqual([WINDOW_RECORD]);
    await expect(client.inspectNativeUiTree(101)).resolves.toMatchObject({ elements: [UI_ELEMENT] });
    await expect(client.resolveNativeUiElement(101, "42.1")).resolves.toEqual(UI_ELEMENT);
    await expect(client.runNativeGuiAction({ hwnd: 101, nativeRef: null, action: "click" })).resolves.toEqual(ACTION_RESULT);
    await expect(client.activateNativeWindow(101)).resolves.toBe(true);
    expect(fallbackCalls.listWindows).toHaveBeenCalledTimes(1);
    expect(fallbackCalls.inspectUiTree).toHaveBeenCalledTimes(1);
    expect(fallbackCalls.resolveUiElement).toHaveBeenCalledTimes(1);
    expect(fallbackCalls.runGuiAction).toHaveBeenCalledTimes(1);
    expect(fallbackCalls.activateWindow).toHaveBeenCalledTimes(1);
  });

  it("业务失败（worker-error）→ 原样抛出，绝不 fallback 重试", async () => {
    const request = vi.fn(async () => {
      throw new UiaWorkerRequestError("worker-error");
    });
    const { client, fallbackCalls } = makeClient({ request: request as never });
    await expect(client.runNativeGuiAction({ hwnd: 101, nativeRef: null, action: "click" })).rejects.toBeInstanceOf(
      UiaWorkerRequestError
    );
    expect(fallbackCalls.runGuiAction).not.toHaveBeenCalled();
  });

  it("act 业务失败（bounds-changed）原样返回，不 fallback", async () => {
    const request = vi.fn(async () => ({ ok: false, reason: "bounds-changed" }));
    const { client, fallbackCalls } = makeClient({ request: request as never });
    await expect(client.runNativeGuiAction({ hwnd: 101, nativeRef: "42.1", action: "click" })).resolves.toEqual({
      ok: false,
      reason: "bounds-changed",
    });
    expect(fallbackCalls.runGuiAction).not.toHaveBeenCalled();
  });
});
