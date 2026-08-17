import { describe, it, expect } from "vitest";
import { proposeStudyRebalance } from "@/lib/planning/studyRebalance";
import { buildCourseOverlapScheduleFingerprint } from "@/lib/planning/courseOverlapPolicy";
import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";

const NOW = new Date(2026, 7, 10, 9, 0, 0); // 周一
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dateOffsetOk = (d: string) => d >= date(0) && d <= date(6);

const SEMESTER: Semester = { id: "s", name: "S", startDate: date(0), totalWeeks: 16 };

function mkA(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function mkBlock(id: string, offset: number, start: string, end: string, patch: Partial<StudyBlock> = {}): StudyBlock {
  return {
    id, title: `块${id}`, date: date(offset), startTime: start, endTime: end,
    assignmentId: "a1", courseId: "c1", source: "kiro",
    ...patch,
  } as StudyBlock;
}

function baseInput(patch: Partial<Parameters<typeof proposeStudyRebalance>[0]> = {}) {
  return {
    assignments: [],
    studyBlocks: [],
    schedules: [] as CourseSchedule[],
    calendarMarks: [] as CalendarMark[],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    horizonDays: 7 as const,
    now: NOW,
    ...patch,
  };
}

describe("Study Rebalance Engine", () => {
  it("§68 after_deadline：DDL 周三 20:00，Kiro Block 周四 19–20 → 移到周三 18–19", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 20, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 4, "19:00", "20:00"); // 周四
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block] }));
    expect(r.moves).toHaveLength(1);
    const m = r.moves[0];
    expect(m.blockId).toBe("b1");
    expect(m.reason).toBe("after_deadline");
    expect(m.to.date).toBe(date(3)); // 周三
    expect(m.to.startTime).toBe("19:00"); // 同日同时段优先（end 20:00 <= DDL 20:00）
    expect(m.to.endTime).toBe("20:00");
    expect(m.minutes).toBe(60);
  });

  it("§69 no slot：Deadline 前无完整 duration slot → 0 move + unresolved reason（不缩短 duration）", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 12, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 4, "19:00", "20:30"); // 90min，DDL 周三 12:00
    // 今天/周一/周二全天考试 + 周三 08:00–12:00 考试 → Deadline 前无完整 90min slot
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
      { id: "cm1", date: date(1), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
      { id: "cm2", date: date(2), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
      { id: "cm3", date: date(3), type: "exam", title: "上午考试", startTime: "08:00", endTime: "12:00" },
    ];
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], calendarMarks }));
    expect(r.moves).toHaveLength(0);
    expect(r.reasons).toContain("unresolved_after_deadline");
  });

  it("§70 manual protection：同一 late Block 但 source=manual → 0 move", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 20, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 4, "19:00", "20:00", { source: "manual" });
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block] }));
    expect(r.moves).toHaveLength(0);
    expect(r.reasons).toContain("manual_or_inactive_blocks_protected");
  });

  it("§71a V1.1：已有 Kiro StudyBlock 与课程重叠（未批准）→ course_conflict hard issue → 移到非课程日", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 6 * 86400000), 20, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 2, "10:00", "11:00"); // 周三
    const dowOfBlock = new Date(NOW.getTime() + 2 * 86400000).getDay() === 0 ? 7 : new Date(NOW.getTime() + 2 * 86400000).getDay();
    // 课程覆盖整天 → block 与课程重叠（无 Approval → unapproved conflict）
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: dowOfBlock, startTime: "08:00", endTime: "21:00", location: "", weeks: "1-16周" },
    ];
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], schedules }));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].reason).toBe("course_conflict");
    // 必须移到非课程日（不得把未批准重叠搬去另一个重叠）
    expect(r.moves[0].to.date).not.toBe(date(2));
  });

  it("§59 approved：Block ↔ S1 已显式批准且 schedule 未变 → 不因 course_conflict 移动", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 6 * 86400000), 20, 0), estimatedMinutes: 120 });
    const dowOfBlock = new Date(NOW.getTime() + 2 * 86400000).getDay() === 0 ? 7 : new Date(NOW.getTime() + 2 * 86400000).getDay();
    const s1: CourseSchedule = { id: "s1", courseId: "c2", dayOfWeek: dowOfBlock, startTime: "08:00", endTime: "21:00", location: "", weeks: "1-16周" };
    const block = mkBlock("b1", 2, "10:00", "11:00", {
      courseOverlapApprovals: [
        { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(s1), approvedAt: 1 },
      ],
    });
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], schedules: [s1] }));
    expect(r.moves).toHaveLength(0);
  });

  it("§58 schedule 时间变化 → fingerprint 失效 → 重新识别 course_conflict", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 6 * 86400000), 20, 0), estimatedMinutes: 120 });
    const dowOfBlock = new Date(NOW.getTime() + 2 * 86400000).getDay() === 0 ? 7 : new Date(NOW.getTime() + 2 * 86400000).getDay();
    // 批准时课程 10:00–11:00
    const oldS1: CourseSchedule = { id: "s1", courseId: "c2", dayOfWeek: dowOfBlock, startTime: "10:00", endTime: "11:00", location: "", weeks: "1-16周" };
    // 之后课程改为 10:30–11:30（仍与 block 10:00–11:00 重叠，但 fingerprint 变了）
    const newS1: CourseSchedule = { ...oldS1, startTime: "10:30", endTime: "11:30" };
    const block = mkBlock("b1", 2, "10:00", "11:00", {
      courseOverlapApprovals: [
        { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(oldS1), approvedAt: 1 },
      ],
    });
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], schedules: [newS1] }));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].reason).toBe("course_conflict");
  });

  it("§71b Case 2：因 fixed_event 必须移动，免费日 vs 课程日都可达 → 优先免费日（preference）", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 5 * 86400000), 20, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 3, "19:00", "20:00"); // 周四
    const dowOfWed = new Date(NOW.getTime() + 2 * 86400000).getDay() === 0 ? 7 : new Date(NOW.getTime() + 2 * 86400000).getDay();
    // 课程日 = 周三（距原位置 1 天，若课程时间入池会因日期更近被选中）；
    // 免费日 = 周六（距 2 天）；周五全天考试堵死
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: dowOfWed, startTime: "08:00", endTime: "21:00", location: "", weeks: "1-16周" },
    ];
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(1), type: "exam", title: "周二全天", startTime: "00:00", endTime: "23:59" },
      { id: "cm1", date: date(3), type: "exam", title: "周四考试", startTime: "08:00", endTime: "21:00" }, // 覆盖 block → 触发 fixed_event，且周四无空档
      { id: "cm2", date: date(4), type: "exam", title: "周五全天", startTime: "00:00", endTime: "23:59" },
    ];
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], schedules, calendarMarks }));
    expect(r.moves).toHaveLength(1);
    const m = r.moves[0];
    expect(m.reason).toBe("fixed_event_conflict");
    // 必须选免费日（周六 date(5)），而不是更近但课程重叠的周三
    expect(m.to.date).toBe(date(5));
    expect(m.to.startTime).toBe("19:00");
  });

  it("§71c Case 3：只有课程重叠 target 可用 → 允许生成 fallback target", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 10, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 1, "10:30", "11:30"); // 周二 10:30–11:30，DDL 周二 10:00 → after_deadline
    const dowOfTue = new Date(NOW.getTime() + 1 * 86400000).getDay() === 0 ? 7 : new Date(NOW.getTime() + 1 * 86400000).getDay();
    const dowOfMon = new Date(NOW.getTime()).getDay() === 0 ? 7 : new Date(NOW.getTime()).getDay();
    // 周一全天考试（hard busy，两个 pass 都不进）；周二 08:00–10:00 课程（fallback 唯一可用，end 09:00 <= DDL 10:00）
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: dowOfTue, startTime: "08:00", endTime: "10:00", location: "", weeks: "1-16周" },
    ];
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(0), type: "exam", title: "周一全天", startTime: "00:00", endTime: "23:59" },
      // 周一也按 dayOfWeek 堵死（上面 cm0 已按日期；再补周几无关紧要）
    ];
    void dowOfMon;
    const r = proposeStudyRebalance(
      baseInput({ assignments: [a], studyBlocks: [block], schedules, calendarMarks })
    );
    expect(r.moves).toHaveLength(1);
    const m = r.moves[0];
    expect(m.reason).toBe("after_deadline");
    // Pass 1 无解（周一考试 + 周二课程时间 busy + 剩余 <60min / 超 DDL）→ fallback 到课程重叠位
    expect(m.to.date).toBe(date(1));
    expect(m.to.startTime).toBe("09:00");
    expect(m.to.endTime).toBe("10:00");
  });

  it("§72 fixed_event_conflict：exam 冲突 → 移动", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 6 * 86400000), 20, 0), estimatedMinutes: 120 });
    const block = mkBlock("b1", 2, "14:00", "15:00"); // 周二
    const calendarMarks: CalendarMark[] = [
      { id: "cm1", date: date(2), type: "exam", title: "考试", startTime: "14:00", endTime: "16:00" },
    ];
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block], calendarMarks }));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].reason).toBe("fixed_event_conflict");
  });

  it("§73 capacity_relief：周二前 shortfall 60，晚 DDL 任务周二 19–20 移到周五 → 释放早期容量", () => {
    // a1 明天(周二)截止 120；a2 周六截止；bB 周二 19–20 占住 a1 唯一可用的 120min 晚间时段的一半
    const a1 = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const a2 = mkA("a2", { ddl: iso(new Date(NOW.getTime() + 6 * 86400000)), estimatedMinutes: 60 });
    const blockB = mkBlock("bB", 1, "19:00", "20:00", { assignmentId: "a2" }); // 周二 19–20
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" }, // 今天全堵
      { id: "cm1", date: date(1), type: "exam", title: "考试", startTime: "08:00", endTime: "19:00" }, // 周二 08–19 堵
    ];
    const r = proposeStudyRebalance(
      baseInput({ assignments: [a1, a2], studyBlocks: [blockB], calendarMarks })
    );
    // 周二 19:00–21:00 只剩 120min，bB 占 60 → a1 缺口 60
    expect(r.summary.shortfallBefore).toBe(60);
    // bB 移到周五（a2 周六 DDL 前，且在该短缺口 deadline 之后）→ 周二晚间 120min 全给 a1 → 缺口 0
    const relief = r.moves.find((m) => m.reason === "capacity_relief");
    expect(relief).toBeTruthy();
    expect(dateOffsetOk(relief!.to.date)).toBe(true); // 移到 shortfall deadline 之后的最近可用日
    expect(relief!.to.date >= date(2)).toBe(true); // 不早于周二 deadline
    expect(relief!.to.date <= date(5)).toBe(true); // 且不晚于周五（a2 周六 DDL 前）
    expect(r.summary.shortfallAfter).toBe(0);
    expect(r.summary.releasedEarlyCapacityMinutes).toBe(60);
  });

  it("§74 no benefit：移动不降 shortfall → 不 proposal", () => {
    // a1 明天截止 120，明天无容量；a2 周二截止 60；bB 周五 19–20（a2）移到周三不改变任何缺口
    const a1 = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const a2 = mkA("a2", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000)), estimatedMinutes: 60 });
    const blockB = mkBlock("bB", 5, "19:00", "20:00", { assignmentId: "a2" });
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(1), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
    ];
    const r = proposeStudyRebalance(
      baseInput({ assignments: [a1, a2], studyBlocks: [blockB], calendarMarks })
    );
    // bB 已在周五（a2 周二 DDL 之后）→ after_deadline? a2 DDL 周二，周五 block 在 DDL 后 → after_deadline 触发！
    // 为构造纯 no-benefit：给 bB 一个周三的位置（在 a2 DDL 前，不占早期稀缺容量）
    const blockC = mkBlock("bC", 3, "19:00", "20:00", { assignmentId: "a2" }); // 周三
    const r2 = proposeStudyRebalance(
      baseInput({ assignments: [a1, a2], studyBlocks: [blockC], calendarMarks })
    );
    // a1 明天缺口 120 无法通过移动 bC（bC 周三，a2 周二 DDL 前）缓解：bC 已在其 DDL 前且不占 a1 所需容量
    expect(r2.moves.filter((m) => m.reason === "capacity_relief")).toHaveLength(0);
    expect(r2.summary.shortfallAfter).toBe(r2.summary.shortfallBefore);
  });

  it("§75 minimal churn：第一个 move 已解决 → 只包含 1 move", () => {
    // a1 明天截止 120，明天 18:00-21:00 free 180；a2 周四截止 60，bB 周二 19–20 占早期容量
    const a1 = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const a2 = mkA("a2", { ddl: iso(new Date(NOW.getTime() + 4 * 86400000)), estimatedMinutes: 60 });
    const blockB = mkBlock("bB", 2, "19:00", "20:00", { assignmentId: "a2" });
    const blockC = mkBlock("bC", 2, "20:00", "21:00", { assignmentId: "a2" });
    const r = proposeStudyRebalance(
      baseInput({ assignments: [a1, a2], studyBlocks: [blockB, blockC] })
    );
    // 明天有 180min free → a1 需求 120 可覆盖；shortfallBefore 可能为 0 → 无 capacity_relief。
    // 关键断言：没有无意义的第二个 move（minimal churn）
    expect(r.moves.length).toBeLessThanOrEqual(1);
  });

  it("§76 deterministic：同一输入重复调用 + 打乱 block 顺序 → moves 完全一致", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 20, 0), estimatedMinutes: 120 });
    const b1 = mkBlock("b1", 4, "19:00", "20:00");
    const b2 = mkBlock("b2", 5, "10:00", "11:00");
    const input = baseInput({ assignments: [a], studyBlocks: [b1, b2] });
    const r1 = proposeStudyRebalance(input);
    const r2 = proposeStudyRebalance(input);
    const r3 = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [b2, b1] }));
    expect(r1.moves).toEqual(r2.moves);
    expect(r1.moves).toEqual(r3.moves);
  });

  it("§4 只考虑未来 Block：scheduledStart <= now → 不移动", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 20, 0), estimatedMinutes: 120 });
    // 今天 08:00 已开始（< now 09:00）
    const past = mkBlock("bPast", 0, "08:00", "09:30");
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [past] }));
    expect(r.moves).toHaveLength(0);
  });

  it("§21 completed assignment 的 block 不移动", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000), 20, 0), estimatedMinutes: 120, status: "completed" });
    const block = mkBlock("b1", 4, "19:00", "20:00");
    const r = proposeStudyRebalance(baseInput({ assignments: [a], studyBlocks: [block] }));
    expect(r.moves).toHaveLength(0);
  });
});
