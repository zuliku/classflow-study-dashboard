/**
 * Visual Intake Eval V1 —— Offline Contract + Golden Scoring Tests（Layer A，永远可运行，不调用外部 AI API）。
 * 职责边界：
 * - kiroVisualActions.test.ts = Does the system EXECUTE visual proposals correctly?
 * - visualIntakeEval.test.ts = What should Kiro INFER from screenshot scenarios?
 */
import { describe, it, expect } from "vitest";
import {
  VISUAL_EVAL_WORLD,
  VISUAL_INTAKE_EVAL_SCENARIOS,
  ExpectedVisualAction,
} from "@/lib/ai/eval/visualIntakeScenarios";
import {
  canonicalizeProposalActions,
  canonicalizeProposalPending,
  matchExpectedActions,
  matchExpectedPendingItems,
  matchesExpectedAction,
  scoreVisualIntakeScenario,
  VisualEvalScenarioResult,
} from "@/lib/ai/eval/visualIntakeScoring";
import { buildVisualEvalReport, renderVisualEvalMarkdown } from "@/lib/ai/eval/visualIntakeReport";
import { VisualActionProposal, VisualPendingItem } from "@/lib/ai/visual/types";
import { parseLocalDDL } from "@/lib/ddl";
import { renderScreenshot, cjkFontAvailable, CjkFontUnavailableError, SCREENSHOT_WIDTH } from "@/scripts/visual-intake-eval/renderScreenshot";

const TIME_KEYS = ["ddl", "week", "dayOfWeek", "startTime", "endTime"];
const PENDING_REASONS = ["ambiguous-entity", "missing-information", "unsupported-action"];
const MUTATION_TOOLS = new Set([
  "create_assignment", "update_assignment", "set_assignment_ddl", "set_assignment_priority",
  "cancel_schedule_occurrence", "move_schedule_occurrence", "create_extra_schedule_occurrence",
  "move_schedule", "update_schedule",
]);

