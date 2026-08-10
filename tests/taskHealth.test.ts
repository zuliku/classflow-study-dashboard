import { describe, it, expect } from "vitest";
import { deriveAssignmentHealth } from "@/lib/tasks/taskHealth";
import { findFreeTime } from "@/lib/planning/freeTime";
import { proposeStudyPlan } from "@/lib/planning/studyPlanner";
import { Assignment, StudyBlock, CourseSchedule, CalendarMark, Semester } from "@/types";

const NOW = new Date(2026, 7, 10, 12, 0, 0); // 2026-08-10 周一 12:00
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SEMESTER: Semester = { id: "s", name: "S", startDate: date(0), totalWeeks: 16 };

function mk(id: string, patch: Partial<Assignment>): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function block(id: string, assignmentId: string, offset: number, start: string, end: string): StudyBlock {
  return { id, title: id, date: date(offset), startTime: start, endTime: end, assignmentId, courseId: "c1", source: "manual" };
}

describe("deriveAssignmentHealth", () => {
  it("无 Deadline → unknown（missing_deadline）", () => {
    const r = deriveAssignmentHealth({ assignment: mk("a1", { estimatedMinutes: 60 }), studyBlocks: [], now: NOW });
    expect(r.state).toBe("unknown");
    expect(r.reasons).toContain("missing_deadline");
  });

  it("无 estimate → unknown（missing_estimate）；不伪造 60min", () => {
    const r = deriveAssignmentHealth({ assignment: mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)) }), studyBlocks: [], now: NOW });
    expect(r.state).toBe("unknown");
    expect(r.reasons).toContain("missing_estimate");
  });

  it("已逾期且未完成 → overdue", () => {
    const r = deriveAssignmentHealth({ assignment: mk("a1", { ddl: iso(new Date(NOW.getTime() - 86400000)), estimatedMinutes: 60 }), studyBlocks: [], now: NOW });
    expect(r.state).toBe("overdue");
  });

  it("预计 120min，Deadline 前已排 120min → safe", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 120 });
    const blocks = [block("b1", "a1", 1, "19:00", "20:00"), block("b2", "a1", 2, "19:00", "20:00")];
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: blocks, now: NOW });
    expect(r.state).toBe("safe");
    expect(r.scheduledMinutesBeforeDeadline).toBe(120);
  });

  it("还缺 90min，Deadline 前只有 30min 可用 → at-risk", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000), 18, 0), estimatedMinutes: 120 });
    const blocks = [block("b1", "a1", 1, "19:00", "19:30")]; // 已排 30
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: blocks, now: NOW, availableMinutesBeforeDeadline: 30 });
    expect(r.state).toBe("at-risk");
    expect(r.reasons).toContain("insufficient_available_time");
    expect(r.unscheduledMinutes).toBe(90);
  });

  it("有足够 Free Time 但一个 Block 都没排 → unscheduled", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 });
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: [], now: NOW, availableMinutesBeforeDeadline: 300 });
    expect(r.state).toBe("unscheduled");
    expect(r.reasons).toContain("not_scheduled");
  });

  it("部分已排且 Free Time 足够 → attention", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 120 });
    const blocks = [block("b1", "a1", 1, "19:00", "19:45")];
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: blocks, now: NOW, availableMinutesBeforeDeadline: 300 });
    expect(r.state).toBe("attention");
    expect(r.reasons).toContain("partially_scheduled");
  });

  it("Deadline 后的 StudyBlock 不计入 scheduledMinutesBeforeDeadline", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000), 18, 0), estimatedMinutes: 120 });
    const blocks = [block("b1", "a1", 2, "20:00", "21:00")]; // Deadline 当天 18:00 之后
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: blocks, now: NOW });
    expect(r.scheduledMinutesBeforeDeadline).toBe(0);
  });

  it("Deadline < 24h 且未完全覆盖 → attention + deadline_soon", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW), 23, 59), estimatedMinutes: 60 }); // 今天 23:59（12h 内）
    const blocks = [block("b1", "a1", 0, "19:00", "19:30")];
    const r = deriveAssignmentHealth({ assignment: a, studyBlocks: blocks, now: NOW, availableMinutesBeforeDeadline: 300 });
    expect(r.state).toBe("attention");
    expect(r.reasons).toContain("deadline_soon");
  });
});

