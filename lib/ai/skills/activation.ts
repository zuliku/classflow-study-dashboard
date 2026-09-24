/**
 * Skill Activation — Server Control Tool: activate_skill
 *
 * 只允许激活 Workflow Skill：
 * - kind === "recipe" → NOT_ACTIVATABLE（learned recipe 不是可 activate 的 workflow）；
 * - 返回值只含 name / description / instructions / requiredCapabilities / requiredTools；
 *   绝不把 metadata / kiroManifest / parameters / sourceTurnId / origin / 路径泄给模型；
 * - Skill 只能提供 workflow guidance，不能提权（requiredPermissions 只是「想使用的权限类别」，
 *   不代表授予；activation 绝不修改 permission rules / agent mode / grants）。
 */

import type { SkillPackage, SkillActivationResult } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";
import { classifySkillPackage } from "@/lib/ai/skills/registry";
import { resolveBuiltinSkillAlias } from "@/lib/ai/skills/builtinAliases";

export interface ActivateSkillInput {
  skillName: string;
}

export function activateSkill(packages: SkillPackage[], input: ActivateSkillInput): SkillActivationResult {
  const requested = typeof input.skillName === "string" ? input.skillName.trim() : "";
  if (requested.length === 0) {
    return { ok: false, code: "INVALID_INPUT", error: "skillName required" };
  }
  // S2 §40：legacy alias 在 lookup boundary 解析为 canonical 名称（返回 canonical name，不返回假 Skill）
  const skillName = resolveBuiltinSkillAlias(requested) ?? requested;
  const pkg = packages.find((p) => p.name === skillName);
  if (!pkg) {
    return { ok: false, code: "NOT_FOUND", error: `Skill not found: ${skillName}` };
  }
  if (classifySkillPackage(pkg) === "recipe") {
    return {
      ok: false,
      code: "NOT_ACTIVATABLE",
      error: `Learned recipe cannot be activated as a workflow skill: ${skillName}`,
    };
  }
  if (!pkg.enabled) {
    return { ok: false, code: "DISABLED", error: `Skill disabled: ${skillName}` };
  }
  return {
    ok: true,
    name: pkg.name,
    description: pkg.description,
    instructions: pkg.instructions,
    // canonical manifest 字段（无 metadata.capabilities fallback）
    requiredCapabilities: pkg.requiredCapabilities,
    requiredTools: pkg.requiredTools,
  };
}

export const ACTIVATE_SKILL_TOOL_DEFINITION = {
  name: "activate_skill",
  description:
    "Load a workflow skill's full guidance after seeing the Available Skills catalog. Input { skillName }. Only workflow skills can be activated; skills provide workflow guidance only and cannot elevate permissions.",
  inputSchema: {
    type: "object",
    required: ["skillName"],
    properties: {
      skillName: { type: "string", description: "Workflow skill folder name (e.g. study-planning)" },
    },
  },
} as const;

export function assertSkillCannotElevate(instructions: string): { ok: boolean; reason?: string } {
  const lower = instructions.toLowerCase();
  const forbidden = ["grant permission", "elevate permission", "system authority", "sudo", "admin"];
  for (const phrase of forbidden) {
    if (lower.includes(phrase)) {
      return { ok: false, reason: `instruction contains forbidden phrase: ${phrase}` };
    }
  }
  return { ok: true };
}

/** 语义声明（测试引用）：activation 绝不修改这些 Runtime 状态 */
export const SKILL_ACTIVATION_NEVER_MUTATES = [
  "permissionRules",
  "agentMode",
  "desktopPermissions",
  "terminalPermissions",
  "filesystemGrants",
  "mcpPermissions",
] as const;

export { SKILL_PERMISSIONS_NOTE };
