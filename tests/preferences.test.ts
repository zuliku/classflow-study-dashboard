/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_PREFERENCES, sanitizePreferences, PREFERENCE_SECTIONS, getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { getLocalDDLDate } from "@/lib/ddl";
import { FONT_REGISTRY, UI_FONT_PRESETS, DEFAULT_UI_FONT } from "@/lib/typography/fonts";

const KEY = "classflow-storage-v2";

/** 合法偏好 */
const validPrefs = {
  showWeekends: false,
  ddlWarningDays: 7,
  defaultDDLTime: "21:30",
  enableScheduleDirectManipulation: false,
  enableDDLDirectManipulation: true,
  motionPreference: "reduced",
  startupView: "last",
  defaultTaskPriority: "high",
  defaultTaskStatus: "doing",
  enableSingleKeyShortcuts: false,
  contentDensity: "compact",
  defaultDeadlineReminderMinutes: 60 as const,
  defaultTaskWorkspaceView: "focus" as const,
  uiFont: "source-han-sans-sc" as const,
};

describe("sanitizePreferences 逐字段回落", () => {
  it("Settings V3：defaultTaskWorkspaceView 合法值通过、非法回落 focus", () => {
    expect(DEFAULT_PREFERENCES.defaultTaskWorkspaceView).toBe("focus");
    expect(sanitizePreferences({ defaultTaskWorkspaceView: "today" }).defaultTaskWorkspaceView).toBe("today");
    expect(sanitizePreferences({ defaultTaskWorkspaceView: "unscheduled" }).defaultTaskWorkspaceView).toBe("unscheduled");
    expect(sanitizePreferences({ defaultTaskWorkspaceView: "archive" }).defaultTaskWorkspaceView).toBe("archive");
    // 非法 / 缺失 → focus
    expect(sanitizePreferences({ defaultTaskWorkspaceView: "hacked" }).defaultTaskWorkspaceView).toBe("focus");
    expect(sanitizePreferences({}).defaultTaskWorkspaceView).toBe("focus");
  });

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

  it("新增字段缺失 → 回落默认（旧持久化数据安全补字段）", () => {
    const out = sanitizePreferences({
      showWeekends: true,
      ddlWarningDays: 3,
      defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true,
      enableDDLDirectManipulation: true,
      motionPreference: "system",
    });
    expect(out.startupView).toBe("overview");
    expect(out.defaultTaskPriority).toBe("medium");
    expect(out.defaultTaskStatus).toBe("todo");
    expect(out.enableSingleKeyShortcuts).toBe(true);
    expect(out.contentDensity).toBe("comfortable");
  });

  it("新增字段非法值 → 回落默认", () => {
    expect(sanitizePreferences({ startupView: "courses" }).startupView).toBe("overview");
    expect(sanitizePreferences({ startupView: "assignments" }).startupView).toBe("assignments");
    expect(sanitizePreferences({ startupView: "last" }).startupView).toBe("last");
    expect(sanitizePreferences({ defaultTaskPriority: "critica!" }).defaultTaskPriority).toBe("medium");
    expect(sanitizePreferences({ defaultTaskPriority: "urgent" }).defaultTaskPriority).toBe("urgent");
    // 禁止 submitted/completed：默认状态只有 todo/doing
    expect(sanitizePreferences({ defaultTaskStatus: "completed" }).defaultTaskStatus).toBe("todo");
    expect(sanitizePreferences({ defaultTaskStatus: "doing" }).defaultTaskStatus).toBe("doing");
    expect(sanitizePreferences({ enableSingleKeyShortcuts: "no" }).enableSingleKeyShortcuts).toBe(true);
    expect(sanitizePreferences({ contentDensity: "huge" }).contentDensity).toBe("comfortable");
    expect(sanitizePreferences({ contentDensity: "compact" }).contentDensity).toBe("compact");
  });

  // Typography V1 — uiFont sanitize & defaults
  it("Typography V1：DEFAULT uiFont = harmonyos-sans-sc", () => {
    expect(DEFAULT_PREFERENCES.uiFont).toBe("harmonyos-sans-sc");
    expect(DEFAULT_UI_FONT).toBe("harmonyos-sans-sc");
  });

  it("Typography V1：三个合法值均通过 sanitize", () => {
    expect(sanitizePreferences({ uiFont: "harmonyos-sans-sc" }).uiFont).toBe("harmonyos-sans-sc");
    expect(sanitizePreferences({ uiFont: "source-han-sans-sc" }).uiFont).toBe("source-han-sans-sc");
    expect(sanitizePreferences({ uiFont: "misan" }).uiFont).toBe("misan");
  });

  it("Typography V1：非法 uiFont 回落 harmonyos-sans-sc", () => {
    expect(sanitizePreferences({ uiFont: "comic-sans" }).uiFont).toBe("harmonyos-sans-sc");
    expect(sanitizePreferences({ uiFont: "" }).uiFont).toBe("harmonyos-sans-sc");
    expect(sanitizePreferences({ uiFont: null }).uiFont).toBe("harmonyos-sans-sc");
    expect(sanitizePreferences({ uiFont: 123 }).uiFont).toBe("harmonyos-sans-sc");
  });

  it("Typography V1：旧持久化无 uiFont 自动补 harmonyos-sans-sc", () => {
    const out = sanitizePreferences({ showWeekends: true });
    expect(out.uiFont).toBe("harmonyos-sans-sc");
    expect(sanitizePreferences({}).uiFont).toBe("harmonyos-sans-sc");
  });

  it("Typography V1：uiFont 属于 general section", () => {
    expect(PREFERENCE_SECTIONS.uiFont).toBe("general");
  });

  it("Typography V1：getModifiedPreferenceKeys 能检测 uiFont 差异", () => {
    const modified = getModifiedPreferenceKeys({ ...DEFAULT_PREFERENCES, uiFont: "misan" });
    expect(modified).toContain("uiFont");
    expect(getModifiedPreferenceKeys(DEFAULT_PREFERENCES)).not.toContain("uiFont");
  });

  it("Typography V1：resetPreferencePatch uiFont → harmonyos-sans-sc", () => {
    expect(resetPreferencePatch("uiFont")).toEqual({ uiFont: "harmonyos-sans-sc" });
  });

  it("Typography V1：Font Registry 三项完整且 fallback 正确", () => {
    expect(UI_FONT_PRESETS).toEqual(["harmonyos-sans-sc", "source-han-sans-sc", "misan"]);
    expect(Object.keys(FONT_REGISTRY)).toEqual(expect.arrayContaining(UI_FONT_PRESETS));
    // harmony default bundled, source-han bundled, misan local-only
    expect(FONT_REGISTRY["harmonyos-sans-sc"].bundled).toBe(true);
    expect(FONT_REGISTRY["source-han-sans-sc"].bundled).toBe(true);
    expect(FONT_REGISTRY["misan"].bundled).toBe(false);
    expect(FONT_REGISTRY["misan"].localOnly).toBe(true);
    // MiSans fallback 必须包含 HarmonyOS
    expect(FONT_REGISTRY["misan"].cssFallback).toContain("HarmonyOS Sans SC");
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
    expect(raw.version).toBe(8); // 当前 persist schema version (Typography V1 保持 v8 additive)
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

  it("resetPreferences 后 preferences 回到默认值且不动业务数据", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ motionPreference: "reduced" });
    store.getState().updateUserProfile({ name: "保留用户" });
    store.getState().resetPreferences();
    expect(store.getState().preferences).toEqual(DEFAULT_PREFERENCES);
    expect(store.getState().userProfile.name).toBe("保留用户");
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

describe("Typography V1 store 集成与备用", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    return mod.useAppStore;
  }

  it("updatePreferences 可实时切换 uiFont", async () => {
    const store = await freshStore();
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");
    store.getState().updatePreferences({ uiFont: "source-han-sans-sc" });
    expect(store.getState().preferences.uiFont).toBe("source-han-sans-sc");
    store.getState().updatePreferences({ uiFont: "misan" });
    expect(store.getState().preferences.uiFont).toBe("misan");
  });

  it("旧 persisted preferences 无 uiFont 自动补 harmonyos-sans-sc", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 8,
        state: {
          userProfile: { name: "u", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
          semester: { id: "s1", name: "学期", startDate: "2026-02-23", totalWeeks: 16 },
          courses: [], schedules: [], assignments: [], calendarMarks: [], groupProjects: [],
          preferences: { showWeekends: false, ddlWarningDays: 3, defaultDDLTime: "23:59", motionPreference: "system" },
        },
      })
    );
    const store = await freshStore();
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");
    expect(store.getState().preferences.showWeekends).toBe(false);
  });

  it("非法 uiFont persisted 回落 harmonyos-sans-sc", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 8,
        state: {
          userProfile: { name: "u", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
          semester: { id: "s1", name: "学期", startDate: "2026-02-23", totalWeeks: 16 },
          courses: [], schedules: [], assignments: [], calendarMarks: [], groupProjects: [],
          preferences: { uiFont: "comic-sans" },
        },
      })
    );
    const store = await freshStore();
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");
  });

  it("resetPreferencePatch uiFont → harmonyos-sans-sc 且 updatePreferences 生效", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ uiFont: "misan" });
    expect(store.getState().preferences.uiFont).toBe("misan");
    store.getState().updatePreferences(resetPreferencePatch("uiFont"));
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");
  });

  it("backup/restore 保持 uiFont", async () => {
    const store = await freshStore();
    const s = store.getState();
    store.getState().restoreAppData({
      ...s,
      preferences: { ...DEFAULT_PREFERENCES, uiFont: "source-han-sans-sc" as const },
    } as never);
    expect(store.getState().preferences.uiFont).toBe("source-han-sans-sc");
    // persist round-trip via localStorage
    store.getState().updatePreferences({ uiFont: "misan" });
    await new Promise((r) => setTimeout(r, 10));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.state.preferences.uiFont).toBe("misan");
    const reloaded = await freshStore();
    expect(reloaded.getState().preferences.uiFont).toBe("misan");
  });

  it("旧备份无 uiFont 导入后 uiFont 回落默认", async () => {
    const store = await freshStore();
    const s = store.getState();
    store.getState().updatePreferences({ uiFont: "misan" });
    store.getState().restoreAppData({
      userProfile: s.userProfile,
      semester: s.semester,
      courses: [], schedules: [], assignments: [], calendarMarks: [], groupProjects: [],
      // 无 preferences → 保留当前（misan）
    } as never);
    expect(store.getState().preferences.uiFont).toBe("misan");
    // 带非法 uiFont 的备份应被 sanitize
    store.getState().restoreAppData({
      ...s,
      preferences: { uiFont: "comic-sans" } as never,
    } as never);
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");
  });

  it("persist version 保持 v8（additive preference 不 bump schema）", async () => {
    const store = await freshStore();
    store.getState().updatePreferences({ uiFont: "source-han-sans-sc" });
    await new Promise((r) => setTimeout(r, 10));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.version).toBe(8);
  });
});
