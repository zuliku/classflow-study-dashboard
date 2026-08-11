import { describe, it, expect } from "vitest";
import { searchSettings, SETTINGS_REGISTRY } from "@/lib/settingsRegistry";
import {
  DEFAULT_PREFERENCES,
  getModifiedPreferenceKeys,
  getModifiedSections,
  resetPreferencePatch,
  PREFERENCE_SECTIONS,
} from "@/lib/preferences";

describe("settingsRegistry 搜索", () => {
  it("registry 覆盖核心设置且 id 稳定", () => {
    const ids = SETTINGS_REGISTRY.map((s) => s.id);
    expect(ids).toContain("show-weekends");
    expect(ids).toContain("default-ddl-time");
    expect(ids).toContain("schedule-direct-manipulation");
    expect(ids).toContain("ddl-direct-manipulation");
    expect(ids).toContain("backup-full");
    expect(ids).toContain("restore-data");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("输入「截止」→ 任务相关的两个设置", () => {
    const r = searchSettings("截止");
    const titles = r.map((s) => s.title);
    expect(titles).toContain("临近截止提醒");
    expect(titles).toContain("默认截止时间");
  });

  it("输入「拖拽」→ 直接操作设置（命中 keywords）", () => {
    const r = searchSettings("拖拽");
    expect(r.map((s) => s.title)).toEqual(
      expect.arrayContaining(["课表直接操作", "DDL 直接操作"])
    );
  });

  it("输入「备份」→ 数据与存储的设置", () => {
    const r = searchSettings("备份");
    expect(r.map((s) => s.title)).toEqual(
      expect.arrayContaining(["完整备份", "仅数据备份", "恢复数据"])
    );
  });

  it("空查询 → 空结果；无匹配 → 空", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("不存在的设置xyz")).toEqual([]);
  });

  it("输入「字号」→ kiro 输出字号设置（Task 7D）", () => {
    const r = searchSettings("字号");
    expect(r.map((s) => s.id)).toContain("kiro-output-text-size");
    // 同义词「字体」也能命中
    expect(searchSettings("字体").map((s) => s.id)).toContain("kiro-output-text-size");
    expect(searchSettings("font").map((s) => s.id)).toContain("kiro-output-text-size");
  });

  it("大小写不敏感（ddl / DDL / DDL 提醒）", () => {
    expect(searchSettings("DDL").length).toBeGreaterThan(0);
    expect(searchSettings("ddl 提醒").length).toBeGreaterThan(0);
  });

  it("Settings V3 Task 5：真实设置全部可搜索（profile 字段 / custom / 连接状态）", () => {
    expect(searchSettings("姓名").some((s) => s.id === "profile-name")).toBe(true);
    expect(searchSettings("学号").some((s) => s.id === "profile-student-id")).toBe(true);
    expect(searchSettings("学院").some((s) => s.id === "profile-college")).toBe(true);
    expect(searchSettings("年级").some((s) => s.id === "profile-grade")).toBe(true);
    expect(searchSettings("学分").some((s) => s.id === "profile-credits")).toBe(true);
    expect(searchSettings("自定义").some((s) => s.id === "ai-custom-name")).toBe(true);
    expect(searchSettings("连接").some((s) => s.id === "ai-connection-status")).toBe(true);
  });
});

describe("modified preference 检测", () => {
  it("默认偏好 → 无修改", () => {
    expect(getModifiedPreferenceKeys(DEFAULT_PREFERENCES)).toEqual([]);
    expect(getModifiedSections(DEFAULT_PREFERENCES).size).toBe(0);
  });

  it("单项修改 → 返回对应键与 section", () => {
    const prefs = { ...DEFAULT_PREFERENCES, defaultDDLTime: "21:00" };
    expect(getModifiedPreferenceKeys(prefs)).toEqual(["defaultDDLTime"]);
    expect(getModifiedSections(prefs).has("tasks")).toBe(true);
    expect(getModifiedSections(prefs).has("interaction")).toBe(false);
  });

  it("多项修改 → 全部返回，section 去重", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      showWeekends: false,
      motionPreference: "reduced" as const,
      defaultDDLTime: "21:30",
    };
    const keys = getModifiedPreferenceKeys(prefs);
    expect(keys).toHaveLength(3);
    const sections = getModifiedSections(prefs);
    expect(sections.has("semester")).toBe(true);
    expect(sections.has("tasks")).toBe(true);
    expect(sections.has("general")).toBe(true); // Settings V3 IA：动效偏好归入通用
  });

  it("resetPreferencePatch 单项恢复默认", () => {
    expect(resetPreferencePatch("defaultDDLTime")).toEqual({ defaultDDLTime: "23:59" });
    expect(resetPreferencePatch("motionPreference")).toEqual({ motionPreference: "system" });
    expect(resetPreferencePatch("showWeekends")).toEqual({ showWeekends: true });
  });

  it("PREFERENCE_SECTIONS 覆盖所有偏好键", () => {
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      expect(PREFERENCE_SECTIONS[key as keyof typeof DEFAULT_PREFERENCES]).toBeDefined();
    }
  });
});
