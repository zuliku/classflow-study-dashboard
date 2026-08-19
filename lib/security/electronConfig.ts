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

/**
 * 唯一 Source of Truth：所有 BrowserWindow 必须通过此 builder 产生 webPreferences。
 * 测试直接校验此 builder 输出的 sandbox/contextIsolation/nodeIntegration，而非未使用的常量。
 */
export function buildClassFlowWebPreferences(opts: {
  preloadPath: string;
  apiBase: string;
}): {
  preload: string;
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  allowRunningInsecureContent: false;
  enableWebSQL: false;
  additionalArguments: string[];
} {
  return {
    preload: opts.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    enableWebSQL: false,
    additionalArguments: [`--classflow-api-base=${opts.apiBase}`],
  };
}

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
