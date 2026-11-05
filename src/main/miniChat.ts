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

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
} from "electron";
import { join, dirname } from "node:path";
import { promises as fs } from "node:fs";
import {
  MINI_CAPSULE_SIZE,
  MINI_MODE_ANIMATION_MS,
  type MiniChatSnapshot,
  type MiniChatWindowMode,
  type MiniChatWindowState,
} from "@/lib/ai/miniChat/protocol";
import { decideNavigation } from "@/lib/security/navigation";

export const MINI_DEFAULT_SIZE = { width: 340, height: 560 };
const MINI_MIN_SIZE = { width: 300, height: 440 };
const MINI_MAX_SIZE = { width: 560, height: 900 };
const MINI_SEND_TIMEOUT_MS = 90_000;
const BOUNDS_SAVE_DEBOUNCE_MS = 300;
const MINI_SHORTCUT = "CommandOrControl+Shift+K";

interface MiniBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  expandedWidth: number;
  expandedHeight: number;
  alwaysOnTop: boolean;
  mode: MiniChatWindowMode;
}

let miniWindow: BrowserWindow | null = null;
let latestSnapshot: MiniChatSnapshot | null = null;
let boundsSaveTimer: NodeJS.Timeout | null = null;
let capsuleSettleTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let shortcutRegistered = false;
let displayListenersRegistered = false;
let currentMode: MiniChatWindowMode = "expanded";
let expandedSize = { ...MINI_DEFAULT_SIZE };

/** requestId → 待回执（mini invoke ↔ 主窗口执行结果关联） */
const pendingSends = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>();

function boundsFile(): string {
  return join(app.getPath("userData"), "mini-chat-bounds.json");
}

function clampSize(width: number, height: number) {
  return {
    width: Math.min(MINI_MAX_SIZE.width, Math.max(MINI_MIN_SIZE.width, Math.round(width))),
    height: Math.min(MINI_MAX_SIZE.height, Math.max(MINI_MIN_SIZE.height, Math.round(height))),
  };
}

function normalizeBounds(value: unknown): MiniBounds {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const mode: MiniChatWindowMode = v.mode === "capsule" ? "capsule" : "expanded";
  const fallback = clampSize(num(v.width) ?? MINI_DEFAULT_SIZE.width, num(v.height) ?? MINI_DEFAULT_SIZE.height);
  const expanded = clampSize(
    num(v.expandedWidth) ?? fallback.width,
    num(v.expandedHeight) ?? fallback.height
  );
  return {
    x: num(v.x) === undefined ? undefined : Math.round(num(v.x) as number),
    y: num(v.y) === undefined ? undefined : Math.round(num(v.y) as number),
    width: mode === "capsule" ? MINI_CAPSULE_SIZE : expanded.width,
    height: mode === "capsule" ? MINI_CAPSULE_SIZE : expanded.height,
    expandedWidth: expanded.width,
    expandedHeight: expanded.height,
    alwaysOnTop: v.alwaysOnTop === false ? false : true,
    mode,
  };
}

