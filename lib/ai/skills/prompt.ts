/**
 * Skill Prompt — 构建 System Context 中的 Available Skills 段落
 */

import type { SkillCatalogEntry } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

export function buildSkillCatalogSection(catalog: SkillCatalogEntry[]): string {
  if (catalog.length === 0) return "";
  const lines = catalog.map((s) => `- ${s.name} — ${s.description}`);
  return `\n\n# Available Skills (progressive disclosure: only name/description loaded; call activate_skill to load full workflow)\n${lines.join("\n")}\n\n${SKILL_PERMISSIONS_NOTE}\n`;
}

export function buildSkillCatalogPromptSection(catalog: SkillCatalogEntry[]): string {
  return buildSkillCatalogSection(catalog);
}

export function buildSkillActivationPrompt(skillName: string, instructions: string): string {
  return `\n\n# Activated Skill: ${skillName}\n${instructions}\n\n${SKILL_PERMISSIONS_NOTE}\n`;
}
