// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MAX_TRAJECTORY_STEPS,
  buildDesktopSkillDraft,
  buildDesktopSkillName,
  describeTrajectoryStep,
  sanitizeTrajectoryTargetLabel,
  type DesktopTrajectory,
} from "@/src/main/computer/trajectory";
import {
  MAX_DESKTOP_RECIPES,
  buildDesktopRecipePromptSection,
  sanitizeRecipeSummary,
} from "@/lib/ai/skills/recipes";
import { buildKiroSkillRegistry } from "@/lib/ai/skills/registry";
import { validateSkillDraft } from "@/lib/ai/skills/draft";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";

function trajectory(overrides: Partial<DesktopTrajectory> = {}): DesktopTrajectory {
  return {
    appName: "wechat",
    appLabel: "即时通讯",
    goal: "给文件传输助手发送报告",
    result: "completed",
    startedAt: 1,
    steps: [
      { index: 0, action: "click", targetLabel: "ListItem「文件传输助手」", risk: "normal", verificationPassed: true, at: 1 },
      { index: 1, action: "type", targetLabel: "Edit「输入」", risk: "normal", verificationPassed: true, at: 2 },
      { index: 2, action: "click", targetLabel: "Button「发送」", risk: "external", verificationPassed: false, at: 3 },
    ],
    ...overrides,
  };
}

describe("V2.6 轨迹 — 清洗与描述", () => {
  it("目标标签清洗控制字符 / 折叠空白 / 截断 64", () => {
    expect(sanitizeTrajectoryTargetLabel("Button\u0000「发送」\n")).toBe("Button 「发送」");
    expect(sanitizeTrajectoryTargetLabel("x".repeat(200)).length).toBe(64);
    expect(sanitizeTrajectoryTargetLabel(null)).toBe("");
  });

  it("步骤描述不包含输入文本 / 路径", () => {
    const line = describeTrajectoryStep({
      index: 0,
      action: "type",
      targetLabel: "Edit「搜索」",
      risk: "normal",
      verificationPassed: null,
      at: 0,
    });
    expect(line).toContain("Edit「搜索」");
    expect(line).toContain("不要复用固定值");
    const upload = describeTrajectoryStep({
      index: 1,
      action: "upload_file",
      targetLabel: "",
      risk: "external",
      verificationPassed: null,
      at: 0,
    });
    expect(upload).not.toContain("\\");
  });
});

describe("V2.6 轨迹 — Skill 草稿", () => {
  it("名称满足 SKILL_NAME_PATTERN 且带 desktop- 前缀", () => {
    const name = buildDesktopSkillName(trajectory());
    expect(name.startsWith("desktop-")).toBe(true);
    expect(SKILL_NAME_PATTERN.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("中文目标 → 回退到动作序列摘要（仍合法）", () => {
    const name = buildDesktopSkillName(trajectory({ goal: "给文件传输助手发送报告" }));
    expect(SKILL_NAME_PATTERN.test(name)).toBe(true);
    expect(name.startsWith("desktop-")).toBe(true);
  });

  it("草稿通过 validateSkillDraft，且含步骤 / 验证 / 安全说明（S1：kind = recipe）", () => {
    const draft = buildDesktopSkillDraft(trajectory(), "cs-11111111-2222-3333-4444-555555555555");
    expect(draft.name.startsWith("desktop-")).toBe(true);
    expect(draft.kind).toBe("recipe");
    expect(draft.requiredTools).toContain("desktop_action");
    expect(draft.instructions).toContain("发送");
    expect(draft.instructions).toContain("重新 observe_desktop");
    expect(draft.instructions).toContain("未通过验证");
    expect(draft.instructions).toContain("需要确认");
    const validation = validateSkillDraft(draft);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("草稿不含输入文本 / 绝对路径 / 截图字段", () => {
    const draft = buildDesktopSkillDraft(trajectory(), "cs-1");
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialized).not.toContain("dataUrl");
    expect(serialized).not.toContain("clipboardText");
  });

  it("步骤上限 40", () => {
    const steps = Array.from({ length: MAX_TRAJECTORY_STEPS + 10 }, (_, index) => ({
      index,
      action: "click" as const,
      targetLabel: `el-${index}`,
      risk: "normal" as const,
      verificationPassed: null,
      at: index,
    }));
    const draft = buildDesktopSkillDraft(trajectory({ steps }), "cs-1");
    expect(draft.instructions.split("\n").filter((line) => /^\d+\./.test(line)).length).toBeLessThanOrEqual(
      MAX_TRAJECTORY_STEPS
    );
  });
});

describe("V2.6 本机成功配方注入（S1：只消费 Recipe Registry）", () => {
  const recipe = (name: string, overrides: Record<string, unknown> = {}) => ({
    name,
    description: "在微信发送文件",
    instructions: "1. 打开 C:\\Users\\me\\report.docx 并发送",
    enabled: true,
    ...overrides,
  });

  it("最多 3 条；disabled 不注入；workflow 由 Registry 分类排除（不进入 recipe section）", () => {
    const section = buildDesktopRecipePromptSection([
      recipe("desktop-a"),
      recipe("desktop-b"),
      recipe("desktop-c"),
      recipe("desktop-d"),
      recipe("desktop-disabled", { enabled: false }),
    ]);
    expect(section).toContain("本机成功配方");
    expect(section).toContain("desktop-a");
    expect(section).toContain("desktop-c");
    expect(section).not.toContain("desktop-d");
    expect(section).not.toContain("desktop-disabled");
    expect(section.split("\n").filter((line) => line.startsWith("- desktop-")).length).toBe(MAX_DESKTOP_RECIPES);

    // 分类边界：buildDesktopRecipePromptSection 只接受 recipe；workflow 由 Registry 排除
    const registry = buildKiroSkillRegistry([
      { name: "computer-control", kind: "workflow" } as never,
      { name: "desktop-wechat-send-file", kind: "recipe" } as never,
    ]);
    expect(registry.recipes.map((r) => r.name)).toEqual(["desktop-wechat-send-file"]);
    expect(registry.workflows.map((w) => w.name)).toEqual(["computer-control"]);
  });

  it("摘要清洗绝对路径 / 控制字符 / 限长", () => {
    expect(sanitizeRecipeSummary("打开 C:\\Users\\me\\a.docx 并发送")).not.toContain("C:\\Users");
    expect(sanitizeRecipeSummary("\\\\server\\share\\x.txt")).toContain("[本机路径]");
    expect(sanitizeRecipeSummary("x".repeat(2000)).length).toBeLessThanOrEqual(700);
  });

  it("无配方 → 空字符串", () => {
    expect(buildDesktopRecipePromptSection([])).toBe("");
  });

  it("Chat Route 在电脑能力开启时注入配方 section（Registry 分类，route 不做 prefix 判断）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "app", "api", "ai", "chat", "route.ts"), "utf8");
    expect(source).toContain("buildDesktopRecipePromptSection");
    expect(source).toContain("desktopRecipeSection");
    expect(source).toContain("buildKiroSkillRegistry");
    expect(source).not.toContain('startsWith("desktop-")');
  });
});
