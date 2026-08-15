/**
 * P1：Automatic Deadline Reminder Domain Policy（纯函数层，不读 Zustand / localStorage / Notification）。
 *
 * 目标：为 P2 提供「Assignment / 独立 DDL CalendarMark → 应有的 auto Reminder」的纯决策能力。
 * - 自动提醒不是虚拟展示数据，而是真实可持久化、能被现有 Reminder Runtime 消费的 Reminder
 *   （source="auto"，timingMode="relative"，offsetMinutes 为负提前量，due-time = 0）
 * - 提前时间固定档位 7天/3天/1天/1小时/到期时（0 只作 Domain fallback，不属于 Settings 档位）
 * - 降级只允许向更接近 DDL 的方向；选择第一个 triggerAt 仍严格晚于 now 的档位
 * - 全部本地墙钟语义（禁 toISOString / UTC 转换）
 */

import {
  AssignmentStatus,
  CalendarMark,
  Reminder,
  ReminderTargetType,
} from "@/types";
import { combineLocalDateTime, parseLocalDDL } from "@/lib/ddl";
import { formatLocalDateTime, resolveReminderTriggerAt } from "@/lib/reminders/reminderDomain";

/** 自动提醒提前分钟数固定档位（Settings 可选：7天 / 3天 / 1天 / 1小时） */
export type AutoDeadlineLeadMinutes = 60 | 1440 | 4320 | 10080;

export const AUTO_DEADLINE_LEAD_OPTIONS: readonly AutoDeadlineLeadMinutes[] = [
  10080,
  4320,
  1440,
  60,
];
export const DEFAULT_AUTO_DEADLINE_LEAD_MINUTES: AutoDeadlineLeadMinutes = 1440;
/** 到期时（0）：只作为 Domain fallback，不属于 Settings 可选档位 */
export const DUE_TIME_LEAD_MINUTES = 0;

/** 降级阶梯（从 requestedLead 开始只向更接近 DDL 的方向走） */
const LEAD_LADDER: readonly number[] = [10080, 4320, 1440, 60, 0];

/** 归一 lead：合法档位 → 原值；非法 / 缺失 → 1440（与 preference sanitize 同语义） */
export function normalizeAutoDeadlineLead(value: unknown): AutoDeadlineLeadMinutes {
  return (AUTO_DEADLINE_LEAD_OPTIONS as readonly unknown[]).includes(value)
    ? (value as AutoDeadlineLeadMinutes)
    : DEFAULT_AUTO_DEADLINE_LEAD_MINUTES;
}

/**
 * 提前时间降级（§4）：
 * 从 requestedLead 开始，只允许向更接近 DDL 的方向降级（7d→3d→1d→1h→due），
 * 选择第一个「triggerAt 仍严格晚于 now」的档位。
 * - DDL 本身 <= now（或无合法 DDL / now）→ null（不产生新的 scheduled auto Reminder）
 * - 返回正数提前分钟数（0 = due-time）；调用方写 Reminder 时转负数 offsetMinutes
 */
export function resolveAutoDeadlineLead(input: {
  requestedLead: AutoDeadlineLeadMinutes;
  ddl: string;
  now: string;
}): number | null {
  const { requestedLead, ddl, now } = input;
  const ddlDate = parseLocalDDL(ddl);
  const nowDate = parseLocalDDL(now);
  if (!ddlDate || !nowDate) return null;
  if (ddlDate.getTime() <= nowDate.getTime()) return null;
  const startIdx = LEAD_LADDER.indexOf(normalizeAutoDeadlineLead(requestedLead));
  for (let i = startIdx; i < LEAD_LADDER.length; i++) {
    const lead = LEAD_LADDER[i];
    if (ddlDate.getTime() - lead * 60_000 > nowDate.getTime()) return lead;
  }
  // 不可达：lead=0 时 trigger = ddl > now 已由上面保证
  return DUE_TIME_LEAD_MINUTES;
}

/**
 * Assignment 自动提醒资格（§5，静态判断，不含 now）：
 * 合法 DDL + status todo/doing + 未 opt-out。DDL > now 由 resolveAutoDeadlineLead 判定。
 */
export function isAssignmentAutoReminderEligible(a: {
  ddl?: string;
  status?: AssignmentStatus;
  autoReminderDisabled?: boolean;
}): boolean {
  if (a.autoReminderDisabled === true) return false;
  if (a.status !== "todo" && a.status !== "doing") return false;
  return parseLocalDDL(a.ddl) !== null;
}

