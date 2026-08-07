import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { getLocalDDLDate } from "@/lib/ddl";

describe("deleteCourse 级联清理", () => {
  beforeEach(() => {
    useAppStore.getState().resetAllDataToDefault();
  });

  it("删除课程后：课程/排课/作业/关联 DDL 标记/小组项目消失，其余保留", () => {
    const before = useAppStore.getState();
    // c_4 关联：s3、s8（排课）、a1（作业，sourceId a1 的 cm1 标记）、gp_2（小组项目）
    expect(before.courses.find((c) => c.id === "c_4")).toBeTruthy();
    expect(before.schedules.filter((s) => s.courseId === "c_4")).toHaveLength(2);
    expect(before.assignments.find((a) => a.id === "a1")).toBeTruthy();
    expect(before.calendarMarks.find((m) => m.id === "cm1")).toBeTruthy();
    expect(before.groupProjects.find((g) => g.id === "gp_2")).toBeTruthy();

    useAppStore.getState().deleteCourse("c_4");

    const after = useAppStore.getState();
    expect(after.courses.find((c) => c.id === "c_4")).toBeUndefined(); // 课程消失
    expect(after.courses).toHaveLength(5); // 其余 5 门保留
    expect(after.schedules.filter((s) => s.courseId === "c_4")).toHaveLength(0); // 排课消失
    expect(after.assignments.find((a) => a.id === "a1")).toBeUndefined(); // 作业消失
    expect(after.assignments).toHaveLength(5);
    expect(after.calendarMarks.find((m) => m.id === "cm1")).toBeUndefined(); // 关联 DDL 标记消失
    expect(after.calendarMarks.find((m) => m.id === "cm2")).toBeTruthy(); // 其他课程标记保留
    expect(after.calendarMarks.find((m) => m.id === "cm3")).toBeTruthy(); // exam 保留
    expect(after.calendarMarks.find((m) => m.id === "cm4")).toBeTruthy(); // activity 保留
    expect(after.groupProjects.find((g) => g.id === "gp_2")).toBeUndefined(); // 小组项目消失
    expect(after.groupProjects.find((g) => g.id === "gp_1")).toBeTruthy(); // 其他小组项目保留
  });

  it("无 sourceId 的历史遗留 DDL 标记按 title/date 兼容删除，但 exam/activity 绝不误删", () => {
    const a1 = useAppStore.getState().assignments.find((a) => a.id === "a1")!;
    useAppStore.setState((s) => ({
      calendarMarks: [
        ...s.calendarMarks,
        { id: "legacy_title", date: "2026-05-20", type: "ddl" as const, title: a1.title },
        { id: "legacy_date", date: getLocalDDLDate(a1.ddl), type: "ddl" as const, title: "完全不同的标题" },
        { id: "legacy_exam", date: "2026-05-20", type: "exam" as const, title: a1.title },
        { id: "legacy_activity", date: getLocalDDLDate(a1.ddl), type: "activity" as const, title: "完全不同的标题" },
      ],
    }));

    useAppStore.getState().deleteCourse("c_4");

    const after = useAppStore.getState();
    expect(after.calendarMarks.find((m) => m.id === "legacy_title")).toBeUndefined(); // title 匹配删除
    expect(after.calendarMarks.find((m) => m.id === "legacy_date")).toBeUndefined(); // date 匹配删除
    expect(after.calendarMarks.find((m) => m.id === "legacy_exam")).toBeTruthy(); // exam 保留
    expect(after.calendarMarks.find((m) => m.id === "legacy_activity")).toBeTruthy(); // activity 保留
  });

  it("删除无作业关联的课程不影响任何 CalendarMark", () => {
    // c_2 没有作业与其关联（a6 属于 c_2？mockData 中 a6 courseId 为 c_2）
    const hasA6 = useAppStore.getState().assignments.some((a) => a.courseId === "c_2");
    useAppStore.getState().deleteCourse("c_2");
    const after = useAppStore.getState();
    expect(after.courses.find((c) => c.id === "c_2")).toBeUndefined();
    // 全部 calendarMarks 保留（c_2 的 a6 没有对应 sourceId 标记）
    expect(after.calendarMarks).toHaveLength(4);
    expect(hasA6).toBe(true);
    expect(after.assignments.find((a) => a.id === "a6")).toBeUndefined();
  });
});
