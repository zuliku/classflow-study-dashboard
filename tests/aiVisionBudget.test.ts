/**
 * Kiro Vision Turn 统一二进制预算纯逻辑测试（Phase 3.4B）。
 */
import { describe, it, expect } from "vitest";
import {
  resolveVisionTurnBudget,
  sumVisionBytes,
  isVisionTurnWithinBudget,
} from "@/lib/ai/attachments/visionBudget";
import {
  MAX_VISION_BINARY_BYTES_PER_TURN,
  MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN,
} from "@/lib/ai/attachments/limits";

const MiB = 1024 * 1024;

describe("resolveVisionTurnBudget（用户图片优先，PDF 只用剩余额度）", () => {
  it("A. userImageBytes=0 → pdfBudget = 8 MiB（PDF 子上限）", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 0 });
    expect(b.totalLimitBytes).toBe(10 * MiB);
    expect(b.remainingTurnBytes).toBe(10 * MiB);
    expect(b.pdfBudgetBytes).toBe(8 * MiB);
    expect(b.overBudget).toBe(false);
  });

  it("B. userImages=4 MiB → remaining=6 MiB → pdfBudget=6 MiB", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 4 * MiB });
    expect(b.remainingTurnBytes).toBe(6 * MiB);
    expect(b.pdfBudgetBytes).toBe(6 * MiB);
  });

  it("C. userImages=8 MiB → remaining=2 MiB → pdfBudget=2 MiB", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 8 * MiB });
    expect(b.remainingTurnBytes).toBe(2 * MiB);
    expect(b.pdfBudgetBytes).toBe(2 * MiB);
  });

  it("D. userImages=10 MiB（等于上限）→ remaining=0，pdfBudget=0，overBudget=false（边界合法）", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 10 * MiB });
    expect(b.remainingTurnBytes).toBe(0);
    expect(b.pdfBudgetBytes).toBe(0);
    expect(b.overBudget).toBe(false);
  });

  it("E. userImages=10 MiB+1 → overBudget=true，remaining=0，pdfBudget=0", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 10 * MiB + 1 });
    expect(b.overBudget).toBe(true);
    expect(b.remainingTurnBytes).toBe(0);
    expect(b.pdfBudgetBytes).toBe(0);
  });

  it("F. total 足够大时 PDF 仍不能超过自己的 8 MiB subcap", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 1 * MiB });
    expect(b.remainingTurnBytes).toBe(9 * MiB);
    expect(b.pdfBudgetBytes).toBe(8 * MiB); // min(8MiB, 9MiB)
  });

  it("显式 totalLimitBytes/pdfLimitBytes 可覆盖默认", () => {
    const b = resolveVisionTurnBudget({ userImageBytes: 2 * MiB, totalLimitBytes: 5 * MiB, pdfLimitBytes: 3 * MiB });
    expect(b.remainingTurnBytes).toBe(3 * MiB);
    expect(b.pdfBudgetBytes).toBe(3 * MiB);
  });
});

describe("sumVisionBytes / isVisionTurnWithinBudget（composition invariant）", () => {
  it("pageFiles 3 MiB + images 6 MiB = 9 MiB → allowed", () => {
    const pageFiles = [{ size: 3 * MiB }];
    const images = [{ size: 3 * MiB }, { size: 3 * MiB }];
    const total = sumVisionBytes(pageFiles) + sumVisionBytes(images);
    expect(total).toBe(9 * MiB);
    expect(isVisionTurnWithinBudget(total)).toBe(true);
  });

  it("pageFiles 4 MiB + images 7 MiB = 11 MiB → rejected", () => {
    const total = sumVisionBytes([{ size: 4 * MiB }, { size: 4 * MiB }, { size: 3 * MiB }]);
    expect(total).toBe(11 * MiB);
    expect(isVisionTurnWithinBudget(total)).toBe(false);
  });

  it("边界：恰好 10 MiB → allowed", () => {
    expect(isVisionTurnWithinBudget(MAX_VISION_BINARY_BYTES_PER_TURN)).toBe(true);
  });

  it("sumVisionBytes 忽略负 size（防御）", () => {
    expect(sumVisionBytes([{ size: -100 }, { size: 5 }])).toBe(5);
  });
});
