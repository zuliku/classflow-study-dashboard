/**
 * Computer 逻辑资源路径安全边界（Part 1）：
 * normalizeRelativeComputerPath 是唯一入口——model-provided path 必须是相对 authorized root 的
 * 规范化相对路径。权限审批永远不能覆盖 PATH_OUTSIDE_SANDBOX。
 */
import { ComputerError } from "@/lib/ai/computer/errors";

/** Windows 保留设备名（大小写不敏感，含扩展名后缀也拒绝）：CON PRN AUX NUL COM1..9 LPT1..9 */
const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** 禁止的 control / 特殊字符（NUL、C0 control、部分 C1） */
const INVALID_CHARS = /[\u0000-\u001f\u007f\u0080-\u009f]/;

export interface NormalizedComputerPath {
  /** 规范化后的相对路径（/ 分隔、无 . / .. 段、非空） */
  path: string;
  /** 段列表 */
  segments: string[];
}

/**
 * 规范化模型提供的相对路径。
 *
 * 处理：
 * - `/` 与 `\` 统一；
 * - 拒绝 absolute（leading / 或 Windows 盘符）、UNC（\\ 开头）、drive-relative；
 * - 拒绝 control chars / NUL；
 * - 拒绝 Windows reserved device names（CON.txt 等，大小写不敏感）；
 * - 拒绝 `..` 逃逸出 root（`../secret`）；路径内部合法的 `a/../b` 归一到 `b`；
 * - 空路径 / `.` 拒绝。
 *
 * 抛 ComputerError(PATH_OUTSIDE_SANDBOX)，绝不返回可逃逸路径。
 */
export function normalizeRelativeComputerPath(input: string): NormalizedComputerPath {
  if (typeof input !== "string" || input.length === 0) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径为空");
  }

  const raw = input.trim();
  if (raw.length === 0) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径为空");
  }
  if (INVALID_CHARS.test(raw)) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径包含非法控制字符");
  }

  // 统一分隔符
  const normalized = raw.replace(/\\/g, "/");

  // absolute / drive / UNC 拒绝
  if (normalized.startsWith("/")) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径不能是绝对路径");
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径不能包含盘符");
  }
  if (normalized.startsWith("//")) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径不能是 UNC 路径");
  }

  // 分段归一：拒绝 escape 的 ..；内部 . / a/../b 正常折叠
  const segments: string[] = [];
  for (const rawSegment of normalized.split("/")) {
    if (rawSegment === "" || rawSegment === ".") continue;
    if (rawSegment === "..") {
      if (segments.length === 0) {
        throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径越出工作区边界");
      }
      segments.pop();
      continue;
    }
    // reserved device name 校验（含扩展名）
    if (WINDOWS_RESERVED_BASENAME.test(rawSegment)) {
      throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径包含系统保留名称");
    }
    segments.push(rawSegment);
  }

  if (segments.length === 0) {
    throw new ComputerError("PATH_OUTSIDE_SANDBOX", "路径无效");
  }

  return { path: segments.join("/"), segments };
}
