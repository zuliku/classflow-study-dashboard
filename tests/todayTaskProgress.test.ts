import { describe, it, expect } from "vitest";
import { getTodayTaskProgress } from "@/lib/tasks/todayTaskProgress";
import type { Assignment } from "@/types";

/** Workflow UX Sidebar Productization V2.2 —— 今日任务进度（纯函数口径锁定） */

const TODAY = new Date("2026-03-10T12:00:00");

const mk = (over: Partial<Assignment>): Assignment =>
  ({ id: "a", courseId: "c1", title: "t", description: "", priority: "medium", status: "todo", progress: 0, tags: [], ...over }) as Assignment;

describe("getTodayTaskProgress", () => {
  it("今日 todo → total+1 / done 0", () => {
    const p = getTodayTaskProgress([mk({ ddl: "2026-03-10T23:59:00" })], TODAY);
    expect(p).toEqual({ total: 1, done: 0, percentage: 0 });
  });

  it("今日 doing → total+1 / done 0（progress=100 不额外计 done）", () => {
    const p = getTodayTaskProgress([mk({ ddl: "2026-03-10T23:59:00", status: "doing", progress: 100 })], TODAY);
    expect(p).toEqual({ total: 1, done: 0, percentage: 0 });
  });

  it.each([
    ["submitted"],
    ["completed"],
  ] as const)("今日 %s → total+1 / done+1", (status) => {
    const p = getTodayTaskProgress([mk({ ddl: "2026-03-10T23:59:00", status })], TODAY);
    expect(p).toEqual({ total: 1, done: 1, percentage: 100 });
  });

  it("明天任务不计入", () => {
    expect(getTodayTaskProgress([mk({ ddl: "2026-03-11T23:59:00" })], TODAY).total).toBe(0);
  });

  it("无 DDL 不计入", () => {
    expect(getTodayTaskProgress([mk({})], TODAY).total).toBe(0);
  });

  it("invalid DDL 不计入（不 throw）", () => {
    expect(getTodayTaskProgress([mk({ ddl: "not-a-date" })], TODAY).total).toBe(0);
  });

  it("denominator 稳定：5 个今日任务完成 2 → 2/5 = 40%", () => {
    const assignments = [
      mk({ id: "1", ddl: "2026-03-10T09:00:00", status: "completed" }),
      mk({ id: "2", ddl: "2026-03-10T10:00:00", status: "submitted" }),
      mk({ id: "3", ddl: "2026-03-10T18:00:00" }),
      mk({ id: "4", ddl: "2026-03-10T19:00:00" }),
      mk({ id: "5", ddl: "2026-03-10T20:00:00" }),
    ];
    expect(getTodayTaskProgress(assignments, TODAY)).toEqual({
      total: 5,
      done: 2,
      percentage: 40,
    });
  });

  it("total=0 → percentage=0（geometry 稳定，显示 0 / 0 项）", () => {
    expect(getTodayTaskProgress([], TODAY)).toEqual({ total: 0, done: 0, percentage: 0 });
  });
});
