/**
 * Electron 基线声明 — Task 05
 * 当前受支持的稳定版本（截至 2026-08-19）
 * - Electron 43.3.x stable（Chromium 141 / Node 22）
 * - 不使用 beta/alpha/nightly/prerelease（禁止 44 alpha）
 * - electron-vite / electron-builder 仅在兼容需要时同步升级
 */

export const ELECTRON_BASELINE = {
  // 2026-08-19 仍受支持的稳定版本（43.3.x）
  electron: "43.3.0",
  electronVite: "2.3.0",
  electronBuilder: "24.13.3",
  nodeTypes: "22.14.0",
  channel: "stable" as const,
  prerelease: false,
  notes: [
    "Electron 43 基于 Chromium 141 / Node 22，支持 sandbox:true + contextIsolation:true",
    "preload ESM 需 electron-vite 2.3+",
    "app:// protocol 在 sandbox 下仍可通过 protocol.handle 正常加载 bundle",
    "safeStorage 在 Windows 上可用；不可用时 SecretVault fail closed",
    "BrowserWindow 安全基线：sandbox:true 已在 lib/security/electronConfig.ts 固化 via buildClassFlowWebPreferences",
  ],
} as const;

export function isStableElectronVersion(version: string): boolean {
  // 简单校验：不含 -beta / -alpha / -nightly / prerelease 标识
  return !/(?:-beta|-alpha|-nightly|\+|prerelease)/i.test(version);
}
