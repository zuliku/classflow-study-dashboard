import { parseISO } from "date-fns";

/**
 * Assignment DDL 统一使用"本地时间"语义：
 * 新数据保存为无偏移的本地 ISO 格式，例如 "2026-08-10T23:59:00"（不追加 Z）。
 */

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** 将用户输入的日期 + 时间组合为本地 DDL 字符串（无 Z，无时区偏移） */
export function combineLocalDateTime(date: string, time: string): string {
  const t = (time || "").trim() || "23:59";
  const hasSeconds = t.split(":").length >= 3;
  return `${date}T${hasSeconds ? t : `${t}:00`}`;
}

/** 取 DDL 的本地日期部分 "YYYY-MM-DD"（旧 Z 数据按字符串墙钟时间读取，不偏移；无值返回 ""） */
export function getLocalDDLDate(ddl?: string | null): string {
  const m = WALL_CLOCK_RE.exec(ddl || "");
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return (ddl || "").split("T")[0];
}

/** 取 DDL 的本地时间部分 "HH:mm"（旧 Z 数据按字符串墙钟时间读取，不偏移；无值返回 ""） */
export function getLocalDDLTime(ddl?: string | null): string {
  const m = WALL_CLOCK_RE.exec(ddl || "");
  if (m) return `${m[4]}:${m[5]}`;
  return "";
}

/**
 * 将 DDL 解析为本地 Date：
 * - 新格式（无偏移）与带真实时区偏移的字符串：按标准 ISO 语义解析
 * - 旧格式（以 Z 结尾，本地时间曾被误标为 UTC）：按字符串中的墙钟时间
 *   重建本地 Date，避免中国等时区出现 +8 小时偏移，保证旧任务可正确读取
 * - 无值 / 非法：返回 null（V2 无 DDL 任务合法）
 */
export function parseLocalDDL(ddl?: string | null): Date | null {
  if (!ddl) return null;

  const trimmed = ddl.trim();
  const isLegacyUTC = /[zZ]$/.test(trimmed);

  if (isLegacyUTC) {
    const m = WALL_CLOCK_RE.exec(trimmed);
    if (!m) return null;
    const date = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
      0
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = parseISO(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
