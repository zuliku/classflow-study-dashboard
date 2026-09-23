/**
 * Computer Use V2.6 / Skill V2 S1 — 「本机成功配方」注入（Server / Chat Route 侧，纯函数）。
 *
 * 数据来源：Learned Recipe（canonical kind === "recipe"；旧数据 desktop-* 前缀由
 * registry.resolveLegacySkillKind 在读取边界归一）。本模块不自行判断 name prefix。
 *
 * 安全契约：
 * - 只注入已启用 Recipe；最多 3 条（S4 才做 retrieval / ranking）；
 * - 指令摘要清洗控制字符 + 绝对路径（Windows 盘符 / UNC），并限长；
 * - 配方只是「过去成功过的步骤参考」：仍要求按当前界面重新 observe_desktop 定位元素，
 *   风险动作仍需逐次确认；Recipe 绝不改变 Agent mode / 权限 / approval。
 */
import type { SkillPackage } from "@/lib/ai/skills/types";

export const MAX_DESKTOP_RECIPES = 3;
const MAX_RECIPE_SUMMARY_LENGTH = 700;

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
 * 输入必须已经是 Recipe Registry 的产物（kind === "recipe"）；本模块不再分类。
 */
export function buildDesktopRecipePromptSection(
  recipes: Array<Pick<SkillPackage, "name" | "description" | "instructions" | "enabled">>
): string {
  const selected = recipes
    .filter((recipe) => recipe.enabled !== false)
    .slice(0, MAX_DESKTOP_RECIPES);
  if (selected.length === 0) return "";

  const lines = [
    "# 本机成功配方（来自你过去成功完成的桌面任务）",
    "以下是用户在本机由成功轨迹生成的配方，可作为步骤与验证方式的参考；",
    "但必须按当前界面重新 observe_desktop / find_desktop_element 定位元素，禁止复用旧 elementId，风险动作仍需逐次确认。",
  ];
  for (const recipe of selected) {
    lines.push(`- ${recipe.name}：${sanitizeRecipeSummary(recipe.description ?? "")}`);
    const summary = sanitizeRecipeSummary(recipe.instructions ?? "");
    if (summary) lines.push(`  步骤要点：${summary}`);
  }
  return lines.join("\n");
}
