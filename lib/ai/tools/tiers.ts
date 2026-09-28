/**
 * Kiro 工具两层暴露（上下文 103k → ~60k）。
 *
 * 实测（workspace-auto 全量 135 工具 ≈ 116k 估算）：
 * - 首轮纯聊天（你好）也要下发全部 schema，其中 9 个胖子占 ~73k；
 * - 本轮一旦发起过任意业务工具调用，说明进入任务流，完整集自动开放。
 *
 * 规则：
 * - CORE（首轮默认）：只读 + 小写工具 + 方法论刚需 propose + begin_final_answer；
 * - DEFERRED（延迟）：文档创建/更新、批量变更集、批量提醒、课表导入、
 *   桌面操作、学习历史深查——冷启动任务先做只读确认（本来就是规范动作），
 *   随后完整集自动开放，只多 0 个额外往返（同一次 streamText 内 prepareStep 升级，
 *   跨往返靠消息历史判定）。
 * - begin_final_answer 永不延迟（终答边界协议）；解锁判定忽略它。
 * - server 过滤不是安全边界（executor 独立 policy 求值），只为省上下文。
 */
import { isKiroFinalAnswerToolName } from "@/lib/ai/tools/finalAnswer";

/**
 * 延迟工具（fat schemas；首轮不见业务工具调用时不下发）。
 * 新增胖工具时往这里加；默认 core（fail-open：漏加只多花 token，不坏功能）。
 */
export const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_document",
  "update_document",
  "apply_change_set",
  "propose_timetable_import",
  "create_reminders_batch",
  "update_reminders_batch",
  "delete_reminders_batch",
  "desktop_action",
  "query_learning_history",
]);

export function isDeferredTool(toolName: string): boolean {
  return DEFERRED_TOOL_NAMES.has(toolName);
}

interface TurnMessageLike {
  role?: string;
  parts?: ReadonlyArray<{ type?: string }>;
}

/**
 * 本轮（最后一个 user 之后）是否已出现业务工具调用（终答边界信号除外）。
 * 历史轮工具不算；无 user 消息 → false。
 */
export function turnHasBusinessToolCalls(
  messages: ReadonlyArray<TurnMessageLike>
): boolean {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return false;
  for (let i = lastUserIndex + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== "assistant" || !Array.isArray(m.parts)) continue;
    for (const p of m.parts) {
      if (typeof p?.type !== "string" || !p.type.startsWith("tool-")) continue;
      if (isKiroFinalAnswerToolName(p.type.slice("tool-".length))) continue;
      return true;
    }
  }
  return false;
}

/**
 * prepareStep 层工具门（纯函数）：
 * - 已全量（tiered=false）或已解锁（历史/steps 见过业务工具）→ null（不限制）；
 * - 否则返回 core 名单（deferred 剔除；已在 tools 全集内取交集，调用方保证）。
 * 空 core → null（绝不发空 activeTools，避免 SDK 行为未定义）。
 */
export function resolveTieredActiveTools(input: {
  tiered: boolean;
  unlocked: boolean;
  toolNames: string[];
}): string[] | null {
  if (!input.tiered || input.unlocked) return null;
  const core = input.toolNames.filter((n) => !DEFERRED_TOOL_NAMES.has(n));
  return core.length > 0 ? core : null;
}
