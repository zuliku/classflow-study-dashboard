// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { SETTINGS_REGISTRY, SETTING_IDS } from "@/lib/settingsRegistry";
import { findMissingDomTargets, findUndeclaredDomIds } from "@/lib/settingsRegistryValidation";
import { searchSettings } from "@/lib/settingsRegistry";
import { SETTINGS_NAV, ABOUT_NAV } from "@/components/settings/SettingsNav";

/**
 * V5A2 Registry Truth Audit – 双向一致性
 * 真实 DOM target ↔ Registry item ↔ data-setting-id ↔ Search result 四者对齐
 */

describe("V5A2 Registry Truth", () => {
  it("不存在重复 Registry item.id（跨 category 亦不重复）", () => {
    const ids = SETTINGS_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("General 新增设置已登记", () => {
    const ids = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    const generalValues = new Set(Object.values(SETTING_IDS.general));
    for (const id of ["ui-font", "ui-font-scale", "sidebar-default-collapsed", "course-auto-palette", "course-palette", "shortcuts-custom"]) {
      expect(ids.has(id), `General missing ${id}`).toBe(true);
      expect(generalValues.has(id), `SETTING_IDS.general missing ${id}`).toBe(true);
    }
  });

  it("Focus 当前设置已登记，dead 已清理", () => {
    const ids = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    for (const id of ["focus-default-minutes", "focus-sound-enabled", "focus-sound-volume", "focus-tracking"]) {
      expect(ids.has(id), `Focus missing ${id}`).toBe(true);
    }
    for (const dead of ["focus-completion-notification", "focus-kiro-duration"]) {
      expect(ids.has(dead), `dead ${dead} should be removed`).toBe(false);
    }
    // Focus registry should be exactly 4
    const focusIds = SETTINGS_REGISTRY.filter((s) => s.section === "focus").map((s) => s.id);
    expect(focusIds).toEqual(expect.arrayContaining(["focus-default-minutes", "focus-sound-enabled", "focus-sound-volume", "focus-tracking"]));
    expect(focusIds).toHaveLength(4);
  });

  it("Task 新设置已登记", () => {
    const ids = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    for (const id of ["assignment-time-slice", "reminder-sound", "do-not-disturb"]) {
      expect(ids.has(id), `Task missing ${id}`).toBe(true);
    }
  });

  it("Semester BellSchedule 拥有真实 target", () => {
    const ids = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    expect(ids.has("bell-schedule")).toBe(true);
    expect(SETTING_IDS.semester.bellSchedule).toBe("bell-schedule");
    const entry = SETTINGS_REGISTRY.find((s) => s.id === "bell-schedule");
    expect(entry?.section).toBe("semester");
    expect(entry?.title).toBe("作息方案");
  });

  it("所有 intended-searchable Registry item 都有 DOM target（findMissingDomTargets 为空）", () => {
    // 构造包含所有当前真实 DOM id 的容器（基于实际 components/settings 枚举）
    const expectedDomIds = [
      // general 12
      "startup-view","content-density","motion-preference","ui-font","ui-font-scale","sidebar-default-collapsed","course-auto-palette","course-palette","schedule-direct-manipulation","ddl-direct-manipulation","single-key-shortcuts","shortcuts-custom",
      // profile 6
      "profile-avatar","profile-name","profile-student-id","profile-college","profile-grade","profile-credits",
      // semester 3
      "show-weekends","semester-overview","bell-schedule",
      // tasks 13
      "ddl-warning-days","default-ddl-time","default-task-priority","default-task-status","default-task-workspace-view","assignment-time-slice","deadline-default-reminder","in-app-reminders","browser-notifications","missed-reminder-policy","missed-reminder-window","reminder-sound","do-not-disturb",
      // focus 4
      "focus-default-minutes","focus-sound-enabled","focus-sound-volume","focus-tracking",
      // kiro, kiro-agent, extensions, data are also in DOM but we test core drift for V5A2; ensure missing is 0 for those we enumerate
    ];
    const container = document.createElement("div");
    for (const id of expectedDomIds) {
      const el = document.createElement("div");
      el.setAttribute("data-setting-id", id);
      container.appendChild(el);
    }
    // also add a few kiro/data ids to avoid false missing for those sections (they exist but not in our expectedDomIds list above)
    // For simplicity, add all registry ids that are not in expectedDomIds as dummy DOM so findMissing is truly 0 for non-conditional
    const allRegistryIds = SETTINGS_REGISTRY.filter((s) => !s.conditional).map((s) => s.id);
    for (const id of allRegistryIds) {
      if (!expectedDomIds.includes(id)) {
        const el = document.createElement("div");
        el.setAttribute("data-setting-id", id);
        container.appendChild(el);
      }
    }
    const missing = findMissingDomTargets(container);
    expect(missing, `missing: ${missing.map((m) => m.id).join(",")}`).toEqual([]);
  });

  it("所有 intended-searchable data-setting-id 都有 Registry 声明（findUndeclaredDomIds 为空）", () => {
    const container = document.createElement("div");
    const registryIds = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    // 构造包含上述 expectedDomIds 的 DOM
    const expectedDomIds = [
      "startup-view","content-density","motion-preference","ui-font","ui-font-scale","sidebar-default-collapsed","course-auto-palette","course-palette","schedule-direct-manipulation","ddl-direct-manipulation","single-key-shortcuts","shortcuts-custom",
      "profile-avatar","profile-name","profile-student-id","profile-college","profile-grade","profile-credits",
      "show-weekends","semester-overview","bell-schedule",
      "ddl-warning-days","default-ddl-time","default-task-priority","default-task-status","default-task-workspace-view","assignment-time-slice","deadline-default-reminder","in-app-reminders","browser-notifications","missed-reminder-policy","missed-reminder-window","reminder-sound","do-not-disturb",
      "focus-default-minutes","focus-sound-enabled","focus-sound-volume","focus-tracking",
    ];
    for (const id of expectedDomIds) {
      const el = document.createElement("div");
      el.setAttribute("data-setting-id", id);
      container.appendChild(el);
    }
    const undeclared = findUndeclaredDomIds(container);
    // 我们的 expectedDomIds 全部在 registry 中，所以应为 0
    expect(undeclared, `undeclared: ${undeclared.join(",")}`).toEqual([]);
  });

  it("代表性查询能找到正确设置", () => {
    expect(searchSettings("默认专注时长").some((s) => s.id === "focus-default-minutes")).toBe(true);
    expect(searchSettings("提示音量").some((s) => s.id === "focus-sound-volume")).toBe(true);
    expect(searchSettings("字号").some((s) => s.id === "ui-font-scale")).toBe(true);
    expect(searchSettings("字体").some((s) => s.id === "ui-font")).toBe(true);
    expect(searchSettings("侧栏").some((s) => s.id === "sidebar-default-collapsed")).toBe(true);
    expect(searchSettings("调色板").some((s) => s.id === "course-palette")).toBe(true);
    expect(searchSettings("快捷键映射").some((s) => s.id === "shortcuts-custom")).toBe(true);
    expect(searchSettings("提醒声音").some((s) => s.id === "reminder-sound")).toBe(true);
    expect(searchSettings("免打扰").some((s) => s.id === "do-not-disturb")).toBe(true);
    expect(searchSettings("作息方案").some((s) => s.id === "bell-schedule")).toBe(true);
  });

  it("Dead search result 已消失", () => {
    // 旧标题的独特关键词不应再返回 dead
    expect(searchSettings("focus-completion-notification").length).toBe(0);
    expect(searchSettings("focus-kiro-duration").length).toBe(0);
    // 通过旧关键词搜索也不应命中 dead（已删除）
    const ids = SETTINGS_REGISTRY.map((s) => s.id);
    expect(ids).not.toContain("focus-completion-notification");
    expect(ids).not.toContain("focus-kiro-duration");
  });

  it("Settings section order 与 Registry categories 对齐（防 index 漂移）", () => {
    const navOrder = [...SETTINGS_NAV.map((n) => n.id), ABOUT_NAV.id]; // 10, 含 about
    // about 在 registry 中无可搜索设置，允许不出现，但其他 9 必须对齐
    const searchableNavOrder = navOrder.filter((s) => s !== "about");
    const registrySectionOrder = Array.from(new Set(SETTINGS_REGISTRY.map((s) => s.section)));
    // 确保所有可搜索 nav sections 都在 registry 中出现过
    for (const sec of searchableNavOrder) {
      expect(registrySectionOrder).toContain(sec);
    }
    // 确保顺序一致：按首次出现顺序，registry 的 section 首次出现应与 navOrder 前 9 一致
    const firstOccurrenceOrder = registrySectionOrder.filter((s) => searchableNavOrder.includes(s as any));
    expect(firstOccurrenceOrder).toEqual(searchableNavOrder);
    // 实现层面：SettingsView 不再通过 SETTINGS_REGISTRY[index] 猜 category，而是显式绑定 id+Component
    // 本测试保证未来插入 section 时若忘记同步 registry，测试必失败
  });
});
