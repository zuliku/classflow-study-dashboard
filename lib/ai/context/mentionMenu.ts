import type { KiroContextRef } from "@/lib/ai/context/types";
import { getKiroContextGroups } from "@/lib/ai/context/options";
import { moveSlashIndex } from "@/lib/ai/skills/slashMenu";

/**
 * @ mention 菜单（Kiro Composer）——纯逻辑，对标 Slash Skill 菜单：
 *
 * 产品规则（与 slash 同构）：
 * - 只有输入尾部的 `@query`（@ 后无空格、无第二个 @）才展开；
 *   选中后文本变为 `@label `（带尾随空格）→ 自动折叠，不会重新弹出。
 * - 空 query（只输入 `@`）展示全部（上限截断）。
 * - 选项与 KiroContextListView 同源（getKiroContextGroups 展平），label 子串匹配。
 */
export interface MentionOption {
  key: string;
  label: string;
  group: string;
  ref: KiroContextRef;
}

/** 菜单最多展示条数（输入区上方浮层，保持小巧） */
export const MENTION_MENU_LIMIT = 8;

/** 从输入文本解析 mention query；不是 @ 输入 → null */
export function parseMentionQuery(text: string): string | null {
  const match = /@([^\s@]*)$/.exec(text);
  if (!match) return null;
  // 邮箱误触防护：@ 前是 ASCII 词字符（foo@bar）视为邮箱/标识符；
  // CJK 前无空格是正常中文输入（帮我看下@高数），必须放行。
  const atIndex = text.length - match[0].length;
  if (atIndex > 0 && /[\w@]/.test(text[atIndex - 1])) return null;
  return match[1];
}

type ContextSource = Parameters<typeof getKiroContextGroups>;

/** 分组展平 + query 过滤（大小写不敏感；空 query → 按组序取前 N） */
export function filterMentionOptions(
  groups: ReturnType<typeof getKiroContextGroups>,
  query: string
): MentionOption[] {
  const q = query.trim().toLowerCase();
  const flat: MentionOption[] = [];
  for (const g of groups) {
    for (const ref of g.items) {
      if (!q || ref.label.toLowerCase().includes(q)) {
        flat.push({ key: ref.key, label: ref.label, group: g.title, ref });
      }
    }
  }
  return flat.slice(0, MENTION_MENU_LIMIT);
}

/** 由 Store 实体直接构建可展示选项（Composer 内联使用） */
export function buildMentionOptions(
  courses: ContextSource[0],
  assignments: ContextSource[1],
  groupProjects: ContextSource[2],
  query: string
): MentionOption[] {
  return filterMentionOptions(getKiroContextGroups(courses, assignments, groupProjects), query);
}

/** 键盘导航：复用 slash 循环语义 */
export function moveMentionIndex(current: number, delta: number, length: number): number {
  return moveSlashIndex(current, delta, length);
}

/** 选中后回填文本：尾部 @query → @label + 空格（与 slash 同构） */
export function applyMentionPick(text: string, label: string): string {
  return text.replace(/@[^\s@]*$/, `@${label} `);
}
