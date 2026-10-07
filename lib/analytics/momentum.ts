/**
 * 学习动量（GitHub contributions / Duolingo streak 对标）：
 * 12 周日历热力 + 连续学习天数。纯函数，只消费已查到的事件。
 *
 * - 活跃日 = 专注分钟 > 0 或有完成任务（ MEMORY：完成本身就是投入）
 * - 未知日（早于 historyStartedAt，即记录起点之前）= 灰色且打断连续（Unknown ≠ Zero，V3 真值观）
 * - 未来日不参与（调用方只传到今天为止的日期）
 */

export const MOMENTUM_WEEKS = 12;
export const MOMENTUM_DAYS = MOMENTUM_WEEKS * 7;

export type MomentumLevel = 0 | 1 | 2 | 3 | 4;

export interface MomentumDay {
  /** 本地日期 "YYYY-MM-DD" */
  date: string;
  /** 当日专注分钟（未知日归 0） */
  minutes: number;
  completed: number;
  active: boolean;
  /** 记录起点之前：灰色展示，打断连续 */
  unknown: boolean;
  level: MomentumLevel;
}

export interface StudyMomentum {
  days: MomentumDay[];
  /** 连续活跃天数（今天没动但昨天动了也算保持；昨天也没动 = 0） */
  streakDays: number;
  activeToday: boolean;
  totalMinutes: number;
}

export interface MomentumEventLike {
  type: string;
  localDate: string;
  data?: unknown;
}

/** 分钟 → 热力等级（阈值对标专注时长体感：半小时/1小时/2小时） */
export function momentumLevel(minutes: number): MomentumLevel {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地 "YYYY-MM-DD" */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** todayStr 当天 00:00 起往前数共 days 天（升序返回） */
export function momentumDateRange(todayStr: string, days: number = MOMENTUM_DAYS): string[] {
  const [y, m, d] = todayStr.split("-").map(Number);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const t = new Date(y, (m ?? 1) - 1, d ?? 1);
    t.setDate(t.getDate() - i);
    out.push(toLocalDateStr(t));
  }
  return out;
}

export function buildStudyMomentum(input: {
  events: MomentumEventLike[];
  todayStr: string;
  /** 记录起点 epoch ms；null = 起点未知（全部按已知处理） */
  historyStartedAt: number | null;
  weeks?: number;
}): StudyMomentum {
  const { events, todayStr, historyStartedAt } = input;
  const weeks = input.weeks ?? MOMENTUM_WEEKS;
  const dates = momentumDateRange(todayStr, weeks * 7);
  const startedDateStr =
    historyStartedAt === null || Number.isNaN(historyStartedAt)
      ? null
      : toLocalDateStr(new Date(historyStartedAt));

  const minutesByDate = new Map<string, number>();
  const completedByDate = new Map<string, number>();
  for (const e of events) {
    if (e.type === "focus.completed") {
      const raw = typeof e.data === "object" && e.data !== null ? (e.data as { actualActiveMs?: unknown }) : null;
      const ms = raw?.actualActiveMs;
      const minutes = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms / 60000 : 0;
      if (minutes > 0) minutesByDate.set(e.localDate, (minutesByDate.get(e.localDate) ?? 0) + minutes);
    } else if (e.type === "assignment.completed") {
      completedByDate.set(e.localDate, (completedByDate.get(e.localDate) ?? 0) + 1);
    }
  }

  const days: MomentumDay[] = dates.map((date) => {
    const unknown = startedDateStr !== null && date < startedDateStr;
    const minutes = unknown ? 0 : Math.round((minutesByDate.get(date) ?? 0) * 10) / 10;
    const completed = unknown ? 0 : (completedByDate.get(date) ?? 0);
    const active = !unknown && (minutes > 0 || completed > 0);
    // 有投入即点亮（完成事项无分钟也至少 1 档；与 streak 口径一致）
    const level = (!active ? 0 : Math.max(1, momentumLevel(minutes))) as MomentumLevel;
    return { date, minutes, completed, active, unknown, level };
  });

  // 连续：从今天往回数；今天没动则从昨天起算（保持中），昨天也没动则 0；未知日打断
  const byDate = new Map(days.map((d) => [d.date, d]));
  let streakDays = 0;
  const today = byDate.get(todayStr);
  const activeToday = today?.active === true;
  let cursor = activeToday ? todayStr : shiftDateStr(todayStr, -1);
  for (;;) {
    const day = byDate.get(cursor);
    if (!day || !day.active) break;
    streakDays += 1;
    cursor = shiftDateStr(cursor, -1);
  }

  return {
    days,
    streakDays,
    activeToday,
    totalMinutes: Math.round(days.reduce((sum, d) => sum + d.minutes, 0) * 10) / 10,
  };
}

function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(y, (m ?? 1) - 1, d ?? 1);
  t.setDate(t.getDate() + deltaDays);
  return toLocalDateStr(t);
}
