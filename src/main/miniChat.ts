/**
 * Kiro 常驻 Mini 窗（系统桌面级常驻，独立 BrowserWindow）——Main 侧。
 *
 * 架构（单运行时 + 主进程中继）：
 * - 聊天唯一真相在主窗口 KiroSession/useKiroChat；Mini 是瘦客户端（`?mini=1` 同包渲染）。
 * - Main 做可信中继：mini:send（invoke，需关联响应）→ 主窗口 `mini:remote-send` 执行；
 *   主窗口 `mini:publish-state`（send）→ 缓存最新快照 → 转推 mini `mini:state`。
 * - 同 session（CSP/injector 既有逻辑直接覆盖；Mini 不直调 Local API，所有模型调用走主窗口）。
 * - sender 校验：mini:* 显式校验 trusted（主窗口或 Mini 窗其一），fail closed。
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, dirname } from "node:path";
import { promises as fs } from "node:fs";
import type { MiniChatSnapshot } from "@/lib/ai/miniChat/protocol";
import { decideNavigation } from "@/lib/security/navigation";

export const MINI_DEFAULT_SIZE = { width: 340, height: 560 };
const MINI_MIN_SIZE = { width: 300, height: 440 };
const MINI_MAX_SIZE = { width: 560, height: 900 };
const MINI_SEND_TIMEOUT_MS = 90_000;
const BOUNDS_SAVE_DEBOUNCE_MS = 300;

interface MiniBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
}

let miniWindow: BrowserWindow | null = null;
let latestSnapshot: MiniChatSnapshot | null = null;
let boundsSaveTimer: NodeJS.Timeout | null = null;

/** requestId → 待回执（mini invoke ↔ 主窗口执行结果关联） */
const pendingSends = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>();

function boundsFile(): string {
  return join(app.getPath("userData"), "mini-chat-bounds.json");
}

function normalizeBounds(value: unknown): MiniBounds {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const width = Math.min(
    MINI_MAX_SIZE.width,
    Math.max(MINI_MIN_SIZE.width, Math.round(num(v.width) ?? MINI_DEFAULT_SIZE.width))
  );
  const height = Math.min(
    MINI_MAX_SIZE.height,
    Math.max(MINI_MIN_SIZE.height, Math.round(num(v.height) ?? MINI_DEFAULT_SIZE.height))
  );
  return {
    x: num(v.x) === undefined ? undefined : Math.round(num(v.x) as number),
    y: num(v.y) === undefined ? undefined : Math.round(num(v.y) as number),
    width,
    height,
    alwaysOnTop: v.alwaysOnTop === false ? false : true,
  };
}

async function loadBounds(): Promise<MiniBounds> {
  try {
    const raw = await fs.readFile(boundsFile(), "utf8");
    return normalizeBounds(JSON.parse(raw));
  } catch {
    return normalizeBounds(null);
  }
}

function scheduleSaveBounds(): void {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    void saveBoundsNow();
  }, BOUNDS_SAVE_DEBOUNCE_MS);
}

async function saveBoundsNow(): Promise<void> {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  try {
    const [x, y] = miniWindow.getPosition();
    const [width, height] = miniWindow.getSize();
    const payload: MiniBounds = {
      x,
      y,
      width,
      height,
      alwaysOnTop: miniWindow.isAlwaysOnTop(),
    };
    await fs.mkdir(dirname(boundsFile()), { recursive: true });
    await fs.writeFile(boundsFile(), JSON.stringify(payload), "utf8");
  } catch {
    /* 持久化失败不影响会话内位置 */
  }
}

export function getMiniWindow(): BrowserWindow | null {
  return miniWindow && !miniWindow.isDestroyed() ? miniWindow : null;
}

export function isMiniWebContents(id: number): boolean {
  const w = getMiniWindow();
  return !!w && w.webContents.id === id;
}

export function getLatestMiniSnapshot(): MiniChatSnapshot | null {
  return latestSnapshot;
}

function miniLoadTarget(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return `${devUrl.replace(/\/$/, "")}/index.html?mini=1`;
  return "app://bundle/index.html?mini=1";
}

