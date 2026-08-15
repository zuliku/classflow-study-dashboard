import { describe, it, expect } from "vitest";
import { Reminder, StudyBlock } from "@/types";
import {
  formatDeadlineView,
  formatRelativeDuration,
  formatReminderSummaryText,
  formatScheduleSummaryText,
  summarizeReminders,
  summarizeStudySchedule,
} from "@/lib/tasks/assignmentDetailView";

/** 本地墙钟 now（避免时区漂移：直接用本地 Date 构造） */
const NOW = new Date(2026, 7, 15, 10, 0, 0); // 2026-08-15 10:00 本地

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

describe("formatDeadlineView", () => {
  it("无 DDL → 未设置截止时间 / 无剩余文案 / 非逾期", () => {
    expect(formatDeadlineView(undefined, NOW)).toEqual({
      hasDdl: false,
      primary: "未设置截止时间",
      relative: null,
      overdue: false,
    });
  });

  it("今天 → 今天 HH:mm + 还有 X", () => {
    const view = formatDeadlineView(localIso(new Date(2026, 7, 15, 20, 0)), NOW);
    expect(view.hasDdl).toBe(true);
    expect(view.primary).toBe("今天 20:00");
    expect(view.overdue).toBe(false);
    expect(view.relative).toMatch(/^还有 \d+ 小时$/);
  });

  it("明天 → 明天 HH:mm", () => {
    expect(formatDeadlineView(localIso(new Date(2026, 7, 16, 23, 59)), NOW).primary).toBe("明天 23:59");
  });

  it("更远日期 → M月d日 周X · HH:mm（本地墙钟）", () => {
    // 2026-08-18 是周二
    expect(formatDeadlineView(localIso(new Date(2026, 7, 18, 23, 59)), NOW).primary).toBe(
      "8月18日 周二 · 23:59"
    );
  });

  it("逾期 → 已逾期 X", () => {
    const view = formatDeadlineView(localIso(new Date(2026, 7, 15, 8, 0)), NOW);
    expect(view.overdue).toBe(true);
    expect(view.relative).toMatch(/^已逾期 /);
  });

  it("未来 3 天 → 还有 3 天", () => {
    expect(formatDeadlineView(localIso(new Date(2026, 7, 18, 10, 0)), NOW).relative).toBe("还有 3 天");
  });
});

describe("formatRelativeDuration", () => {
  it("分钟 / 小时 / 天 单位", () => {
    expect(formatRelativeDuration(30 * 60000)).toBe("30 分钟");
    expect(formatRelativeDuration(8 * 3600000)).toBe("8 小时");
    expect(formatRelativeDuration(3 * 86400000)).toBe("3 天");
  });
});

describe("summarizeStudySchedule", () => {
  const mkBlock = (patch: Partial<StudyBlock>): StudyBlock =>
    ({
      id: "b",
      title: "安排",
      date: "2026-08-16",
      startTime: "19:00",
      endTime: "20:00",
      source: "manual",
      ...patch,
    }) as StudyBlock;

  it("无 block → hasBlocks=false / 0 分钟", () => {
    const s = summarizeStudySchedule([]);
    expect(s).toMatchObject({ hasBlocks: false, minutes: 0, blockCount: 0 });
    expect(s.lines).toEqual([]);
  });

  it("2 个 1 小时时段 → 120 分钟 · 2 个时段", () => {
    const s = summarizeStudySchedule([
      mkBlock({ id: "b1", date: "2026-08-16", startTime: "19:00", endTime: "20:00" }),
      mkBlock({ id: "b2", date: "2026-08-17", startTime: "15:00", endTime: "16:00" }),
    ]);
    expect(s.minutes).toBe(120);
    expect(s.blockCount).toBe(2);
  });

  it("非法时段（end <= start / 非法时间）不计时长但仍可列出", () => {
    const s = summarizeStudySchedule([
      mkBlock({ id: "b1", startTime: "20:00", endTime: "19:00" }),
      mkBlock({ id: "b2", startTime: "not-a-time", endTime: "21:00" }),
    ]);
    expect(s.minutes).toBe(0);
    expect(s.blockCount).toBe(1); // 非法时间行不列入
  });

  it("行按 date + startTime 升序", () => {
    const s = summarizeStudySchedule([
      mkBlock({ id: "b2", date: "2026-08-17", startTime: "09:00", endTime: "10:00" }),
      mkBlock({ id: "b1", date: "2026-08-16", startTime: "21:00", endTime: "22:00" }),
      mkBlock({ id: "b0", date: "2026-08-16", startTime: "08:00", endTime: "09:00" }),
    ]);
    expect(s.lines.map((l) => l.id)).toEqual(["b0", "b1", "b2"]);
  });
});

