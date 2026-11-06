/**
 * Phase 0：本地墙钟字符串校验（纯函数，无时区转换）。
 *
 * - 日期：`YYYY-MM-DD`，要求真实日历日期（拒绝 2026-02-30）
 * - 时间戳：`YYYY-MM-DDTHH:mm[:ss]`，不接受 Z / 时区偏移
 * - 非法值统一返回 undefined（Unknown ≠ Zero，不伪造时间）
 */

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** 合法本地日期 "YYYY-MM-DD" */
export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** 合法本地墙钟时间戳 "YYYY-MM-DDTHH:mm[:ss]"（无 Z / 无偏移） */
export function isValidLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATETIME_RE.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi, s] = match;
  if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return false;
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

export function normalizeLocalDate(value: unknown): string | undefined {
  return isValidLocalDate(value) ? value : undefined;
}

export function normalizeLocalDateTime(value: unknown): string | undefined {
  return isValidLocalDateTime(value) ? value : undefined;
}
