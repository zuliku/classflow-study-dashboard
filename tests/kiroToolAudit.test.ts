import { describe, expect, it } from "vitest";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";
import {
  KIRO_TOOL_CAPABILITY_AUDIT,
  KiroToolFindingDisposition,
} from "@/lib/ai/eval/kiroToolAudit";

describe("Kiro Tool Capability Audit", () => {
  it("audits every scenario exactly once", () => {
    const scenarios = KIRO_EVAL_SCENARIOS.map((s) => s.id).sort();
    const audited = KIRO_TOOL_CAPABILITY_AUDIT.scenarios.map((s) => s.scenarioId).sort();
    expect(audited).toEqual(scenarios);
  });

  it("references only real tools", () => {
    const names = new Set(Object.keys(KIRO_TOOLS));
    for (const finding of KIRO_TOOL_CAPABILITY_AUDIT.toolFindings) {
      expect(names.has(finding.tool)).toBe(true);
    }
  });

  it("task5Decision is a valid decision", () => {
    expect(["skip", "refine-existing-tools", "add-minimal-tool"]).toContain(
      KIRO_TOOL_CAPABILITY_AUDIT.task5Decision
    );
  });

  it("all non-keep findings have evidence and recommendation", () => {
    for (const f of KIRO_TOOL_CAPABILITY_AUDIT.toolFindings) {
      const disposition = f.disposition as KiroToolFindingDisposition;
      if (disposition === "keep") continue;
      expect(f.evidence.length, f.id).toBeGreaterThan(0);
      expect(f.recommendation.trim().length, f.id).toBeGreaterThan(0);
    }
  });

  it("aggregate tool is only recommended with strong evidence", () => {
    const agg = KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool;
    if (agg.recommended) {
      expect(agg.supportingScenarioIds.length).toBeGreaterThanOrEqual(3);
      expect(agg.repeatedToolPattern.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("finds get_available_time totalMinutes gap", () => {
    const ids = KIRO_TOOL_CAPABILITY_AUDIT.toolFindings.map((x) => x.id);
    expect(ids).toContain("available-time-total-minutes");
  });

  it("finds delete_reminder listing-description gap", () => {
    const ids = KIRO_TOOL_CAPABILITY_AUDIT.toolFindings.map((x) => x.id);
    expect(ids).toContain("delete-reminder-listing-description");
  });

  it("finds delete_reminder scheduled guard gap", () => {
    const ids = KIRO_TOOL_CAPABILITY_AUDIT.toolFindings.map((x) => x.id);
    expect(ids).toContain("delete-reminder-scheduled-guard");
  });
});
