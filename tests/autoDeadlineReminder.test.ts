import { describe, it, expect } from "vitest";
import { CalendarMark, Reminder } from "@/types";
import {
  applyAutoReconcileResult,
  buildAutoDeadlineReminder,
  hasAutoReminderHandledAnchor,
  hasAutoReminderSameTriggerConflict,
  hasScheduledAutoReminderForTarget,
  inferAutoReminderAnchor,
  isAssignmentAutoReminderEligible,
  isIndependentDDLCalendarMark,
  normalizeAutoDeadlineLead,
  reconcileAutoDeadlineReminder,
  resolveAutoDeadlineLead,
  resolveDDLCalendarMarkAnchor,
} from "@/lib/reminders/autoDeadlineReminder";
import { DEFAULT_PREFERENCES, sanitizePreferences, DEADLINE_REMINDER_MINUTES } from "@/lib/preferences";
import { normalizeReminder, evaluateMissedReminder } from "@/lib/reminders/reminderDomain";
import { normalizeAssignment } from "@/lib/tasks/taskSemantics";

const NOW = "2026-08-15T10:00:00";

function mkAutoReminder(patch: Partial<Reminder>): Reminder {
  return {
    id: "auto1",
    title: "自动提醒",
    targetType: "assignment",
    targetId: "a1",
    timingMode: "relative",
    offsetMinutes: -1440,
    triggerAt: "2026-08-20T10:00:00",
    status: "scheduled",
    source: "auto",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("defaultDeadlineReminderMinutes preference", () => {
  it("1. legacy fallback = 1440（缺失 / 非法档位）", () => {
    expect(DEFAULT_PREFERENCES.defaultDeadlineReminderMinutes).toBe(1440);
    expect(sanitizePreferences({}).defaultDeadlineReminderMinutes).toBe(1440);
    expect(sanitizePreferences(undefined).defaultDeadlineReminderMinutes).toBe(1440);
    expect(sanitizePreferences({ defaultDeadlineReminderMinutes: 999 }).defaultDeadlineReminderMinutes).toBe(1440);
    expect(sanitizePreferences({ defaultDeadlineReminderMinutes: "1440" }).defaultDeadlineReminderMinutes).toBe(1440);
    expect(sanitizePreferences({ defaultDeadlineReminderMinutes: 0 }).defaultDeadlineReminderMinutes).toBe(1440);
  });

  it("合法档位保留：10080 / 4320 / 1440 / 60", () => {
    for (const v of DEADLINE_REMINDER_MINUTES) {
      expect(sanitizePreferences({ defaultDeadlineReminderMinutes: v }).defaultDeadlineReminderMinutes).toBe(v);
    }
  });
});

describe("normalizeReminder source=auto", () => {
  it("2. source=auto normalize 后仍是 auto；kiro 保留；legacy/缺失 → manual", () => {
    expect(normalizeReminder(mkAutoReminder({}))?.source).toBe("auto");
    expect(normalizeReminder(mkAutoReminder({ source: "kiro" }))?.source).toBe("kiro");
    expect(normalizeReminder(mkAutoReminder({ source: "manual" }))?.source).toBe("manual");
    expect(normalizeReminder(mkAutoReminder({ source: undefined }))?.source).toBe("manual");
    expect(normalizeReminder(mkAutoReminder({ source: "system" as Reminder["source"] }))?.source).toBe("manual");
  });
});

describe("resolveAutoDeadlineLead（降级规则）", () => {
  it("3. 默认 1 天，DDL > 1 天 → 1 天", () => {
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-20T10:00:00", now: NOW })).toBe(1440);
  });

  it("4. 默认 1 天，只剩 3 小时 → 提前 1 小时", () => {
    // DDL 13:00，now 10:00 → 1 天（昨天 13:00）已错过 → 1 小时（12:00）
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-15T13:00:00", now: NOW })).toBe(60);
  });

  it("5. 默认 1 天，只剩 30 分钟 → due-time（0）", () => {
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-15T10:30:00", now: NOW })).toBe(0);
  });

  it("6. DDL <= now → null（不产生 scheduled proposal）", () => {
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-15T10:00:00", now: NOW })).toBeNull();
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-14T23:00:00", now: NOW })).toBeNull();
  });

  it("7. 7 天 -> 3 天 -> 1 天 -> 1 小时 -> due 降级顺序", () => {
    // 从 7 天开始逐级：DDL 距 now 依次收窄（避开「提前量恰好 == 剩余时间」的严格 > 边界）
    expect(resolveAutoDeadlineLead({ requestedLead: 10080, ddl: "2026-08-25T10:00:00", now: NOW })).toBe(10080);
    expect(resolveAutoDeadlineLead({ requestedLead: 10080, ddl: "2026-08-18T10:30:00", now: NOW })).toBe(4320);
    expect(resolveAutoDeadlineLead({ requestedLead: 10080, ddl: "2026-08-16T11:00:00", now: NOW })).toBe(1440);
    expect(resolveAutoDeadlineLead({ requestedLead: 10080, ddl: "2026-08-15T11:01:00", now: NOW })).toBe(60);
    expect(resolveAutoDeadlineLead({ requestedLead: 10080, ddl: "2026-08-15T10:20:00", now: NOW })).toBe(0);
  });

  it("非法 requestedLead 归一为 1440 后继续降级", () => {
    expect(resolveAutoDeadlineLead({ requestedLead: 999 as never, ddl: "2026-08-16T11:00:00", now: NOW })).toBe(1440);
  });
});

describe("Assignment eligibility", () => {
  it("8. todo / doing eligible", () => {
    expect(isAssignmentAutoReminderEligible({ ddl: "2026-08-20T10:00:00", status: "todo" })).toBe(true);
    expect(isAssignmentAutoReminderEligible({ ddl: "2026-08-20T10:00:00", status: "doing" })).toBe(true);
  });

  it("9. submitted / completed ineligible", () => {
    expect(isAssignmentAutoReminderEligible({ ddl: "2026-08-20T10:00:00", status: "submitted" })).toBe(false);
    expect(isAssignmentAutoReminderEligible({ ddl: "2026-08-20T10:00:00", status: "completed" })).toBe(false);
  });

  it("无合法 DDL / 缺失 → ineligible", () => {
    expect(isAssignmentAutoReminderEligible({ ddl: undefined, status: "todo" })).toBe(false);
    expect(isAssignmentAutoReminderEligible({ ddl: "not-a-date", status: "todo" })).toBe(false);
  });

  it("10. opted-out Assignment ineligible", () => {
    expect(
      isAssignmentAutoReminderEligible({ ddl: "2026-08-20T10:00:00", status: "todo", autoReminderDisabled: true })
    ).toBe(false);
  });
});

describe("CalendarMark eligibility / anchor", () => {
  const assignmentIds = new Set(["a1"]);

  it("11. 独立 DDL CalendarMark eligible", () => {
    expect(isIndependentDDLCalendarMark({ id: "m1", date: "2026-08-20", type: "ddl", title: "交报告" }, assignmentIds)).toBe(true);
  });

  it("12. Assignment-linked DDL CalendarMark excluded（sourceId 精确 relation）", () => {
    expect(isIndependentDDLCalendarMark({ id: "m1", date: "2026-08-20", type: "ddl", title: "交报告", sourceId: "a1" }, assignmentIds)).toBe(false);
  });

  it("非 ddl type / opted-out 排除；sourceId 不存在的 mark 视为独立（不猜）", () => {
    expect(isIndependentDDLCalendarMark({ id: "m1", date: "2026-08-20", type: "exam", title: "考试" }, assignmentIds)).toBe(false);
    expect(
      isIndependentDDLCalendarMark({ id: "m1", date: "2026-08-20", type: "ddl", title: "交报告", autoReminderDisabled: true }, assignmentIds)
    ).toBe(false);
    expect(
      isIndependentDDLCalendarMark({ id: "m1", date: "2026-08-20", type: "ddl", title: "同名", sourceId: "unknown-target" }, assignmentIds)
    ).toBe(true);
  });

  it("13. 无 startTime 的 DDL mark 使用 defaultDDLTime 计算 anchor 但不 mutate mark", () => {
    const mark: CalendarMark = { id: "m1", date: "2026-08-20", type: "ddl", title: "交报告" };
    expect(resolveDDLCalendarMarkAnchor(mark, "23:59")).toBe("2026-08-20T23:59:00");
    expect(mark.startTime).toBeUndefined(); // mark 未被修改
  });

  it("有合法 startTime 时 anchor = date + startTime", () => {
    expect(resolveDDLCalendarMarkAnchor({ id: "m1", date: "2026-08-20", type: "ddl", title: "交报告", startTime: "18:00" }, "23:59")).toBe("2026-08-20T18:00:00");
  });
});

describe("Proposal / uniqueness / suppression", () => {
  it("proposal：source=auto / relative / 负 offset / 本地墙钟 triggerAt；due-time offset = 0", () => {
    const p = buildAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      leadMinutes: 1440,
    });
    expect(p).toEqual({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      offsetMinutes: -1440,
      triggerAt: "2026-08-19T10:00:00",
    });
    const due = buildAutoDeadlineReminder({
      targetType: "calendarMark",
      targetId: "m1",
      title: "交报告",
      anchor: "2026-08-15T10:30:00",
      leadMinutes: 0,
    });
    expect(due?.offsetMinutes).toBe(0);
    expect(due?.triggerAt).toBe("2026-08-15T10:30:00");
  });

  it("14. manual 不同 trigger 可 coexist（same-time conflict 只按同 triggerAt）", () => {
    const manual = mkAutoReminder({ id: "m1", source: "manual", offsetMinutes: -180, triggerAt: "2026-08-19T07:00:00" });
    expect(hasAutoReminderSameTriggerConflict([manual], "assignment", "a1", "2026-08-19T10:00:00")).toBe(false);
  });

  it("15. manual 相同 triggerAt（格式差异 12:00 vs 12:00:00）suppress auto", () => {
    const manual = mkAutoReminder({ id: "m1", source: "manual", triggerAt: "2026-08-19T10:00" });
    expect(hasAutoReminderSameTriggerConflict([manual], "assignment", "a1", "2026-08-19T10:00:00")).toBe(true);
  });

  it("16. suppression 不等于 opt-out：manual 删除后（无该 reminder）可恢复创建", () => {
    const manual = mkAutoReminder({ id: "m1", source: "manual", triggerAt: "2026-08-19T10:00" });
    expect(reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      requestedLead: 1440,
      now: NOW,
      reminders: [manual],
    }).proposal).toBeNull();
    const r2 = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      requestedLead: 1440,
      now: NOW,
      reminders: [],
    });
    expect(r2.proposal).not.toBeNull();
    expect(r2.proposal?.triggerAt).toBe("2026-08-19T10:00:00");
  });

  it("唯一性：同 target 已有 scheduled auto（anchor 匹配）→ 不重复创建", () => {
    const existing = mkAutoReminder({ id: "auto1", offsetMinutes: -1440, triggerAt: "2026-08-19T10:00:00" });
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      requestedLead: 1440,
      now: NOW,
      reminders: [existing],
    });
    expect(r.proposal).toBeNull();
    expect(r.staleAutoIds).toEqual([]);
  });

  it("scheduled auto 的 anchor 与当前不一致 → stale（anchor 变化的旧 auto）+ 按当前默认重建", () => {
    const old = mkAutoReminder({ id: "auto1", offsetMinutes: -1440, triggerAt: "2026-08-10T10:00:00" });
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      requestedLead: 1440,
      now: NOW,
      reminders: [old],
    });
    expect(r.staleAutoIds).toEqual(["auto1"]);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal?.triggerAt).toBe("2026-08-19T10:00:00");
  });
});

