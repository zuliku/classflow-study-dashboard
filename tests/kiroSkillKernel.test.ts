// @vitest-environment node
/**
 * S1 §71 — Kernel 边界成功标准（可回答 A–G）。
 *
 * A. 什么是 Skill？→ workflow knowledge
 * B. 什么是 Recipe？→ learned execution experience
 * C. 什么是 Core Protocol？→ always-on runtime / safety contract（不属于 Skill Registry）
 * D. 谁进入 Catalog？→ enabled workflow Skill
 * E. 谁能 activate_skill？→ workflow Skill
 * F. 谁进入 desktop recipe prompt？→ enabled Recipe
 * G. 谁能改变权限？→ 都不能
 */
import { describe, it, expect } from "vitest";
import { KIRO_SKILL_CANNOT_CHANGE, KIRO_SKILL_KERNEL_LAYERS, KIRO_SKILL_KINDS } from "@/lib/ai/skills/kernel";
import { SKILL_ACTIVATION_NEVER_MUTATES } from "@/lib/ai/skills/activation";
import { buildKiroSkillRegistry } from "@/lib/ai/skills/registry";
import { buildSkillCatalog } from "@/lib/ai/skills/catalog";
import { buildDesktopRecipePromptSection } from "@/lib/ai/skills/recipes";
import { activateSkill } from "@/lib/ai/skills/activation";
import type { SkillPackage } from "@/lib/ai/skills/types";

function pkg(overrides: Partial<SkillPackage> & { name: string }): SkillPackage {
  return {
    description: "desc",
    instructions: "instructions",
    rawContent: "",
    folderName: overrides.name,
    enabled: true,
    kind: "workflow",
    origin: "user",
    ...overrides,
  };
}

describe("S1 Kernel 边界", () => {
  it("三层定义存在；Core Protocol 绝不是 Skill kind", () => {
    expect([...KIRO_SKILL_KERNEL_LAYERS]).toEqual(["core-protocol", "workflow-skill", "learned-recipe"]);
    expect([...KIRO_SKILL_KINDS]).toEqual(["workflow", "recipe"]);
    expect((KIRO_SKILL_KINDS as readonly string[]).includes("core-protocol")).toBe(false);
  });

  it("A/B/D/F：Catalog 只含 workflow；recipe 只进 recipe prompt", () => {
    const registry = buildKiroSkillRegistry([
      pkg({ name: "exam-review" }),
      pkg({ name: "desktop-wechat-send-file", kind: "recipe" }),
    ]);
    const catalog = buildSkillCatalog(registry.workflows);
    expect(catalog.map((c) => c.name)).toEqual(["exam-review"]);
    expect(buildDesktopRecipePromptSection(registry.recipes)).toContain("desktop-wechat-send-file");
    expect(buildDesktopRecipePromptSection(registry.recipes)).not.toContain("exam-review");
  });

  it("E：只有 workflow 能 activate_skill", () => {
    const packages = [pkg({ name: "exam-review" }), pkg({ name: "desktop-x", kind: "recipe" })];
    expect(activateSkill(packages, { skillName: "exam-review" }).ok).toBe(true);
    expect(activateSkill(packages, { skillName: "desktop-x" }).code).toBe("NOT_ACTIVATABLE");
  });

  it("G：Skill 不能改变权限 / Agent mode / grants（声明一致）", () => {
    // 两份声明使用同一命名族（kernel 用 kebab-case 文档名，activation 用 Runtime 字段名）
    expect(SKILL_ACTIVATION_NEVER_MUTATES).toEqual([
      "permissionRules",
      "agentMode",
      "desktopPermissions",
      "terminalPermissions",
      "filesystemGrants",
      "mcpPermissions",
    ]);
    for (const required of ["agent-mode", "desktop-permissions", "terminal-permissions", "filesystem-grants", "mcp-permissions"]) {
      expect(KIRO_SKILL_CANNOT_CHANGE).toContain(required);
    }
  });
});