async function ensureMiniWindow(opts: {
  session: Electron.Session;
  preloadPath: string;
  apiBase: string;
  apiCapability: string;
  allowedApiOrigin: string;
  allowedDevOrigin: string | undefined;
}): Promise<BrowserWindow> {
  const existing = getMiniWindow();
  if (existing) return existing;
  const bounds = await loadBounds();
  const w = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: MINI_MIN_SIZE.width,
    minHeight: MINI_MIN_SIZE.height,
    show: false,
    backgroundColor: "#F7F5F5",
    autoHideMenuBar: true,
    title: "Kiro Mini",
    // 无边框微型框：拖动走 renderer `-webkit-app-region: drag`，缩放走原生 thickFrame
    frame: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: bounds.alwaysOnTop,
    skipTaskbar: true,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    webPreferences: {
      preload: opts.preloadPath,
      session: opts.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--classflow-api-base=${opts.apiBase}`,
        `--classflow-api-capability=${opts.apiCapability}`,
      ],
    },
  });
  miniWindow = w;
  void w.loadURL(miniLoadTarget());
  // 与主窗同等导航硬化（此前缺失：mini 内 window.open/跳转无拦截）：
  // 外部链接走系统浏览器，内部仅允许可信渲染器，其余一律拒绝。
  w.webContents.setWindowOpenHandler(({ url }) => {
    const verdict = decideNavigation({ url, allowedApiOrigin: opts.allowedApiOrigin, allowedDevOrigin: opts.allowedDevOrigin });
    if (verdict.kind === "allow-external") {
      void shell.openExternal(url);
    } else if (verdict.kind === "deny") {
      console.warn(`[mini] blocked window.open: ${url} reason=${verdict.reason}`);
    }
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    const verdict = decideNavigation({ url, allowedApiOrigin: opts.allowedApiOrigin, allowedDevOrigin: opts.allowedDevOrigin });
    if (verdict.kind === "allow-internal") return;
    event.preventDefault();
    if (verdict.kind === "allow-external") {
      void shell.openExternal(url);
    } else {
      console.warn(`[mini] blocked will-navigate: ${url} reason=${verdict.reason}`);
    }
  });
  w.on("ready-to-show", () => {
    w.show();
    // 重开即推最新快照（relay 可能在 mini 关闭期间持续 publish，缓存保证不空白）
    if (latestSnapshot && !w.webContents.isDestroyed()) {
      w.webContents.send("mini:state", latestSnapshot);
    }
  });
  // 常驻语义：点 × 只隐藏（任务栏无图标，主窗口按钮可随时召回），bounds 照常落盘
  w.on("close", (event) => {
    if (getMiniWindow() === w) {
      event.preventDefault();
      void saveBoundsNow();
      w.hide();
    }
  });
  w.on("closed", () => {
    if (miniWindow === w) miniWindow = null;
  });
  w.on("move", scheduleSaveBounds);
  w.on("resize", scheduleSaveBounds);
  return w;
}

export interface MiniChatMainDeps {
  getMainWindow: () => BrowserWindow | null;
  getSession: () => Electron.Session | null;
  getPreloadPath: () => string;
  getApiBase: () => string;
  getApiCapability: () => string;
  getAllowedOrigins: () => { allowedApiOrigin: string; allowedDevOrigin: string | undefined };
  /** sender URL 是否属于受信任渲染器（app://bundle 或精确 dev origin）；fail closed */
  isTrustedRendererUrl: (url: string) => boolean;
  /** 受信任 sender（主窗口或 Mini 窗其一）；fail closed */
  isTrustedSender: (sender: Electron.WebContents) => boolean;
}

export function registerMiniChatIpc(deps: MiniChatMainDeps): void {
  // id 信任 + URL 信任双门（仅 id 会在窗内导航到恶意 origin 后继续放行）
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return false;
    if (!deps.isTrustedSender(sender)) return false;
    let url = "";
    try {
      url = sender.getURL();
    } catch {
      return false;
    }
    return deps.isTrustedRendererUrl(url);
  };

  const show = async (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (!trusted(event)) return;
    const session = deps.getSession();
    if (!session) return;
    const { allowedApiOrigin, allowedDevOrigin } = deps.getAllowedOrigins();
    const w = await ensureMiniWindow({
      session,
      preloadPath: deps.getPreloadPath(),
      apiBase: deps.getApiBase(),
      apiCapability: deps.getApiCapability(),
      allowedApiOrigin,
      allowedDevOrigin,
    });
    if (!w.isDestroyed()) {
      if (!w.isVisible()) w.show();
      w.focus();
    }
  };

  ipcMain.on("mini:show", (event) => void show(event));
  ipcMain.on("mini:hide", (event) => {
    if (!trusted(event)) return;
    void saveBoundsNow();
    getMiniWindow()?.hide();
  });
  ipcMain.on("mini:toggle", (event) => {
    if (!trusted(event)) return;
    const w = getMiniWindow();
    if (w && w.isVisible()) {
      void saveBoundsNow();
      w.hide();
    } else {
      void show(event);
    }
  });
  ipcMain.on("mini:set-always-on-top", (event, input: unknown) => {
    if (!trusted(event)) return;
    const onTop = (input as { onTop?: unknown })?.onTop !== false;
    getMiniWindow()?.setAlwaysOnTop(onTop);
    scheduleSaveBounds();
  });
  ipcMain.handle("mini:is-always-on-top", (event) => {
    if (!trusted(event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    return { onTop: getMiniWindow()?.isAlwaysOnTop() ?? true };
  });

  // Mini → 主窗口：远端发送（invoke 关联回执；超时 fail closed）
  ipcMain.handle("mini:send", (event, input: unknown) => {
    if (!trusted(event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    if (!isMiniWebContents(event.sender.id)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    const main = deps.getMainWindow();
    if (!main || main.isDestroyed()) {
      throw new Error(JSON.stringify({ code: "MAIN_UNAVAILABLE", message: "主窗口不可用。" }));
    }
    const payload = (input ?? {}) as { requestId?: unknown };
    const requestId = typeof payload.requestId === "string" && payload.requestId ? payload.requestId : null;
    if (!requestId) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "requestId required" }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSends.delete(requestId);
        reject(new Error(JSON.stringify({ code: "TIMEOUT", message: "发送超时，请重试。" })));
      }, MINI_SEND_TIMEOUT_MS);
      pendingSends.set(requestId, { resolve, reject, timer });
      main.webContents.send("mini:remote-send", input);
    });
  });

  // 主窗口执行完成回执（requestId 关联 mini:send 的 invoke；仅主窗口可回执，
  // 否则 mini 可伪造 ok:true 抢占真回执）
  ipcMain.on("mini:remote-send:done", (event, result: unknown) => {
    if (!trusted(event)) return;
    const main = deps.getMainWindow();
    if (!main || main.isDestroyed() || event.sender.id !== main.webContents.id) return;
    const requestId = (result as { requestId?: unknown })?.requestId;
    if (typeof requestId !== "string") return;
    const pending = pendingSends.get(requestId);
    if (!pending) return;
    pendingSends.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(result);
  });

  ipcMain.on("mini:stop", (event) => {
    if (!trusted(event)) return;
    if (!isMiniWebContents(event.sender.id)) return;
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send("mini:remote-stop");
  });

  // 主窗口 → Mini：快照发布（缓存最新；mini 不可见时仅缓存，重开即推）
  ipcMain.on("mini:publish-state", (event, snapshot: unknown) => {
    if (!trusted(event)) return;
    const main = deps.getMainWindow();
    if (main && event.sender.id !== main.webContents.id) return;
    latestSnapshot = snapshot as MiniChatSnapshot;
    const w = getMiniWindow();
    if (w && w.isVisible() && !w.webContents.isDestroyed()) {
      w.webContents.send("mini:state", latestSnapshot);
    }
  });
  ipcMain.handle("mini:get-state", (event) => {
    if (!trusted(event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    return latestSnapshot;
  });
}
