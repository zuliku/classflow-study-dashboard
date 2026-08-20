/**
 * Skill Catalog — Progressive Disclosure
 * 启动时只读取 name/description，激活后才载入完整 instructions
 */

import type { SkillPackage, SkillCatalogEntry } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

export function buildSkillCatalog(packages: SkillPackage[]): SkillCatalogEntry[] {
  return packages
    .filter((p) => p.enabled)
    .map((p) => ({ name: p.name, description: p.description, enabled: true }));
}

export function buildSkillCatalogFromLight(packages: Array<{ name: string; description: string; enabled: boolean }>): SkillCatalogEntry[] {
  return packages.filter((p) => p.enabled).map((p) => ({ name: p.name, description: p.description, enabled: true }));
}

export function buildSkillCatalogPromptSection(catalog: SkillCatalogEntry[]): string {
  if (catalog.length === 0) return "";
  const lines = catalog.map((s) => `- ${s.name} — ${s.description}`);
  return `\n\n# Available Skills ( progressive disclosure: only name/description loaded )\n${lines.join("\n")}\n\nTo load full workflow, call activate_skill with { skillName }.\n${SKILL_PERMISSIONS_NOTE}\n`;
}

export function isSkillInCatalog(pkg: SkillPackage): boolean {
  return pkg.enabled;
}

export function assertCatalogOnlyMetadata(catalog: SkillCatalogEntry[]): boolean {
  for (const e of catalog) {
    if ("instructions" in (e as unknown as Record<string, unknown>)) return false;
    if ("rawContent" in (e as unknown as Record<string, unknown>)) return false;
  }
  return true;
}
