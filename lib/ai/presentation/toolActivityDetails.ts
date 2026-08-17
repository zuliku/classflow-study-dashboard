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

/** 通用 fallback 文案（无实质信息；UI 不为其显示 disclosure） */
const GENERIC_TOOL_DETAILS = new Set(["正在处理…", "已完成", "执行未完成"]);

/**
 * 是否有「有意义的」Tool Detail：
 * 只用于决定 UI 是否出现 Chevron / disclosure。
 * generic fallback（formatKiroToolActivityDetail 的默认值）→ false；
 * 真实确定性事实（找到 N 个任务 / 已读取「title」等）→ true。
 */
export function hasMeaningfulKiroToolDetails(details: string[]): boolean {
  return details.some((detail) => !GENERIC_TOOL_DETAILS.has(detail.trim()));
}

/* ---------------- Task 17B：Tool Row 主文案（headline）安全格式化 ---------------- */

export const WEB_ACTIVITY_QUERY_MAX_CHARS = 72;
export const WEB_ACTIVITY_TITLE_MAX_CHARS = 52;

/** Search Query sanitizer：trim / collapse whitespace / ≤72 chars（69 + …）；只允许显示 query 字段 */
export function formatWebSearchQueryForActivity(input: unknown): string {
  const q = (input as { query?: unknown } | null)?.query;
  if (typeof q !== "string") return "";
  const collapsed = q.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  if (collapsed.length <= WEB_ACTIVITY_QUERY_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, WEB_ACTIVITY_QUERY_MAX_CHARS - 3)}…`;
}

function truncateActivityTitle(text: string): string {
  if (text.length <= WEB_ACTIVITY_TITLE_MAX_CHARS) return text;
  return `${text.slice(0, WEB_ACTIVITY_TITLE_MAX_CHARS - 3)}…`;
}

function searchResultCount(output: unknown): number {
  const data = (output as { ok?: boolean; data?: { results?: unknown[] } } | null)?.data;
  return Array.isArray(data?.results) ? data.results.length : 0;
}

function readSourceIdsOf(input: unknown): string[] {
  const ids = (input as { sourceIds?: unknown } | null)?.sourceIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function readSuccessCount(output: unknown): number {
  const sources = (output as { ok?: boolean; data?: { sources?: unknown[] } } | null)?.data?.sources;
  return Array.isArray(sources) ? sources.length : 0;
}

export interface KiroToolActivityHeadlineInput {
  toolName: string;
  status: KiroToolDetailStatus;
  input?: unknown;
  output?: unknown;
  /** 当前 Turn 已完成 web_search 结果的 source lookup（Presentation 内构建；只含 title/domain） */
  trustedWebSources?: Map<string, { title: string; domain: string }>;
}

/**
 * Tool Row 主文案（Task 17B）：
 * - web_search：显示 sanitized query（working/done/error 三态）；无安全 query → 通用文案
 * - read_web_source：显示来源 title（来自当前 Turn 真实 Search Result lookup）；内部 ID / URL 绝不展示
 * - 其他 Tool：返回 null（UI 继续用 block.label）
 * 严禁 raw JSON.stringify、includeDomains/excludeDomains/sourceIds/apiKey 等其它字段。
 */
export function formatKiroToolActivityHeadline(input: KiroToolActivityHeadlineInput): string | null {
  const { toolName, status, input: toolInput, output, trustedWebSources } = input;

  if (toolName === "web_search") {
    const q = formatWebSearchQueryForActivity(toolInput);
    if (status === "working") return q ? `正在搜索网页：${q}` : "正在搜索网页…";
    if (status === "error") return q ? `网页搜索失败：${q}` : "网页搜索失败";
    const count = searchResultCount(output);
    const suffix = count > 0 ? ` · ${count} 个来源` : "";
    return q ? `已搜索网页：${q}${suffix}` : `搜索网页${suffix}`;
  }

  if (toolName === "read_web_source") {
    const ids = readSourceIdsOf(toolInput);
    const present = ids
      .map((id) => trustedWebSources?.get(id))
      .filter((t): t is { title: string; domain: string } => !!t);
    const multi = ids.length > 1;
    const titleOf = (t: { title: string; domain: string } | undefined) =>
      t ? truncateActivityTitle(t.title || t.domain) : "";

    if (status === "working") {
      if (multi) return `正在阅读 ${ids.length} 个网页来源`;
      const t = titleOf(present[0]);
      return t ? `正在阅读网页：${t}` : "正在阅读网页…";
    }
    if (status === "error") return "网页内容读取失败";
    const successCount = readSuccessCount(output);
    if (successCount > 1) return `已阅读 ${successCount} 个网页来源`;
    if (successCount === 1) {
      // Task 17B1 §24：请求多个、只成功一个 → partial，主行用数量；不展示失败 sourceId
      if (multi) return "已阅读 1 个网页来源";
      const t = titleOf(present[0]);
      return t ? `已阅读网页：${t}` : "已阅读网页…";
    }
    return "网页内容读取失败"; // empty evidence：不显示「已阅读 0 个来源」
  }

  // Task 17B1 §5：非联网 Tool 一律返回 null，UI 继续用 block.label（禁止顺手重写其它 Tool 文案）
  return null;
}

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
  // Task 16B：read_web_source 专属（不展示工具名 / URL / query / Tavily Extract）
  if (toolName === "read_web_source") {
    if (status === "working") return ["正在阅读网页"];
    if (status === "error") return ["网页内容读取失败"];
    const sources = (output as { ok?: boolean; data?: { sources?: unknown[] } } | null)?.data?.sources;
    const count = Array.isArray(sources) ? sources.length : 0;
    return [`已阅读 ${count} 个来源`];
  }
  // Task 14：web_search 专属（不展示工具名 / Tavily / raw query / API Key）
  if (toolName === "web_search") {
    if (status === "working") return ["正在搜索网络"];
    if (status === "error") return ["网络搜索失败"];
    const data = (output as { ok?: boolean; data?: { results?: unknown[] } } | null)?.data;
    const count = Array.isArray(data?.results) ? data.results.length : 0;
    return [`搜索网络 · ${count} 个来源`];
  }
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
