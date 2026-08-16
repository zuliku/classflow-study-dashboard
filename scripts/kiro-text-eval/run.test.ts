/**
 * Kiro Text Eval V1 —— Live Text Baseline Entry（DeepSeek V4 Flash）。
 * 只在 DEEPSEEK_TEST_API_KEY 存在时运行（CI 默认 skip）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..."
 *   $env:KIRO_TEXT_EVAL_PROFILE = "smoke" | "full"
 *   npm run eval:kiro:text:live
 * 绝不打印 API Key 内容。
 */
import { it } from "vitest";
import { runKiroTextBenchmark, kiroTextEvalEnabled } from "@/scripts/kiro-text-eval/run";

const run = kiroTextEvalEnabled() ? it : it.skip;
const LIVE_TIMEOUT = 30 * 60_000;

run("Kiro Text live benchmark（DeepSeek V4 Flash；写 .tmp/kiro-text-eval/report.*）", async () => {
  const { report } = await runKiroTextBenchmark();
  if (!report || report.summary.pass + report.summary.partial + report.summary.fail === 0) {
    throw new Error("benchmark produced no results");
  }
}, LIVE_TIMEOUT);
