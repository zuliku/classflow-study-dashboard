/**
 * Slash Command — 显式 Skill invocation
 * 输入以 / 开头，后跟 skill name
 */

import type { SkillCatalogEntry } from "@/lib/ai/skills/types";

export function parseSlashSkillCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const withoutSlash = trimmed.slice(1).trim();
  if (withoutSlash.length === 0) return null;
  const token = withoutSlash.split(/\s+/)[0];
  if (!token) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token)) return null;
  return token;
}

export function isSlashSkillInvocation(text: string, catalog: SkillCatalogEntry[]): boolean {
  const skillName = parseSlashSkillCommand(text);
  if (!skillName) return false;
  return catalog.some((s) => s.name === skillName && s.enabled);
}

export function getEnabledSkillNamesForSlash(catalog: SkillCatalogEntry[]): string[] {
  return catalog.filter((s) => s.enabled).map((s) => s.name);
}