/** 把窗口 bounds clamp 到当前显示器工作区（多显示器拔插/分辨率变化后仍可见） */
function clampBounds(input: {
  x?: number;
  y?: number;
  width: number;
  height: number;
}): { x?: number; y?: number; width: number; height: number } {
  const width = Math.min(input.width, MINI_MAX_SIZE.width);
  const height = Math.min(input.height, MINI_MAX_SIZE.height);
  if (input.x === undefined || input.y === undefined) return { width, height };
  const display = screen.getDisplayMatching({
    x: input.x,
    y: input.y,
    width,
    height,
  });
  const area = (display ?? screen.getPrimaryDisplay()).workArea;
  const x = Math.min(Math.max(input.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(input.y, area.y), area.y + area.height - height);
  return { x: Math.round(x), y: Math.round(y), width, height };
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
    // 窗口不可用户调整大小；expandedSize 是程序设定的逻辑尺寸。
    // 不读取 getSize() 覆盖它——透明窗口在 Windows 下可能包含 1–2px
    // 非客户区，反复展开会把尺寸越滚越大。
    const payload: MiniBounds = {
      x,
      y,
      width: currentMode === "capsule" ? MINI_CAPSULE_SIZE : expandedSize.width,
      height: currentMode === "capsule" ? MINI_CAPSULE_SIZE : expandedSize.height,
      expandedWidth: expandedSize.width,
      expandedHeight: expandedSize.height,
      alwaysOnTop: miniWindow.isAlwaysOnTop(),
      mode: currentMode,
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

/**
 * 收起落地定时器：卡片 CSS 收缩期间原生窗口保持展开尺寸；收缩完成后再
 * 瞬间缩到 72×72。此时可见卡片已经在窗口左上角 72×72，缩窗本身不可见。
 */
function clearCapsuleSettleTimer(): void {
  if (capsuleSettleTimer) {
    clearTimeout(capsuleSettleTimer);
    capsuleSettleTimer = null;
  }
}

/** 原生窗口瞬间改尺寸（仅模式切换用，不参与逐帧动画） */
function setWindowSize(w: BrowserWindow, width: number, height: number): void {
  const [x, y] = w.getPosition();
  const target = clampBounds({ x, y, width, height });
  try {
    w.setBounds(target);
  } catch {
    /* 窗口销毁竞态 */
  }
}

/** 已在屏幕外（旧 bounds / 拔显示器 / 拖出边界）→ 移回当前显示器工作区 */
function ensureWindowVisible(w: BrowserWindow): void {
  if (!w || w.isDestroyed()) return;
  try {
    const bounds = w.getBounds();
    const clamped = clampBounds(bounds);
    if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
      w.setPosition(clamped.x as number, clamped.y as number);
    }
  } catch {
    /* 窗口销毁竞态：忽略 */
  }
}

function setMiniMode(mode: MiniChatWindowMode, instant = false): void {
  const w = getMiniWindow();
  if (!w) return;
  if (currentMode === mode) return;
  clearCapsuleSettleTimer();
  currentMode = mode;
  if (mode === "expanded") {
    // 原生窗口瞬间扩到展开尺寸：新增区域完全透明，用户看不到窗口变大；
    // 卡片的形变全部由 renderer 的 CSS 完成（不逐帧 setBounds）。
    setWindowSize(w, expandedSize.width, expandedSize.height);
    scheduleSaveBounds();
  } else if (instant) {
    setWindowSize(w, MINI_CAPSULE_SIZE, MINI_CAPSULE_SIZE);
    scheduleSaveBounds();
  } else {
    // 收起：窗口先保持展开尺寸，等卡片 CSS 收缩到 72×72 后再瞬间缩窗；
    // 此时缩掉的是透明区域，视觉上无变化。
    capsuleSettleTimer = setTimeout(() => {
      capsuleSettleTimer = null;
      if (currentMode !== "capsule") return;
      const win = getMiniWindow();
      if (!win) return;
      setWindowSize(win, MINI_CAPSULE_SIZE, MINI_CAPSULE_SIZE);
      scheduleSaveBounds();
    }, MINI_MODE_ANIMATION_MS.capsule + 90);
  }
  syncMainThrottling();
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
  currentMode = bounds.mode;
  expandedSize = { width: bounds.expandedWidth, height: bounds.expandedHeight };
  const initial = clampBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
  const w = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: MINI_CAPSULE_SIZE,
    minHeight: MINI_CAPSULE_SIZE,
    ...(initial.x !== undefined && initial.y !== undefined ? { x: initial.x, y: initial.y } : {}),
    show: false,
    // 透明窗口：模态切换时原生窗口瞬间变大/变小，透明区域不可见；
    // 真正的形变动画由 renderer 的卡片 CSS 完成（不再逐帧 setBounds）。
    // 透明窗口不做可调整大小（Electron 在 Windows 上对此有限制）。
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    autoHideMenuBar: true,
    title: "Kiro Mini",
    frame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: bounds.alwaysOnTop,
    skipTaskbar: true,
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
    ensureWindowVisible(w);
    w.show();
    // 重开即推最新快照（relay 可能在 mini 关闭期间持续 publish，缓存保证不空白）
    if (latestSnapshot && !w.webContents.isDestroyed()) {
      w.webContents.send("mini:state", latestSnapshot);
    }
    syncMainThrottling();
  });
  // 常驻语义：点 × 只隐藏（任务栏无图标，主窗口/托盘按钮可随时召回），bounds 照常落盘
  w.on("close", (event) => {
    if (getMiniWindow() === w) {
      event.preventDefault();
      void saveBoundsNow();
      w.hide();
      syncMainThrottling();
    }
  });
  w.on("closed", () => {
    clearCapsuleSettleTimer();
    if (miniWindow === w) miniWindow = null;
    syncMainThrottling();
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

function focusMainWindow(deps: Pick<MiniChatMainDeps, "getMainWindow">): BrowserWindow | null {
  const main = deps.getMainWindow();
  if (!main || main.isDestroyed()) return null;
  if (main.isMinimized()) main.restore();
  if (!main.isVisible()) main.show();
  main.focus();
  return main;
}

function previewText(snapshot: MiniChatSnapshot): string {
  const last = [...snapshot.messages].reverse().find((m) => m.role === "assistant");
  return (last?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function syncMainThrottling(deps?: Pick<MiniChatMainDeps, "getMainWindow">): void {
  const main = deps?.getMainWindow() ?? getMainWindowRef?.() ?? null;
  if (!main || main.isDestroyed()) return;
  const busy = latestSnapshot?.busy === true;
  try {
    // Turn 进行中不节流：主窗口可能已最小化/隐藏，但流式完成与系统通知必须可靠。
    main.webContents.setBackgroundThrottling(!busy);
  } catch {}
}

function maybeNotifyCompletion(previous: MiniChatSnapshot | null, next: MiniChatSnapshot): void {
  if (!previous || previous.busy !== true || next.busy !== false) return;
  if (next.phase === "error") return;
  if (!Notification.isSupported()) return;
  const main = getMainWindowRef?.() ?? null;
  const w = getMiniWindow();
  if (main?.isFocused() && !main.isMinimized()) return;
  if (w?.isVisible() && w.isFocused()) return;
  const body = previewText(next);
  if (!body) return;
  const notification = new Notification({
    title: "Kiro 已回答",
    body,
    silent: false,
  });
  notification.on("click", () => {
    void showWindowRef?.();
  });
  notification.show();
}

/** register 时注入的窗口引用（避免把 deps 挂到模块作用域） */
let getMainWindowRef: (() => BrowserWindow | null) | null = null;
let showWindowRef: (() => Promise<void>) | null = null;

function ensureTray(deps: MiniChatMainDeps): void {
  if (tray) return;
  void (async () => {
    let image = nativeImage.createFromPath(
      app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "build", "icon.png")
    );
    if (image.isEmpty()) {
      try {
        image = await app.getFileIcon(process.execPath, { size: "small" });
      } catch {
        /* 无图标则不创建托盘，不影响 Mini */
      }
    }
    if (image.isEmpty() || tray) return;
    try {
      tray = new Tray(image);
      tray.setToolTip("ClassFlow · Kiro");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: "显示 Kiro Mini",
            click: () => {
              void showWindowRef?.();
            },
          },
          {
            label: "打开 ClassFlow",
            click: () => {
              focusMainWindow(deps);
            },
          },
          { type: "separator" },
          {
            label: "退出 ClassFlow",
            click: () => {
              app.quit();
            },
          },
        ])
      );
      tray.on("click", () => {
        void showWindowRef?.();
      });
      tray.on("double-click", () => {
        focusMainWindow(deps);
      });
    } catch {
      tray = null;
    }
  })();
}

