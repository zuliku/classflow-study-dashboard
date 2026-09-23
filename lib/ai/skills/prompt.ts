/**
 * Skill Prompt — System Context 中的 Available Skills / Activated Skill 段落。
 * 只消费 Workflow Skill（catalog 由 catalog.ts / registry.ts 派生）。
 */

import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

export { buildSkillCatalogSection, buildSkillCatalogPromptSection } from "@/lib/ai/skills/catalog";

export function buildSkillActivationPrompt(skillName: string, instructions: string): string {
  return `\n\n# Activated Skill: ${skillName}\n${instructions}\n\n${SKILL_PERMISSIONS_NOTE}\n`;
}
