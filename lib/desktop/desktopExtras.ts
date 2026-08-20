/**
 * 桌面版扩展桥接类型与访问器：在网页版冻结的 ClassFlowDesktopBridgeV1
 * （lib/desktop/types.ts）之上叠加桌面运行时的窗口控制与 apiBase。
 * 全局 window.classflowDesktop 的类型由 lib/desktop/types.ts 声明（合同冻结）。
 */
import type { ClassFlowDesktopBridgeV1 } from "@/lib/desktop/types";

export interface ClassFlowDesktopWindowBridge {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

/** 桌面运行时实际注入的完整 Bridge（= Web 合同 + 桌面扩展） */
export type ClassFlowDesktopBridge = ClassFlowDesktopBridgeV1 & {
  apiBase: string;
  window: ClassFlowDesktopWindowBridge;
};

/** 获取桌面扩展部分（窗口控制 / apiBase）；Web 合同部分请直接用 window.classflowDesktop */
export function getClassFlowDesktopExtras(): ClassFlowDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.classflowDesktop as ClassFlowDesktopBridge | undefined;
  return bridge && typeof bridge === "object" && bridge.apiBase && bridge.window ? bridge : null;
}

/**
 * 仅窗口控制 Bridge（不依赖 apiBase / filesystem / terminal 等 capability）。
 * 校验：window.classflowDesktop.version === 1 且 window 表面完整。
 */
export function getClassFlowDesktopWindowBridge(): ClassFlowDesktopWindowBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.classflowDesktop as unknown as { version?: unknown; window?: unknown } | undefined;
  if (!bridge || typeof bridge !== "object") return null;
  if ((bridge as { version?: unknown }).version !== 1) return null;
  const win = (bridge as { window?: unknown }).window as Partial<ClassFlowDesktopWindowBridge> | undefined;
  if (!win || typeof win !== "object") return null;
  if (
    typeof win.minimize !== "function" ||
    typeof win.toggleMaximize !== "function" ||
    typeof win.close !== "function" ||
    typeof win.isMaximized !== "function" ||
    typeof win.onMaximizedChange !== "function"
  ) {
    return null;
  }
  return win as ClassFlowDesktopWindowBridge;
}
