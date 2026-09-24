/**
 * Builtin Workflow Skills（S2：10 → 3）—— 唯一事实来源。
 *
 * 最终只保留三个真正有方法论价值的 Builtin Workflow Skill：
 * - study-planning（合并 timetable-analysis + task-triage + study-plan）
 * - course-material-analysis（升级自 document-handling）
 * - class-notice-to-actions（ClassFlow-native 新增）
 *
 * 被移除的 6 个（focus-coach / web-research / computer-control / terminal-helper /
 * file-organizer / reminder-assistant）已由 Core Protocol / Tool Contract / Domain Semantics
 * 承担（KIRO_SYSTEM_PROMPT + desktopCapabilityPrompt + Tool Description + Policy）。
 * 它们不再是 Skill，也不提供 legacy alias。
 */
import type { SkillPackage } from "@/lib/ai/skills/types";
import { STUDY_PLANNING_SKILL } from "@/lib/ai/skills/builtin/studyPlanning";
import { COURSE_MATERIAL_ANALYSIS_SKILL } from "@/lib/ai/skills/builtin/courseMaterialAnalysis";
import { CLASS_NOTICE_TO_ACTIONS_SKILL } from "@/lib/ai/skills/builtin/classNoticeToActions";
import { BUILTIN_ALIAS_NAMES } from "@/lib/ai/skills/builtinAliases";

export { createBuiltinWorkflowSkill } from "@/lib/ai/skills/builtin/helper";

export const BUILTIN_SKILLS: SkillPackage[] = [
  STUDY_PLANNING_SKILL,
  COURSE_MATERIAL_ANALYSIS_SKILL,
  CLASS_NOTICE_TO_ACTIONS_SKILL,
];

/** 内置 Skill 名称保留字：用户创建/导入同名 Skill 时拒绝（单一事实来源：BUILTIN_SKILLS） */
export const BUILTIN_SKILL_NAMES: readonly string[] = BUILTIN_SKILLS.map((s) => s.name);

/** 内置 + legacy alias 名称集合（collision / reserved 判定用） */
export const BUILTIN_SKILL_NAME_SET: ReadonlySet<string> = new Set<string>([
  ...BUILTIN_SKILL_NAMES,
  ...BUILTIN_ALIAS_NAMES,
]);

/** 保留名列表（builtin canonical + legacy alias；用户不得创建同名 Skill） */
export const BUILTIN_RESERVED_SKILL_NAMES: readonly string[] = [
  ...BUILTIN_SKILL_NAMES,
  ...BUILTIN_ALIAS_NAMES,
];

/**
 * 用户 Skills + 内置 Skills 合并（catalog / activation 统一入口）：
 * - 内置始终启用（产品基础能力，非用户偏好；UI 以锁定态展示，不提供开关）；
 * - Builtin reserved name authoritative：磁盘上遗留的同名 user Skill 不覆盖 builtin
 *   （不删除用户目录数据；由 validator 阻止新建同名，历史 collision 在此让位）。
 */
export function withBuiltinSkills(userPackages: SkillPackage[]): SkillPackage[] {
  return [...BUILTIN_SKILLS, ...userPackages.filter((p) => !BUILTIN_SKILL_NAME_SET.has(p.name))];
}

/** 用户新建/导入时：命中内置保留名（含 legacy alias）则拒绝（错误文案供 UI 直接展示） */
export function assertNotBuiltinSkillName(name: string): { ok: true } | { ok: false; message: string } {
  if (BUILTIN_SKILL_NAME_SET.has(name)) {
    return { ok: false, message: `“${name}”为系统内置 Skill 名称，请换一个名称。` };
  }
  return { ok: true };
}
