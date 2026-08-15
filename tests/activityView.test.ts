import { describe, it, expect } from "vitest";
import { LearningHistoryEvent, LearningHistorySource } from "@/lib/history/types";
import {
  ActivityRow,
  formatActivityDeadline,
  formatActivityGroupLabel,
  formatActivityTime,
  projectActivityEvents,
} from "@/lib/history/activityView";

let seq = 0;

function mk(
  patch: {
    type: LearningHistoryEvent["type"];
    occurredAt: number;
    localDate?: string;
    source?: LearningHistorySource;
    assignmentId?: string;
    courseId?: string;
    assignmentTitleSnapshot?: string;
    data?: unknown;
  }
): LearningHistoryEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    schemaVersion: 1,
    type: patch.type,
    occurredAt: patch.occurredAt,
    localDate: patch.localDate ?? "2026-08-15",
    timezoneOffsetMinutes: -480,
    source: patch.source ?? "manual",
    entityType: "assignment",
    entityId: "a1",
    semesterId: "s1",
    semesterNameSnapshot: "S",
    semesterWeek: 3,
    sequence: seq,
    assignmentId: patch.assignmentId ?? "a1",
    courseId: patch.courseId,
    assignmentTitleSnapshot: patch.assignmentTitleSnapshot,
    data: patch.data,
  } as LearningHistoryEvent;
}

const T = {
  created: 1786700000000,
  day2: 1786700000000 + 86400000,
};

function titles(rows: ActivityRow[]): string[] {
  return rows.map((r) => r.title);
}

describe("Assignment scope projection", () => {
  it("1. assignment.created → 创建任务", () => {
    const rows = projectActivityEvents([mk({ type: "assignment.created", occurredAt: T.created })], "assignment");
    expect(rows[0].title).toBe("创建任务");
    expect(rows[0].source).toBeUndefined(); // manual → no chip
    expect(rows[0].category).toBe("task");
  });

  it("2. status_changed todo→doing → 状态从「待完成」改为「进行中」", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.status_changed", occurredAt: T.created, data: { from: "todo", to: "doing" } })],
      "assignment"
    );
    expect(rows[0].title).toBe("状态从「待完成」改为「进行中」");
  });

  it("3. completed suppresses same-mutation status_changed（同一 assignmentId+occurredAt+source）", () => {
    const at = T.created;
    const events = [
      mk({ type: "assignment.status_changed", occurredAt: at, data: { from: "doing", to: "completed" } }),
      mk({ type: "assignment.completed", occurredAt: at, data: { previousStatus: "doing", completionTrigger: "status" } }),
    ];
    const rows = projectActivityEvents(events, "assignment");
    expect(titles(rows)).toEqual(["完成任务"]);
  });

  it("4. reopened suppresses duplicate status_changed", () => {
    const at = T.created;
    const events = [
      mk({ type: "assignment.status_changed", occurredAt: at, data: { from: "completed", to: "todo" } }),
      mk({ type: "assignment.reopened", occurredAt: at, data: { from: "completed", to: "todo" } }),
    ];
    const rows = projectActivityEvents(events, "assignment");
    expect(titles(rows)).toEqual(["重新打开任务"]);
  });

  it("3b. 不同 occurredAt / 不同 assignment 的 status_changed 不误抑制", () => {
    const events = [
      mk({ type: "assignment.status_changed", occurredAt: T.created, data: { from: "todo", to: "doing" } }),
      mk({ type: "assignment.completed", occurredAt: T.day2, data: { previousStatus: "doing", completionTrigger: "status" } }),
    ];
    const rows = projectActivityEvents(events, "assignment");
    expect(titles(rows)).toEqual(["状态从「待完成」改为「进行中」", "完成任务"]);
  });

  it("5. deadline add（before=null, after 有值）", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.deadline_changed", occurredAt: T.created, data: { before: null, after: "2026-08-18T20:00:00" } })],
      "assignment"
    );
    expect(rows[0].detail).toBe("设置截止时间为 8月18日 20:00");
  });

  it("6. deadline move", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.deadline_changed", occurredAt: T.created, data: { before: "2026-08-18T20:00:00", after: "2026-08-20T20:00:00" } })],
      "assignment"
    );
    expect(rows[0].detail).toBe("将截止时间调整为 8月20日 20:00");
  });

  it("7. deadline remove", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.deadline_changed", occurredAt: T.created, data: { before: "2026-08-18T20:00:00", after: null } })],
      "assignment"
    );
    expect(rows[0].detail).toBe("移除截止时间");
  });

  it("8. priority change", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.priority_changed", occurredAt: T.created, data: { before: "medium", after: "high" } })],
      "assignment"
    );
    expect(rows[0].title).toBe("优先级从「中」改为「高」");
  });

  it("9. estimate change 使用 formatEstimatedMinutes 统一格式", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.estimate_changed", occurredAt: T.created, data: { before: 60, after: 90 } })],
      "assignment"
    );
    expect(rows[0].title).toBe("预计耗时从 1 小时调整为 1 小时 30 分");
    const unset = projectActivityEvents(
      [mk({ type: "assignment.estimate_changed", occurredAt: T.created, data: { before: null, after: 90 } })],
      "assignment"
    );
    expect(unset[0].title).toBe("预计耗时从未设置调整为 1 小时 30 分");
  });

  it("10. study_block create/update/delete", () => {
    const rows = projectActivityEvents(
      [
        mk({ type: "study_block.created", occurredAt: T.created, data: { date: "2026-08-17", startTime: "19:00", endTime: "20:00" } }),
        mk({ type: "study_block.updated", occurredAt: T.day2, data: { date: "2026-08-17", startTime: "20:00", endTime: "21:00" } }),
        mk({ type: "study_block.deleted", occurredAt: T.day2 + 1000, data: { date: "2026-08-17" } }),
      ],
      "assignment"
    );
    expect(rows[0].title).toBe("安排学习时间");
    expect(rows[0].detail).toBe("8月17日 · 19:00–20:00");
    expect(rows[1].title).toBe("调整学习安排");
    expect(rows[2].title).toBe("移除学习安排");
  });

  it("11. focus.completed 使用真实 actualActiveMs（round 到分钟）", () => {
    const rows = projectActivityEvents(
      [mk({ type: "focus.completed", occurredAt: T.created, data: { plannedMinutes: 60, actualActiveMs: 42 * 60000 + 31000, startedAt: 1, endedAt: 2, endReason: "timer", sessionSource: "manual" } })],
      "assignment"
    );
    expect(rows[0].title).toBe("完成专注");
    expect(rows[0].detail).toBe("43 分钟");
  });

  it("12. focus.started/paused/resumed 默认不展示", () => {
    const rows = projectActivityEvents(
      [
        mk({ type: "focus.started", occurredAt: T.created, data: { plannedMinutes: 25, sessionSource: "manual", startedAt: 1 } }),
        mk({ type: "focus.paused", occurredAt: T.created + 1, data: { accumulatedActiveMs: 1000 } }),
        mk({ type: "focus.resumed", occurredAt: T.created + 2, data: { accumulatedActiveMs: 1000 } }),
        mk({ type: "focus.completed", occurredAt: T.created + 3, data: { plannedMinutes: 25, actualActiveMs: 60000, startedAt: 1, endedAt: 2, endReason: "timer", sessionSource: "manual" } }),
      ],
      "assignment"
    );
    expect(titles(rows)).toEqual(["完成专注"]);
  });
});

