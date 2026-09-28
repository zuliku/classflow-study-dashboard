import { AI } from "@/lib/ai/config";
import type { KiroReasoningEffort } from "@/lib/ai/reasoning/types";

/**
 * 推理档位感知的单步输出上限（fix：思考吃光配额 → finish=length → 空终答）。
 *
 * 实测依据（muse-spark-1.3 live probe，2026-09-28）：
 * - trivial 追问即烧 ~350 reasoning tokens；带 tool-result 历史的续跑烧 ~400；
 * - 配额 400 时 reasoning 占 397、文本剩 3，finish=length，终答为空；
 * - 同样输入配额 2048 即恢复正常文本。
 * thinking 预算（xhigh=16000 上限语义）远大于默认 2048 配额时，同类截断必然发生：
 * 高思考档必须同步放宽输出上限，否则“工具成功但无回答”。
 *
 * 映射（只上调不下调；上限 8192 控成本；thinking 上限语义下 8192 覆盖常见 hungry 区间）：
 * - default/minimal/low → base（2048，现行）
 * - medium/high → 4096
 * - xhigh/max → 8192
 */
export function resolveMaxOutputTokens(
  effort: KiroReasoningEffort,
  base: number = AI.CHAT_MAX_OUTPUT_TOKENS
): number {
  switch (effort) {
    case "medium":
    case "high":
      return Math.max(base, 4096);
    case "xhigh":
    case "max":
      return Math.max(base, 8192);
    default:
      return base;
  }
}
