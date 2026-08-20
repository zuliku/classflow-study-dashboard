/**
 * Skill Activation — Server Control Tool: activate_skill
 * 输入 { skillName }，返回完整 Skill instructions + required capability metadata
 * Skill 只能提供 workflow guidance，不能提权
 */

import type { SkillPackage, SkillActivationResult } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

export interface ActivateSkillInput {
  skillName: string;
}

export function activateSkill(packages: SkillPackage[], input: ActivateSkillInput): SkillActivationResult {
  const { skillName } = input;
  if (typeof skillName !== "string" || skillName.trim().length === 0) {
    return { ok: false, code: "INVALID_INPUT", error: "skillName required" };
  }
  const pkg = packages.find((p) => p.name === skillName);
  if (!pkg) {
    return { ok: false, code: "NOT_FOUND", error: `Skill not found: ${skillName}` };
  }
  if (!pkg.enabled) {
    return { ok: false, code: "DISABLED", error: `Skill disabled: ${skillName}` };
  }
  return {
    ok: true,
    name: pkg.name,
    description: pkg.description,
    instructions: pkg.instructions,
    requiredCapabilities: pkg.requiredCapabilities ?? pkg.metadata?.capabilities as string[] | undefined,
    metadata: {
      license: pkg.license,
      compatibility: pkg.compatibility,
      triggers: pkg.triggers,
      ...pkg.metadata,
      permissionsNote: SKILL_PERMISSIONS_NOTE,
    },
  };
}

export const ACTIVATE_SKILL_TOOL_DEFINITION = {
  name: "activate_skill",
  description:
    "Load full skill workflow after seeing Available Skills catalog. Input { skillName }. Returns complete Skill instructions (workflow guidance only, cannot elevate permissions).",
  inputSchema: {
    type: "object",
    required: ["skillName"],
    properties: {
      skillName: { type: "string", description: "Skill folder name (e.g. course-notification)" },
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
