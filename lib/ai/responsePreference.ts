/**
 * Kiro 回答偏好（Intelligence V2 Task 1 — Foundation）。
 *
 * 三档 enum：dense（高密度·默认）/ balanced（平衡）/ deep（深入）。
 * Task 1 只完成「设置 + 数据传递 + 安全归一」；
 * 真正的 Answer Contract（dense/balanced/deep 表达规则）留给 Prompt V2 Task。
 *
 * 最重要不变量：
 * 回答偏好只影响 Final Answer 的表达深度；
 * 绝不改变必要 Tool 调用、事实读取、安全规则、确认要求或写入授权。
 *
 * Server 只信任 normalize 后的 enum；raw client value 绝不进入 System Context。
 */

export const KIRO_RESPONSE_PREFERENCES = ["dense", "balanced", "deep"] as const;

export type KiroResponsePreference = (typeof KIRO_RESPONSE_PREFERENCES)[number];

export const DEFAULT_KIRO_RESPONSE_PREFERENCE: KiroResponsePreference = "dense";

/**
 * 精确 enum 归一：
 * 只有 dense / balanced / deep 接受；其余（undefined / 非法 string / object / 大小写变体 / 前后空白）一律 dense。
 * 不做 trim 后模糊匹配、substring、大小写转换或自由字符串。
 */
export function normalizeKiroResponsePreference(value: unknown): KiroResponsePreference {
  return KIRO_RESPONSE_PREFERENCES.includes(value as KiroResponsePreference)
    ? (value as KiroResponsePreference)
    : DEFAULT_KIRO_RESPONSE_PREFERENCE;
}

/**
 * Server 生成的可信 Response Preference Context（插入 System Prompt）。
 * 内部必须再次 normalize；绝不把 raw client value 插进返回文本。
 */
export function buildKiroResponsePreferenceContext(value: unknown): string {
  const preference = normalizeKiroResponsePreference(value);
  return (
    "\n\n# Kiro 回答偏好（受信任设置）\n" +
    `- responsePreference: ${preference}\n` +
    "- 此设置只控制最终回答的表达深度；不改变必要工具调用、事实读取、安全规则、确认要求或写入授权。"
  );
}
