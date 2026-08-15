/**
 * Visual Turn Mutation Guard（Task B 硬性验收）：
 * 本 User Turn 绑定 ready image attachment（turnHasImageSource === true）时，
 * ClassFlow 业务 mutation（Write Tools + apply_change_set）一律拒绝，返回 VISUAL_PROPOSAL_REQUIRED。
 * 不约束：Read Tools / propose_visual_actions / web search / final answer / Computer 工具 / Memory 工具。
 * 这是 deterministic guard，不是 Prompt 依赖。
 */
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";

export const VISUAL_PROPOSAL_REQUIRED_CODE = "VISUAL_PROPOSAL_REQUIRED";
export const VISUAL_PROPOSAL_REQUIRED_MESSAGE =
  "该回合包含图片来源。请先使用 propose_visual_actions 生成用户可预览的修改方案，不要直接写入 ClassFlow。";

/** 是否属于 ClassFlow 业务 mutation（Write Tools + apply_change_set） */
export function isClassFlowMutationTool(toolName: string): boolean {
  return (KIRO_WRITE_TOOL_NAMES as string[]).includes(toolName) || toolName === "apply_change_set";
}
