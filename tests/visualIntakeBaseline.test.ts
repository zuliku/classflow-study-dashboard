/**
 * Visual Intake Eval V1.3 —— Baseline Manifest & Comparison（offline；不调用真实模型）。
 * 覆盖：contract fingerprint determinism/漂移、promotion eligibility、
 * transition 分类、metric delta、safetyRegression、comparisonKind、fail-closed 拒绝。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  stableCanonicalJson,
  buildVisualEvalContractPayload,
  computeVisualEvalContractFingerprint,
  buildCurrentVisualEvalContract,
  VISUAL_EVAL_CONTRACT_VERSION,
} from "@/lib/ai/eval/visualIntakeContract";
import {
  createVisualEvalBaselineManifest,
  compareVisualEvalToBaseline,
  classifyVisualEvalTransition,
  renderVisualEvalComparisonMarkdown,
  VisualEvalBaselineManifest,
} from "@/lib/ai/eval/visualIntakeBaseline";
import { buildVisualEvalReport, VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { VisualEvalScenarioResult } from "@/lib/ai/eval/visualIntakeScoring";
import { VISUAL_INTAKE_EVAL_SCENARIOS } from "@/lib/ai/eval/visualIntakeScenarios";

const SUITE_IDS = VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id);

function mkResult(id: string, over: Partial<VisualEvalScenarioResult> = {}): VisualEvalScenarioResult {
  return {
    scenarioId: id,
    outcome: "pass",
    runtime: { proposalProduced: true, preflightRejected: false },
    proposedActions: [],
    proposedPending: [],
    toolTrace: [],
    metrics: { actionTP: 1, actionFP: 0, actionFN: 0, entityAccurate: 1, entityTotal: 1, timeAccurate: 1, timeTotal: 1, pendingCorrect: 1, pendingWrong: 0 },
    safety: { directWriteAttempts: [], unsafeProposal: false, unsafeReasons: [] },
    failures: [],
    ...over,
  };
}

function buildReport(opts: {
  provider?: string;
  model?: string;
  gitSha?: string;
  filtered?: boolean;
  scenarioOutcomes?: Record<string, "pass" | "partial" | "fail">;
  scenarioMetrics?: Record<string, Partial<VisualEvalScenarioResult["metrics"]>>;
  safetyScenarios?: Record<string, VisualEvalScenarioResult["safety"]>;
  runtimeErrorIds?: string[];
  fullSuiteIds?: string[];
  requestedIds?: string[];
}): VisualEvalReport {
  const ids = opts.requestedIds ?? SUITE_IDS;
  const scenarios = ids.map((id) => {
    const base = mkResult(id);
    if (opts.runtimeErrorIds?.includes(id)) {
      return { ...base, outcome: "fail" as const, metrics: { actionTP: 0, actionFP: 0, actionFN: 0, entityAccurate: 0, entityTotal: 0, timeAccurate: 0, timeTotal: 0, pendingCorrect: 0, pendingWrong: 0 }, runtimeError: { type: "provider" as const, message: "502" }, failures: ["provider runtime failure: 502"] };
    }
    return {
      ...base,
      outcome: opts.scenarioOutcomes?.[id] ?? base.outcome,
      metrics: { ...base.metrics, ...(opts.scenarioMetrics?.[id] ?? {}) },
      safety: opts.safetyScenarios?.[id] ?? base.safety,
    };
  });
  return buildVisualEvalReport({
    scenarios,
    meta: {
      timestamp: "2026-08-16T00:00:00.000Z",
      provider: opts.provider ?? "opencode-go",
      model: opts.model ?? "mimo-v2.5",
      fullSuiteScenarioCount: SUITE_IDS.length,
      filtered: opts.filtered ?? false,
      ...(opts.gitSha ? { gitSha: opts.gitSha } : {}),
    },
    requestedScenarioIds: ids,
    fullSuiteScenarioIds: opts.fullSuiteIds ?? SUITE_IDS,
  });
}

const eligibleReport = () => buildReport({});
const hashOf = (payload: unknown) => createHash("sha256").update(stableCanonicalJson(payload), "utf8").digest("hex");

describe("Eval V1.3：Contract fingerprint", () => {
  it("A. deterministic：同 payload 两次一致；stableCanonicalJson 与 key 顺序无关", () => {
    expect(computeVisualEvalContractFingerprint()).toBe(computeVisualEvalContractFingerprint());
    const a = stableCanonicalJson({ b: 1, a: { d: 2, c: 3 }, arr: [1, 2] });
    const b = stableCanonicalJson({ a: { c: 3, d: 2 }, b: 1, arr: [1, 2] });
    expect(a).toBe(b);
    expect(stableCanonicalJson({ x: undefined, y: 1 })).toBe(stableCanonicalJson({ y: 1 }));
  });

  it("B. scenario expected deadline 改变 → fingerprint 改变", () => {
    const payload = JSON.parse(JSON.stringify(buildVisualEvalContractPayload())) as Record<string, unknown>;
    const scenarios = payload.scenarios as { expected: { actions: { fields?: Record<string, unknown> }[] } }[];
    const target = scenarios.find((s) => s.expected.actions[0]?.fields?.ddl !== undefined);
    expect(target).toBeTruthy();
    (target!.expected.actions[0].fields as Record<string, unknown>).ddl = "2099-01-01T00:00:00";
    expect(hashOf(payload)).not.toBe(computeVisualEvalContractFingerprint());
  });

  it("C. scenario screenshot text 改变 → fingerprint 改变", () => {
    const payload = JSON.parse(JSON.stringify(buildVisualEvalContractPayload())) as Record<string, unknown>;
    const scenarios = payload.scenarios as { screenshot: { messages: { text: string }[] } }[];
    scenarios[0].screenshot.messages[0].text = "修改后的截图文本";
    expect(hashOf(payload)).not.toBe(computeVisualEvalContractFingerprint());
  });

  it("D. VISUAL_EVAL_NOW 改变 → fingerprint 改变（payload 中 fixedNow）", () => {
    const payload = JSON.parse(JSON.stringify(buildVisualEvalContractPayload())) as Record<string, unknown>;
    payload.fixedNow = "2027-01-01T00:00:00.000Z";
    expect(hashOf(payload)).not.toBe(computeVisualEvalContractFingerprint());
  });

  it("E/F. provider/model/gitSha 不进入 fingerprint（subject under evaluation / provenance）", () => {
    const payload = buildVisualEvalContractPayload();
    const json = stableCanonicalJson(payload);
    expect(json).not.toContain("opencode-go");
    expect(json).not.toContain("mimo-v2.5");
    expect(json).not.toContain("gitSha");
    // 同一 fingerprint 前后一致（描述符内不含 provider/model/gitSha）
    const c = buildCurrentVisualEvalContract();
    expect(c.fingerprint).toBe(computeVisualEvalContractFingerprint());
    expect(c.contractVersion).toBe(VISUAL_EVAL_CONTRACT_VERSION);
    expect(c.scenarioIds).toEqual(SUITE_IDS);
  });
});

describe("Eval V1.3：Baseline Promotion eligibility", () => {
  it("1. valid full safety-clean report → promotion success", () => {
    const manifest = createVisualEvalBaselineManifest(eligibleReport());
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.contract.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.source.runtimeParity).toBe("production");
    expect(manifest.scenarios).toHaveLength(SUITE_IDS.length);
  });

  it("2. filtered report → reject", () => {
    expect(() => createVisualEvalBaselineManifest(buildReport({ filtered: true, requestedIds: [SUITE_IDS[0]] }))).toThrow(/BASELINE_NOT_ELIGIBLE/);
  });

  it("3. runtime invalid → reject", () => {
    expect(() => createVisualEvalBaselineManifest(buildReport({ runtimeErrorIds: [SUITE_IDS[0]] }))).toThrow(/BASELINE_NOT_ELIGIBLE/);
  });

  it("4. Safety unsafe → reject", () => {
    expect(() =>
      createVisualEvalBaselineManifest(buildReport({ safetyScenarios: { [SUITE_IDS[0]]: { directWriteAttempts: ["create_reminder"], unsafeProposal: false, unsafeReasons: [] } } }))
    ).toThrow(/BASELINE_NOT_ELIGIBLE/);
  });

  it("5. legacy（无 contract）→ reject", () => {
    const report = { ...eligibleReport() } as VisualEvalReport;
    delete (report as { contract?: unknown }).contract;
    expect(() => createVisualEvalBaselineManifest(report)).toThrow(/BASELINE_NOT_ELIGIBLE/);
  });

  it("6. contract fingerprint != current → reject", () => {
    const report = eligibleReport();
    report.contract = { ...report.contract, fingerprint: "0".repeat(64) };
    expect(() => createVisualEvalBaselineManifest(report)).toThrow(/BASELINE_NOT_ELIGIBLE/);
  });
});

describe("Eval V1.3：Candidate Regression Comparison", () => {
  const baseline = createVisualEvalBaselineManifest(eligibleReport());
  const compareWith = (over: Partial<Parameters<typeof buildReport>[0]> & { contract?: Partial<VisualEvalReport["contract"]>; deleteContract?: boolean }) => {
    const candidate = buildReport(over);
    if (over.deleteContract) {
      const c = { ...candidate } as VisualEvalReport;
      delete (c as { contract?: unknown }).contract;
      return compareVisualEvalToBaseline({ baseline, candidate: c });
    }
    if (over.contract) candidate.contract = { ...candidate.contract, ...over.contract };
    return compareVisualEvalToBaseline({ baseline, candidate });
  };

  it("1-7. transition 分类矩阵", () => {
    expect(classifyVisualEvalTransition("pass", "pass")).toBe("unchanged-pass");
    expect(classifyVisualEvalTransition("pass", "partial")).toBe("regressed");
    expect(classifyVisualEvalTransition("pass", "fail")).toBe("regressed");
    expect(classifyVisualEvalTransition("partial", "pass")).toBe("improved");
    expect(classifyVisualEvalTransition("partial", "partial")).toBe("unchanged-partial");
    expect(classifyVisualEvalTransition("partial", "fail")).toBe("regressed");
    expect(classifyVisualEvalTransition("fail", "pass")).toBe("improved");
    expect(classifyVisualEvalTransition("fail", "partial")).toBe("improved");
    expect(classifyVisualEvalTransition("fail", "fail")).toBe("unchanged-fail");
  });

  it("pass→partial 归入 regressions；partial→pass 归入 improvements；其余 unchanged", () => {
    const c = compareWith({ scenarioOutcomes: { [SUITE_IDS[0]]: "partial", [SUITE_IDS[1]]: "fail" } });
    expect(c.regressions.map((r) => r.scenarioId)).toContain(SUITE_IDS[0]);
    expect(c.regressions.map((r) => r.scenarioId)).toContain(SUITE_IDS[1]);
    expect(c.regressions.every((r) => r.classification === "regressed")).toBe(true);
    expect(c.improvements).toHaveLength(0);
    expect(c.unchanged).toHaveLength(SUITE_IDS.length - 2);
  });

  it("fail→partial / fail→pass 归入 improvements", () => {
    // baseline 本身含 fail（promotion 只要求 validity/safety/parity/contract，不要求全部 pass）
    const baseline = createVisualEvalBaselineManifest(buildReport({ scenarioOutcomes: { [SUITE_IDS[0]]: "fail", [SUITE_IDS[1]]: "fail" } }));
    const candidate = buildReport({ scenarioOutcomes: { [SUITE_IDS[0]]: "partial", [SUITE_IDS[1]]: "pass" } });
    const c = compareVisualEvalToBaseline({ baseline, candidate });
    expect(c.improvements.map((i) => i.scenarioId).sort()).toEqual([SUITE_IDS[0], SUITE_IDS[1]].sort());
    expect(c.improvements.every((i) => i.classification === "improved")).toBe(true);
  });

  it("metric delta 正确（null 保持）", () => {
    const c = compareWith({ scenarioMetrics: { [SUITE_IDS[0]]: { actionFN: 1, actionTP: 0, actionFP: 0 } } });
    const recall = c.metricDeltas.find((d) => d.metric === "actionRecall")!;
    expect(recall.baseline).toBe(100);
    expect(recall.candidate).not.toBe(100);
    expect(recall.delta).toBeLessThan(0);
    const precision = c.metricDeltas.find((d) => d.metric === "actionPrecision")!;
    expect(typeof precision.delta).toBe("number");
  });

  it("candidate Safety violation → safetyRegression.detected=true + 列出", () => {
    const c = compareWith({
      safetyScenarios: {
        [SUITE_IDS[0]]: { directWriteAttempts: ["create_reminder"], unsafeProposal: false, unsafeReasons: [] },
        [SUITE_IDS[1]]: { directWriteAttempts: [], unsafeProposal: true, unsafeReasons: ["wrong-entity-proposal", "wrong-tool-proposal"] },
      },
    });
    expect(c.safetyRegression.detected).toBe(true);
    expect(c.safetyRegression.directWriteScenarios).toEqual([SUITE_IDS[0]]);
    expect(c.safetyRegression.wrongEntityProposals).toEqual([SUITE_IDS[1]]);
    expect(c.safetyRegression.wrongToolProposals).toEqual([SUITE_IDS[1]]);
    // candidate Safety FAIL 仍能 compare（关键语义）
    expect(c.compatible).toBe(true);
  });

  it("contract mismatch → INCOMPATIBLE_EVAL_CONTRACT（不输出 delta）", () => {
    expect(() => compareWith({ contract: { fingerprint: "0".repeat(64) } })).toThrow(/INCOMPATIBLE_EVAL_CONTRACT/);
  });

  it("legacy candidate（无 contract）→ LEGACY_EVAL_REPORT", () => {
    expect(() => compareWith({ deleteContract: true })).toThrow(/LEGACY_EVAL_REPORT/);
  });

  it("filtered candidate → 拒绝", () => {
    expect(() => compareWith({ filtered: true, requestedIds: [SUITE_IDS[0]] })).toThrow(/INVALID_EVAL_REPORT/);
  });

  it("invalid candidate（runtime error）→ 拒绝", () => {
    expect(() => compareWith({ runtimeErrorIds: [SUITE_IDS[0]] })).toThrow(/INVALID_EVAL_REPORT/);
  });

  it("scenario set mismatch → INCOMPATIBLE_SCENARIO_SET", () => {
    expect(() => compareWith({ contract: { scenarioIds: [...SUITE_IDS.slice(0, 19), "S99-fake"] } })).toThrow(/INCOMPATIBLE_SCENARIO_SET/);
  });

  it("cross-model：provider/model 不同 → comparisonKind=cross-model", () => {
    const c = compareWith({ provider: "opencode-go", model: "kimi-k3" });
    expect(c.comparisonKind).toBe("cross-model");
    expect(c.baseline.model).toBe("mimo-v2.5");
    expect(c.candidate.model).toBe("kimi-k3");
  });

  it("same model 不同 gitSha → implementation-change；完全相同 → repeat-run", () => {
    const c1 = compareWith({ gitSha: "abc1234" });
    expect(c1.comparisonKind).toBe("implementation-change");
    const c2 = compareWith({});
    expect(c2.comparisonKind).toBe("repeat-run");
  });

  it("Markdown 渲染包含关键 section（无 Overall Score）", () => {
    const c = compareWith({ scenarioOutcomes: { [SUITE_IDS[0]]: "fail" } });
    const md = renderVisualEvalComparisonMarkdown(c);
    expect(md).toContain("# Visual Intake Regression Comparison");
    expect(md).toContain("Regressions: 1");
    expect(md).toContain("Safety regression: NO");
    expect(md).toContain("## Metric Delta");
    expect(md).toContain("## Regressed Scenarios");
    expect(md).not.toContain("Overall Score");
  });
});

