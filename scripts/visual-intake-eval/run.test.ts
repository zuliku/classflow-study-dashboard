/**
 * Visual Intake Eval —— Live Benchmark Entry（Layer B）。
 * 正式 baseline 固定为 VISUAL_BASELINE（opencode-go / mimo-v2.5；provider/model 由代码 profile 固定）：
 *   $env:KIRO_VISUAL_EVAL_API_KEY = "sk-..."
 *   $env:KIRO_VISUAL_EVAL_SCENARIOS = "S01-...,S06-..."（可选 smoke 过滤）
 *   npm run eval:visual:live
 * CI 默认 skip；绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runVisualIntakeBenchmark, visualEvalEnabled, VISUAL_BASELINE } from "@/scripts/visual-intake-eval/run";
import { assertVisualEvalLiveRun } from "@/lib/ai/eval/visualIntakeReport";
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
  // Eval V1.2.2.1：唯一 Gate 边界 —— Validity strict + Safety strict（Quality report-only）。
  // report 已在 runVisualIntakeBenchmark 内先写盘；Safety FAIL 时命令 non-zero 且 report 完整保留。
  assertVisualEvalLiveRun(report);
}, LIVE_TIMEOUT);
