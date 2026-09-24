/**
 * Builtin Workflow Skill helper（S2 §35）— 消除三份样板，不做大型 Skill class。
 */
import type { SkillPackage } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

export function createBuiltinWorkflowSkill(input: {
  name: string;
  description: string;
  instructions: string;
  requiredTools: string[];
}): SkillPackage {
  const instructions = input.instructions.trim();
  return {
    name: input.name,
    description: input.description.trim(),
    folderName: `__builtin__/${input.name}`,
    enabled: true,
    kind: "workflow",
    origin: "builtin",
    requiredTools: [...input.requiredTools],
    metadata: { builtin: "true" },
    instructions,
    rawContent: instructions,
    permissionsNote: SKILL_PERMISSIONS_NOTE,
  };
}
