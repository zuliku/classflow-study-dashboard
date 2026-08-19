/**
 * Electron 基线声明 — Task 01
 * 当前受支持的稳定版本（截至 2026-08-19）
 * - Electron 32.x 为当前 LTS / Stable（支持到 2026 年底；32.3.x 最新稳定）
 * - 不使用 beta/alpha/nightly/prerelease
 * - electron-vite / electron-builder 仅在兼容需要时同步升级
 *
 * 本文件作为 Web 侧的基线声明；实际 Electron 依赖由桌面壳（classflow-desktop）管理。
 * Web 侧通过此模块暴露版本常量供测试与文档使用。
 */

export const ELECTRON_BASELINE = {
  // 2026-08-19 仍受支持的稳定版本（官方支持周期：每版 8 周，32.x 为 LTS）
  electron: "32.3.3",
  electronVite: "2.3.0",
  electronBuilder: "24.13.3",
  nodeTypes: "20.14.12",
  channel: "stable" as const,
  prerelease: false,
  // 兼容性备注
  notes: [
    "Electron 32 基于 Chromium 128 / Node 20，支持 sandbox:true + contextIsolation:true",
    "preload ESM 需 electron-vite 2.3+",
    "app:// protocol 在 sandbox 下仍可通过 protocol.handle 正常加载 bundle",
    "safeStorage 在 Windows 上可用；不可用时 SecretVault fail closed",
    "BrowserWindow 安全基线：sandbox:true 已在 lib/security/electronConfig.ts 固化",
  ],
} as const;

export function isStableElectronVersion(version: string): boolean {
  // 简单校验：不含 -beta / -alpha / -nightly / prerelease 标识
  return !/(?:-beta|-alpha|-nightly|\+|prerelease)/i.test(version);
}
