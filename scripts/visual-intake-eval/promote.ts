/**
 * Visual Intake Eval V1.3.1 —— Baseline Promotion Entry（operational command boundary）。
 * 用法：
 *   $env:KIRO_VISUAL_EVAL_REPORT = ".tmp/visual-intake-eval/opencode-go__mimo-v2.5/report.json"
 *   npm run eval:visual:promote
 *
 * 正式 promotion 语义 = 持久写入受版本控制的 eval/visual-intake/baseline.json：
 * - validate 先于写文件（invalid report 绝不留下 artifact）
 * - parent directory 自动创建（仓库没有 eval/visual-intake/ 是允许的）
 * - no-clobber 写入（flag:"wx"）：已存在 → BASELINE_ALREADY_EXISTS，绝不覆盖 / unlink / backup
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { createVisualEvalBaselineManifest } from "@/lib/ai/eval/visualIntakeBaseline";

export const VISUAL_EVAL_BASELINE_PATH = join(process.cwd(), "eval", "visual-intake", "baseline.json");

export function resolvePromotionReportPath(): string {
  const raw = process.env.KIRO_VISUAL_EVAL_REPORT ?? "";
  if (!raw.trim()) throw new Error("KIRO_VISUAL_EVAL_REPORT 未配置（需指向 report.json）");
  return raw;
}

/**
 * Path-injectable promotion primitive（unit tests 用 temp path；正式命令用 canonical path）。
 * 顺序：read → parse → eligibility 全通过 → mkdir parent → no-clobber 单次写入。
 */
export function promoteVisualEvalBaselineAt(input: {
  reportPath: string;
  baselinePath: string;
}): { manifestPath: string; fingerprint: string } {
  const report = JSON.parse(readFileSync(input.reportPath, "utf8")) as VisualEvalReport;
  // eligibility 不满足 → BASELINE_NOT_ELIGIBLE（此时绝不创建文件）
  const manifest = createVisualEvalBaselineManifest(report);
  mkdirSync(dirname(input.baselinePath), { recursive: true });
  try {
    writeFileSync(input.baselinePath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("BASELINE_ALREADY_EXISTS: 已有受版本控制的 baseline；replacement 需显式流程");
    }
    throw err;
  }
  return { manifestPath: input.baselinePath, fingerprint: manifest.contract.fingerprint };
}

/** 正式命令入口：canonical path + env report path */
export function promoteVisualEvalBaseline(): { manifestPath: string; fingerprint: string } {
  return promoteVisualEvalBaselineAt({
    reportPath: resolvePromotionReportPath(),
    baselinePath: VISUAL_EVAL_BASELINE_PATH,
  });
}
