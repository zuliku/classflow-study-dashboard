/**
 * Kiro Tool Activity Detail（安全白名单）。
 * 只从已完成的 Tool output 中提取少量安全事实：
 * - 数量（找到 N 个任务 / N 条课表安排 / 完成 N 项修改）
 * - 实体标题（已读取「title」/ 已处理「title」）
 *
 * 严禁输出：JSON.stringify(output)、raw input、raw errorText、
 * entity id、storageKey、API/Provider 信息、文件路径、schema。
 * 未知结构一律返回默认状态文案。
 */

export type KiroToolDetailStatus = "working" | "done" | "error";

const DEFAULT_DETAILS: Record<KiroToolDetailStatus, string[]> = {
  working: ["正在处理…"],
  done: ["已完成"],
  error: ["执行未完成"],
};

function isOkEnvelope(output: unknown): output is { ok: true; data?: unknown; action?: unknown } {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { ok?: unknown }).ok === true
  );
}

/** 成功 Read output 的 data 字段 */
function dataOf(output: { data?: unknown }): unknown {
  return output.data;
}

function arrayItems(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * 安全 Activity Detail（数组形态；未知结构 → 默认状态）。
 * status !== "done" 恒默认（错误详情绝不外泄）。
 */
export function formatKiroToolActivityDetail(
  toolName: string,
  status: KiroToolDetailStatus,
  output?: unknown
): string[] {
  if (status !== "done") return DEFAULT_DETAILS[status];
  if (!isOkEnvelope(output)) return DEFAULT_DETAILS.done;

  const data = dataOf(output);

  // Read：任务列表（search_assignments / get_upcoming_assignments）
  if (toolName === "search_assignments" || toolName === "get_upcoming_assignments") {
    const items =
      arrayItems((data as { items?: unknown })?.items) ??
      arrayItems((data as { assignments?: unknown })?.assignments);
    if (items) return [`找到 ${items.length} 个任务`];
    return DEFAULT_DETAILS.done;
  }

  // Read：课表安排
  if (toolName === "get_week_schedule") {
    const items =
      arrayItems((data as { items?: unknown })?.items) ??
      arrayItems((data as { schedule?: unknown })?.schedule);
    if (items) return [`读取 ${items.length} 条课表安排`];
    return DEFAULT_DETAILS.done;
  }

  // Read：单个任务标题
  if (toolName === "get_assignment") {
    const title = (data as { title?: unknown } | null | undefined)?.title;
    if (typeof title === "string" && title.length > 0) return [`已读取「${title}」`];
    return DEFAULT_DETAILS.done;
  }

  // Change Set：整体修改数量
  if (toolName === "apply_change_set") {
    const count =
      (data as { count?: unknown } | null | undefined)?.count ??
      (output.action as { changeSet?: { count?: unknown } } | undefined)?.changeSet?.count;
    if (typeof count === "number") return [`完成 ${count} 项修改`];
    return DEFAULT_DETAILS.done;
  }

  // 成功 Write：action.title 白名单事实
  const action = (output.action ?? null) as { title?: unknown } | null;
  if (action && typeof action.title === "string" && action.title.length > 0) {
    return [`已处理「${action.title}」`];
  }

  return DEFAULT_DETAILS.done;
}
