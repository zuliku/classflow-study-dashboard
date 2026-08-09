import { describe, it, expect } from "vitest";
import { timeToMinutes, timeToDayRatio, intervalToDayGeometry } from "@/lib/timeline/timelineGeometry";
import { deriveTimelineItems, deriveUnscheduledAssignments } from "@/lib/timeline/deriveTimelineItems";
import { studyBlockConflict } from "@/components/timeline/TimelineWorkspace";

describe("timelineGeometry（真正的时间轴）", () => {
  it("06:00 → 25%；12:00 → 50%；18:00 → 75%；23:59 接近 100%", () => {
    expect(timeToDayRatio("06:00")).toBeCloseTo(0.25, 4);
    expect(timeToDayRatio("12:00")).toBeCloseTo(0.5, 4);
    expect(timeToDayRatio("18:00")).toBeCloseTo(0.75, 4);
    expect(timeToDayRatio("23:59")).toBeCloseTo(1439 / 1440, 4);
  });

  it("Case 4：14:00–16:00 → left≈58.3%，width≈8.3%", () => {
    const g = intervalToDayGeometry("14:00", "16:00");
    expect(g.leftRatio).toBeCloseTo(14 / 24, 4);
    expect(g.widthRatio).toBeCloseTo(2 / 24, 4);
  });

  it("Case 5：上午 08:00–10:00 明显位于当天较左侧", () => {
    const g = intervalToDayGeometry("08:00", "10:00");
    expect(g.leftRatio).toBeCloseTo(1 / 3, 4);
    expect(g.widthRatio).toBeCloseTo(2 / 24, 4);
  });

  it("非法时间 → 0；缺结束时间 → 30 分钟点状区块（不伪造长时段）", () => {
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToDayRatio("bad")).toBe(0);
    const g = intervalToDayGeometry("14:00");
    expect(g.widthRatio).toBeCloseTo(30 / 1440, 4);
  });
});

describe("deriveTimelineItems（Projection + DDL 去重）", () => {
  const weekDates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];

  it("Case 8：Assignment DDL + 对应 CalendarMark（sourceId 匹配）只显示一个 DDL", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [{ id: "a1", courseId: "c1", title: "计量作业", description: "", ddl: "2026-08-12T23:59:00", priority: "high", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [{ id: "m1", date: "2026-08-12", type: "ddl", title: "计量作业", sourceId: "a1" }],
      groupProjects: [],
      studyBlocks: [],
    });
    const ddls = items.filter((it) => it.sourceType === "assignment");
    expect(ddls).toHaveLength(1);
    expect(ddls[0].date).toBe("2026-08-12");
    expect(ddls[0].startTime).toBe("23:59");
  });

  it("Case 2：DDL 23:59 时间保留（Key Lane 按 24h 比例定位到列最右端）", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [{ id: "a1", courseId: "c1", title: "作业", description: "", ddl: "2026-08-12T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [],
    });
    expect(items[0].startTime).toBe("23:59");
    expect(timeToDayRatio(items[0].startTime)).toBeCloseTo(1439 / 1440, 4);
  });

  it("Case 3：DDL 12:00 → 50%", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [{ id: "a1", courseId: "c1", title: "作业", description: "", ddl: "2026-08-12T12:00:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [],
    });
    expect(timeToDayRatio(items[0].startTime)).toBeCloseTo(0.5, 4);
  });

  it("Case 7：只有日期的 Activity（无 startTime）→ all-day，不伪造时间", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [],
      calendarMarks: [{ id: "m2", date: "2026-08-13", type: "activity", title: "校园活动" }],
      groupProjects: [],
      studyBlocks: [],
    });
    expect(items[0].temporalType).toBe("all-day");
    expect(items[0].startTime).toBeUndefined();
  });

  it("Case 5/6：带时间的 Exam → interval（几何由 timelineGeometry 统一计算）", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [],
      calendarMarks: [{ id: "m3", date: "2026-08-13", type: "exam", title: "期中考试", startTime: "14:00", endTime: "16:00" }],
      groupProjects: [],
      studyBlocks: [],
    });
    expect(items[0].temporalType).toBe("interval");
    const g = intervalToDayGeometry(items[0].startTime, items[0].endTime);
    expect(g.leftRatio).toBeCloseTo(14 / 24, 4);
    expect(g.widthRatio).toBeCloseTo(2 / 24, 4);
  });

  it("小组任务 DDL 进入时间轴（group-task sourceType）", () => {
    const items = deriveTimelineItems({
      weekDates,
      assignments: [],
      calendarMarks: [],
      groupProjects: [{ id: "gp1", courseId: "c1", title: "项目", description: "", progress: 0, updatedAt: "", members: [], tasks: [{ id: "t1", title: "数据收集", ddl: "2026-08-14T20:00:00", completed: false }] }],
      studyBlocks: [],
    });
    expect(items[0].sourceType).toBe("group-task");
    expect(items[0].startTime).toBe("20:00");
  });
});

describe("deriveUnscheduledAssignments + studyBlockConflict", () => {
  it("已完成或已安排的任务不进待安排", () => {
    const out = deriveUnscheduledAssignments({
      assignments: [
        { id: "a1", courseId: "c1", title: "待安排", description: "", ddl: "2026-08-12T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
        { id: "a2", courseId: "c1", title: "已安排", description: "", ddl: "2026-08-12T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
        { id: "a3", courseId: "c1", title: "已完成", description: "", ddl: "2026-08-12T23:59:00", priority: "medium", status: "completed", progress: 100, tags: [] },
      ],
      studyBlocks: [{ id: "sb1", title: "已安排", date: "2026-08-12", startTime: "19:00", endTime: "20:00", assignmentId: "a2", source: "manual" }],
    });
    expect(out.map((a) => a.id)).toEqual(["a1"]);
  });

  it("Case 9/29：StudyBlock 与课程时间重叠 → 拒绝；与另一 StudyBlock 重叠 → 拒绝", () => {
    const state = {
      schedules: [{ id: "s1", courseId: "c1", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", weeks: "1-16周" }],
      studyBlocks: [{ id: "sb9", title: "已有计划", date: "2026-08-12", startTime: "19:00", endTime: "20:00", source: "manual" }],
      currentSemesterWeek: 1,
    };
    expect(studyBlockConflict({ date: "2026-08-12", startTime: "10:30", endTime: "11:30" }, state)).toEqual({ courseName: expect.stringContaining("课程时间重叠") });
    expect(studyBlockConflict({ date: "2026-08-12", startTime: "19:30", endTime: "20:30" }, state)).toEqual({ otherTitle: expect.stringContaining("学习计划") });
    expect(studyBlockConflict({ date: "2026-08-12", startTime: "14:00", endTime: "15:00" }, state)).toBeNull();
  });
});
