// @vitest-environment node
/**
 * S1 — Skill Registry / Catalog / Slash / Activation 分类测试（§63）。
 *
 * 覆盖：workflow 进入 workflows、recipe 进入 recipes；disabled 不进入 catalog / recipe prompt；
 * recipe 不进入 Available Skills / Slash；activate_skill 拒绝 recipe；workflow 可 activate；
 * origin builtin / user 正确；builtin collision 不覆盖 builtin。
 */
import { describe, it, expect } from "vitest";
import type { SkillPackage } from "@/lib/ai/skills/types";
import {
  buildKiroSkillRegistry,
  classifySkillPackage,
  listRecipeSkills,
  listWorkflowSkills,
  resolveLegacySkillKind,
} from "@/lib/ai/skills/registry";
import { buildSkillCatalog, buildSkillCatalogFromLight, buildSkillCatalogSection } from "@/lib/ai/skills/catalog";
import { activateSkill } from "@/lib/ai/skills/activation";
import { isSlashSkillInvocation, getEnabledSkillNamesForSlash } from "@/lib/ai/skills/slash";
import { toSlashSkillOptions } from "@/lib/ai/skills/slashMenu";
import { buildDesktopRecipePromptSection } from "@/lib/ai/skills/recipes";
import { BUILTIN_SKILLS, withBuiltinSkills } from "@/lib/ai/skills/builtin";

function pkg(overrides: Partial<SkillPackage> & { name: string }): SkillPackage {
  return {
    description: `desc-${overrides.name}`,
    instructions: `instructions-${overrides.name}`,
    rawContent: "",
    folderName: overrides.name,
    enabled: true,
    kind: "workflow",
    origin: "user",
    ...overrides,
  };
}

describe("Registry 分类（唯一来源）", () => {
  it("workflow 进入 workflows；recipe 进入 recipes", () => {
    const registry = buildKiroSkillRegistry([
      pkg({ name: "exam-review" }),
      pkg({ name: "desktop-wechat-send-file", kind: "recipe" }),
    ]);
    expect(registry.workflows.map((p) => p.name)).toEqual(["exam-review"]);
    expect(registry.recipes.map((p) => p.name)).toEqual(["desktop-wechat-send-file"]);
  });

  it("legacy desktop-*（无 manifest kind）→ recipe；普通名 → workflow", () => {
    expect(resolveLegacySkillKind({ name: "desktop-word-save" })).toBe("recipe");
    expect(resolveLegacySkillKind({ name: "desktop-" })).toBe("workflow");
    expect(resolveLegacySkillKind({ name: "class-notice-to-actions" })).toBe("workflow");
    expect(classifySkillPackage({ name: "desktop-x" })).toBe("recipe");
  });

  it("disabled 不进入 enabled-only 列表（workflow / recipe 都适用）", () => {
    const packages = [
      pkg({ name: "a", enabled: true }),
      pkg({ name: "b", enabled: false }),
      pkg({ name: "desktop-c", kind: "recipe", enabled: true }),
      pkg({ name: "desktop-d", kind: "recipe", enabled: false }),
    ];
    expect(listWorkflowSkills(packages, { enabledOnly: true }).map((p) => p.name)).toEqual(["a"]);
    expect(listRecipeSkills(packages, { enabledOnly: true }).map((p) => p.name)).toEqual(["desktop-c"]);
  });

  it("同名去重（builtin 合并后 builtin authoritative；alias 名同样让位）", () => {
    const merged = withBuiltinSkills([
      pkg({ name: "study-planning", description: "user 版本" }),
      pkg({ name: "study-plan", description: "legacy alias 版本" }),
      pkg({ name: "exam-review", description: "user 自有" }),
    ]);
    const canonical = merged.filter((p) => p.name === "study-planning");
    expect(canonical).toHaveLength(1);
    expect(canonical[0].origin).toBe("builtin");
    // legacy alias 名称不是独立 Skill（被保留名过滤，不会与 canonical 混淆）
    expect(merged.some((p) => p.name === "study-plan")).toBe(false);
    // 普通用户 Skill 不受影响
    expect(merged.filter((p) => p.name === "exam-review")).toHaveLength(1);
    expect(merged.find((p) => p.name === "exam-review")!.origin).toBe("user");
  });

  it("origin builtin / user 正确", () => {
    expect(BUILTIN_SKILLS.every((s) => s.origin === "builtin")).toBe(true);
    const registry = buildKiroSkillRegistry([pkg({ name: "user-skill" })]);
    expect(registry.workflows[0].origin).toBe("user");
  });
});

