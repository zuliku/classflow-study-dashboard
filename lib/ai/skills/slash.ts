/**
 * Slash Command — 显式 Workflow Skill invocation（/skill-name）。
 *
 * Recipe 不能通过 Slash 绕过 Registry 边界：本模块只消费 workflow catalog；
 * 未命中（含 recipe 名称）→ 不是可用 Skill command，绝不 fallback 到 activate_skill。
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
