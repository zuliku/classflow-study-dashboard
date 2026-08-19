/**
 * Electron BrowserWindow 安全基线 — Task 01/02
 * 权威配置：contextIsolation=true, nodeIntegration=false, sandbox=true
 * 仅保留 contextBridge + ipcRenderer。
 */

export const SECURE_WINDOW_OPTIONS = {
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    enableWebSQL: false,
  },
} as const;

export function assertSecureWindowOptions(opts: {
  contextIsolation?: boolean;
  nodeIntegration?: boolean;
  sandbox?: boolean;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (opts.contextIsolation !== true) errors.push("contextIsolation must be true");
  if (opts.nodeIntegration !== false) errors.push("nodeIntegration must be false");
  if (opts.sandbox !== true) errors.push("sandbox must be true");
  return { ok: errors.length === 0, errors };
}

/** Preload 允许的 API 面（最小） */
export const ALLOWED_PRELOAD_APIS: ReadonlySet<string> = new Set(["contextBridge", "ipcRenderer"]);

/** Renderer 禁止暴露的 API */
export const FORBIDDEN_RENDERER_APIS: ReadonlySet<string> = new Set([
  "fs",
  "path",
  "child_process",
  "process",
  "require",
  "electron",
]);
