import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_PREFERENCES, sanitizePreferences } from "@/lib/preferences";
import { getLocalDDLDate } from "@/lib/ddl";

const KEY = "classflow-storage-v2";

/** 合法偏好 */
const validPrefs = {
  showWeekends: false,
  ddlWarningDays: 7,
  defaultDDLTime: "21:30",
  enableScheduleDirectManipulation: false,
  enableDDLDirectManipulation: true,
  motionPreference: "reduced",
};

describe("sanitizePreferences 逐字段回落", () => {
  it("缺失 → 全部默认值", () => {
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences("garbage")).toEqual(DEFAULT_PREFERENCES);
  });

  it("partial → 缺失字段回落默认，存在字段保留", () => {
    const out = sanitizePreferences({ ddlWarningDays: 7 });
    expect(out.ddlWarningDays).toBe(7);
    expect(out.showWeekends).toBe(DEFAULT_PREFERENCES.showWeekends);
    expect(out.motionPreference).toBe(DEFAULT_PREFERENCES.motionPreference);
  });

  it("invalid ddlWarningDays=4 → 回落 3", () => {
    expect(sanitizePreferences({ ddlWarningDays: 4 }).ddlWarningDays).toBe(3);
    expect(sanitizePreferences({ ddlWarningDays: "3" }).ddlWarningDays).toBe(3);
  });

  it("invalid defaultDDLTime → 回落 23:59", () => {
    expect(sanitizePreferences({ defaultDDLTime: "25:99" }).defaultDDLTime).toBe("23:59");
    expect(sanitizePreferences({ defaultDDLTime: "9:30" }).defaultDDLTime).toBe("23:59");
    expect(sanitizePreferences({ defaultDDLTime: "09:30" }).defaultDDLTime).toBe("09:30");
  });

  it("invalid motionPreference → 回落 system", () => {
    expect(sanitizePreferences({ motionPreference: "hello" }).motionPreference).toBe("system");
    expect(sanitizePreferences({ motionPreference: "full" }).motionPreference).toBe("full");
  });

  it("非布尔字段 → 回落默认", () => {
    expect(sanitizePreferences({ showWeekends: "yes" }).showWeekends).toBe(true);
    expect(sanitizePreferences({ enableScheduleDirectManipulation: 1 }).enableScheduleDirectManipulation).toBe(true);
  });
});

