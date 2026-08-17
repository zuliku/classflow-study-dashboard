/** 共享 Planning 常量（Planner / Capacity Allocator / Outlook 共用，禁止复制）。
 *  PLAN_MIN_BLOCK_MINUTES 是「正常学习块的 preferred minimum」——不是 correctness hard minimum：
 *  短任务（<30min）、不规则尾数、Deadline 截断小片段允许 <30min 的 terminal/exceptional block
 *  （分钟守恒优先于避免短块）。PLAN_PREFERRED_BLOCK_MINUTES 是单块目标上限（≤90，绝不允许超）。
 */
export const PLAN_MIN_BLOCK_MINUTES = 30;
export const PLAN_PREFERRED_BLOCK_MINUTES = 90;
