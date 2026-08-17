/**
 * Visual Intake Eval V1.3.1 —— Baseline Promotion Command Entry。
 * 只在显式以 `npm run eval:visual:promote` 调用时执行（npm_lifecycle_event）：
 * - 普通 npm test / vitest 直接运行 → skip（绝不能意外写入 canonical baseline）
 * - 正式命令但缺 KIRO_VISUAL_EVAL_REPORT → 明确 fail（exit non-zero；绝不 silent skip）
 * - 正式命令 → 只执行一次 promotion（不 cleanup canonical baseline；成功即持久存在）
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { promoteVisualEvalBaseline, VISUAL_EVAL_BASELINE_PATH } from "@/scripts/visual-intake-eval/promote";

const invokedAsPromotionCommand = process.env.npm_lifecycle_event === "eval:visual:promote";
const reportConfigured = Boolean(process.env.KIRO_VISUAL_EVAL_REPORT);

describe("Visual Intake Baseline Promotion Command", () => {
  if (invokedAsPromotionCommand && !reportConfigured) {
    it("promote 命令必须配置 KIRO_VISUAL_EVAL_REPORT（否则 non-zero）", () => {
      throw new Error("KIRO_VISUAL_EVAL_REPORT 未配置（npm run eval:visual:promote 需要指向 report.json）");
    });
  } else if (invokedAsPromotionCommand) {
    it("promote：eligible report → 持久写入 canonical baseline（不 cleanup）", () => {
      const out = promoteVisualEvalBaseline();
      expect(out.manifestPath).toBe(VISUAL_EVAL_BASELINE_PATH);
      expect(out.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(VISUAL_EVAL_BASELINE_PATH)).toBe(true);
      console.log(`[promote] baseline written to ${VISUAL_EVAL_BASELINE_PATH} (fingerprint ${out.fingerprint.slice(0, 16)}…)`);
    });
  } else {
    it.skip("promotion 只在 npm run eval:visual:promote 下执行（普通 test 运行跳过）", () => {});
  }
});
