/**
 * Computer Use V2.6 — 「本机成功配方」注入（Server / Chat Route 侧，纯函数）。
 *
 * 数据来源：用户由桌面成功轨迹生成的 Skill（name 前缀 `desktop-`）。
 * 安全契约：
 * - 只注入已启用 Skill；最多 3 条
 * - 指令摘要清洗控制字符 + 绝对路径（Windows 盘符 / UNC），并限长
 * - 配方只是「过去成功过的步骤参考」：仍要求按当前界面重新 observe_desktop 定位元素
 */
import type { SkillPackage } from "@/lib/ai/skills/types";

export const MAX_DESKTOP_RECIPES = 3;
export const DESKTOP_RECIPE_PREFIX = "desktop-";
const MAX_RECIPE_SUMMARY_LENGTH = 700;

export function isDesktopRecipeSkill(skill: { name: string }): boolean {
  return (
    typeof skill.name === "string" &&
    skill.name.startsWith(DESKTOP_RECIPE_PREFIX) &&
    skill.name.length > DESKTOP_RECIPE_PREFIX.length
  );
}

/** 清洗指令摘要：控制字符 / 绝对路径 / 折叠空白 / 限长 */
export function sanitizeRecipeSummary(instructions: string): string {
  return instructions
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[本机路径]")
    .replace(/\\\\[^\s"']+/g, "[本机路径]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RECIPE_SUMMARY_LENGTH);
}

/**
 * 构建「本机成功配方」Prompt section（无可用配方 → 空字符串）。
 * 只读取 name / description / instructions / enabled；不注入 metadata。
 */
export function buildDesktopRecipePromptSection(
  skills: Array<Pick<SkillPackage, "name" | "description" | "instructions" | "enabled">>
): string {
  const recipes = skills
    .filter((skill) => skill.enabled !== false && isDesktopRecipeSkill(skill))
    .slice(0, MAX_DESKTOP_RECIPES);
  if (recipes.length === 0) return "";

  const lines = [
    "# 本机成功配方（来自你过去成功完成的桌面任务）",
    "以下是用户在本机由成功轨迹生成的配方，可作为步骤与验证方式的参考；",
    "但必须按当前界面重新 observe_desktop / find_desktop_element 定位元素，禁止复用旧 elementId，风险动作仍需逐次确认。",
  ];
  for (const recipe of recipes) {
    lines.push(`- ${recipe.name}：${sanitizeRecipeSummary(recipe.description ?? "")}`);
    const summary = sanitizeRecipeSummary(recipe.instructions ?? "");
    if (summary) lines.push(`  步骤要点：${summary}`);
  }
  return lines.join("\n");
}