describe("summarizeReminders / formatReminderSummaryText", () => {
  const mkR = (patch: Partial<Reminder>): Reminder =>
    ({
      id: "r",
      title: "提醒",
      targetType: "assignment",
      targetId: "a1",
      timingMode: "relative",
      offsetMinutes: -60,
      triggerAt: "2026-08-16T10:00:00",
      status: "scheduled",
      source: "manual",
      createdAt: "2026-08-15T10:00:00",
      updatedAt: "2026-08-15T10:00:00",
      ...patch,
    }) as Reminder;

  it("单个 auto → 默认提醒 · 提前 X", () => {
    const s = summarizeReminders([mkR({ source: "auto", offsetMinutes: -60 })], "assignment", "a1", false);
    expect(s.count).toBe(1);
    expect(s.hasAuto).toBe(true);
    expect(s.autoLabel).toBe("提前 1 小时");
    expect(formatReminderSummaryText(s)).toBe("默认提醒 · 提前 1 小时");
  });

  it("多个提醒 → N 个提醒", () => {
    const s = summarizeReminders(
      [mkR({ id: "r1", source: "auto" }), mkR({ id: "r2", source: "manual", offsetMinutes: -10 })],
      "assignment",
      "a1",
      false
    );
    expect(formatReminderSummaryText(s)).toBe("2 个提醒");
  });

  it("opt-out 且无 scheduled → 默认提醒：已关闭", () => {
    const s = summarizeReminders([], "assignment", "a1", true);
    expect(formatReminderSummaryText(s)).toBe("默认提醒：已关闭");
  });

  it("空 → 无提醒", () => {
    expect(formatReminderSummaryText(summarizeReminders([], "assignment", "a1", false))).toBe("无提醒");
  });

  it("fired/skipped 不参与 scheduled 摘要", () => {
    const s = summarizeReminders(
      [mkR({ id: "r1", status: "fired", source: "auto" }), mkR({ id: "r2", status: "skipped" })],
      "assignment",
      "a1",
      false
    );
    expect(s.count).toBe(0);
  });
});

describe("formatScheduleSummaryText", () => {
  it("未安排 → 未安排学习时间", () => {
    expect(formatScheduleSummaryText(summarizeStudySchedule([]))).toBe("未安排学习时间");
  });

  it("已安排 2 小时 · 2 个时段（含预计）", () => {
    const s = summarizeStudySchedule([
      { id: "b1", title: "t", date: "2026-08-16", startTime: "19:00", endTime: "20:00", source: "manual" },
      { id: "b2", title: "t", date: "2026-08-17", startTime: "15:00", endTime: "16:00", source: "manual" },
    ]);
    expect(formatScheduleSummaryText(s)).toBe("已安排 2 小时 · 2 个时段");
    expect(formatScheduleSummaryText(s, 180)).toBe("已安排 2 小时 · 2 个时段 / 预计 3 小时");
  });

  it("时长准确：30→30 分钟 / 60→1 小时 / 90→1 小时 30 分 / 120→2 小时（不 round 出错误小时）", () => {
    const mk = (minutes: number) => {
      const end = new Date(2026, 7, 16, 0, 0, 0);
      end.setMinutes(minutes);
      return summarizeStudySchedule([
        {
          id: "b1",
          title: "t",
          date: "2026-08-16",
          startTime: "00:00",
          endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
          source: "manual",
        },
      ]);
    };
    expect(formatScheduleSummaryText(mk(30))).toBe("已安排 30 分钟 · 1 个时段");
    expect(formatScheduleSummaryText(mk(60))).toBe("已安排 1 小时 · 1 个时段");
    expect(formatScheduleSummaryText(mk(90))).toBe("已安排 1 小时 30 分 · 1 个时段");
    expect(formatScheduleSummaryText(mk(120))).toBe("已安排 2 小时 · 1 个时段");
  });
});
