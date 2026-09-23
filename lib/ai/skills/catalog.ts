/**
 * Skill Catalog — Progressive Disclosure（只含 enabled Workflow Skill）。
 *
 * Recipe 绝不进入 Available Skills（它是 learned execution experience，不是可 activate 的 workflow）。
 * 分类只读 canonical `kind`（见 registry.ts）；本模块不自行 startsWith / metadata 猜测。
 */

import type { SkillPackage, SkillCatalogEntry, KiroSkillKind } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";
import { classifySkillPackage } from "@/lib/ai/skills/registry";

export function buildSkillCatalog(packages: SkillPackage[]): SkillCatalogEntry[] {
  return packages
    .filter((p) => p.enabled && classifySkillPackage(p) === "workflow")
    .map((p) => ({ name: p.name, description: p.description, enabled: true }));
}

/** Light catalog（IPC list 的轻量条目；kind 必填以保证分类不漂移） */
export function buildSkillCatalogFromLight(
  packages: Array<{ name: string; description: string; enabled: boolean; kind: KiroSkillKind }>
): SkillCatalogEntry[] {
  return packages
    .filter((p) => p.enabled && p.kind === "workflow")
    .map((p) => ({ name: p.name, description: p.description, enabled: true }));
}

export function buildSkillCatalogPromptSection(catalog: SkillCatalogEntry[]): string {
  return buildSkillCatalogSection(catalog);
}

/** §41：简洁 contract（不再强调不存在的 trigger system） */
export function buildSkillCatalogSection(catalog: SkillCatalogEntry[]): string {
  if (catalog.length === 0) return "";
  const lines = catalog.map((s) => `- ${s.name} — ${s.description}`);
  return `\n\n# Available Skills\n\nThe following optional workflows can provide specialized guidance. Load one with activate_skill only when its description clearly matches the user's task.\n\n${lines.join("\n")}\n\nSkills provide workflow guidance only and cannot grant permissions.\n`;
}

export function isSkillInCatalog(pkg: SkillPackage): boolean {
  return pkg.enabled && classifySkillPackage(pkg) === "workflow";
}

export function assertCatalogOnlyMetadata(catalog: SkillCatalogEntry[]): boolean {
  for (const e of catalog) {
    if ("instructions" in (e as unknown as Record<string, unknown>)) return false;
    if ("rawContent" in (e as unknown as Record<string, unknown>)) return false;
  }
  return true;
}