function registerDisplayListeners(): void {
  if (displayListenersRegistered) return;
  displayListenersRegistered = true;
  const reclamp = () => {
    const w = getMiniWindow();
    if (!w || w.isDestroyed()) return;
    ensureWindowVisible(w);
  };
  screen.on("display-removed", reclamp);
  screen.on("display-metrics-changed", reclamp);
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

  getMainWindowRef = deps.getMainWindow;
  // 全局快捷键 + 托盘使用
  const showWindow = async () => {
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
      ensureWindowVisible(w);
      if (!w.isVisible()) w.show();
      w.focus();
      if (latestSnapshot && !w.webContents.isDestroyed()) {
        w.webContents.send("mini:state", latestSnapshot);
      }
      syncMainThrottling(deps);
    }
  };
  showWindowRef = showWindow;

  const hideWindow = async () => {
    await saveBoundsNow();
    getMiniWindow()?.hide();
    syncMainThrottling(deps);
  };
  const toggleWindow = async () => {
    const w = getMiniWindow();
    if (w && w.isVisible()) await hideWindow();
    else await showWindow();
  };

  ipcMain.on("mini:show", (event) => {
    if (!trusted(event)) return;
    void showWindow();
  });
  ipcMain.on("mini:hide", (event) => {
    if (!trusted(event)) return;
    void hideWindow();
  });
  ipcMain.on("mini:toggle", (event) => {
    if (!trusted(event)) return;
    void toggleWindow();
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
  ipcMain.on("mini:set-mode", (event, input: unknown) => {
    if (!trusted(event)) return;
    const mode = (input as { mode?: unknown })?.mode === "capsule" ? "capsule" : "expanded";
    const instant = (input as { instant?: unknown })?.instant === true;
    setMiniMode(mode, instant);
  });
  ipcMain.handle("mini:get-window-state", (event): MiniChatWindowState => {
    if (!trusted(event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    return {
      mode: currentMode,
      onTop: getMiniWindow()?.isAlwaysOnTop() ?? true,
    };
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
  ipcMain.on("mini:new-chat", (event) => {
    if (!trusted(event)) return;
    if (!isMiniWebContents(event.sender.id)) return;
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send("mini:remote-new-chat");
  });
  ipcMain.on("mini:switch-conversation", (event, input: unknown) => {
    if (!trusted(event)) return;
    if (!isMiniWebContents(event.sender.id)) return;
    const conversationId = (input as { conversationId?: unknown })?.conversationId;
    if (typeof conversationId !== "string" || !conversationId || conversationId.length > 160) return;
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("mini:remote-switch-conversation", { conversationId });
    }
  });
  ipcMain.on("mini:focus-main", (event, input: unknown) => {
    if (!trusted(event)) return;
    if (!isMiniWebContents(event.sender.id)) return;
    const main = focusMainWindow(deps);
    if (!main) return;
    const conversationId = (input as { conversationId?: unknown })?.conversationId;
    if (typeof conversationId === "string" && conversationId && conversationId.length <= 160) {
      main.webContents.send("mini:remote-focus-conversation", { conversationId });
    }
  });
  ipcMain.on("mini:approve", (event, input: unknown) => {
    if (!trusted(event)) return;
    if (!isMiniWebContents(event.sender.id)) return;
    const approvalId = (input as { approvalId?: unknown })?.approvalId;
    const decision = (input as { decision?: unknown })?.decision === "deny" ? "deny" : "allow-once";
    if (typeof approvalId !== "string" || !approvalId) return;
    const approval = latestSnapshot?.approval;
    if (!approval?.pending || approval.id !== approvalId) return;
    if (decision === "allow-once" && approval.canApproveInMini !== true) return;
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("mini:remote-approval", { approvalId, decision });
    }
  });

  // 主窗口 → Mini：快照发布（缓存最新；mini 不可见时仅缓存，重开即推）
  ipcMain.on("mini:publish-state", (event, snapshot: unknown) => {
    if (!trusted(event)) return;
    const main = deps.getMainWindow();
    if (main && event.sender.id !== main.webContents.id) return;
    const previous = latestSnapshot;
    latestSnapshot = snapshot as MiniChatSnapshot;
    syncMainThrottling(deps);
    maybeNotifyCompletion(previous, latestSnapshot);
    const w = getMiniWindow();
    if (w && w.isVisible() && !w.webContents.isDestroyed()) {
      w.webContents.send("mini:state", latestSnapshot);
    }
  });
  ipcMain.handle("mini:get-state", (event) => {
    if (!trusted(event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    return latestSnapshot;
  });

  registerDisplayListeners();
  ensureTray(deps);
  if (!shortcutRegistered) {
    shortcutRegistered = true;
    try {
      const ok = globalShortcut.register(MINI_SHORTCUT, () => {
        void toggleWindow();
      });
      if (!ok) {
        shortcutRegistered = false;
        console.warn(`[mini] global shortcut unavailable: ${MINI_SHORTCUT}`);
      }
    } catch {
      shortcutRegistered = false;
    }
  }
  app.on("will-quit", () => {
    if (shortcutRegistered) {
      globalShortcut.unregister(MINI_SHORTCUT);
      shortcutRegistered = false;
    }
  });
}

/** 主窗口关闭时调用：Mini 没有运行时，必须一起关闭，避免孤儿常驻窗。 */
export function closeMiniWindow(): void {
  clearCapsuleSettleTimer();
  for (const [requestId, pending] of pendingSends) {
    clearTimeout(pending.timer);
    pending.reject(new Error(JSON.stringify({ code: "MAIN_UNAVAILABLE", message: "主窗口已关闭。" })));
    pendingSends.delete(requestId);
  }
  const w = getMiniWindow();
  if (w) {
    try {
      w.destroy();
    } catch {}
  }
  miniWindow = null;
}

/** 应用退出清理（before-quit）；幂等。 */
export function disposeMiniChat(): void {
  closeMiniWindow();
  if (tray) {
    try {
      tray.destroy();
    } catch {}
    tray = null;
  }
  if (shortcutRegistered) {
    globalShortcut.unregister(MINI_SHORTCUT);
    shortcutRegistered = false;
  }
  latestSnapshot = null;
}
