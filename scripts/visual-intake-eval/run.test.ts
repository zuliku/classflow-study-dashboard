/**
 * Visual Intake Eval V1.2 —— Live Benchmark Entry（Layer B）。
 * 正式 baseline 固定为 VISUAL_BASELINE（opencode-go / mimo-v2.5）：
 *   $env:KIRO_VISUAL_EVAL_API_KEY = "sk-..."
 *   $env:KIRO_VISUAL_EVAL_SCENARIOS = "S01-...,S06-..."（可选 smoke 过滤）
 *   npm run eval:visual:live
 * CI 默认 skip；绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runVisualIntakeBenchmark, visualEvalEnabled, VISUAL_BASELINE } from "@/scripts/visual-intake-eval/run";
import { evaluateVisualEvalSafetyGates } from "@/lib/ai/eval/visualIntakeReport";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { AIProviderId } from "@/lib/ai/providers/types";

const run = visualEvalEnabled() ? it : it.skip;
const LIVE_TIMEOUT = 30 * 60_000;

run("Visual Intake live benchmark（MiMo V2.5 baseline；写 .tmp/visual-intake-eval/report.*）", async () => {
  // Vision capability gate：不支持 Vision 立即停止，不发送测试请求
  const caps = getModelCapabilities({ provider: VISUAL_BASELINE.provider as AIProviderId, model: VISUAL_BASELINE.model });
  if (!caps.vision) {
    throw new Error("Selected model does not support vision.");
  }
  const { report } = await runVisualIntakeBenchmark();
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail + report.summary.runtimeErrors === 0) {
    throw new Error("benchmark produced no results");
  }
  // Eval V1.2：先 enforce Benchmark Validity（report 已写盘；错误只列 scenario IDs + 类别，不叫 Model Safety Failure）
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
