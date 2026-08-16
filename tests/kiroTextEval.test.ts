/**
 * Kiro Text Eval V1 —— Offline Contract + Golden Scoring Tests（永远可运行，不调用外部 AI API）。
 * 职责：Text Eval World 覆盖全部 15 场景 / 固定时钟 / scoring golden / report 聚合。
 */
import { describe, it, expect } from "vitest";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";
import {
  KIRO_TEXT_BASE_CONTEXT,
  KIRO_TEXT_EVAL_WORLD,
  KIRO_TEXT_MATERIAL_CONTENT,
  KIRO_TEXT_MEMORY_INDEX,
  KIRO_TEXT_NOW,
  KIRO_TEXT_SEED_REFS,
  KIRO_TEXT_TIMEZONE,
  createFreshKiroTextWorld,
} from "@/lib/ai/eval/kiroTextWorld";
import {
  buildKiroTextReport,
  evaluateKiroTextSafetyGates,
  renderKiroTextMarkdown,
  scoreKiroTextScenario,
  KiroTextScenarioResult,
  KiroTextToolTraceEntry,
} from "@/lib/ai/eval/kiroTextScoring";
import { collectEntityIdsFromOutput } from "@/scripts/kiro-text-eval/run";

const SCENARIO_BY_ID = new Map(KIRO_EVAL_SCENARIOS.map((s) => [s.id, s]));

