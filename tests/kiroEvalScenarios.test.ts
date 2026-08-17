import { describe, expect, it } from "vitest";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";

const toolNames = new Set(Object.keys(KIRO_TOOLS));

describe("Kiro Eval Scenario Matrix", () => {
  it("1. 场景数量 >= 15", () => {
    expect(KIRO_EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(15);
  });

  it("2. id 唯一", () => {
    const ids = KIRO_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("3. userMessage 非空", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      expect(s.userMessage.trim().length, s.id).toBeGreaterThan(0);
    }
  });

  it("4. maxToolCalls > 0", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      expect(s.maxToolCalls, s.id).toBeGreaterThan(0);
    }
  });

  it("5. requiredFacts 非空", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      expect(s.requiredFacts.length, s.id).toBeGreaterThan(0);
    }
  });

  it("6. answerPriorities 非空", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      expect(s.answerPriorities.length, s.id).toBeGreaterThan(0);
    }
  });

  it("7. requiredTools 与 forbiddenTools 无交集", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      const required = new Set(s.requiredTools);
      const overlap = s.forbiddenTools.filter((t) => required.has(t));
      expect(overlap, s.id).toEqual([]);
    }
  });

  it("8. allowedTools 与 forbiddenTools 无交集", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      const allowed = new Set(s.allowedTools);
      const overlap = s.forbiddenTools.filter((t) => allowed.has(t));
      expect(overlap, s.id).toEqual([]);
    }
  });

  it("9. 所有 Tool 名真实存在于 KIRO_TOOLS", () => {
    for (const s of KIRO_EVAL_SCENARIOS) {
      const refs = [...s.requiredTools, ...s.allowedTools, ...s.forbiddenTools];
      for (const name of refs) {
        expect(toolNames.has(name), `${s.id} -> ${name}`).toBe(true);
      }
    }
  });

  it("覆盖规定的场景 id", () => {
    const ids = new Set(KIRO_EVAL_SCENARIOS.map((s) => s.id));
    for (const requiredId of [
      "today-task-list",
      "today-top-priority",
      "today-study-plan",
      "assignment-health",
      "weekly-pressure",
      "tonight-free-time",
      "pdf-task-breakdown",
      "multi-assignment-week-plan",
      "batch-ddl-change",
      "create-reminder",
      "cancel-reminder",
      "start-focus",
      "course-material-list",
      "material-requirements-summary",
      "save-study-preference-memory",
    ]) {
      expect(ids.has(requiredId), requiredId).toBe(true);
    }
  });
});
