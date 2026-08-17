import { app, BrowserWindow, shell, protocol, net, ipcMain } from "electron";
import { join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startApiServer, installPdfFontEnv, ApiServer } from "./httpServer";
import { registerDesktopBridgeIpc } from "./desktopBridge";

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

function createWindow(apiBase: string): void {
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
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--classflow-api-base=${apiBase}`],
    },
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

  // 外部链接一律用系统浏览器打开（不劫持应用内导航）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith("app://") || url.startsWith("http://127.0.0.1")) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadURL("app://bundle/index.html");
  }
}

app.whenReady().then(async () => {
  // 窗口控制 IPC（自绘标题栏）
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  // Desktop Bridge V1（Filesystem + Terminal）：grant opaque / relative-path-only / canonical sandbox
  registerDesktopBridgeIpc();

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

  installPdfFontEnv();
  try {
    apiServer = await startApiServer();
  } catch (err) {
    console.error("[classflow] 本地 API server 启动失败:", err);
    app.quit();
    return;
  }
  createWindow(`http://127.0.0.1:${apiServer.port}`);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(`http://127.0.0.1:${apiServer?.port}`);
  });
});

app.on("window-all-closed", () => {
  console.info("[classflow] window-all-closed");
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  console.info("[classflow] will-quit");
  if (apiServer) {
    void apiServer.close();
    apiServer = null;
  }
});
