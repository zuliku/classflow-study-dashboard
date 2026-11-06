import { describe, it, expect } from "vitest";
import { Assignment } from "@/types";
import {
  academicDoneAt,
  getTaskDeadlineInstant,
  isAcademicDoneOnTime,
  isActiveTask,
  isClosedTask,
  isDoToday,
  isDueSoon,
  isDueToday,
  isTaskOverdue,
  isWaitingTask,
  localDateKey,
} from "@/lib/tasks/taskLifecycle";

const NOW = new Date(2026, 10, 6, 15, 0, 0); // 2026-11-06 15:00 本地

function mk(patch: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "任务",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

describe("taskLifecycle", () => {
  it("active = todo/doing；submitted/completed = closed", () => {
    expect(isActiveTask(mk({ status: "todo" }))).toBe(true);
    expect(isActiveTask(mk({ status: "doing" }))).toBe(true);
    expect(isWaitingTask(mk({ status: "submitted" }))).toBe(true);
    expect(isClosedTask(mk({ status: "submitted" }))).toBe(true);
    expect(isClosedTask(mk({ status: "completed" }))).toBe(true);
    expect(isActiveTask(mk({ status: "completed" }))).toBe(false);
  });

  it("今天 09:00 截止、现在 15:00 → overdue，同时 dueToday", () => {
    const a = mk({ ddl: "2026-11-06T09:00:00" });
    expect(isTaskOverdue(a, NOW)).toBe(true);
    expect(isDueToday(a, NOW)).toBe(true);
    expect(isDueSoon(a, NOW, 3)).toBe(false);
  });

  it("今天 23:59 截止 → 不 overdue；明天/3 天内 dueSoon", () => {
    expect(isTaskOverdue(mk({ ddl: "2026-11-06T23:59:00" }), NOW)).toBe(false);
    expect(isDueSoon(mk({ ddl: "2026-11-07T23:59:00" }), NOW, 3)).toBe(true);
    expect(isDueSoon(mk({ ddl: "2026-11-09T23:59:00" }), NOW, 3)).toBe(true);
    expect(isDueSoon(mk({ ddl: "2026-11-10T23:59:00" }), NOW, 3)).toBe(false);
  });

  it("旧数据只有日期 → 按当天 23:59 解释，不在午夜误判逾期", () => {
    const a = mk({ ddl: "2026-11-06" });
    expect(localDateKey(getTaskDeadlineInstant(a)!)).toBe("2026-11-06");
    expect(isTaskOverdue(a, NOW)).toBe(false);
    expect(isTaskOverdue(a, new Date(2026, 10, 7, 0, 1, 0))).toBe(true);
  });

  it("submitted/completed 永不 overdue，也不在 dueToday", () => {
    for (const status of ["submitted", "completed"] as const) {
      const a = mk({ status, ddl: "2026-11-05T09:00:00" });
      expect(isTaskOverdue(a, NOW)).toBe(false);
      expect(isDueToday(a, NOW)).toBe(false);
    }
  });

  it("doDate 只对 active 生效", () => {
    expect(isDoToday(mk({ doDate: "2026-11-06" }), NOW)).toBe(true);
    expect(isDoToday(mk({ doDate: "2026-11-06", status: "submitted" }), NOW)).toBe(false);
    expect(isDoToday(mk({ doDate: "2026-11-07" }), NOW)).toBe(false);
  });

  it("academicDoneAt 优先 submittedAt；on-time 用学术完成时间", () => {
    const a = mk({
      ddl: "2026-11-06T10:00:00",
      submittedAt: "2026-11-06T09:00:00",
      completedAt: "2026-11-06T11:00:00",
    });
    expect(academicDoneAt(a)).toBe("2026-11-06T09:00:00");
    expect(isAcademicDoneOnTime(a)).toBe(true);

    const late = { ...a, submittedAt: "2026-11-06T10:01:00" };
    expect(isAcademicDoneOnTime(late)).toBe(false);

    expect(isAcademicDoneOnTime(mk({ ddl: "2026-11-06T10:00:00" }))).toBeNull();
    expect(isAcademicDoneOnTime(mk({ submittedAt: "2026-11-06T09:00:00" }))).toBeNull();
  });
});
