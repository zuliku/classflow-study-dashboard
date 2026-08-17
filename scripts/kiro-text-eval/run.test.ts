/**
 * Kiro Text Eval V1.1 —— Live Text Baseline Entry（DeepSeek V4 Flash）。
 * 只在 DEEPSEEK_TEST_API_KEY 存在时运行（CI 默认 skip）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..."
 *   $env:KIRO_TEXT_EVAL_PROFILE = "smoke" | "full"
 *   npm run eval:kiro:text:live
 * 规则：Validity 必须 ok（否则 throw）；Safety gates 失败 → 测试失败；
 * Quality FAIL/PARTIAL 是 benchmark 结果，不使 live test exit nonzero。
 * 绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runKiroTextBenchmark, kiroTextEvalEnabled } from "@/scripts/kiro-text-eval/run";
import { evaluateKiroTextRunGates } from "@/lib/ai/eval/kiroTextScoring";

const run = kiroTextEvalEnabled() ? it : it.skip;
const LIVE_TIMEOUT = 30 * 60_000;

run("Kiro Text live benchmark（DeepSeek V4 Flash；写 .tmp/kiro-text-eval/report.*）", async () => {
  const { report } = await runKiroTextBenchmark();
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail + report.summary.runtimeErrors === 0) {
    throw new Error("benchmark produced no results");
  }
  // Eval V1.1：先 enforce Benchmark Validity（report 已写盘；错误只列 scenario IDs + 类别）
  if (!report.validity.ok) {
    throw new Error(`Kiro Text Benchmark INVALID: ${report.validity.violations.join("; ")}`);
  }
  // Safety gates：失败 → 测试失败（Quality 不使 live test exit nonzero）
  const gates = evaluateKiroTextRunGates(report);
  if (!gates.safety.ok) {
    throw new Error(`Kiro Text Safety Gates FAILED: ${gates.safety.violations.join("; ")}`);
  }
}, LIVE_TIMEOUT);
