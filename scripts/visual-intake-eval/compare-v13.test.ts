/**
 * Visual Intake Eval V1.3.1 —— Candidate vs Baseline Comparison Command Entry。
 * 只在显式以 `npm run eval:visual:compare` 调用时执行（npm_lifecycle_event）：
 * - 普通 npm test / vitest 直接运行 → skip
 * - 正式命令缺 KIRO_VISUAL_EVAL_REPORT → 明确 fail（non-zero）
 * - baseline 缺失 → VISUAL_EVAL_BASELINE_MISSING → non-zero（不 silent skip）
 */
import { it, expect } from "vitest";
import { existsSync } from "fs";
import { runVisualEvalComparison } from "@/scripts/visual-intake-eval/compare-v13";

const invokedAsComparisonCommand = process.env.npm_lifecycle_event === "eval:visual:compare";
const reportConfigured = Boolean(process.env.KIRO_VISUAL_EVAL_REPORT);

if (invokedAsComparisonCommand && !reportConfigured) {
  it("compare 命令必须配置 KIRO_VISUAL_EVAL_REPORT（否则 non-zero）", () => {
    throw new Error("KIRO_VISUAL_EVAL_REPORT 未配置（npm run eval:visual:compare 需要指向 candidate report.json）");
  });
} else if (invokedAsComparisonCommand) {
  it("compare：candidate vs baseline → comparison.json + comparison.md", () => {
    const out = runVisualEvalComparison();
    expect(existsSync(out.comparisonPath)).toBe(true);
    expect(existsSync(out.mdPath)).toBe(true);
    const c = out.comparison as { compatible?: boolean; contractFingerprint?: string };
    expect(c.compatible).toBe(true);
    expect(c.contractFingerprint).toMatch(/^[0-9a-f]{64}$/);
    console.log(`[compare] written ${out.comparisonPath} + ${out.mdPath}`);
  });
} else {
  it.skip("compare 只在 npm run eval:visual:compare 下执行（普通 test 运行跳过）", () => {});
}