describe("auto history 防重复重建", () => {
  it("17. 同 anchor 已 fired/skipped → 不重建", () => {
    const fired = mkAutoReminder({ id: "auto1", status: "fired", firedAt: NOW, offsetMinutes: -1440, triggerAt: "2026-08-14T10:00:00" });
    // fired 的 inferred anchor = triggerAt + 1440 = 2026-08-15T10:00:00 = 当前 anchor
    expect(inferAutoReminderAnchor(fired)).toBe("2026-08-15T10:00:00");
    expect(hasAutoReminderHandledAnchor([fired], "assignment", "a1", "2026-08-15T10:00:00")).toBe(true);
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-15T10:00:00",
      requestedLead: 1440,
      now: "2026-08-15T09:00:00",
      reminders: [fired],
    });
    expect(r.proposal).toBeNull();
  });

  it("18. anchor 改变后（新截止时刻）→ 可产生新 auto", () => {
    const fired = mkAutoReminder({ id: "auto1", status: "fired", firedAt: NOW, offsetMinutes: -1440, triggerAt: "2026-08-10T10:00:00" });
    // 旧 anchor = 2026-08-11T10:00:00；当前 anchor 不同 → 新截止 → 可重建
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-20T10:00:00",
      requestedLead: 1440,
      now: NOW,
      reminders: [fired],
    });
    expect(r.proposal).not.toBeNull();
    expect(r.proposal?.triggerAt).toBe("2026-08-19T10:00:00");
  });
});

