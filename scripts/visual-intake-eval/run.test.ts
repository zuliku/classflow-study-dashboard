/**
 * Visual Intake Eval —— Live Benchmark Entry（Layer B）。
 * 通用生产同构 Live Eval Runner：provider/model/apiKey 全部由环境变量指定
 * （正式 baseline 的 promotion/snapshot/provenance 属于后续 Eval V1.3）：
 *   $env:KIRO_VISUAL_EVAL_PROVIDER = "opencode-go"
 *   $env:KIRO_VISUAL_EVAL_MODEL = "mimo-v2.5"   （或其它 production-compatible Vision model，如 kimi-k3）
 *   $env:KIRO_VISUAL_EVAL_API_KEY = "sk-..."
 *   npm run eval:visual:live
 * CI 默认 skip；绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runVisualIntakeBenchmark, visualEvalEnabled, VISUAL_EVAL_ENV } from "@/scripts/visual-intake-eval/run";
import { assertVisualEvalLiveRun } from "@/lib/ai/eval/visualIntakeReport";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { AIProviderId } from "@/lib/ai/providers/types";

const run = visualEvalEnabled() ? it : it.skip;
const LIVE_TIMEOUT = 30 * 60_000;

run("Visual Intake live benchmark（provider/model 由环境变量指定；写 .tmp/visual-intake-eval/report.*）", async () => {
  // Vision capability gate：不支持 Vision 立即停止，不发送测试请求
  const caps = getModelCapabilities({ provider: VISUAL_EVAL_ENV.provider as AIProviderId, model: VISUAL_EVAL_ENV.model });
  if (!caps.vision) {
    throw new Error("Selected model does not support vision.");
  }
  const { report } = await runVisualIntakeBenchmark();
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail + report.summary.runtimeErrors === 0) {
    throw new Error("benchmark produced no results");
  }
  // Eval V1.2.2.1：唯一 Gate 边界 —— Validity strict + Safety strict（Quality report-only）。
  // report 已在 runVisualIntakeBenchmark 内先写盘；Safety FAIL 时命令 non-zero 且 report 完整保留。
  assertVisualEvalLiveRun(report);
}, LIVE_TIMEOUT);