describe("findFreeTime", () => {
  const schedules: CourseSchedule[] = [
    { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
    { id: "s2", courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "", weeks: "单周" },
  ];
  const marks: CalendarMark[] = [
    { id: "m1", date: date(1), type: "exam", title: "测验", startTime: "14:00", endTime: "16:00" },
    { id: "m2", date: date(2), type: "activity", title: "全天活动" }, // all-day blocked
    { id: "m3", date: date(7), type: "ddl", title: "作业", sourceId: "a1" }, // DDL 不是 busy
  ];
  const blocks: StudyBlock[] = [
    block("b1", "a1", 1, "19:00", "20:00"),
  ];
  const q = (offset: number, days = 2) => {
    const start = new Date(NOW);
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0); // 非今天：完整 08:00 窗口
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return { start, end, semester: SEMESTER, currentSemesterWeek: 1, schedules, calendarMarks: marks, studyBlocks: blocks };
  };

  it("不返回课程时间（下周一 08:00-09:40 被排除）", () => {
    const slots = findFreeTime(q(7));
    expect(slots.some((s) => s.date === date(7) && s.startTime < "09:40" && s.endTime > "08:00")).toBe(false);
  });

  it("不返回 Exam / Fixed Activity（周二 14:00-16:00 被排除）", () => {
    const slots = findFreeTime(q(1));
    expect(slots.some((s) => s.date === date(1) && s.startTime < "16:00" && s.endTime > "14:00")).toBe(false);
  });

  it("不返回已有 StudyBlock（周二 19:00-20:00 被排除）", () => {
    const slots = findFreeTime(q(1));
    expect(slots.some((s) => s.date === date(1) && s.startTime < "20:00" && s.endTime > "19:00")).toBe(false);
  });

  it("all-day activity → 当天无空闲", () => {
    const slots = findFreeTime(q(2));
    expect(slots.filter((s) => s.date === date(2))).toHaveLength(0);
  });

  it("DDL mark 不是 busy（课程结束后立即有空闲）", () => {
    const slots = findFreeTime(q(7));
    expect(slots.some((s) => s.date === date(7) && s.startTime === "09:40")).toBe(true);
  });

  it("今天不返回过去时间（now 12:00 → 最早 12:00 之后，15min ceil）", () => {
    const slots = findFreeTime({ ...q(0), start: new Date(NOW) });
    const todaySlots = slots.filter((s) => s.date === date(0));
    for (const s of todaySlots) {
      expect(s.startTime >= "12:00").toBe(true);
      const sm = Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3, 5));
      expect(sm % 15).toBe(0);
    }
  });

  it("dayCap：Deadline 当天不超过截止时刻", () => {
    const slots = findFreeTime({ ...q(0), dayCapMinutesByDate: { [date(0)]: 15 * 60 } });
    for (const s of slots.filter((x) => x.date === date(0))) {
      expect(s.endTime <= "15:00").toBe(true);
    }
  });

  it("过滤 < minimumSlotMinutes 的碎片", () => {
    const slots = findFreeTime({ ...q(0), minimumSlotMinutes: 120 });
    for (const s of slots) expect(s.minutes).toBeGreaterThanOrEqual(120);
  });
});

describe("proposeStudyPlan", () => {
  const assignments: Assignment[] = [
    mk("a1", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000), 23, 59), estimatedMinutes: 90, priority: "medium" }),
    mk("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 23, 59), estimatedMinutes: 60, priority: "high" }),
    mk("a3", { estimatedMinutes: 60 }), // 无 DDL
    mk("a4", { ddl: iso(new Date(NOW.getTime() - 86400000), 23, 59), estimatedMinutes: 60 }), // overdue 不安排
  ];

  it("排序：Deadline 早优先（a2 先于 a1），无 DDL 最后，overdue 跳过", () => {
    const r = proposeStudyPlan({
      assignments, studyBlocks: [], semester: SEMESTER, currentSemesterWeek: 1,
      schedules: [], calendarMarks: [], fromDate: date(0), toDate: date(7), now: NOW,
    });
    expect(r.items.map((i) => i.assignmentId)).toEqual(["a2", "a1", "a3"]);
    expect(r.items.every((i) => i.proposedBlocks.length > 0)).toBe(true);
  });

  it("只补 estimated - existing 的缺口；现有安排计入 coverage", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 23, 59), estimatedMinutes: 120 });
    const existing = [block("b1", "a1", 1, "19:00", "19:30")]; // 30min
    const r = proposeStudyPlan({
      assignments: [a], studyBlocks: existing, semester: SEMESTER, currentSemesterWeek: 1,
      schedules: [], calendarMarks: [], fromDate: date(0), toDate: date(7), now: NOW,
    });
    const item = r.items[0];
    expect(item.scheduledMinutes).toBe(30);
    expect(item.proposedMinutes).toBe(90); // 补缺口
    expect(item.completeCoverage).toBe(true);
  });

  it("块长 30–90min，不填满所有空闲", () => {
    const r = proposeStudyPlan({
      assignments: [mk("a1", { ddl: iso(new Date(NOW.getTime() + 7 * 86400000), 23, 59), estimatedMinutes: 180 })],
      studyBlocks: [], semester: SEMESTER, currentSemesterWeek: 1,
      schedules: [], calendarMarks: [], fromDate: date(0), toDate: date(7), now: NOW,
    });
    const item = r.items[0];
    expect(item.proposedBlocks.length).toBe(2); // 90 + 90
    for (const b of item.proposedBlocks) {
      expect(b.minutes).toBeGreaterThanOrEqual(30);
      expect(b.minutes).toBeLessThanOrEqual(90);
    }
    expect(item.proposedMinutes).toBe(180);
  });

  it("Deadline 当天安排的块不超过 Deadline 时刻", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 18, 0), estimatedMinutes: 120 });
    const r = proposeStudyPlan({
      assignments: [a], studyBlocks: [], semester: SEMESTER, currentSemesterWeek: 1,
      schedules: [], calendarMarks: [], fromDate: date(0), toDate: date(1), now: NOW,
    });
    for (const b of r.items[0].proposedBlocks) {
      if (b.date === date(1)) expect(b.endTime <= "18:00").toBe(true);
    }
  });

  it("课程不可被移动：安排结果不会落在课程时间上", () => {
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "12:00", location: "", weeks: "1-16周" },
    ];
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 23, 59), estimatedMinutes: 60 });
    const r = proposeStudyPlan({
      assignments: [a], studyBlocks: [], semester: SEMESTER, currentSemesterWeek: 1,
      schedules, calendarMarks: [], fromDate: date(0), toDate: date(1), now: NOW,
    });
    for (const b of r.items[0].proposedBlocks) {
      if (b.date === date(0)) expect(b.startTime >= "12:00").toBe(true);
    }
  });
});
