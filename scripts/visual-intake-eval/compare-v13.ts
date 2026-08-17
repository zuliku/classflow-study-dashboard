/**
 * Visual Intake Eval V1.3 —— Candidate vs Baseline 正式 Comparison Entry。
 * 用法：
 *   $env:KIRO_VISUAL_EVAL_REPORT = ".tmp/visual-intake-eval/opencode-go__kimi-k3/report.json"
 *   npm run eval:visual:compare
 * Baseline 默认 eval/visual-intake/baseline.json（不存在 → VISUAL_EVAL_BASELINE_MISSING，不 silent skip）。
 * 输出 .tmp/visual-intake-eval/comparison/{comparison.json, comparison.md}（ephemeral，不提交）。
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import {
  compareVisualEvalToBaseline,
  renderVisualEvalComparisonMarkdown,
  VisualEvalBaselineManifest,
} from "@/lib/ai/eval/visualIntakeBaseline";
import { VISUAL_EVAL_BASELINE_PATH } from "@/scripts/visual-intake-eval/promote";

export function runVisualEvalComparison(): { comparisonPath: string; mdPath: string; comparison: unknown } {
  if (!existsSync(VISUAL_EVAL_BASELINE_PATH)) {
    throw new Error("VISUAL_EVAL_BASELINE_MISSING: 尚无受版本控制的 baseline（先运行 eval:visual:live + eval:visual:promote）");
  }
  const reportPath = process.env.KIRO_VISUAL_EVAL_REPORT ?? "";
  if (!reportPath.trim()) throw new Error("KIRO_VISUAL_EVAL_REPORT 未配置（需指向 candidate report.json）");
  const baseline = JSON.parse(readFileSync(VISUAL_EVAL_BASELINE_PATH, "utf8")) as VisualEvalBaselineManifest;
  const candidate = JSON.parse(readFileSync(reportPath, "utf8")) as VisualEvalReport;
  const comparison = compareVisualEvalToBaseline({ baseline, candidate });

  const dir = join(process.cwd(), ".tmp", "visual-intake-eval", "comparison");
  mkdirSync(dir, { recursive: true });
  const comparisonPath = join(dir, "comparison.json");
  const mdPath = join(dir, "comparison.md");
  writeFileSync(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, renderVisualEvalComparisonMarkdown(comparison), "utf8");
  return { comparisonPath, mdPath, comparison };
}
