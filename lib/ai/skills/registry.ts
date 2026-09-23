/**
 * Kiro Skill Registry（S1 §23）— 分类的唯一来源。
 *
 * 数据流：
 *   SkillPackage[] → Registry → { workflows, recipes }
 *                    ├── workflows → Catalog / Slash / activate_skill
 *                    └── recipes   → desktop recipe prompt（S4 再做 retrieval）
 *
 * 规则：
 * - 分类只读 canonical `kind` 字段；
 * - `desktop-*` prefix heuristic 只允许出现在本文件的 migration resolver（旧数据兼容）；
 * - Catalog / Activation / Slash / Prompt 不得自行 .filter(kind) / .startsWith("desktop-")。
 */
import type { KiroSkillKind, SkillPackage } from "@/lib/ai/skills/types";

/** legacy 判定前缀：仅用于 migration / normalization boundary（不得在其它消费者复制） */
export const LEGACY_DESKTOP_RECIPE_PREFIX = "desktop-";

/**
 * 旧数据 → kind（唯一 migration resolver）：
 * 1. 显式 manifest kind → authoritative；
 * 2. name 以 desktop- 开头 → recipe（旧 desktop 轨迹产物）；
 * 3. 其余 → workflow。
 */
export function resolveLegacySkillKind(input: {
  name: string;
  manifestKind?: KiroSkillKind | null;
}): KiroSkillKind {
  if (input.manifestKind === "workflow" || input.manifestKind === "recipe") {
    return input.manifestKind;
  }
  if (
    typeof input.name === "string" &&
    input.name.startsWith(LEGACY_DESKTOP_RECIPE_PREFIX) &&
    input.name.length > LEGACY_DESKTOP_RECIPE_PREFIX.length
  ) {
    return "recipe";
  }
  return "workflow";
}

/** 分类单个 package（kind 缺失时走 migration resolver） */
export function classifySkillPackage(pkg: { name: string; kind?: KiroSkillKind }): KiroSkillKind {
  return resolveLegacySkillKind({ name: pkg.name, manifestKind: pkg.kind ?? null });
}

export interface KiroSkillRegistry {
  workflows: SkillPackage[];
  recipes: SkillPackage[];
}

/** 分类全部 package（保持输入顺序；同名单次去重，后者忽略） */
export function buildKiroSkillRegistry(packages: SkillPackage[]): KiroSkillRegistry {
  const seen = new Set<string>();
  const workflows: SkillPackage[] = [];
  const recipes: SkillPackage[] = [];
  for (const pkg of packages) {
    if (seen.has(pkg.name)) continue;
    seen.add(pkg.name);
    if (classifySkillPackage(pkg) === "recipe") recipes.push(pkg);
    else workflows.push(pkg);
  }
  return { workflows, recipes };
}

export function listWorkflowSkills(
  packages: SkillPackage[],
  opts?: { enabledOnly?: boolean }
): SkillPackage[] {
  return buildKiroSkillRegistry(packages).workflows.filter(
    (pkg) => !opts?.enabledOnly || pkg.enabled
  );
}

export function listRecipeSkills(
  packages: SkillPackage[],
  opts?: { enabledOnly?: boolean }
): SkillPackage[] {
  return buildKiroSkillRegistry(packages).recipes.filter(
    (pkg) => !opts?.enabledOnly || pkg.enabled
  );
}