describe("local wall-clock 语义", () => {
  it("19. 无 timezone / toISOString drift：跨日降级保持本地墙钟", () => {
    // DDL 8/16 00:30，now 8/15 23:00 → 1 天已错过 → 1 小时 → 8/15 23:30
    expect(resolveAutoDeadlineLead({ requestedLead: 1440, ddl: "2026-08-16T00:30:00", now: "2026-08-15T23:00:00" })).toBe(60);
    const p = buildAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-16T00:30:00",
      leadMinutes: 60,
    });
    expect(p?.triggerAt).toBe("2026-08-15T23:30:00");
  });
});

describe("normalizeAssignment / CalendarMark 字段", () => {
  it("autoReminderDisabled：true 保留；false / 缺失 → undefined", () => {
    expect(normalizeAssignment({ id: "a1", autoReminderDisabled: true }).autoReminderDisabled).toBe(true);
    expect(normalizeAssignment({ id: "a1", autoReminderDisabled: false }).autoReminderDisabled).toBeUndefined();
    expect(normalizeAssignment({ id: "a1" }).autoReminderDisabled).toBeUndefined();
    expect(normalizeAssignment({ id: "a1", autoReminderDisabled: "yes" }).autoReminderDisabled).toBeUndefined();
  });

  it("normalizeAutoDeadlineLead：非法 → 1440；合法保留", () => {
    expect(normalizeAutoDeadlineLead(undefined)).toBe(1440);
    expect(normalizeAutoDeadlineLead(0)).toBe(1440);
    expect(normalizeAutoDeadlineLead(10080)).toBe(10080);
    expect(normalizeAutoDeadlineLead(60)).toBe(60);
  });
});

