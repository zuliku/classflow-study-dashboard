/**
 * plan-approve 模式 — 冻结范围 prompt 注入（server trust boundary）。
 * approvedPlanContext 是浏览器派生的用户数据：只做 normalize/bound（丢弃非字符串、
 * hard slice），再生成 Prompt section。只描述计划边界（做什么/做到哪），
 * 不含任何授权语义——授权仍由 policy/偏离门独立执行。
 */

/** 上限：冻结范围文本最多进入 prompt 的字符数 */
export const APPROVED_PLAN_CONTEXT_MAX_CHARS = 2000;

/** 请求体字段归一（非字符串/空 → ""；超限截断） */
export function normalizeApprovedPlanContext(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > APPROVED_PLAN_CONTEXT_MAX_CHARS
    ? trimmed.slice(0, APPROVED_PLAN_CONTEXT_MAX_CHARS)
    : trimmed;
}

/** Prompt section（空 → ""；调用方拼接到 computer workspace context 之后） */
export function buildApprovedPlanPromptSection(normalized: string): string {
  if (!normalized) return "";
  return `\n\n# 用户已批准的执行计划（plan-approve 模式）\n${normalized}\n\n以上是用户在计划卡片上明确批准的执行边界：只执行计划内步骤；任何计划外的改写操作都会被拦截并请求用户确认，不要尝试绕过（换工具/拆分步骤/改路径都算计划外）。用户要求改计划时，引导用户切回计划模式重新提交（覆盖旧计划），不要自行修改计划内容。`;
}