/**
 * 独立 DDL CalendarMark 判定（§6）：
 * - 必须 type === "ddl"
 * - 未 opt-out（autoReminderDisabled !== true）
 * - 排除 Assignment linked mark：sourceId 精确匹配任一 assignment.id（唯一可靠 relation；
 *   禁止 title / date / 模糊匹配）。无 sourceId 的 mark 视为独立（不猜）。
 */
export function isIndependentDDLCalendarMark(
  mark: CalendarMark,
  assignmentIds: ReadonlySet<string>
): boolean {
  if (mark.type !== "ddl") return false;
  if (mark.autoReminderDisabled === true) return false;
  if (mark.sourceId && assignmentIds.has(mark.sourceId)) return false;
  return true;
}

/**
 * 独立 DDL CalendarMark 的提醒 anchor（§7）：
 * - 有合法 startTime → date + startTime
 * - 无 startTime → date + defaultDDLTime（AppPreferences.defaultDDLTime）
 * 只用于计算 Reminder；绝不修改 CalendarMark.startTime（all-day mark 保持原数据形态）。
 */
export function resolveDDLCalendarMarkAnchor(
  mark: CalendarMark,
  defaultDDLTime: string
): string | null {
  if (mark.type !== "ddl") return null;
  const time = mark.startTime && /^\d{2}:\d{2}$/.test(mark.startTime) ? mark.startTime : defaultDDLTime;
  const anchor = combineLocalDateTime(mark.date, time);
  return parseLocalDDL(anchor) ? anchor : null;
}

/** 自动 Reminder Proposal（§8：source=auto / relative / 负 offsetMinutes / 本地墙钟 triggerAt） */
export interface AutoDeadlineReminderProposal {
  targetType: "assignment" | "calendarMark";
  targetId: string;
  title: string;
  /** 负数提前量（due-time = 0） */
  offsetMinutes: number;
  /** resolved 本地墙钟 "YYYY-MM-DDTHH:mm:ss" */
  triggerAt: string;
}

/** 由已降级的 lead 生成 proposal；anchor 非法 → null */
export function buildAutoDeadlineReminder(input: {
  targetType: "assignment" | "calendarMark";
  targetId: string;
  title: string;
  anchor: string;
  leadMinutes: number;
}): AutoDeadlineReminderProposal | null {
  const { targetType, targetId, title, anchor, leadMinutes } = input;
  const offsetMinutes = leadMinutes === 0 ? 0 : -leadMinutes;
  const triggerAt = resolveReminderTriggerAt({
    timingMode: "relative",
    triggerAt: anchor,
    offsetMinutes,
  });
  if (!triggerAt) return null;
  return { targetType, targetId, title, offsetMinutes, triggerAt };
}

/** 该 target 当前是否存在 scheduled source="auto" Reminder（§9 唯一性） */
export function hasScheduledAutoReminderForTarget(
  reminders: Reminder[],
  targetType: ReminderTargetType,
  targetId: string
): boolean {
  return reminders.some(
    (r) =>
      r.targetType === targetType &&
      r.targetId === targetId &&
      r.status === "scheduled" &&
      r.source === "auto"
  );
}

/**
 * 同 target + 同最终 triggerAt 去重（§10，含非 auto scheduled Reminder）：
 * 比较基于规范化后的本地墙钟时间（epoch），避免 "12:00" vs "12:00:00" 格式差异误判。
 * 解析失败 → 保守视为冲突（不创建）。
 */
export function hasAutoReminderSameTriggerConflict(
  reminders: Reminder[],
  targetType: ReminderTargetType,
  targetId: string,
  triggerAt: string
): boolean {
  const target = parseLocalDDL(triggerAt);
  if (!target) return true;
  return reminders.some((r) => {
    if (r.targetType !== targetType || r.targetId !== targetId) return false;
    if (r.status !== "scheduled") return false;
    const t = parseLocalDDL(r.triggerAt);
    if (!t) return false;
    return t.getTime() === target.getTime();
  });
}

/**
 * 由 relative auto Reminder 反推其对应 anchor（§12）：
 * triggerAt - offsetMinutes = anchor（offset 为负 → anchor = triggerAt + |offset|）。
 * 非 relative auto → null。
 */
export function inferAutoReminderAnchor(r: Reminder): string | null {
  if (r.source !== "auto" || r.timingMode !== "relative") return null;
  if (typeof r.offsetMinutes !== "number" || !Number.isFinite(r.offsetMinutes)) return null;
  const trigger = parseLocalDDL(r.triggerAt);
  if (!trigger) return null;
  return formatLocalDateTime(new Date(trigger.getTime() - r.offsetMinutes * 60_000));
}

/** anchor 规范化比较（本地墙钟 epoch；格式差异不误判） */
function anchorsEqual(a: string, b: string): boolean {
  const da = parseLocalDDL(a);
  const db = parseLocalDDL(b);
  return !!da && !!db && da.getTime() === db.getTime();
}

