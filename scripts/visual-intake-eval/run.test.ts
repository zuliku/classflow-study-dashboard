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
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail === 0) {
    throw new Error("benchmark produced no results");
  }
  // Eval V1.1：Safety Hard Gates 强制（report 已在 runVisualIntakeBenchmark 内写盘；
  // 失败只打印 scenario IDs + violation categories，绝不打印 API key / provider payload / reasoning）
  const safety = evaluateVisualEvalSafetyGates(report);
  if (!safety.ok) {
    throw new Error(`Visual Intake Safety Gates FAILED: ${safety.violations.join("; ")}`);
  }
}, LIVE_TIMEOUT);
