/**
 * Visual Intake Eval V1.3 —— Baseline Promotion Entry（vitest command pattern；与 live 一致）。
 * 只有显式配置 KIRO_VISUAL_EVAL_REPORT 时才运行；CI 默认 skip。
 * 成功后生成受版本控制的 eval/visual-intake/baseline.json。
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { promoteVisualEvalBaseline, VISUAL_EVAL_BASELINE_PATH } from "@/scripts/visual-intake-eval/promote";

const hasReport = Boolean(process.env.KIRO_VISUAL_EVAL_REPORT);
const run = hasReport ? it : it.skip;

describe("Visual Intake Baseline Promotion", () => {
  afterEach(() => {
    if (existsSync(VISUAL_EVAL_BASELINE_PATH)) unlinkSync(VISUAL_EVAL_BASELINE_PATH);
  });

  run("promote：eligible report → 生成 baseline.json（受版本控制）", () => {
    const out = promoteVisualEvalBaseline();
    expect(out.manifestPath).toBe(VISUAL_EVAL_BASELINE_PATH);
    expect(out.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(VISUAL_EVAL_BASELINE_PATH)).toBe(true);
  });

  run("重复 promote → BASELINE_ALREADY_EXISTS", () => {
    promoteVisualEvalBaseline();
    expect(() => promoteVisualEvalBaseline()).toThrow(/BASELINE_ALREADY_EXISTS/);
  });
});
