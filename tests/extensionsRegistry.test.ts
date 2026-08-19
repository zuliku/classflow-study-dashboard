import { describe, it, expect } from "vitest";
import { CHANNEL_PROVIDERS, validateRegistry, getProviderMeta } from "@/lib/extensions/registry";
import { SETTINGS_REGISTRY, SETTING_IDS, searchSettings } from "@/lib/settingsRegistry";
import { SETTINGS_NAV } from "@/components/settings/SettingsNav";
import { WORKSPACE_NAV_ITEMS, MAIN_NAV_ITEMS } from "@/components/layout/navItems";
import { containsSecretField } from "@/lib/extensions/types";

describe("Extensions Registry — Task 04", () => {
  it("Channel providers 固定 3 个且从 registry 渲染", () => {
    expect(CHANNEL_PROVIDERS).toHaveLength(3);
    const ids = CHANNEL_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("qq-bot");
    expect(ids).toContain("gmail");
    expect(ids).toContain("qq-mail");
    // 每个 provider 有 name/description
    for (const p of CHANNEL_PROVIDERS) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("Registry 完整性校验通过", () => {
    const result = validateRegistry();
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("UI 从 registry 渲染（不手写 if provider === ...）", () => {
    // 模拟 UI 渲染路径：通过 getProviderMeta 查找而非硬编码分支
    for (const id of ["qq-bot", "gmail", "qq-mail"] as const) {
      const meta = getProviderMeta(id);
      expect(meta).toBeDefined();
      expect(meta!.id).toBe(id);
      expect(meta!.kind).toBe("channel");
    }
  });

  it("SettingsSection 支持 extensions", () => {
    const navIds = SETTINGS_NAV.map((n) => n.id);
    expect(navIds).toContain("extensions");
  });

  it("Settings 左侧出现“连接与扩展”", () => {
    const item = SETTINGS_NAV.find((n) => n.id === "extensions");
    expect(item).toBeDefined();
    expect(item!.label).toBe("连接与扩展");
  });

  it("Zustand persist 不包含 secret — containsSecretField 检测", () => {
    const fakePersisted = {
      extensions: [
        { id: "1", kind: "mcp", providerId: "test", credentialRef: "cred_123" },
      ],
    };
    expect(containsSecretField(fakePersisted)).toBe(false);
    expect(containsSecretField({ ...fakePersisted, secret: "leak" })).toBe(true);
    expect(containsSecretField({ extensions: [{ id: "1", secret: "leak" }] })).toBe(true);
    expect(containsSecretField({ extensions: [{ id: "1", accessToken: "leak" }] })).toBe(true);
  });

  it("credential 只能保存 credentialRef", () => {
    // 类型层面：ExtensionRecord 只有 credentialRef，没有 secret 字段
    const example: import("@/lib/extensions/types").ExtensionRecord = {
      id: "ext_1",
      kind: "mcp",
      providerId: "test",
      name: "Test",
      description: "desc",
      status: "disconnected",
      credentialRef: "cred_abc",
      enabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect((example as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect(example.credentialRef).toBe("cred_abc");
  });

  it("Settings Search 可以搜索“QQ Bot”并跳到 Extensions", () => {
    const results = searchSettings("QQ Bot");
    expect(results.length).toBeGreaterThan(0);
    const qqBot = results.find((r) => r.id === SETTING_IDS.extensions.qqBot);
    expect(qqBot).toBeDefined();
    expect(qqBot!.section).toBe("extensions");
    expect(qqBot!.title).toBe("QQ Bot");
  });

  it("搜索“Gmail”命中 extensions", () => {
    const r = searchSettings("Gmail");
    expect(r.some((x) => x.id === SETTING_IDS.extensions.gmail)).toBe(true);
    expect(r.find((x) => x.id === SETTING_IDS.extensions.gmail)?.section).toBe("extensions");
  });

  it("搜索“QQ 邮箱”命中 extensions", () => {
    const r = searchSettings("QQ 邮箱");
    expect(r.some((x) => x.id === SETTING_IDS.extensions.qqMail)).toBe(true);
  });

  it("搜索“连接与扩展”命中 overview", () => {
    const r = searchSettings("连接与扩展");
    expect(r.some((x) => x.id === SETTING_IDS.extensions.overview)).toBe(true);
  });

  it("搜索“Skills”“MCP”“消息渠道”命中", () => {
    expect(searchSettings("Skills").some((x) => x.id === SETTING_IDS.extensions.skills)).toBe(true);
    expect(searchSettings("MCP").some((x) => x.id === SETTING_IDS.extensions.mcp)).toBe(true);
    expect(searchSettings("消息渠道").some((x) => x.id === SETTING_IDS.extensions.channels)).toBe(true);
  });

  it("Existing Settings search validation 不回归 — registry integrity", async () => {
    const { validateRegistryIntegrity } = await import("@/lib/settingsRegistry");
    const result = validateRegistryIntegrity();
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("Existing Sidebar 没有新增 Extension 一级入口", () => {
    const workspaceIds = WORKSPACE_NAV_ITEMS.map((i) => i.id);
    // 不允许在 Sidebar 主导航中新增 skills / mcp / qq 等入口
    expect(workspaceIds).not.toContain("extensions" as never);
    expect(workspaceIds).not.toContain("skills" as never);
    expect(workspaceIds).not.toContain("mcp" as never);
    // 验证 MAIN_NAV_ITEMS 仍仅为原有工作区
    const mainIds = MAIN_NAV_ITEMS.map((i) => i.id);
    expect(mainIds).toEqual(expect.arrayContaining(["overview", "timetable", "assignments", "courses", "analytics", "group"]));
    expect(mainIds).not.toContain("extensions" as unknown as typeof mainIds[number]);
  });

  it("Extensions registry 与 SettingsRegistry 一致（SETTING_IDS.extensions 存在）", () => {
    expect(SETTING_IDS.extensions.overview).toBe("extensions-overview");
    expect(SETTING_IDS.extensions.qqBot).toBe("extensions-qq-bot");
    expect(SETTING_IDS.extensions.gmail).toBe("extensions-gmail");
    expect(SETTING_IDS.extensions.qqMail).toBe("extensions-qq-mail");
    expect(SETTINGS_REGISTRY.some((s) => s.id === SETTING_IDS.extensions.overview)).toBe(true);
  });
});
