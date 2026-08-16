/**
 * Visual Intake Eval V1.3 —— Candidate vs Baseline Comparison Entry（vitest command pattern）。
 * 显式配置 KIRO_VISUAL_EVAL_REPORT 才运行；CI 默认 skip。
 * 输出 .tmp/visual-intake-eval/comparison/（ephemeral）。
 */
import { it, expect } from "vitest";
import { existsSync } from "fs";
import { runVisualEvalComparison } from "@/scripts/visual-intake-eval/compare-v13";

const hasReport = Boolean(process.env.KIRO_VISUAL_EVAL_REPORT);
const run = hasReport ? it : it.skip;

run("compare：candidate vs baseline → comparison.json + comparison.md", () => {
  const out = runVisualEvalComparison();
  expect(existsSync(out.comparisonPath)).toBe(true);
  expect(existsSync(out.mdPath)).toBe(true);
  const c = out.comparison as { compatible?: boolean; contractFingerprint?: string };
  expect(c.compatible).toBe(true);
  expect(c.contractFingerprint).toMatch(/^[0-9a-f]{64}$/);
});
