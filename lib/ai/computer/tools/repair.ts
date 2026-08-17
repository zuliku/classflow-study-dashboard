/**
 * Bounded Tool Call Repair guard（V2.2）。
 * 规则（纯函数，可单测）：
 * - 只有 InvalidToolInputError 才可能 repair（NoSuchToolError 等一律不修）
 * - 只 repair create_document / update_document
 * - 一个 toolCallId 最多 repair 1 次（Set 去重，不形成失败→retry 循环）
 * - raw invalid input 超过上限不 repair（避免巨大 repair prompt）
 */
import { InvalidToolInputError } from "ai";

export const KIRO_TOOL_CALL_REPAIR_MAX_INPUT_BYTES = 24 * 1024;

export const KIRO_REPAIRABLE_DOCUMENT_TOOLS = new Set(["create_document", "update_document"]);

export function shouldRepairToolCall(options: {
  error: unknown;
  toolName: string;
  toolCallId: string;
  inputSizeBytes: number;
  alreadyRepaired: Set<string>;
}): boolean {
  if (!(options.error instanceof InvalidToolInputError)) return false;
  if (!KIRO_REPAIRABLE_DOCUMENT_TOOLS.has(options.toolName)) return false;
  if (options.alreadyRepaired.has(options.toolCallId)) return false;
  if (options.inputSizeBytes > KIRO_TOOL_CALL_REPAIR_MAX_INPUT_BYTES) return false;
  return true;
}