describe("Catalog 只含 Workflow Skill", () => {
  it("recipe 不进入 Available Skills（即便 enabled）", () => {
    const catalog = buildSkillCatalog([
      pkg({ name: "exam-review" }),
      pkg({ name: "desktop-wechat-send-file", kind: "recipe" }),
    ]);
    expect(catalog.map((c) => c.name)).toEqual(["exam-review"]);
    const section = buildSkillCatalogSection(catalog);
    expect(section).toContain("exam-review");
    expect(section).not.toContain("desktop-wechat-send-file");
    expect(section).not.toContain("trigger");
  });

  it("light catalog（IPC list）按 kind 过滤", () => {
    const catalog = buildSkillCatalogFromLight([
      { name: "a", description: "A", enabled: true, kind: "workflow" },
      { name: "desktop-b", description: "B", enabled: true, kind: "recipe" },
      { name: "c", description: "C", enabled: false, kind: "workflow" },
    ]);
    expect(catalog.map((c) => c.name)).toEqual(["a"]);
  });
});

describe("Slash 只含 Workflow Skill", () => {
  it("recipe 不进入 Slash 选项；explicit slash 不命中 recipe", () => {
    const options = toSlashSkillOptions([
      { name: "exam-review", description: "S", enabled: true, kind: "workflow" },
      { name: "desktop-wechat-send-file", description: "R", enabled: true, kind: "recipe" },
      { name: "disabled", description: "D", enabled: false, kind: "workflow" },
    ]);
    expect(options.map((o) => o.name)).toEqual(["exam-review"]);

    const catalog = options.map((o) => ({ ...o, enabled: true }));
    expect(isSlashSkillInvocation("/exam-review", catalog)).toBe(true);
    expect(isSlashSkillInvocation("/desktop-wechat-send-file", catalog)).toBe(false);
    expect(getEnabledSkillNamesForSlash(catalog)).toEqual(["exam-review"]);
  });
});

describe("activate_skill 只激活 Workflow", () => {
  it("recipe → NOT_ACTIVATABLE（不注入 instructions）", () => {
    const result = activateSkill([pkg({ name: "desktop-wechat-send-file", kind: "recipe" })], {
      skillName: "desktop-wechat-send-file",
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_ACTIVATABLE");
    expect(result.instructions).toBeUndefined();
  });

  it("normal workflow 可 activate（只返回 guidance + 诊断元数据）", () => {
    const result = activateSkill(
      [
        pkg({
          name: "exam-review",
          requiredTools: ["propose_study_plan"],
          requiredCapabilities: ["planning"],
          kiroManifest: undefined,
        }),
      ],
      { skillName: "exam-review" }
    );
    expect(result.ok).toBe(true);
    expect(result.instructions).toBe("instructions-exam-review");
    expect(result.requiredTools).toEqual(["propose_study_plan"]);
    expect(result.requiredCapabilities).toEqual(["planning"]);
    // 内部 provenance 绝不进入模型
    expect(result.metadata).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("sourceTurnId");
    expect(JSON.stringify(result)).not.toContain("kiroManifest");
  });

  it("disabled workflow → DISABLED", () => {
    const result = activateSkill([pkg({ name: "exam-review", enabled: false })], { skillName: "exam-review" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("DISABLED");
  });
});

describe("Desktop Recipe prompt 只消费 Recipe Registry", () => {
  it("workflow 不进 recipe section；recipe 进入", () => {
    const registry = buildKiroSkillRegistry([
      pkg({ name: "computer-control" }),
      pkg({ name: "desktop-wechat-send-file", kind: "recipe", description: "在微信发送文件" }),
    ]);
    const section = buildDesktopRecipePromptSection(registry.recipes);
    expect(section).toContain("desktop-wechat-send-file");
    expect(section).not.toContain("computer-control");
    // 旧成功 ≠ 当前界面：必须重新 observe / 重新定位 / 重新确认
    expect(section).toContain("重新 observe_desktop");
    expect(section).toContain("风险动作仍需逐次确认");
  });
});
