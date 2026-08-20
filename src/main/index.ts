import { app, BrowserWindow, shell, protocol, net, ipcMain } from "electron";
import { join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { startApiServer, installPdfFontEnv, ApiServer } from "./httpServer";
import { registerDesktopBridgeIpc } from "./desktopBridge";
import { buildClassFlowWebPreferences } from "@/lib/security/electronConfig";
import { decideNavigation } from "@/lib/security/navigation";
import { getCspHeader } from "@/lib/security/csp";
import { validateIpcSender } from "@/lib/security/ipcSender";
import { registerSecretIpc } from "./secrets/secretIpc";
import { registerSkillIpc } from "./skills/skillIpc";
import { registerMcpIpc } from "./mcp/ipc";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// 自定义 app:// 协议：让渲染进程的绝对路径资源（/logo.png、/kiro/*、/ai-providers/* 等）
// 在打包后正确解析到 out/renderer 目录（file:// 下 /xxx 会错误解析到磁盘根目录）
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const RENDERER_DIR = join(__dirname, "../renderer");

let apiServer: ApiServer | null = null;
let mainWindow: BrowserWindow | null = null;

function getAllowedOrigins(apiBase: string): { allowedApiOrigin: string; allowedDevOrigin: string | undefined } {
  const allowedApiOrigin = apiBase;
  const allowedDevOrigin = process.env.ELECTRON_RENDERER_URL;
  return { allowedApiOrigin, allowedDevOrigin };
}

function createWindow(apiBase: string, apiCapability: string): void {
  const { allowedApiOrigin, allowedDevOrigin } = getAllowedOrigins(apiBase);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#F7F5F5",
    autoHideMenuBar: true,
    title: "ClassFlow",
    // 自绘顶部状态栏：去掉原生窗口边框，由渲染进程 TitleBar 提供拖动/最小化/最大化/关闭
    frame: false,
    webPreferences: buildClassFlowWebPreferences({
      preloadPath: join(__dirname, "../preload/index.mjs"),
      apiBase,
      apiCapability,
    }),
  });

  // CSP：根据环境选择 production / development 策略，通过 response header 真正下发
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const cspHeader = getCspHeader(isDev);
  const ses = mainWindow.webContents.session;
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {};
    headers["Content-Security-Policy"] = [cspHeader];
    headers["content-security-policy"] = [cspHeader];
    callback({ responseHeaders: headers });
  });

  // 最大化状态同步给渲染进程（TitleBar 切换 最大化/还原 图标）
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized-changed", false));

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) =>
    console.error(`[classflow] did-fail-load code=${code} desc=${desc} url=${url}`)
  );
  mainWindow.webContents.on("render-process-gone", (_e, details) =>
    console.error(`[classflow] render-process-gone:`, details)
  );
  mainWindow.webContents.on("console-message", (_e, level, message) => {
    if (level >= 1) console.log(`[classflow:renderer] ${message}`);
  });

  // 外部链接硬化：使用 decideNavigation 统一判定
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const verdict = decideNavigation({ url, allowedApiOrigin, allowedDevOrigin });
    if (verdict.kind === "allow-external") {
      void shell.openExternal(url);
    } else if (verdict.kind === "deny") {
      console.warn(`[classflow] blocked window.open: ${url} reason=${verdict.reason}`);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const verdict = decideNavigation({ url, allowedApiOrigin, allowedDevOrigin });
    if (verdict.kind === "allow-internal") return;
    event.preventDefault();
    if (verdict.kind === "allow-external") {
      void shell.openExternal(url);
    } else {
      console.warn(`[classflow] blocked will-navigate: ${url} reason=${verdict.reason}`);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadURL("app://bundle/index.html");
  }
}

function isTrustedSender(sender: Electron.WebContents): boolean {
  if (!mainWindow) return false;
  if (sender.isDestroyed()) return false;
  return sender.id === mainWindow.webContents.id;
}

function validateWindowSender(channel: string, sender: Electron.WebContents, apiBase: string): boolean {
  const { allowedApiOrigin, allowedDevOrigin } = getAllowedOrigins(apiBase);
  const ctx = {
    destroyed: sender.isDestroyed(),
    isTrustedWindow: isTrustedSender(sender),
    url: (() => {
      try {
        return sender.getURL();
      } catch {
        return "";
      }
    })(),
  };
  const result = validateIpcSender(channel, ctx, { allowedApiOrigin, allowedDevOrigin });
  if (!result.ok) {
    console.warn(`[classflow] IPC denied ${channel}: ${result.reason}`);
  }
  return result.ok;
}

app.whenReady().then(async () => {
  const apiCapability = randomUUID();
  installPdfFontEnv();
  try {
    apiServer = await startApiServer({ capability: apiCapability });
  } catch (err) {
    console.error("[classflow] 本地 API server 启动失败:", err);
    app.quit();
    return;
  }
  const apiBase = `http://127.0.0.1:${apiServer.port}`;

  // 窗口控制 IPC（自绘标题栏）— 受 sender validation 保护
  ipcMain.on("window:minimize", (event) => {
    if (!validateWindowSender("window:minimize", event.sender, apiBase)) return;
    mainWindow?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    if (!validateWindowSender("window:maximize", event.sender, apiBase)) return;
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", (event) => {
    if (!validateWindowSender("window:close", event.sender, apiBase)) return;
    mainWindow?.close();
  });
  ipcMain.handle("window:isMaximized", (event) => {
    if (!validateWindowSender("window:isMaximized", event.sender, apiBase)) {
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    }
    return mainWindow?.isMaximized() ?? false;
  });

  // Desktop Bridge V1（Filesystem + Terminal）：通过 validateSender 统一校验
  registerDesktopBridgeIpc({
    getAllowedOrigins: () => getAllowedOrigins(apiBase),
    isTrustedSender,
  });

  // SecretVault — 仅暴露 create/replace/delete/list，且受 sender validation 保护
  registerSecretIpc({
    validateSender: (channel, event) => validateWindowSender(channel, event.sender, apiBase),
  });

  // Skills — 仅 Main 管理文件，Renderer 通过 IPC 操作，同样受 sender validation
  registerSkillIpc({
    validateSender: (channel, event) => validateWindowSender(channel, event.sender, apiBase),
  });

  // MCP — Remote Streamable HTTP, 仅 Main 建立网络连接
  registerMcpIpc({
    validateSender: (channel, event) => validateWindowSender(channel, event.sender, apiBase),
  });

  // app:// → out/renderer 静态资源（路径穿越防护：仅允许 renderer 目录内文件）
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const decoded = decodeURIComponent(pathname);
    const target = normalize(join(RENDERER_DIR, decoded === "/" ? "/index.html" : decoded));
    if (target !== RENDERER_DIR && !target.startsWith(RENDERER_DIR + sep)) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });

  createWindow(apiBase, apiCapability);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiBase, apiCapability);
  });
});

app.on("window-all-closed", () => {
  console.info("[classflow] window-all-closed");
  if (process.platform !== "darwin") app.quit();
});

let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  console.info("[classflow] before-quit cleanup");
  try {
    const { cancelAllTerminalExecutions } = await import("./desktopBridge");
    await cancelAllTerminalExecutions();
  } catch {}
  try {
    const { closeAllPtySessions } = await import("./terminalSessionRuntime");
    closeAllPtySessions();
  } catch {}
  if (apiServer) {
    try {
      await apiServer.close();
    } catch {}
    apiServer = null;
  }
  app.exit(0);
});
