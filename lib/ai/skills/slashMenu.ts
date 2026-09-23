/**
 * Slash Skill 菜单（Kiro Composer）——纯逻辑：命令解析 / 过滤 / 键盘导航。
 *
 * 产品规则：
 * - 只有「输入中的命令」`/query`（命令后没有空格）才展开菜单；
 *   选中技能后文本变为 `/skill-name `（带尾随空格）→ 菜单自动折叠，不会重新弹出。
 * - 空 query（只输入 `/`）展示全部已启用 Skill。
 * - 只展示 Workflow Skill（kind 来自 IPC canonical 字段；Learned Recipe 不进入菜单）。
 */
export interface SlashSkillOption {
  name: string;
  description: string;
}

/** 从输入文本解析 slash query；不是命令输入 → null */
export function parseSlashQuery(text: string): string | null {
  const match = /^\/([^\s]*)$/.exec(text);
  return match ? match[1] : null;
}

/** 按前缀过滤（大小写不敏感；空 query → 全部） */
export function filterSlashSkills<T extends SlashSkillOption>(
  skills: readonly T[],
  query: string
): T[] {
  const prefix = query.trim().toLowerCase();
  if (!prefix) return [...skills];
  return skills.filter((skill) => skill.name.toLowerCase().startsWith(prefix));
}

/**
 * IPC list → Slash 选项（唯一分类点）：
 * 只保留 enabled && kind === "workflow"；不做 name prefix 判断。
 */
export function toSlashSkillOptions(
  skills: readonly { name: string; description: string; enabled: boolean; kind?: string }[]
): SlashSkillOption[] {
  return skills
    .filter((skill) => skill.enabled && skill.kind === "workflow")
    .map((skill) => ({ name: skill.name, description: skill.description }));
}

/** 键盘导航：循环移动 active index（空列表 → 0） */
export function moveSlashIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((current + delta) % length + length) % length;
}