describe("AppPreferences store 集成", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    return mod.useAppStore;
  }

  it("默认 preferences 正确", async () => {
    const store = await freshStore();
    expect(store.getState().preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it("updatePreferences partial merge（immutable，其他字段不变）", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ ddlWarningDays: 7 });
    const after = store.getState().preferences;
    expect(after.ddlWarningDays).toBe(7);
    expect(after.showWeekends).toBe(DEFAULT_PREFERENCES.showWeekends);
    expect(after.defaultDDLTime).toBe(DEFAULT_PREFERENCES.defaultDDLTime);
  });

  it("updatePreferences 非法值被 sanitize 拦截", async () => {
    const store = await freshStore();
    // @ts-expect-error 测试非法输入不被类型系统拦住的运行时行为
    store.getState().updatePreferences({ ddlWarningDays: 4, motionPreference: "hello" });
    expect(store.getState().preferences.ddlWarningDays).toBe(3);
    expect(store.getState().preferences.motionPreference).toBe("system");
  });

  it("persist round-trip：刷新后 preferences 保持", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ motionPreference: "reduced", defaultDDLTime: "21:30" });
    // 触发 persist 写入
    await new Promise((r) => setTimeout(r, 10));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.version).toBe(3);
    expect(raw.state.preferences.motionPreference).toBe("reduced");

    // 重新加载 store（模拟刷新）
    const reloaded = await freshStore();
    expect(reloaded.getState().preferences.motionPreference).toBe("reduced");
    expect(reloaded.getState().preferences.defaultDDLTime).toBe("21:30");
  });

  it("旧版本（v0/v2 无 preferences）迁移自动补默认值，业务数据完整保留", async () => {
    const legacy = {
      version: 2,
      state: {
        userProfile: { name: "旧用户", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
        semester: { id: "sem_old", name: "旧学期", startDate: "2026-02-23", totalWeeks: 16 },
        courses: [{ id: "c_keep_1", name: "保留课程", code: "K-01", teacher: "老师", classroom: "教一", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
        schedules: [{ id: "s_keep_1", courseId: "c_keep_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教一", weeks: "1-16周" }],
        assignments: [{ id: "a_keep_1", courseId: "c_keep_1", title: "保留任务", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
        calendarMarks: [{ id: "cm_keep_1", date: "2026-08-10", type: "ddl", title: "保留任务" }],
        groupProjects: [],
        assignmentTimeSlice: "7days",
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));

    const store = await freshStore();
    const s = store.getState();
    // preferences 自动补默认值
    expect(s.preferences).toEqual(DEFAULT_PREFERENCES);
    // legacy 业务数据完整保留
    expect(s.courses.map((c) => c.id)).toEqual(["c_keep_1"]);
    expect(s.assignments.map((a) => a.id)).toEqual(["a_keep_1"]);
    expect(s.calendarMarks.map((m) => m.id)).toEqual(["cm_keep_1"]);
    expect(s.userProfile.name).toBe("旧用户");
    expect(s.semester.name).toBe("旧学期");
    expect(s.assignmentTimeSlice).toBe("7days");
  });

  it("partial/invalid preferences 持久化数据被逐字段修复", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        state: {
          userProfile: { name: "u", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
          semester: { id: "s1", name: "学期", startDate: "2026-02-23", totalWeeks: 16 },
          courses: [], schedules: [], assignments: [], calendarMarks: [], groupProjects: [],
          preferences: { showWeekends: false, ddlWarningDays: 4, defaultDDLTime: "bad", motionPreference: "hello" },
        },
      })
    );
    const store = await freshStore();
    const p = store.getState().preferences;
    expect(p.showWeekends).toBe(false); // 合法保留
    expect(p.ddlWarningDays).toBe(3); // 非法回落
    expect(p.defaultDDLTime).toBe("23:59");
    expect(p.motionPreference).toBe("system");
    expect(p.enableScheduleDirectManipulation).toBe(true); // 缺失补默认
  });

  it("resetAllDataToDefault 后 preferences 回到默认值", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ motionPreference: "reduced" });
    store.getState().resetAllDataToDefault();
    expect(store.getState().preferences).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("backup 兼容：preferences 纳入备份且旧备份不损坏", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    return mod.useAppStore;
  }

  it("导出备份包含 preferences；恢复后 preferences 被覆盖", async () => {
    const store = await freshStore();
    const s = store.getState();
    // 构造与导出同构的数据（含 preferences）
    const data = {
      userProfile: s.userProfile,
      semester: s.semester,
      courses: s.courses,
      schedules: s.schedules,
      assignments: s.assignments,
      calendarMarks: s.calendarMarks,
      groupProjects: s.groupProjects,
      preferences: { ...validPrefs } as typeof validPrefs & { ddlWarningDays: number; motionPreference: string },
    };
    store.getState().restoreAppData(data as never);
    const restored = store.getState().preferences;
    expect(restored.showWeekends).toBe(false);
    expect(restored.ddlWarningDays).toBe(7);
    expect(restored.defaultDDLTime).toBe("21:30");
  });

  it("旧备份（无 preferences）导入：业务数据恢复，当前偏好保留不被覆盖", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ motionPreference: "reduced" });

    const legacy = {
      userProfile: { name: "备份用户", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
      semester: { id: "s2", name: "备份学期", startDate: "2026-02-23", totalWeeks: 16 },
      courses: [{ id: "c_bak", name: "备份课程", code: "B-01", teacher: "t", classroom: "r", credit: 2, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
      schedules: [], assignments: [], calendarMarks: [], groupProjects: [],
    };
    store.getState().restoreAppData(legacy as never);

    const after = store.getState();
    expect(after.courses.map((c) => c.id)).toEqual(["c_bak"]);
    expect(after.userProfile.name).toBe("备份用户");
    expect(after.semester.name).toBe("备份学期");
    expect(after.preferences.motionPreference).toBe("reduced"); // 保留当前偏好
    expect(after.preferences.ddlWarningDays).toBe(3);
  });

  it("备份中的非法 preferences 导入时被 sanitize", async () => {
    const store = await freshStore();
    const s = store.getState();
    store.getState().restoreAppData({
      ...s,
      preferences: { ddlWarningDays: 4, motionPreference: "nope" },
    } as never);
    const p = store.getState().preferences;
    expect(p.ddlWarningDays).toBe(3);
    expect(p.motionPreference).toBe("system");
  });

  it("备份 DDL 数据导入后 getLocalDDLDate 语义不变", async () => {
    const store = await freshStore();
    const s = store.getState();
    store.getState().restoreAppData({
      ...s,
      assignments: [
        { id: "a_x", courseId: "c_x", title: "t", description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
      ],
    } as never);
    expect(getLocalDDLDate(store.getState().assignments[0].ddl)).toBe("2026-09-01");
  });
});
