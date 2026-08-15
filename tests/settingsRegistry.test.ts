import { describe, it, expect } from "vitest";
import {
  searchSettings,
  SETTINGS_REGISTRY,
  SETTING_IDS,
  validateRegistryIntegrity,
} from "@/lib/settingsRegistry";
import {
  DEFAULT_PREFERENCES,
  getModifiedPreferenceKeys,
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

  it("SETTING_IDS 与 Registry 是同一事实来源（无重复、无漂移）", () => {
    const registryIds = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    const constantIds: string[] = [];
    const walk = (obj: Record<string, unknown>) => {
      for (const v of Object.values(obj)) {
        if (typeof v === "string") constantIds.push(v);
        else if (v && typeof v === "object") walk(v as Record<string, unknown>);
      }
    };
    walk(SETTING_IDS as unknown as Record<string, unknown>);
    expect(constantIds.length).toBeGreaterThan(0);
    for (const id of constantIds) {
      expect(registryIds.has(id), `SETTING_IDS.${id} 不在 Registry 中`).toBe(true);
    }
  });

  it("Registry 结构完整性：ID 唯一、section 有效", () => {
    const result = validateRegistryIntegrity();
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("条件渲染设置声明 conditional，不会被 DOM 校验误判", () => {
    const conditionalIds = new Set(
      SETTINGS_REGISTRY.filter((s) => s.conditional).map((s) => s.id)
    );
    for (const id of [
      "ai-custom-name",
      "ai-custom-url",
      "ai-custom-model",
      "ai-custom-capabilities",
      "missed-reminder-window",
      "kiro-web-search-credential",
      "kiro-web-search-byok-key",
      "kiro-web-search-test",
      "kiro-web-search-privacy",
      "kiro-web-search-service",
      "kiro-web-pdf-vision-enabled",
      "kiro-web-pdf-vision-model",
      "kiro-web-pdf-vision-key",
      "kiro-workspace-knowledge",
    ]) {
      expect(conditionalIds.has(id), id).toBe(true);
    }
  });

  it("V4.1：conditional 条目必须声明 gate，且 gate 引用真实存在的设置", () => {
    const byId = new Map(SETTINGS_REGISTRY.map((s) => [s.id, s]));
    for (const entry of SETTINGS_REGISTRY.filter((s) => s.conditional)) {
      expect(entry.gate && entry.gate.length > 0, entry.id).toBeTruthy();
      for (const gate of entry.gate!) {
        expect(byId.has(gate.control), `${entry.id} → control ${gate.control}`).toBe(true);
      }
    }
  });

  it("V4.1：gate 门控语义正确（偏好依赖 vs 披露依赖）", () => {
    const byId = new Map(SETTINGS_REGISTRY.map((s) => [s.id, s]));
    // 偏好依赖：provider / missed policy / web search / workspace
    expect(byId.get("ai-custom-url")?.gate).toEqual([
      { control: "ai-provider", requiresValue: "custom-openai" },
    ]);
    expect(byId.get("missed-reminder-window")?.gate).toEqual([
      { control: "missed-reminder-policy", requiresValue: "recent-only" },
    ]);
    expect(byId.get("kiro-web-search-service")?.gate).toEqual([
      { control: "kiro-web-search-enabled", requiresValue: true },
    ]);
    expect(byId.get("kiro-web-search-byok-key")?.gate).toEqual([
      { control: "kiro-web-search-enabled", requiresValue: true },
      { control: "kiro-web-search-credential", requiresValue: "byok" },
    ]);
    expect(byId.get("kiro-workspace-knowledge")?.gate).toEqual([
      { control: "kiro-agent-workspace" },
    ]);
    // 披露依赖：折叠区内目标声明 disclosure
    expect(byId.get("ai-custom-capabilities")?.disclosure).toBe("advanced");
    expect(byId.get("kiro-web-search-credential")?.disclosure).toBe("search-settings");
    expect(byId.get("kiro-web-pdf-vision-enabled")?.disclosure).toBe("advanced");
    expect(byId.get("ai-custom-url")?.disclosure).toBeUndefined();
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

  it("输入「备份」→ 数据与隐私的设置", () => {
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

  it("Settings V4：真实设置全部可搜索（profile 字段 / 头像 / 快捷键 / 工作区 / API Key）", () => {
    expect(searchSettings("姓名").some((s) => s.id === "profile-name")).toBe(true);
    expect(searchSettings("学号").some((s) => s.id === "profile-student-id")).toBe(true);
    expect(searchSettings("学院").some((s) => s.id === "profile-college")).toBe(true);
    expect(searchSettings("年级").some((s) => s.id === "profile-grade")).toBe(true);
    expect(searchSettings("学分").some((s) => s.id === "profile-credits")).toBe(true);
    expect(searchSettings("头像").some((s) => s.id === "profile-avatar")).toBe(true);
    expect(searchSettings("快捷键").some((s) => s.id === "single-key-shortcuts")).toBe(true);
    expect(searchSettings("工作区").some((s) => s.id === "kiro-agent-workspace")).toBe(true);
    expect(searchSettings("API Key").some((s) => s.id === "ai-api-key")).toBe(true);
    expect(searchSettings("连接").some((s) => s.id === "ai-connection-status")).toBe(true);
  });

  it("Settings V4 IA：直接操作 / 快捷键属于 general；隐私行属于 data", () => {
    const byId = new Map(SETTINGS_REGISTRY.map((s) => [s.id, s]));
    expect(byId.get("schedule-direct-manipulation")?.section).toBe("general");
    expect(byId.get("ddl-direct-manipulation")?.section).toBe("general");
    expect(byId.get("single-key-shortcuts")?.section).toBe("general");
    expect(byId.get("kiro-privacy-local")?.section).toBe("data");
    expect(byId.get("kiro-privacy-api-key")?.section).toBe("data");
    expect(byId.get("kiro-privacy-context")?.section).toBe("data");
  });
});

describe("modified preference 检测", () => {
  it("默认偏好 → 无修改", () => {
    expect(getModifiedPreferenceKeys(DEFAULT_PREFERENCES)).toEqual([]);
  });

  it("单项修改 → 返回对应键", () => {
    const prefs = { ...DEFAULT_PREFERENCES, defaultDDLTime: "21:00" };
    expect(getModifiedPreferenceKeys(prefs)).toEqual(["defaultDDLTime"]);
  });

  it("多项修改 → 全部返回", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      showWeekends: false,
      motionPreference: "reduced" as const,
      defaultDDLTime: "21:30",
    };
    const keys = getModifiedPreferenceKeys(prefs);
    expect(keys).toHaveLength(3);
  });

  it("resetPreferencePatch 单项恢复默认", () => {
    expect(resetPreferencePatch("defaultDDLTime")).toEqual({ defaultDDLTime: "23:59" });
    expect(resetPreferencePatch("motionPreference")).toEqual({ motionPreference: "system" });
    expect(resetPreferencePatch("showWeekends")).toEqual({ showWeekends: true });
  });

  it("PREFERENCE_SECTIONS 覆盖所有偏好键且 section 有效（V4：交互并入通用）", () => {
    const validSections = new Set(["general", "semester", "tasks"]);
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      const sec = PREFERENCE_SECTIONS[key as keyof typeof DEFAULT_PREFERENCES];
      expect(sec).toBeDefined();
      expect(validSections.has(sec), `${key} → ${sec}`).toBe(true);
    }
  });
});