describe("P3 fix 5：ordinary reconcile 不因时间流逝重新降级已有 auto（preserve-schedule）", () => {
  // T0：now = 8/1，DDL = 8/11，default 7d → scheduled auto trigger 8/4（offset -10080）
  const overdue = mkAutoReminder({
    id: "auto1",
    title: "交报告",
    offsetMinutes: -10080,
    triggerAt: "2026-08-04T10:00:00",
  });

  it("T1：now = 8/6 普通 reconcile（hydrate 语义）→ 保留 offsetMinutes/triggerAt/status=scheduled", () => {
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-11T10:00:00",
      requestedLead: 10080,
      now: "2026-08-06T10:00:00",
      reminders: [overdue],
    });
    expect(r.staleAutoIds).toEqual([]);
    expect(r.refreshAutoIds).toEqual([]);
    expect(r.proposal).toBeNull();
    const out = applyAutoReconcileResult([overdue], r, "2026-08-06T10:00:00");
    expect(out).toHaveLength(1);
    // 绝不能变为 3d / 1d / 1h / due
    expect(out[0].offsetMinutes).toBe(-10080);
    expect(out[0].triggerAt).toBe("2026-08-04T10:00:00");
    expect(out[0].status).toBe("scheduled");
  });

  it("T1：explicit global default 7d → 3d（recompute-schedule）→ 允许按新默认重算到 3d", () => {
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-11T10:00:00",
      requestedLead: 4320,
      now: "2026-08-06T10:00:00",
      reminders: [overdue],
      mode: "recompute-schedule",
    });
    expect(r.staleAutoIds).toEqual([]);
    expect(r.refreshAutoIds).toEqual([
      { id: "auto1", offsetMinutes: -4320, triggerAt: "2026-08-08T10:00:00", title: "交报告" },
    ]);
  });

  it("missed policy 可见性：triggerAt <= now 的 scheduled auto 能被 evaluateMissedReminder 识别为 overdue", () => {
    expect(
      evaluateMissedReminder({ reminder: overdue, now: "2026-08-06T10:00:00", policy: "deliver", windowHours: 6 })
    ).toBe("deliver");
    // 已过期 2 天 > window 6h → recent-only 下 skip（仍由 Runtime policy 处理，不默默移动）
    expect(
      evaluateMissedReminder({ reminder: overdue, now: "2026-08-06T10:00:00", policy: "recent-only", windowHours: 6 })
    ).toBe("skip");
  });

  it("recompute 重建后的新 triggerAt 同样执行 same-trigger suppression（不 refresh 成重复 auto）", () => {
    const manual = mkAutoReminder({
      id: "m1",
      title: "手动 3 天",
      source: "manual",
      offsetMinutes: -4320,
      triggerAt: "2026-08-08T10:00:00",
    });
    const r = reconcileAutoDeadlineReminder({
      targetType: "assignment",
      targetId: "a1",
      title: "交报告",
      anchor: "2026-08-11T10:00:00",
      requestedLead: 4320,
      now: "2026-08-06T10:00:00",
      reminders: [overdue, manual],
      mode: "recompute-schedule",
    });
    expect(r.refreshAutoIds).toEqual([]);
    expect(r.staleAutoIds).toEqual(["auto1"]);
    const out = applyAutoReconcileResult([overdue, manual], r, "2026-08-06T10:00:00");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m1");
  });

  it("preserve 模式下同 trigger 的 manual/Kiro 同样立即 suppression（对最终 trigger 检查）", () => {
    for (const source of ["manual", "kiro"] as const) {
      const nonAuto = mkAutoReminder({
        id: `m-${source}`,
        source,
        offsetMinutes: -10080,
        triggerAt: "2026-08-04T10:00:00",
      });
      const r = reconcileAutoDeadlineReminder({
        targetType: "assignment",
        targetId: "a1",
        title: "交报告",
        anchor: "2026-08-11T10:00:00",
        requestedLead: 10080,
        now: "2026-08-06T10:00:00",
        reminders: [overdue, nonAuto],
      });
      expect(r.staleAutoIds).toEqual(["auto1"]);
      expect(r.refreshAutoIds).toEqual([]);
      const out = applyAutoReconcileResult([overdue, nonAuto], r, "2026-08-06T10:00:00");
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe(`m-${source}`);
    }
  });
});
