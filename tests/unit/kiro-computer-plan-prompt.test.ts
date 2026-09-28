import { describe, it, expect } from "vitest";
import {
  APPROVED_PLAN_CONTEXT_MAX_CHARS,
  buildApprovedPlanPromptSection,
  normalizeApprovedPlanContext,
} from "@/lib/ai/computer/plans/prompt";

describe("normalizeApprovedPlanContext", () => {
  it("非字符串/空 → 空；超限截断", () => {
    expect(normalizeApprovedPlanContext(undefined)).toBe("");
    expect(normalizeApprovedPlanContext(null)).toBe("");
    expect(normalizeApprovedPlanContext(123)).toBe("");
    expect(normalizeApprovedPlanContext("   ")).toBe("");
    expect(normalizeApprovedPlanContext("  abc  ")).toBe("abc");
    const long = "x".repeat(APPROVED_PLAN_CONTEXT_MAX_CHARS + 10);
    expect(normalizeApprovedPlanContext(long).length).toBe(APPROVED_PLAN_CONTEXT_MAX_CHARS);
  });
});

describe("buildApprovedPlanPromptSection", () => {
  it("空 → 空；非空 → 边界 section（声明非授权）", () => {
    expect(buildApprovedPlanPromptSection("")).toBe("");
    const s = buildApprovedPlanPromptSection("# 已批准执行计划：整理");
    expect(s).toContain("用户已批准的执行计划");
    expect(s).toContain("# 已批准执行计划：整理");
    expect(s).toContain("不要尝试绕过");
  });
});
