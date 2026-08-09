/**
 * Kiro Memory Tools：Server 只提供 Schema；执行仍在 Browser（IndexedDB）。
 * 与业务 Write Tools 分离（KiroMemoryApi）；但计入 KIRO_MUTATING_TOOL_NAMES（禁止 Regenerate）。
 * save_memory 受 Explicit Intent 守卫（见 useKiroChat）。
 */

import { z } from "zod";
import { tool } from "ai";
import { MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";

const MEMORY_CATEGORY = z.enum(["study-habit", "schedule-preference", "priority-preference", "learning-goal", "course-preference", "constraint", "other"]);
const MEMORY_SCOPE = z.enum(["global", "semester", "course"]);

export const searchMemoriesSchema = z.object({
  query: z.string().trim().max(100).optional(),
  category: MEMORY_CATEGORY.optional(),
  scope: MEMORY_SCOPE.optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export const saveMemorySchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  content: z.string().trim().min(1).max(500),
  category: MEMORY_CATEGORY.optional(),
  scope: MEMORY_SCOPE.optional(),
  scopeId: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
});

export const updateMemorySchema = z.object({
  memoryId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(60).optional(),
  content: z.string().trim().min(1).max(500).optional(),
  category: MEMORY_CATEGORY.optional(),
  scope: MEMORY_SCOPE.optional(),
  scopeId: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
});

export const deleteMemorySchema = z.object({
  memoryId: z.string().trim().min(1).max(120),
});

export const KIRO_MEMORY_TOOL_SCHEMAS = { search_memories: searchMemoriesSchema, save_memory: saveMemorySchema, update_memory: updateMemorySchema, delete_memory: deleteMemorySchema } as const;

export const KIRO_MEMORY_TOOLS = {
  search_memories: tool({
    description:
      "按关键词/分类/范围查找用户的长期学习记忆（偏好、习惯、目标、约束）。" +
      "安排学习计划、调整 DDL、重新排程或制定长期计划前，如 memoryIndex 存在相关条目应先调用本工具获取完整内容。" +
      "Memory 不代表当前 ClassFlow 业务状态。",
    inputSchema: searchMemoriesSchema,
  }),
  save_memory: tool({
    description:
      "保存一条用户明确要求跨会话记住的稳定学习偏好/习惯/目标/约束（仅当用户明确表达「记住/以后都…/我的偏好是…」等意图时使用）。" +
      "禁止保存业务状态（DDL、课表、任务优先级等）。",
    inputSchema: saveMemorySchema,
  }),
  update_memory: tool({
    description: "修改一条已有长期记忆（用户明确修改其偏好时使用）。",
    inputSchema: updateMemorySchema,
  }),
  delete_memory: tool({
    description: "删除一条长期记忆（用户明确要求忘记某偏好时使用）。",
    inputSchema: deleteMemorySchema,
  }),
} as const;

export const KIRO_MEMORY_TOOL_NAMES = Object.keys(KIRO_MEMORY_TOOLS) as (keyof typeof KIRO_MEMORY_TOOLS)[];
export const KIRO_MEMORY_WRITE_TOOL_NAMES = ["save_memory", "update_memory", "delete_memory"] as const;
export type KiroMemoryToolName = (typeof KIRO_MEMORY_TOOLS)[keyof typeof KIRO_MEMORY_TOOLS] extends infer _T ? keyof typeof KIRO_MEMORY_TOOLS : never;
