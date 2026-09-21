/**
 * Computer Use V2.5 — 剪贴板访问（Main 侧唯一入口，默认关闭）。
 *
 * 安全契约：
 * - 只有用户显式开启（snapshot.desktopClipboardEnabled）+ allow-once 审批后才会到达这里
 * - 读取结果有界（≤4096 字符）、清洗控制字符；绝不写入 audit / 日志
 * - 写入文本不落日志；覆盖前必须经过审批（renderer 侧描述已提示「会覆盖剪贴板」）
 * - 本模块只使用 Electron clipboard（与 screenshot.ts 相同：静态 import + 仅在 Main 动态加载）
 */
import { clipboard } from "electron";

export const CLIPBOARD_TEXT_MAX_LENGTH = 4096;

function sanitizeClipboardText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, CLIPBOARD_TEXT_MAX_LENGTH);
}

/** 读取剪贴板文本（失败 → 空字符串；绝不抛出 raw OS 错误） */
export function readClipboardText(): string {
  try {
    return sanitizeClipboardText(clipboard.readText());
  } catch {
    return "";
  }
}

/** 写入剪贴板文本（失败 → false；调用方转 ACTION_FAILED） */
export function writeClipboardText(text: string): boolean {
  try {
    clipboard.writeText(sanitizeClipboardText(text));
    return true;
  } catch {
    return false;
  }
}
