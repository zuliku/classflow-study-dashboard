import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { CourseSchedule, Material } from "@/types";

describe("删除撤销（Undo）", () => {
  beforeEach(() => {
    useAppStore.getState().resetAllDataToDefault();
  });

  it("删除任务返回被删任务与 DDL 标记，撤销后按原 ID 与字段恢复", () => {
    const before = useAppStore.getState();
    const a1 = before.assignments.find((a) => a.id === "a1")!;
    const cm1 = before.calendarMarks.find((m) => m.id === "cm1")!;
    expect(cm1.sourceId).toBe("a1");

    // 删除（并额外注入一条无 sourceId 的兼容标记验证一并删除）
    useAppStore.setState((s) => ({
      calendarMarks: [
        ...s.calendarMarks,
        { id: "legacy_cm", date: "2026-05-20", type: "ddl" as const, title: a1.title },
      ],
    }));
    const removed = useAppStore.getState().deleteAssignment("a1");
    expect(removed).not.toBeNull();
    expect(removed!.assignment.id).toBe("a1");

    const afterDelete = useAppStore.getState();
    expect(afterDelete.assignments.find((a) => a.id === "a1")).toBeUndefined();
    expect(afterDelete.calendarMarks.find((m) => m.id === "cm1")).toBeUndefined();
    expect(afterDelete.calendarMarks.find((m) => m.id === "legacy_cm")).toBeUndefined();

    // 撤销：恢复任务与标记（不创建新 ID）
    useAppStore.getState().restoreAssignment(removed!.assignment, removed!.marks);
    const after = useAppStore.getState();
    const restored = after.assignments.find((a) => a.id === "a1")!;
    expect(restored).toEqual(a1);
    expect(restored.id).toBe("a1");
    expect(restored.courseId).toBe(a1.courseId);
    expect(restored.ddl).toBe(a1.ddl);
    expect(restored.progress).toBe(a1.progress);
    expect(restored.status).toBe(a1.status);
    expect(restored.subtasks).toEqual(a1.subtasks);
    expect(after.calendarMarks.find((m) => m.id === "cm1")).toEqual(cm1);
    // 兼容标记也恢复（删除时记录了它）
    expect(after.calendarMarks.find((m) => m.id === "legacy_cm")).toBeTruthy();
    // 不重复
    expect(after.calendarMarks.filter((m) => m.id === "cm1")).toHaveLength(1);
  });

  it("删除不存在任务返回 null", () => {
    expect(useAppStore.getState().deleteAssignment("nope")).toBeNull();
  });

  it("删除时段返回原时段，撤销后按原 ID 恢复且不影响其他时段", () => {
    const before = useAppStore.getState();
    const s1 = before.schedules.find((s) => s.id === "s1")!;

    const removed = useAppStore.getState().deleteSchedule("s1");
    expect(removed).toEqual(s1);
    expect(useAppStore.getState().schedules.find((s) => s.id === "s1")).toBeUndefined();

    useAppStore.getState().restoreSchedule(removed!);
    const after = useAppStore.getState();
    expect(after.schedules.find((s) => s.id === "s1")).toEqual(s1);
    expect(after.schedules).toHaveLength(12);
    expect(after.schedules.filter((s) => s.id === "s1")).toHaveLength(1);
  });

  it("删除资料仅移除 metadata，可恢复；重复撤销不产生重复条目", () => {
    const mat: Material = {
      id: "m_test",
      title: "测试.pdf",
      type: "pdf",
      size: "1 MB",
      uploadDate: "2026-08-01",
      storageKey: "file_test",
    };
    useAppStore.setState((s) => ({
      courses: s.courses.map((c) =>
        c.id === "c_1" ? { ...c, materials: [...c.materials, mat] } : c
      ),
    }));

    const removed = useAppStore.getState().deleteCourseMaterial("c_1", "m_test");
    expect(removed).toEqual(mat);
    expect(useAppStore.getState().courses.find((c) => c.id === "c_1")!.materials).toHaveLength(2);

    useAppStore.getState().restoreCourseMaterial("c_1", removed!);
    const restored = useAppStore.getState().courses.find((c) => c.id === "c_1")!.materials;
    expect(restored).toHaveLength(3);
    expect(restored.find((m) => m.id === "m_test")).toEqual(mat);

    // 重复恢复不产生重复
    useAppStore.getState().restoreCourseMaterial("c_1", removed!);
    expect(useAppStore.getState().courses.find((c) => c.id === "c_1")!.materials).toHaveLength(3);
  });

  it("删除课程级联不受 undo 影响（课程删除不进入撤销）", () => {
    const before = useAppStore.getState();
    useAppStore.getState().deleteCourse("c_4");
    const after = useAppStore.getState();
    expect(after.courses.find((c) => c.id === "c_4")).toBeUndefined();
    expect(after.calendarMarks.find((m) => m.id === "cm1")).toBeUndefined();
    expect(after.courses).toHaveLength(before.courses.length - 1);
  });
});
