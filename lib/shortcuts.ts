/**
 * V5A4 Static Shortcut Truth：应用内单键快捷键的唯一静态真值源。
 *
 * - 只描述 Runtime 真实行为（GlobalShortcutController / AssignmentTable 现状），不承诺可配置能力。
 * - 语义键名对应真实行为：X = 选择/切换选择（绝非删除任务）；Space = 预览任务（桌面端），
 *   Space / Arrow / Enter 等固定可访问键保留在各自 Runtime 原处，不在此过度建模。
 * - 用户自定义按键 / 录入 / 冲突检测属于未来单独阶段（V5A5），本轮不做。
 */
export const SINGLE_KEY_SHORTCUTS = {
  /** N：快速新建任务（无输入焦点时） */
  quickCreateTask: "N",
  /** /：打开搜索 */
  openSearch: "/",
  /** ?：打开快捷键帮助 */
  openHelp: "?",
  /** J：任务列表向下移动 */
  assignmentMoveDown: "J",
  /** K：任务列表向上移动 */
  assignmentMoveUp: "K",
  /** X：选择 / 取消选择任务（不是删除） */
  assignmentToggleSelection: "X",
} as const;

export type SingleKeyShortcutId = keyof typeof SINGLE_KEY_SHORTCUTS;

/**
 * 单键匹配（大小写归一：J/j、K/k、N/n、X/x；/ 与 ? 原样比较）。
 * 仅减少重复硬编码，不改变任何 gating / suppression 语义。
 */
export function matchesShortcutKey(eventKey: string, shortcut: string): boolean {
  if (typeof eventKey !== "string" || typeof shortcut !== "string") return false;
  if (eventKey.length !== 1 || shortcut.length !== 1) return eventKey === shortcut;
  return eventKey.toLowerCase() === shortcut.toLowerCase();
}
