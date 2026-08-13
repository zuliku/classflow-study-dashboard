import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { KIRO_MEMORY_WRITE_TOOL_NAMES } from "@/lib/ai/memory/tools";
import { COMPUTER_MUTATION_TOOL_NAMES } from "@/lib/ai/computer/tools/registry";

/**
 * 所有会产生持久化 mutation 的工具（Regenerate 安全判断用）：
 * 业务 Write Tools + apply_change_set + Memory Write Tools（save/update/delete_memory）
 * + Computer Mutation Tools（create_directory / create_text_file / patch_text_file / create_document）。
 * 这些 Turn 一律 canRegenerate = false。
 */
export const KIRO_MUTATING_TOOL_NAMES: string[] = [
  ...KIRO_WRITE_TOOL_NAMES,
  ...KIRO_MEMORY_WRITE_TOOL_NAMES,
  ...Array.from(COMPUTER_MUTATION_TOOL_NAMES),
];
