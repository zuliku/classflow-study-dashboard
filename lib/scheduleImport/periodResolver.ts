/**
 * 节次时间解析（Bell Schedule）：
 * 课表截图通常只有"第1-2节"，Vision 绝不猜测时间；
 * 只有用户配置的 Bell Schedule 能把节次转换为 "HH:mm"。
 */
import { BellScheduleTemplate } from "@/lib/scheduleImport/types";

export const BELL_SCHEDULE_DEFAULT_ID = "bell_default";

/** 创建默认空模板（用户配置前无任何节次） */
export function createEmptyBellSchedule(name = "我的作息"): BellScheduleTemplate {
  return { id: BELL_SCHEDULE_DEFAULT_ID, name, periods: [] };
}

/**
 * 节次区间 → 具体时间。
 * 第 1-2 节 = period 1 的 startTime ~ period 2 的 endTime。
 * 返回 null：模板缺失 / 节次号不存在。
 */
export function resolvePeriodTime(
  template: BellScheduleTemplate | null | undefined,
  periodStart: number,
  periodEnd?: number
): { startTime: string; endTime: string } | null {
  if (!template || !Array.isArray(template.periods) || template.periods.length === 0) return null;
  const start = template.periods.find((p) => p.period === periodStart);
  if (!start) return null;
  const endPeriod = periodEnd ?? periodStart;
  const end = template.periods.find((p) => p.period === endPeriod);
  if (!end) return null;
  return { startTime: start.startTime, endTime: end.endTime };
}

/** 模板是否缺少指定节次（用于 issue 描述） */
export function templateMissingPeriod(
  template: BellScheduleTemplate | null | undefined,
  period: number
): boolean {
  if (!template) return true;
  return !template.periods.some((p) => p.period === period);
}
