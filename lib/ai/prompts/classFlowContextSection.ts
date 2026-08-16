/**
 * 「# 当前 ClassFlow 上下文」Prompt section（纯 helper）。
 * 生产 Route（app/api/ai/chat/route.ts）与 Visual Intake Eval 共用同一实现，
 * 保证 Benchmark 不会随生产 section 格式变化而静默漂移。
 * 范围刻意最小：只负责这一个稳定 section 的字符串拼接，不重构整个 system prompt assembly。
 */
import { KiroPromptContextRef } from "@/lib/ai/context/contextSelection";

export function buildClassFlowContextSection(
  baseContext: Record<string, unknown> | null,
  contextRefs: KiroPromptContextRef[]
): string {
  if (!baseContext) return "";
  return `\n\n# 当前 ClassFlow 上下文\n${JSON.stringify({ baseContext, contextRefs })}`;
}