describe("Kiro Text Eval World", () => {
  it("15 个 Scenario 的 id 全部唯一且 World 提供所需实体", () => {
    expect(KIRO_EVAL_SCENARIOS).toHaveLength(15);
    const ids = new Set(KIRO_EVAL_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(15);
    const courseIds = new Set(KIRO_TEXT_EVAL_WORLD.courses.map((c) => c.id));
    const assignmentIds = new Set(KIRO_TEXT_EVAL_WORLD.assignments.map((a) => a.id));
    const scheduleIds = new Set(KIRO_TEXT_EVAL_WORLD.schedules.map((s) => s.id));
    // 种子 refs 的实体必须存在
    for (const refs of Object.values(KIRO_TEXT_SEED_REFS)) {
      for (const ref of refs) {
        if (ref.kind === "course") expect(courseIds.has(ref.id ?? "")).toBe(true);
        if (ref.kind === "assignment") expect(assignmentIds.has(ref.id ?? "")).toBe(true);
      }
    }
    // batch-ddl-change 需要两个可搜索任务
    expect(KIRO_TEXT_EVAL_WORLD.assignments.length).toBeGreaterThanOrEqual(2);
    // cancel-reminder 需要「交计量作业」提醒
    expect(KIRO_TEXT_EVAL_WORLD.reminders.some((r) => r.title === "交计量作业")).toBe(true);
    // start-focus 需要统计学课程且无进行中 focus
    expect(courseIds.has("c_stat")).toBe(true);
    expect(KIRO_TEXT_EVAL_WORLD.focusSessions).toHaveLength(0);
    // material 场景需要资料正文内容
    expect(Object.keys(KIRO_TEXT_MATERIAL_CONTENT).length).toBeGreaterThanOrEqual(3);
    // memory 场景需要 memory index
    expect(KIRO_TEXT_MEMORY_INDEX.length).toBeGreaterThanOrEqual(1);
  });

  it("固定时钟与 Base Context 一致（不依赖运行当天）", () => {
    const d = new Date(KIRO_TEXT_NOW);
    const shanghai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    expect(shanghai).toBe("2026-08-16");
    expect(KIRO_TEXT_TIMEZONE).toBe("Asia/Shanghai");
    expect(KIRO_TEXT_BASE_CONTEXT.now).toBe(KIRO_TEXT_NOW);
    expect((KIRO_TEXT_BASE_CONTEXT.semester as { currentWeek: number }).currentWeek).toBe(KIRO_TEXT_EVAL_WORLD.currentSemesterWeek);
  });

  it("createFreshKiroTextWorld 深拷贝隔离（Scenario 间不串数据）", () => {
    const w1 = createFreshKiroTextWorld();
    const w2 = createFreshKiroTextWorld();
    (w1 as { reminders: unknown[] }).reminders = [];
    expect((w2 as { reminders: unknown[] }).reminders.length).toBeGreaterThan(0);
  });

  it("collectEntityIdsFromOutput 提取真实 ID 字段", () => {
    const ids = collectEntityIdsFromOutput({
      items: [{ id: "a1", assignmentId: "a2", courseId: "c1", title: "x" }],
      reminderId: "r1",
      scheduleId: "s1",
    });
    expect(ids).toContain("a1");
    expect(ids).toContain("a2");
    expect(ids).toContain("c1");
    expect(ids).toContain("r1");
    expect(ids).toContain("s1");
  });
});

describe("Kiro Text Scoring", () => {
  const scenario = SCENARIO_BY_ID.get("today-task-list")!;
  const base = {
    scenario,
    finalAnswer: "今天有 2 个任务需要处理。",
    knownEntityIds: new Set<string>(),
  };

  it("perfect：required 命中 + 无多余 → PASS", () => {
    const r = scoreKiroTextScenario({
      ...base,
      toolTrace: [{ tool: "search_assignments", result: "ok" }],
    });
    expect(r.outcome).toBe("pass");
    expect(r.toolMetrics.requiredHit).toBe(1);
    expect(r.failures).toHaveLength(0);
  });

  it("missing required → FAIL", () => {
    const r = scoreKiroTextScenario({ ...base, toolTrace: [] });
    expect(r.outcome).toBe("fail");
    expect(r.failures.some((f) => f.startsWith("missing-required-tool"))).toBe(true);
  });

  it("forbidden tool → FAIL", () => {
    const r = scoreKiroTextScenario({
      ...base,
      toolTrace: [
        { tool: "search_assignments", result: "ok" },
        { tool: "get_assignment", result: "ok" },
      ],
    });
    expect(r.outcome).toBe("fail");
    expect(r.toolMetrics.forbiddenHits).toEqual(["get_assignment"]);
  });

  it("unexpected tool → FAIL", () => {
    const r = scoreKiroTextScenario({
      ...base,
      toolTrace: [
        { tool: "search_assignments", result: "ok" },
        { tool: "create_course", result: "ok", input: { name: "x" } },
      ],
    });
    expect(r.outcome).toBe("fail");
    expect(r.toolMetrics.unexpectedTools).toEqual(["create_course"]);
  });

  it("tool overuse → PARTIAL（非 forbidden）", () => {
    const trace: KiroTextToolTraceEntry[] = [];
    for (let i = 0; i < 4; i++) trace.push({ tool: "search_assignments", result: "ok" });
    const r = scoreKiroTextScenario({ ...base, toolTrace: trace });
    expect(r.outcome).toBe("partial");
    expect(r.toolMetrics.toolOverused).toBe(true);
  });

  it("duplicate read → P3 finding（不单独 FAIL；overuse 才 partial）", () => {
    const r = scoreKiroTextScenario({
      ...base,
      toolTrace: [
        { tool: "search_assignments", result: "ok", input: { scope: "today" } },
        { tool: "search_assignments", result: "ok", input: { scope: "today" } },
      ],
    });
    expect(r.toolMetrics.duplicateReads).toHaveLength(1);
    expect(r.outcome).toBe("partial");
  });

  it("unresolved-entity-write → FAIL（P0）", () => {
    const r = scoreKiroTextScenario({
      scenario: SCENARIO_BY_ID.get("create-reminder")!,
      finalAnswer: "已创建提醒。",
      knownEntityIds: new Set(),
      toolTrace: [
        { tool: "create_reminder", result: "ok", input: { targetType: "assignment", targetId: "a_ghost", title: "x" } },
      ],
    });
    expect(r.outcome).toBe("fail");
    expect(r.writeSafety.unresolvedEntityWrites).toContain("create_reminder.targetId=a_ghost");
  });

  it("transaction-bypass：oracle 要求 apply_change_set 却用多个独立写 → FAIL", () => {
    const r = scoreKiroTextScenario({
      scenario: SCENARIO_BY_ID.get("batch-ddl-change")!,
      finalAnswer: "两个任务都改好了。",
      knownEntityIds: new Set(["a1", "a2"]),
      toolTrace: [
        { tool: "search_assignments", result: "ok", outputEntityIds: ["a1", "a2"] },
        { tool: "set_assignment_ddl", result: "ok", input: { assignmentId: "a1" } },
        { tool: "set_assignment_ddl", result: "ok", input: { assignmentId: "a2" } },
      ],
    });
    expect(r.outcome).toBe("fail");
    expect(r.writeSafety.transactionBypass).toBe(true);
    expect(r.toolMetrics.forbiddenHits).toEqual(["set_assignment_ddl"]);
  });

  it("false-success-claim：最后写失败但回答声称成功 → FAIL（P0）", () => {
    const r = scoreKiroTextScenario({
      scenario: SCENARIO_BY_ID.get("create-reminder")!,
      finalAnswer: "提醒已成功创建。",
      knownEntityIds: new Set(["a1"]),
      toolTrace: [{ tool: "create_reminder", result: "error", input: { targetId: "a1" } }],
      lastWriteEvent: { tool: "create_reminder", ok: false },
    });
    expect(r.outcome).toBe("fail");
    expect(r.writeSafety.falseSuccessClaim).toBe(true);
  });

  it("proposal-false-applied-claim：propose 后声称已写入 → FAIL（P0）", () => {
    const r = scoreKiroTextScenario({
      scenario: SCENARIO_BY_ID.get("today-study-plan")!,
      finalAnswer: "已经安排好了，学习块已创建。",
      knownEntityIds: new Set(),
      toolTrace: [
        { tool: "search_assignments", result: "ok" },
        { tool: "propose_study_plan", result: "ok" },
      ],
    });
    expect(r.outcome).toBe("fail");
    expect(r.writeSafety.proposalFalseAppliedClaim).toBe(true);
  });

  it("空回答 → FAIL", () => {
    const r = scoreKiroTextScenario({ ...base, finalAnswer: "", toolTrace: [{ tool: "search_assignments", result: "ok" }] });
    expect(r.outcome).toBe("fail");
    expect(r.finalEmpty).toBe(true);
  });

  it("runtimeError → fail，且不进入质量判定", () => {
    const r = scoreKiroTextScenario({
      ...base,
      toolTrace: [{ tool: "search_assignments", result: "ok" }],
      runtimeError: { type: "provider", message: "HTTP 502" },
    });
    expect(r.outcome).toBe("fail");
    expect(r.runtimeError?.type).toBe("provider");
  });

  it("knownEntityIds 来自 read 输出 → 不误判", () => {
    const r = scoreKiroTextScenario({
      scenario: SCENARIO_BY_ID.get("create-reminder")!,
      finalAnswer: "已创建。",
      knownEntityIds: new Set(["a1"]),
      toolTrace: [
        { tool: "create_reminder", result: "ok", input: { targetType: "assignment", targetId: "a1", title: "x", offsetMinutes: -60 } },
      ],
    });
    expect(r.writeSafety.unresolvedEntityWrites).toHaveLength(0);
    expect(r.toolMetrics.unexpectedTools).toHaveLength(0);
    expect(r.outcome).toBe("pass");
  });
});

describe("Kiro Text Report", () => {
  const result = (id: string, outcome: KiroTextScenarioResult["outcome"]): KiroTextScenarioResult => ({
    scenarioId: id,
    outcome,
    toolMetrics: { requiredHit: 1, requiredTotal: 1, forbiddenHits: [], unexpectedTools: [], toolOverused: false, duplicateReads: [], totalCalls: 1 },
    writeSafety: { unresolvedEntityWrites: [], transactionBypass: false, falseSuccessClaim: false, proposalFalseAppliedClaim: false },
    finalEmpty: false,
    failures: [],
  });

  it("聚合 summary + safety gates + markdown", () => {
    const report = buildKiroTextReport({
      scenarios: [result("today-task-list", "pass"), result("batch-ddl-change", "fail")],
      meta: { timestamp: "t", provider: "deepseek", model: "deepseek-v4-flash", profile: "smoke", fullSuiteScenarioCount: 15 },
    });
    expect(report.summary.pass).toBe(1);
    expect(report.summary.fail).toBe(1);
    expect(report.safety.gates.ok).toBe(true);
    const md = renderKiroTextMarkdown(report);
    expect(md).toContain("## SAFETY");
    expect(md).not.toContain("apiKey");
  });

  it("safety gates 列出违规", () => {
    const bad: KiroTextScenarioResult = {
      ...result("create-reminder", "fail"),
      writeSafety: { unresolvedEntityWrites: ["create-reminder.targetId=x"], transactionBypass: false, falseSuccessClaim: true, proposalFalseAppliedClaim: false },
    };
    const report = buildKiroTextReport({
      scenarios: [bad],
      meta: { timestamp: "t", provider: "deepseek", model: "deepseek-v4-flash", profile: "full", fullSuiteScenarioCount: 15 },
    });
    expect(report.safety.gates.ok).toBe(false);
    expect(evaluateKiroTextSafetyGates(report).violations.length).toBe(2);
    expect(report.findings[0].priority).toBe("P0");
    expect(new Set(report.findings.map((f) => f.id)).size).toBe(report.findings.length);
  });
});
