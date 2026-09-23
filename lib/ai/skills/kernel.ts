/**
 * Kiro Skill Kernel Boundary（S1 §38）— 架构声明（轻量，不引入空的大型抽象）。
 *
 * 1. Core Agent Protocol
 *    always-on runtime / safety contract：无论是否激活任何 Skill 都必须遵守。
 *    当前承担者（不属于 Skill Registry，也不属于本目录的分类体系）：
 *    - KIRO_SYSTEM_PROMPT（lib/ai/config.ts）
 *    - desktopCapabilityPrompt / computer runtime contracts（lib/ai/computer/*）
 *    - Tool descriptions 与 policy（approval / sandbox / stale observation / Stop）
 *    S2 才迁移错误放在 builtin Skill 里的协议文案；S1 只建立边界。
 *
 * 2. Workflow Skill（kind = "workflow"）
 *    可选、可发现、可显式激活的领域方法（Catalog / Slash / activate_skill）。
 *    只提供 workflow guidance；不能授予工具或权限。
 *
 * 3. Learned Recipe（kind = "recipe"）
 *    从真实成功执行轨迹提取的本机经验（desktop-* legacy 前缀仅用于 migration）。
 *    绝不进入 Catalog / Slash / activate_skill；只进入 desktop recipe prompt（S4 再做 retrieval）。
 *
 * 分类唯一来源：lib/ai/skills/registry.ts（buildKiroSkillRegistry / resolveLegacySkillKind）。
 * 消费者不得自行 `.filter(kind)` / `.startsWith("desktop-")` / `.metadata?.builtin` 判断。
 */

export const KIRO_SKILL_KERNEL_LAYERS = ["core-protocol", "workflow-skill", "learned-recipe"] as const;
export type KiroSkillKernelLayer = (typeof KIRO_SKILL_KERNEL_LAYERS)[number];

/** 本阶段允许的 Skill 种类（Core Protocol 绝不是 Skill kind） */
export const KIRO_SKILL_KINDS = ["workflow", "recipe"] as const;

/** Skill 永远不能改变权限 / Agent mode / grants（语义声明，供测试与文档引用） */
export const KIRO_SKILL_CANNOT_CHANGE = [
  "computer-permission-rules",
  "agent-mode",
  "desktop-permissions",
  "terminal-permissions",
  "filesystem-grants",
  "mcp-permissions",
] as const;
