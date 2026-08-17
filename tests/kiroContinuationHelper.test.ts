/**
 * Kiro continuation 生命周期回归（V4.7.2 真实验证）：
 * shouldArmAutoContinuation 纯规则锁定 —— business tool 回填 arm 续跑；begin_final_answer 不 arm；
 * limitReached 不 arm。boundary 不 arm ≠ 阻止 SDK 按 complete tool calls 自动续跑。
 */
import { describe, it, expect } from "vitest";
import { shouldArmAutoContinuation, isKiroFinalAnswerToolName } from "@/lib/ai/tools/finalAnswer";

describe("shouldArmAutoContinuation", () => {
  it("business read tool + limit 未达到 → true", () => {
    expect(shouldArmAutoContinuation("search_assignments", false)).toBe(true);
    expect(shouldArmAutoContinuation("get_assignment", false)).toBe(true);
  });

  it("business write tool + limit 未达到 → true", () => {
    expect(shouldArmAutoContinuation("set_assignment_ddl", false)).toBe(true);
    expect(shouldArmAutoContinuation("create_reminder", false)).toBe(true);
    expect(shouldArmAutoContinuation("apply_change_set", false)).toBe(true);
  });

  it("begin_final_answer → false（boundary + Final 同 stop 响应时不得挂起 awaiting-continuation）", () => {
    expect(isKiroFinalAnswerToolName("begin_final_answer")).toBe(true);
    expect(shouldArmAutoContinuation("begin_final_answer", false)).toBe(false);
  });

  it("limit reached → false（即使 business tool）", () => {
    expect(shouldArmAutoContinuation("search_assignments", true)).toBe(false);
    expect(shouldArmAutoContinuation("begin_final_answer", true)).toBe(false);
  });

  it("boundary 不 arm 不等于阻止 SDK 自动续跑（规则只控制 awaiting-continuation 标记）", () => {
    // 该 helper 只决定 pendingAutoContinueRef 标记；SDK 对 complete tool-calls 响应的续跑是独立机制
    expect(shouldArmAutoContinuation("begin_final_answer", false)).toBe(false);
    expect(shouldArmAutoContinuation("search_assignments", false)).toBe(true);
  });
});
