import { describe, it, expect } from "vitest";
import { resolveStartupTab } from "@/lib/startup";
import { getNewTaskDefaults } from "@/lib/taskDefaults";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { NavTab } from "@/types";

describe("resolveStartupTab（启动位置解析，纯函数）", () => {
  it("overview → 总览（默认）", () => {
    expect(resolveStartupTab("overview", "assignments")).toBe("overview");
  });

  it("timetable → 课表；assignments → 任务", () => {
    expect(resolveStartupTab("timetable", "overview")).toBe("timetable");
    expect(resolveStartupTab("assignments", "overview")).toBe("assignments");
  });

  it("last → 上次使用的工作区", () => {
    expect(resolveStartupTab("last", "courses")).toBe("courses");
    expect(resolveStartupTab("last", "analytics")).toBe("analytics");
    // 未记录过时回落 overview
    expect(resolveStartupTab("last", "overview")).toBe("overview");
  });

  it("任何输入都返回合法 NavTab", () => {
    const tabs: string[] = ["overview", "timetable", "assignments", "courses", "analytics", "group"];
    for (const v of ["overview", "timetable", "assignments", "last"] as const) {
      for (const last of tabs) {
        expect(tabs).toContain(resolveStartupTab(v, last as NavTab));
      }
    }
  });
});

describe("getNewTaskDefaults（新建任务默认值，编辑已有任务不使用）", () => {
  it("默认偏好 → 中优先级 / 待完成 / 23:59", () => {
    expect(getNewTaskDefaults(DEFAULT_PREFERENCES)).toEqual({
      priority: "medium",
      status: "todo",
      ddlTime: "23:59",
    });
  });

  it("自定义偏好 → 高优先级 / 进行中 / 21:00", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      defaultTaskPriority: "high" as const,
      defaultTaskStatus: "doing" as const,
      defaultDDLTime: "21:00",
    };
    expect(getNewTaskDefaults(prefs)).toEqual({
      priority: "high",
      status: "doing",
      ddlTime: "21:00",
    });
  });
});
