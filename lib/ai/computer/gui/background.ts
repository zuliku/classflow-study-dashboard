/**
 * 后台静默操作 — 模式决策（纯函数）。
 *
 * 安全不变量（fail closed）：
 * - consent 缺失 → 前台（既有行为，不改变任何默认路径）；
 * - 非语义动作（double_click/focus/key/scroll/hover/right_click/drag/wait/…）
 *   → 前台（坐标/焦点/光标依赖；遮挡时点中错误窗口比不做更糟）；
 * - 无元素目标（归一化坐标）→ 前台（坐标相对的是屏幕，不是被挡住的窗口）；
 * - 最小化窗口 → 不在此判定（PS 侧 IsIconic 直接 window-minimized，绝不恢复窗口，
 *   因为恢复 = 可见动作，违背后台承诺）；
 * - 后台路径内语义不可用（无 Invoke/Select/Value pattern）→ PS 侧
 *   foreground-required，executor 不自动回退前台（回退 = 偷偷抢焦点）。
 */
export const BACKGROUND_SEMANTIC_ACTIONS: ReadonlySet<string> = new Set(["click", "type"]);

/** 该动作是否可能走后台（pattern 直调；实际能否执行由 PS 侧 pattern 存在性决定） */
export function canRunInBackground(action: string): boolean {
  return BACKGROUND_SEMANTIC_ACTIONS.has(action);
}

export type BackgroundMode = "background" | "foreground";

/**
 * 本次调用走后台还是前台。只读决策，不执行、不改状态。
 * backgroundAllowed 来自冻结 snapshot（用户设置 consent，非模型可自授）。
 */
export function resolveBackgroundMode(input: {
  backgroundAllowed: boolean;
  action: string;
  hasElementTarget: boolean;
}): BackgroundMode {
  if (!input.backgroundAllowed) return "foreground";
  if (!canRunInBackground(input.action)) return "foreground";
  if (!input.hasElementTarget) return "foreground";
  return "background";
}
