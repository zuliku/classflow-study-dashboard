/**
 * Visual Intake Eval V1 —— Live Benchmark Entry（Layer B）。
 * 只在显式配置 KIRO_VISUAL_EVAL_PROVIDER / KIRO_VISUAL_EVAL_MODEL / KIRO_VISUAL_EVAL_API_KEY 时运行：
 *   $env:KIRO_VISUAL_EVAL_PROVIDER = "opencode-go"
 *   $env:KIRO_VISUAL_EVAL_MODEL = "mimo-v2.5"
 *   $env:KIRO_VISUAL_EVAL_API_KEY = "sk-..."
 *   npm run eval:visual:live
 * CI 默认 skip；绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runVisualIntakeBenchmark, visualEvalEnabled, VISUAL_EVAL_ENV } from "@/scripts/visual-intake-eval/run";
import { evaluateVisualEvalSafetyGates } from "@/lib/ai/eval/visualIntakeReport";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { AIProviderId } from "@/lib/ai/providers/types";

const run = visualEvalEnabled() ? it : it.skip;
const LIVE_TIMEOUT = 30 * 60_000;

run("Visual Intake live benchmark（20 scenarios × 1 run；写 .tmp/visual-intake-eval/report.*）", async () => {
  // Vision capability gate：不支持 Vision 立即停止，不发送测试请求
  const caps = getModelCapabilities({ provider: VISUAL_EVAL_ENV.provider as AIProviderId, model: VISUAL_EVAL_ENV.model });
  if (!caps.vision) {
    throw new Error("Selected model does not support vision.");
  }
  const { report } = await runVisualIntakeBenchmark();
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail + report.summary.runtimeErrors === 0) {
    throw new Error("benchmark produced no results");
  }
  // Eval V1.2：先 enforce Benchmark Validity（report 已写盘；错误只列 scenario IDs + 类别，不叫 Model Safety Failure）
  // validity 由 runner 以 scenario identity 构建（requested/full suite IDs + filtered fact）；测试直接消费
  if (!report.validity.ok) {
    throw new Error(`Visual Intake Benchmark INVALID: ${report.validity.violations.join("; ")}`);
  }
  // Eval V1.1：Safety Hard Gates 只报告不中断（benchmark 的目标是测量与报告模型行为；
  // scenario 级 outcome 已按 hard gate 判 FAIL，报告已完整记录 violations）
  const safety = evaluateVisualEvalSafetyGates(report);
  if (!safety.ok) {
    console.warn(`[report] Safety gates violations: ${safety.violations.join("; ")}`);
  }
}, LIVE_TIMEOUT);