describe("Course scope projection", () => {
  it("13. course.created → 创建课程", () => {
    const rows = projectActivityEvents(
      [mk({ type: "course.created", occurredAt: T.created, courseId: "c1", data: { name: "数据结构", code: "CS-210", credit: 4 } })],
      "course"
    );
    expect(rows[0].title).toBe("创建课程");
  });

  it("14. course.updated → 更新课程信息（detail = 变化的字段）", () => {
    const rows = projectActivityEvents(
      [mk({ type: "course.updated", occurredAt: T.created, courseId: "c1", data: { before: { teacher: "李教授", classroom: "A101", credit: 3 }, after: { teacher: "周教授", classroom: "A202", credit: 3 } } })],
      "course"
    );
    expect(rows[0].title).toBe("更新课程信息");
    expect(rows[0].detail).toBe("教师 · 教室");
  });

  it("15. schedule create/update/delete", () => {
    const rows = projectActivityEvents(
      [
        mk({ type: "schedule.created", occurredAt: T.created, courseId: "c1", data: { dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼102", weeks: "1-16周" } }),
        mk({ type: "schedule.updated", occurredAt: T.day2, courseId: "c1", data: { dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "计算机楼102", weeks: "1-16周" } }),
        mk({ type: "schedule.deleted", occurredAt: T.day2 + 1000, courseId: "c1", data: { dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "计算机楼102", weeks: "1-16周" } }),
      ],
      "course"
    );
    expect(rows[0].title).toBe("添加上课时段");
    expect(rows[0].detail).toBe("周一 · 08:00–09:40 · 计算机楼102");
    expect(rows[1].title).toBe("调整上课时段");
    expect(rows[2].title).toBe("删除上课时段");
  });

  it("16. course scope assignment created/completed 使用 snapshot 标题", () => {
    const rows = projectActivityEvents(
      [
        mk({ type: "assignment.created", occurredAt: T.created, courseId: "c1", assignmentTitleSnapshot: "置信区间与检验小测" }),
        mk({ type: "assignment.completed", occurredAt: T.day2, courseId: "c1", assignmentTitleSnapshot: "章节练习" }),
      ],
      "course"
    );
    expect(rows[0].title).toBe("创建任务");
    expect(rows[0].detail).toBe("置信区间与检验小测");
    expect(rows[1].title).toBe("完成任务");
    expect(rows[1].detail).toBe("章节练习");
  });

  it("17. 历史 snapshot 优先：事件标题不被当前标题覆盖（projection 只读事件）", () => {
    const rows = projectActivityEvents(
      [mk({ type: "assignment.completed", occurredAt: T.created, courseId: "c1", assignmentTitleSnapshot: "章节练习" })],
      "course"
    );
    expect(rows[0].detail).toBe("章节练习");
  });

  it("18. course scope focus.completed", () => {
    const rows = projectActivityEvents(
      [mk({ type: "focus.completed", occurredAt: T.created, courseId: "c1", data: { plannedMinutes: 25, actualActiveMs: 1500000, startedAt: 1, endedAt: 2, endReason: "manual", sessionSource: "manual" } })],
      "course"
    );
    expect(rows[0].title).toBe("完成专注");
    expect(rows[0].detail).toBe("25 分钟");
  });

  it("19. course scope 过滤过细噪音：priority/estimate/普通 status_changed 不显示", () => {
    const rows = projectActivityEvents(
      [
        mk({ type: "assignment.priority_changed", occurredAt: T.created, courseId: "c1", data: { before: "medium", after: "high" } }),
        mk({ type: "assignment.estimate_changed", occurredAt: T.created + 1, courseId: "c1", data: { before: 60, after: 90 } }),
        mk({ type: "assignment.status_changed", occurredAt: T.created + 2, courseId: "c1", data: { from: "todo", to: "doing" } }),
        mk({ type: "assignment.completed", occurredAt: T.created + 3, courseId: "c1", assignmentTitleSnapshot: "任务", data: { previousStatus: "doing", completionTrigger: "status" } }),
      ],
      "course"
    );
    expect(titles(rows)).toEqual(["完成任务"]);
  });
});

describe("Source attribution", () => {
  it("20-23. manual 无 chip；kiro/system/import 有 chip", () => {
    const manual = projectActivityEvents([mk({ type: "assignment.created", occurredAt: T.created })], "assignment");
    expect(manual[0].source).toBeUndefined();
    const kiro = projectActivityEvents([mk({ type: "assignment.created", occurredAt: T.created, source: "kiro" })], "assignment");
    expect(kiro[0].source).toBe("kiro");
    const system = projectActivityEvents([mk({ type: "assignment.created", occurredAt: T.created, source: "system" })], "assignment");
    expect(system[0].source).toBe("system");
    const imp = projectActivityEvents([mk({ type: "assignment.created", occurredAt: T.created, source: "import" })], "assignment");
    expect(imp[0].source).toBe("import");
  });
});

describe("Ordering / 输入不可变", () => {
  it("24. desc 输入顺序保留（projection 不重排；query 层负责排序）", () => {
    const events = [
      mk({ type: "assignment.completed", occurredAt: T.day2, data: { previousStatus: "doing", completionTrigger: "status" } }),
      mk({ type: "assignment.created", occurredAt: T.created }),
    ];
    const rows = projectActivityEvents(events, "assignment");
    expect(rows.map((r) => r.occurredAt)).toEqual([T.day2, T.created]);
    // 输入不被 mutate
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("assignment.completed");
  });
});

describe("Time / group formatting（本地墙钟）", () => {
  const NOW = new Date(2026, 7, 15, 14, 0, 0);

  it("formatActivityDeadline", () => {
    expect(formatActivityDeadline("2026-08-18T20:00:00")).toBe("8月18日 20:00");
    expect(formatActivityDeadline("bad")).toBeNull();
  });

  it("formatActivityTime：同天 → HH:mm；同年跨天 → M月d日 HH:mm；跨年 → 完整", () => {
    const today = "2026-08-15";
    expect(formatActivityTime(new Date(2026, 7, 15, 9, 30).getTime(), today, NOW)).toBe("09:30");
    expect(formatActivityTime(new Date(2026, 7, 14, 21, 18).getTime(), "2026-08-14", NOW)).toBe("8月14日 21:18");
    expect(formatActivityTime(new Date(2026, 0, 1, 9, 20).getTime(), "2026-01-01", NOW)).toBe("1月1日 09:20");
    expect(formatActivityTime(new Date(2025, 11, 3, 9, 20).getTime(), "2025-12-03", NOW)).toBe("2025年12月3日 09:20");
  });

  it("formatActivityGroupLabel：今天 / 昨天 / 同年日期 / 跨年日期", () => {
    expect(formatActivityGroupLabel("2026-08-15", NOW)).toBe("今天");
    expect(formatActivityGroupLabel("2026-08-14", NOW)).toBe("昨天");
    expect(formatActivityGroupLabel("2026-08-12", NOW)).toBe("8月12日");
    expect(formatActivityGroupLabel("2025-12-01", NOW)).toBe("2025年12月1日");
  });
});
