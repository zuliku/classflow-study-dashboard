/**
 * Task Execution Loop V1：Focus UI 共享层（纯格式化/常量，不触碰 Domain / Store）。
 * - FOCUS_PRESETS / FOCUS_ERROR_MESSAGES：Overview FocusControl 与 Task Detail Focus 入口共用，
 *   保证 presets 与错误文案单源（不允许两套）
 * - formatFocusClock：倒计时/计时 mm:ss / h:mm:ss（与 Overview 完全一致）
 * - formatAccumulatedMs：已完成专注真实毫秒 → 「X 小时 Y 分」汇总文案
 */

/** Overview FocusControl 与 Task Detail 入口共用的时长预设（分钟） */
export const FOCUS_PRESETS = [15, 25, 30, 45, 60];

/** 共享错误文案（FocusErrorCode → 中文） */
export const FOCUS_ERROR_MESSAGES: Record<string, string> = {
  FOCUS_SESSION_ALREADY_ACTIVE: "已有进行中的专注会话",
  NO_ACTIVE_FOCUS_SESSION: "当前没有进行中的专注",
  FOCUS_ALREADY_PAUSED: "专注已处于暂停状态",
  FOCUS_NOT_PAUSED: "专注未处于暂停状态",
  INVALID_FOCUS_DURATION: "专注时长需为 1–240 的整数",
  FOCUS_TARGET_NOT_FOUND: "关联的课程或任务不存在",
  FOCUS_TARGET_MISMATCH: "任务与课程不匹配",
};

/**
 * 计时钟显示格式（与 Overview FocusControl 的 formatClock 完全一致）：
 * <1h → mm:ss；≥1h → h:mm:ss（毫秒精度，ceil 语义与时长展示一致）
 */
export function formatFocusClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (h >= 1) return `${h}:${p(m)}:${p(s)}`;
  return `${p(m)}:${p(s)}`;
}

/**
 * 已完成专注的真实 active 毫秒 → 汇总文案：
 * <60min → 「N 分钟」；整小时 → 「N 小时」；否则 「N 小时 M 分」。0/负值 → null。
 */
export function formatAccumulatedMs(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
