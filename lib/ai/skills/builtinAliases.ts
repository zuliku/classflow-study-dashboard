/**
 * Builtin Skill legacy alias（S2 §36–§38）—— 单一 resolver。
 *
 * 仅用于显式兼容：用户手动输入旧 `/command`，或旧历史里的 activate_skill 名称。
 * Alias：
 * - 不进入 Catalog / Slash Suggestions / BUILTIN_SKILLS；
 * - 只把旧名称解析为 canonical Builtin 名称；
 * - 被彻底移除的 6 个旧 Skill（focus-coach / web-research / computer-control /
 *   terminal-helper / file-organizer / reminder-assistant）没有 alias——它们已是 Core 能力。
 */
export const BUILTIN_SKILL_ALIASES: Readonly<Record<string, string>> = {
  "document-handling": "course-material-analysis",
  "timetable-analysis": "study-planning",
  "task-triage": "study-planning",
  "study-plan": "study-planning",
};

/** 全部 legacy alias 名称（reserved 判定用；不进入 Catalog / Slash Suggestions） */
export const BUILTIN_ALIAS_NAMES: readonly string[] = Object.keys(BUILTIN_SKILL_ALIASES);

/**
 * 解析 legacy Builtin 名称 → canonical 名称。
 * 非 alias → null（调用方继续按原名查找，不做其它猜测）。
 */
export function resolveBuiltinSkillAlias(name: string): string | null {
  if (typeof name !== "string") return null;
  return BUILTIN_SKILL_ALIASES[name] ?? null;
}

/** 该名称是否为 legacy alias（不显示、不作为独立 Skill） */
export function isBuiltinSkillAlias(name: string): boolean {
  return resolveBuiltinSkillAlias(name) !== null;
}