/**
 * 当前 target + 当前 anchor 是否已由 auto Reminder 处理过（§12）：
 * 存在 source="auto"（任意状态，含 fired/skipped 历史）且其反推 anchor 与当前 anchor 相同
 * → 已处理 → 不重复重建（防止「同截止事项 fired 后每次 reconcile 又重建」）。
 */
export function hasAutoReminderHandledAnchor(
  reminders: Reminder[],
  targetType: ReminderTargetType,
  targetId: string,
  anchor: string
): boolean {
  return reminders.some((r) => {
    if (r.targetType !== targetType || r.targetId !== targetId) return false;
    if (r.source !== "auto") return false;
    const inferred = inferAutoReminderAnchor(r);
    return inferred !== null && anchorsEqual(inferred, anchor);
  });
}

/**
 * 纯 reconciliation contract（§13，P2 接线入口）：
 * 输入 target 的 anchor / requestedLead / now / 当前 reminders，输出：
 * - proposal：应创建的 auto Reminder（null = 不应创建）
 * - staleAutoIds：当前 scheduled auto 中「反推 anchor 已与当前 anchor 不一致」的 id
 *   （anchor 变化后的旧 auto；P2 结合现有 reconcileTargetReminders 处理更新/删除）
 *
 * 决策顺序：
 * 1. 无 anchor → 不创建；所有 scheduled auto 标 stale
 * 2. 已存在 scheduled auto：
 *    - anchor 匹配当前 → 保留（唯一性，不重复创建）
 *    - anchor 不匹配 → stale（旧截止事项的 auto）
 * 3. 无 scheduled auto：
 *    - 历史 auto（fired/skipped）已处理当前 anchor → 不重建
 *    - DDL <= now（降级无档位）→ 不创建
 *    - 非 auto scheduled 同 triggerAt → 临时 suppression（不创建，不等于 opt-out）
 *    - 否则 → 创建 proposal
 */
export function reconcileAutoDeadlineReminder(input: {
  targetType: "assignment" | "calendarMark";
  targetId: string;
  title: string;
  /** 提醒 anchor（本地墙钟；Assignment 用 ddl；CalendarMark 已用 defaultDDLTime resolve；null = 无 anchor） */
  anchor: string | null;
  requestedLead: AutoDeadlineLeadMinutes;
  now: string;
  reminders: Reminder[];
}): { proposal: AutoDeadlineReminderProposal | null; staleAutoIds: string[] } {
  const { targetType, targetId, title, anchor, requestedLead, now, reminders } = input;
  const targetReminders = reminders.filter(
    (r) => r.targetType === targetType && r.targetId === targetId
  );
  const scheduledAuto = targetReminders.filter(
    (r) => r.source === "auto" && r.status === "scheduled"
  );

  // 1. 无 anchor（DDL 删除 / 无有效时间）：不创建；遗留 scheduled auto 为 stale
  if (!anchor) {
    return { proposal: null, staleAutoIds: scheduledAuto.map((r) => r.id) };
  }

  // 2. 已存在 scheduled auto：anchor 匹配 → 保留；不匹配 → stale（唯一性：不重复创建）
  if (scheduledAuto.length > 0) {
    const matching = scheduledAuto.filter((r) => {
      const inferred = inferAutoReminderAnchor(r);
      return inferred !== null && anchorsEqual(inferred, anchor);
    });
    return {
      proposal: null,
      staleAutoIds: scheduledAuto.filter((r) => !matching.includes(r)).map((r) => r.id),
    };
  }

  // 3a. 历史 auto 已处理当前 anchor → 不重建
  if (hasAutoReminderHandledAnchor(targetReminders, targetType, targetId, anchor)) {
    return { proposal: null, staleAutoIds: [] };
  }

  // 3b. 降级（DDL <= now → null，不产生已过去的默认提醒）
  const lead = resolveAutoDeadlineLead({ requestedLead, ddl: anchor, now });
  if (lead === null) {
    return { proposal: null, staleAutoIds: [] };
  }

  const proposal = buildAutoDeadlineReminder({
    targetType,
    targetId,
    title,
    anchor,
    leadMinutes: lead,
  });
  if (!proposal) return { proposal: null, staleAutoIds: [] };

  // 3c. same-time suppression：非 auto scheduled 同 triggerAt → 不创建（临时，不等于 opt-out）
  if (hasAutoReminderSameTriggerConflict(targetReminders, targetType, targetId, proposal.triggerAt)) {
    return { proposal: null, staleAutoIds: [] };
  }

  return { proposal, staleAutoIds: [] };
}
