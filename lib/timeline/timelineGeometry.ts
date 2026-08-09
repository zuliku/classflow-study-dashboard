/**
 * Timeline Geometry（Task：ClassFlow Timeline V1）。
 * Key Timeline 使用 00:00–24:00 全天比例；Course Grid 保持 08:00–21:00（见 timetableInteraction）。
 * 所有水平位置必须来自时间比例，禁止 magic 偏移。
 */

/** "HH:mm" / "HH:mm:ss" → 当天分钟数（0-1439）；非法返回 null */
export function timeToMinutes(time?: string): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 任意时间 → 当天 0–24h 的相对位置（0 = 00:00，0.5 = 12:00，0.75 = 18:00） */
export function timeToDayRatio(time?: string): number {
  const minutes = timeToMinutes(time);
  if (minutes === null) return 0;
  return minutes / 1440;
}

export interface DayIntervalGeometry {
  leftRatio: number;
  widthRatio: number;
}

/** 固定时段 → 当天 Lane 内的几何（left / width 均为 0-1 比例） */
export function intervalToDayGeometry(start?: string, end?: string): DayIntervalGeometry {
  const s = timeToMinutes(start) ?? 0;
  const e = timeToMinutes(end);
  if (e === null || e <= s) {
    // 非法/缺结束时间：退化为 30 分钟点状区块（不伪造长时段）
    return { leftRatio: s / 1440, widthRatio: 30 / 1440 };
  }
  return { leftRatio: s / 1440, widthRatio: (e - s) / 1440 };
}

/** 时间可读性：分钟 → "HH:mm" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