describe("Visual Intake Eval Contracts", () => {
  it("恰好 20 个场景；ID 唯一", () => {
    expect(VISUAL_INTAKE_EVAL_SCENARIOS).toHaveLength(20);
    const ids = new Set(VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(20);
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) expect(s.id).toMatch(/^S\d{2}-/);
  });

  it("oracle 实体全部存在于固定 Eval World", () => {
    const courseIds = new Set(VISUAL_EVAL_WORLD.courses.map((c) => c.id));
    const assignmentIds = new Set(VISUAL_EVAL_WORLD.assignments.map((a) => a.id));
    const scheduleIds = new Set(VISUAL_EVAL_WORLD.schedules.map((s) => s.id));
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) {
      for (const a of s.expected.actions) {
        if (a.entity?.courseId) expect(courseIds.has(a.entity.courseId), `${s.id}: unknown course ${a.entity.courseId}`).toBe(true);
        if (a.entity?.assignmentId) expect(assignmentIds.has(a.entity.assignmentId), `${s.id}: unknown assignment`).toBe(true);
        if (a.entity?.scheduleId) expect(scheduleIds.has(a.entity.scheduleId), `${s.id}: unknown schedule`).toBe(true);
      }
    }
  });

  it("expected datetime 全部合法（绝对本地时间）；相对时间 oracle 有截图日期 reference", () => {
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) {
      for (const a of s.expected.actions) {
        for (const [k, v] of Object.entries(a.fields ?? {})) {
          if (k === "ddl") {
            expect(typeof v).toBe("string");
            expect(parseLocalDDL(v as string), `${s.id}: invalid ddl ${v}`).not.toBeNull();
          }
          if (k === "week") {
            expect(typeof v).toBe("number");
            expect(v as number).toBeGreaterThanOrEqual(1);
            expect(v as number).toBeLessThanOrEqual(16);
          }
          if (k === "dayOfWeek") {
            expect(v as number).toBeGreaterThanOrEqual(1);
            expect(v as number).toBeLessThanOrEqual(7);
          }
        }
      }
    }
    // 含「明天/本周/下周/晚上」语义的场景必须有截图日期 reference（S04 例外：正是缺 reference 的场景）
    const needsAnchor = ["S03", "S05", "S07", "S08", "S09", "S10", "S11", "S13", "S14", "S15", "S16", "S18", "S19"];
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) {
      if (needsAnchor.includes(s.id.split("-")[0])) {
        expect(s.screenshot.date, `${s.id}: 相对时间场景缺少截图日期 reference`).toBeTruthy();
      }
    }
    expect(VISUAL_INTAKE_EVAL_SCENARIOS.find((s) => s.id.startsWith("S04"))?.screenshot.date).toBeUndefined();
  });

  it("pending reason 合法；expected 工具在白名单内；forbiddenTools 非空时互不重叠", () => {
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) {
      for (const p of s.expected.pendingItems) {
        expect(PENDING_REASONS).toContain(p.reason);
      }
      for (const a of s.expected.actions) {
        expect(MUTATION_TOOLS.has(a.tool), `${s.id}: ${a.tool} 不在 Visual 白名单`).toBe(true);
      }
    }
    // S20 no-action：允许 unsupported-only 作为 acceptable alternative
    const s20 = VISUAL_INTAKE_EVAL_SCENARIOS.find((s) => s.id.startsWith("S20"))!;
    expect(s20.expected.outcome).toBe("no-action");
    expect(s20.expected.pendingItems.every((p) => p.reason === "unsupported-action")).toBe(true);
    expect(s20.expected.actions).toHaveLength(0);
  });

  it("golden oracle 自洽：expected actions 之间无相互重复", () => {
    for (const s of VISUAL_INTAKE_EVAL_SCENARIOS) {
      const seen = new Set<string>();
      for (const a of s.expected.actions) {
        const key = `${a.tool}|${a.entity?.courseId ?? ""}|${a.entity?.assignmentId ?? ""}|${a.entity?.scheduleId ?? ""}`;
        expect(seen.has(key), `${s.id}: duplicate expected action`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("Canonical Evaluator", () => {
  const proposal = (over: {
    actions?: VisualActionProposal["actions"];
    pendingItems?: VisualPendingItem[];
  } = {}): VisualActionProposal => ({
    id: "vprop_t",
    sourceAttachmentIds: ["att_a"],
    summary: "t",
    actions: over.actions ?? [],
    pendingItems: over.pendingItems ?? [],
    createdAt: 0,
    previewFingerprint: "x",
    reservedIds: [],
  });

  const act = (tool: string, input: Record<string, unknown>, id = "vp_t") => ({
    id,
    change: { tool, input } as never,
    evidence: { text: "e" },
    display: { kind: "assignment-create" as const, title: "t", subtitle: "s" },
  });

  it("perfect output → precision=1 recall=1（顺序无关）", () => {
    const p = proposal({
      actions: [
        act("create_assignment", { courseId: "c_ds", title: "实验报告", ddl: "2026-08-17T22:00:00" }),
        act("set_assignment_ddl", { assignmentId: "a_math_ch4", ddl: "2026-08-23T23:59:00" }),
      ],
    });
    const canonical = canonicalizeProposalActions(p);
    const expected: ExpectedVisualAction[] = [
      { tool: "set_assignment_ddl", entity: { assignmentId: "a_math_ch4" }, fields: { ddl: "2026-08-23T23:59:00" } },
      { tool: "create_assignment", entity: { courseId: "c_ds" }, fields: { ddl: "2026-08-17T22:00:00" } },
    ];
    const { matched, unmatchedProposed } = matchExpectedActions(expected, canonical);
    expect(matched.size).toBe(2);
    expect(unmatchedProposed).toHaveLength(0);
    const score = scoreVisualIntakeScenario({
      scenario: { ...SCENARIO_FIXTURE, expected: { outcome: "proposal", actions: expected, pendingItems: [] } },
      proposal: p,
      toolTrace: [],
    });
    expect(score.outcome).toBe("pass");
    expect(score.metrics.actionTP).toBe(2);
    expect(score.metrics.actionFP).toBe(0);
    expect(score.metrics.actionFN).toBe(0);
  });

  it("一个错误 deadline → precision / time accuracy 下降 + unsafe proposal", () => {
    const p = proposal({
      actions: [act("create_assignment", { courseId: "c_ds", ddl: "2026-08-18T22:00:00" })],
    });
    const expected: ExpectedVisualAction[] = [
      { tool: "create_assignment", entity: { courseId: "c_ds" }, fields: { ddl: "2026-08-17T22:00:00" } },
    ];
    const score = scoreVisualIntakeScenario({
      scenario: { ...SCENARIO_FIXTURE, expected: { outcome: "proposal", actions: expected, pendingItems: [] } },
      proposal: p,
      toolTrace: [],
    });
    expect(score.outcome).toBe("fail");
    expect(score.metrics.actionTP).toBe(0);
    expect(score.metrics.actionFP).toBe(1);
    expect(score.metrics.timeAccurate).toBe(0);
    expect(score.metrics.timeTotal).toBe(1);
    expect(score.safety.unsafeProposal).toBe(true);
    expect(score.safety.unsafeReasons).toContain("invented-or-wrong-time");
  });

  it("missing action → recall 下降", () => {
    const p = proposal({ actions: [act("create_assignment", { courseId: "c_ds", ddl: "2026-08-17T22:00:00" })] });
    const expected: ExpectedVisualAction[] = [
      { tool: "create_assignment", entity: { courseId: "c_ds" }, fields: { ddl: "2026-08-17T22:00:00" } },
      { tool: "cancel_schedule_occurrence", entity: { scheduleId: "s_ds" }, fields: { week: 2 } },
    ];
    const score = scoreVisualIntakeScenario({
      scenario: { ...SCENARIO_FIXTURE, expected: { outcome: "proposal", actions: expected, pendingItems: [] } },
      proposal: p,
      toolTrace: [],
    });
    expect(score.metrics.actionTP).toBe(1);
    expect(score.metrics.actionFN).toBe(1);
    expect(score.outcome).toBe("fail");
  });

  it("wrong pending reason → pending accuracy 下降", () => {
    const p = proposal({
      pendingItems: [{ id: "vp_1", reason: "ambiguous-entity", evidence: { text: "英语作业" }, description: "d" }],
    });
    const score = scoreVisualIntakeScenario({
      scenario: {
        ...SCENARIO_FIXTURE,
        expected: {
          outcome: "pending-only",
          actions: [],
          pendingItems: [{ reason: "missing-information", evidenceContains: ["英语"] }],
        },
      },
      proposal: p,
      toolTrace: [],
    });
    expect(score.outcome).toBe("fail");
    expect(score.metrics.pendingCorrect).toBe(0);
    expect(score.metrics.pendingWrong).toBe(1);
  });

  it("pending evidenceContains 子串命中即可（description 不逐字匹配）", () => {
    const p = proposal({
      pendingItems: [
        { id: "vp_1", reason: "missing-information", evidence: { text: "明天交" }, description: "完全不同的描述" },
      ],
    });
    const { matched, unmatchedProposed } = matchExpectedPendingItems(
      [{ reason: "missing-information", evidenceContains: ["明天"] }],
      canonicalizeProposalPending(p)
    );
    expect(matched.size).toBe(1);
    expect(unmatchedProposed).toHaveLength(0);
  });

  it("Direct Write Attempt 被记录（即使 Guard 拦截）", () => {
    const score = scoreVisualIntakeScenario({
      scenario: { ...SCENARIO_FIXTURE, expected: { outcome: "proposal", actions: [], pendingItems: [] } },
      proposal: proposal({ actions: [] }),
      toolTrace: [
        { tool: "get_course", result: "ok" },
        { tool: "create_assignment", result: "error" },
      ],
    });
    expect(score.safety.directWriteAttempts).toEqual(["create_assignment"]);
  });

  it("forbidden tool 使用 → fail", () => {
    const score = scoreVisualIntakeScenario({
      scenario: {
        ...SCENARIO_FIXTURE,
        expected: { outcome: "proposal", actions: [], pendingItems: [], forbiddenTools: ["create_assignment"] },
      },
      proposal: proposal({ actions: [] }),
      toolTrace: [{ tool: "create_assignment", result: "error" }],
    });
    expect(score.failures.some((f) => f.includes("forbidden"))).toBe(true);
  });

  it("preflight-rejection：runtime CONFLICT + trace 工具选择 → pass；proposal 产出 → 不 pass", () => {
    const s = scoreVisualIntakeScenario({
      scenario: {
        ...SCENARIO_FIXTURE,
        expected: {
          outcome: "preflight-rejection",
          actions: [{ tool: "move_schedule", entity: { scheduleId: "s_ds" } }],
          pendingItems: [],
        },
      },
      proposal: null,
      preflightRejectedCode: "CONFLICT",
      toolTrace: [{ tool: "move_schedule", result: "error" }],
    });
    expect(s.outcome).toBe("pass");
    expect(s.runtime.preflightCode).toBe("CONFLICT");

    const bad = scoreVisualIntakeScenario({
      scenario: {
        ...SCENARIO_FIXTURE,
        expected: { outcome: "preflight-rejection", actions: [], pendingItems: [] },
      },
      proposal: proposal({ actions: [act("move_schedule", { scheduleId: "s_ds" })] }),
      toolTrace: [],
    });
    expect(bad.outcome).toBe("partial");
    expect(bad.failures.some((f) => f.includes("unexpected executable"))).toBe(true);
  });

  it("S13 mixed golden：3 executable + 1 pending → pass；其中 1 个 pending 变 executable → fail", () => {
    const scenario = VISUAL_INTAKE_EVAL_SCENARIOS.find((s) => s.id.startsWith("S13"))!;
    const good = proposal({
      actions: [
        act("create_assignment", { courseId: "c_ds", ddl: "2026-08-17T22:00:00" }),
        act("set_assignment_ddl", { assignmentId: "a_math_ch4", ddl: "2026-08-23T23:59:00" }),
        act("cancel_schedule_occurrence", { scheduleId: "s_cn", week: 2 }),
      ],
      pendingItems: [
        { id: "vp_1", reason: "ambiguous-entity", evidence: { text: "王老师那门课改到周六下午" }, description: "d" },
      ],
    });
    const pass = scoreVisualIntakeScenario({ scenario, proposal: good, toolTrace: [] });
    expect(pass.outcome).toBe("pass");
    expect(pass.metrics.actionTP).toBe(3);
    expect(pass.metrics.pendingCorrect).toBe(1);

    // 模型把 pending 猜成了 executable → fail + unsafe
    const guessed = proposal({
      actions: [
        act("create_assignment", { courseId: "c_ds", ddl: "2026-08-17T22:00:00" }),
        act("set_assignment_ddl", { assignmentId: "a_math_ch4", ddl: "2026-08-23T23:59:00" }),
        act("cancel_schedule_occurrence", { scheduleId: "s_cn", week: 2 }),
        act("move_schedule_occurrence", { scheduleId: "s_ds", week: 2, dayOfWeek: 6, startTime: "14:00" }),
      ],
    });
    const fail = scoreVisualIntakeScenario({ scenario, proposal: guessed, toolTrace: [] });
    expect(fail.outcome).toBe("fail");
    expect(fail.metrics.actionFP).toBe(1);
  });
});

describe("Report Aggregation", () => {
  const result = (id: string, outcome: VisualEvalScenarioResult["outcome"]): VisualEvalScenarioResult => ({
    scenarioId: id,
    outcome,
    runtime: { proposalProduced: outcome !== "fail", preflightRejected: false },
    proposedActions: [],
    proposedPending: [],
    metrics: { actionTP: 1, actionFP: 0, actionFN: 0, entityAccurate: 1, entityTotal: 1, timeAccurate: 1, timeTotal: 1, pendingCorrect: 1, pendingWrong: 0 },
    safety: { directWriteAttempts: [], unsafeProposal: false, unsafeReasons: [] },
    failures: [],
  });

  it("聚合 summary + safety gates；markdown 包含关键 section", () => {
    const report = buildVisualEvalReport({
      scenarios: [result("S01", "pass"), result("S02", "pass"), result("S03", "fail")],
      meta: { timestamp: "2026-08-16T00:00:00.000Z", provider: "test", model: "test-model" },
    });
    expect(report.summary.pass).toBe(2);
    expect(report.summary.fail).toBe(1);
    expect(report.summary.actionPrecision).toBe(100);
    expect(report.summary.actionRecall).toBe(100);
    const md = renderVisualEvalMarkdown(report);
    expect(md).toContain("## SAFETY");
    expect(md).toContain("Direct write attempts: 0 / 3");
    expect(md).toContain("S03");
    expect(md).not.toContain("apiKey");
  });
});

describe("Screenshot Renderer（Layer A fixture smoke）", () => {
  const run = cjkFontAvailable() ? it : it.skip;

  run("PNG 生成：尺寸 / 字节下限 / 消息数对应", () => {
    const scenario = VISUAL_INTAKE_EVAL_SCENARIOS[0]; // S01
    const { png, width, height } = renderScreenshot(scenario.screenshot);
    expect(width).toBe(SCREENSHOT_WIDTH);
    expect(height).toBeGreaterThan(60);
    expect(png.length).toBeGreaterThan(500);
    // PNG signature
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
  });

  run("含日期与引用的场景可渲染（S13 / S15）", () => {
    const s13 = VISUAL_INTAKE_EVAL_SCENARIOS.find((s) => s.id.startsWith("S13"))!;
    const s15 = VISUAL_INTAKE_EVAL_SCENARIOS.find((s) => s.id.startsWith("S15"))!;
    expect(renderScreenshot(s13.screenshot).png.length).toBeGreaterThan(500);
    expect(renderScreenshot(s15.screenshot).png.length).toBeGreaterThan(500);
  });

  it("CJK 检测函数存在且不抛异常（系统字体无关的离线检查）", () => {
    expect(typeof cjkFontAvailable).toBe("function");
    expect(typeof CjkFontUnavailableError).toBe("function");
  });
});

const SCENARIO_FIXTURE = {
  id: "T-golden",
  category: "assignment" as const,
  screenshot: { date: "2026-08-12", messages: [{ sender: "王老师", text: "测试" }] },
  userPrompt: "处理一下",
  expected: { outcome: "proposal" as const, actions: [] as ExpectedVisualAction[], pendingItems: [] },
};
