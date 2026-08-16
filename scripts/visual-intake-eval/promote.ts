/**
 * Visual Intake Eval V1.3 —— Baseline Promotion Entry。
 * 用法：
 *   $env:KIRO_VISUAL_EVAL_REPORT = ".tmp/visual-intake-eval/opencode-go__mimo-v2.5/report.json"
 *   npm run eval:visual:promote
 * 只有 eligible（validity.ok + baselineEligible + production parity + Safety clean +
 * contract === current）的真实 live report 才能成为受版本控制的 eval/visual-intake/baseline.json。
 * 已存在 baseline → BASELINE_ALREADY_EXISTS（默认拒绝覆盖；replacement 流程后续单独设计）。
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { createVisualEvalBaselineManifest } from "@/lib/ai/eval/visualIntakeBaseline";

export const VISUAL_EVAL_BASELINE_PATH = join(process.cwd(), "eval", "visual-intake", "baseline.json");

export function resolvePromotionReportPath(): string {
  const raw = process.env.KIRO_VISUAL_EVAL_REPORT ?? "";
  if (!raw.trim()) throw new Error("KIRO_VISUAL_EVAL_REPORT 未配置（需指向 report.json）");
  return raw;
}

export function promoteVisualEvalBaseline(): { manifestPath: string; fingerprint: string } {
  if (existsSync(VISUAL_EVAL_BASELINE_PATH)) {
    throw new Error("BASELINE_ALREADY_EXISTS: 已有受版本控制的 baseline；replacement 需显式流程");
  }
  const reportPath = resolvePromotionReportPath();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as VisualEvalReport;
  const manifest = createVisualEvalBaselineManifest(report); // 不满足 → BASELINE_NOT_ELIGIBLE
  writeFileSync(VISUAL_EVAL_BASELINE_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath: VISUAL_EVAL_BASELINE_PATH, fingerprint: manifest.contract.fingerprint };
}
