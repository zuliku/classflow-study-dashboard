/**
 * Visual Intake Eval V1.3 —— Baseline Manifest & Candidate Regression Comparison。
 *
 * Comparability Contract：
 * - Baseline = 受版本控制的 Safety-clean reference run（只存可比较统计事实，绝不存 tool inputs /
 *   final answer / screenshot / API key / reasoning / raw provider error）
 * - Candidate = VisualEvalReport；必须 Validity clean + full coverage + production parity，
 *   但 Safety 可以 fail（我们要比较结果明确告诉开发者新增了 Safety regression）
 * - Contract fingerprint 必须完全一致（否则 INCOMPATIBLE_EVAL_CONTRACT）
 * - Scenario set 必须完全一致（否则 INCOMPATIBLE_SCENARIO_SET）
 *
 * 明确等级：PASS=2 / PARTIAL=1 / FAIL=0；transition 只分类（improved / regressed / unchanged-*），
 * 不给回归硬编码分数；不生成 Overall Score；不建立 Quality Hard Gate。
 */
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { VisualEvalScenarioMetrics } from "@/lib/ai/eval/visualIntakeScoring";
import { buildCurrentVisualEvalContract, VisualEvalContractDescriptor } from "@/lib/ai/eval/visualIntakeContract";

// ---------------- Baseline Manifest ----------------

export interface VisualEvalBaselineManifest {
  schemaVersion: 1;
  createdAt: string;
  contract: {
    contractVersion: string;
    fingerprint: string;
    scenarioIds: string[];
  };
  source: {
    provider: string;
    model: string;
    gitSha?: string;
    runtimeParity: "production";
  };
  summary: {
    pass: number;
    partial: number;
    fail: number;
    actionPrecision: number | null;
    actionRecall: number | null;
    entityAccuracy: number | null;
    timeAccuracy: number | null;
    pendingAccuracy: number | null;
  };
  scenarios: Array<{
    scenarioId: string;
    outcome: "pass" | "partial" | "fail";
    metrics: VisualEvalScenarioMetrics;
  }>;
}

/** Promotion eligibility（任一不满足 → throw BASELINE_NOT_ELIGIBLE；绝不自动生成假 Baseline） */
export function createVisualEvalBaselineManifest(report: VisualEvalReport): VisualEvalBaselineManifest {
  const contract = buildCurrentVisualEvalContract();
  if (!report.validity?.ok) throw new Error("BASELINE_NOT_ELIGIBLE: validity 未通过");
  if (report.validity.baselineEligible !== true) throw new Error("BASELINE_NOT_ELIGIBLE: 非 full-suite eligible run（filtered / 结构不完整）");
  if (report.meta.runtimeParity !== "production") throw new Error("BASELINE_NOT_ELIGIBLE: runtimeParity 非 production");
  if (!report.safety?.gates?.ok) throw new Error("BASELINE_NOT_ELIGIBLE: Safety Gates 未通过（Baseline 必须 Safety-clean）");
  if (!report.contract || report.contract.fingerprint !== contract.fingerprint) {
    throw new Error("BASELINE_NOT_ELIGIBLE: contract 与当前 Benchmark Oracle 不一致（legacy 或 fingerprint 漂移）");
  }
  return {
    schemaVersion: 1,
    createdAt: report.meta.timestamp,
    contract: {
      contractVersion: report.contract.contractVersion,
      fingerprint: report.contract.fingerprint,
      scenarioIds: report.contract.scenarioIds,
    },
    source: {
      provider: report.meta.provider,
      model: report.meta.model,
      ...(report.meta.gitSha ? { gitSha: report.meta.gitSha } : {}),
      runtimeParity: "production",
    },
    summary: {
      pass: report.summary.pass,
      partial: report.summary.partial,
      fail: report.summary.fail,
      actionPrecision: report.summary.actionPrecision,
      actionRecall: report.summary.actionRecall,
      entityAccuracy: report.summary.entityAccuracy,
      timeAccuracy: report.summary.timeAccuracy,
      pendingAccuracy: report.summary.pendingAccuracy,
    },
    scenarios: report.scenarios
      .filter((s) => !s.runtimeError)
      .map((s) => ({
        scenarioId: s.scenarioId,
        outcome: s.outcome,
        metrics: s.metrics,
      })),
  };
}

// ---------------- Comparison ----------------

export const VISUAL_EVAL_OUTCOME_RANK = { pass: 2, partial: 1, fail: 0 } as const;

export type VisualEvalTransition =
  | "unchanged-pass"
  | "unchanged-partial"
  | "unchanged-fail"
  | "improved"
  | "regressed";

export function classifyVisualEvalTransition(
  baselineOutcome: "pass" | "partial" | "fail",
  candidateOutcome: "pass" | "partial" | "fail"
): VisualEvalTransition {
  const b = VISUAL_EVAL_OUTCOME_RANK[baselineOutcome];
  const c = VISUAL_EVAL_OUTCOME_RANK[candidateOutcome];
  if (c > b) return "improved";
  if (c < b) return "regressed";
  return `unchanged-${baselineOutcome}` as VisualEvalTransition;
}

export interface VisualEvalScenarioDelta {
  scenarioId: string;
  baselineOutcome: "pass" | "partial" | "fail";
  candidateOutcome: "pass" | "partial" | "fail";
  classification: VisualEvalTransition;
}

export interface VisualEvalMetricDelta {
  metric: "actionPrecision" | "actionRecall" | "entityAccuracy" | "timeAccuracy" | "pendingAccuracy";
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
}

export type VisualEvalComparisonKind = "implementation-change" | "cross-model" | "repeat-run";

export interface VisualEvalComparison {
  compatible: true;
  comparisonKind: VisualEvalComparisonKind;
  baseline: { provider: string; model: string; gitSha?: string };
  candidate: { provider: string; model: string; gitSha?: string };
  contractFingerprint: string;
  metricDeltas: VisualEvalMetricDelta[];
  regressions: VisualEvalScenarioDelta[];
  improvements: VisualEvalScenarioDelta[];
  unchanged: VisualEvalScenarioDelta[];
  safetyRegression: {
    detected: boolean;
    directWriteScenarios: string[];
    wrongEntityProposals: string[];
    inventedTimeProposals: string[];
    wrongToolProposals: string[];
    pendingMutationCapability: number;
  };
}

/**
 * Candidate vs Baseline 正式比较（fail-closed）：
 * - candidate 无 contract（legacy）→ LEGACY_EVAL_REPORT
 * - candidate validity / full coverage / baselineEligible / production parity 任一不满足 → 拒绝
 * - fingerprint 不一致 → INCOMPATIBLE_EVAL_CONTRACT（不输出任何 delta）
 * - scenario set 不一致 → INCOMPATIBLE_SCENARIO_SET
 */
export function compareVisualEvalToBaseline(input: {
  baseline: VisualEvalBaselineManifest;
  candidate: VisualEvalReport;
}): VisualEvalComparison {
  const { baseline, candidate } = input;
  if (!candidate.contract) throw new Error("LEGACY_EVAL_REPORT: candidate 无 contract，不可作为正式 V1.3 comparison input");
  if (!candidate.validity?.ok) throw new Error("INVALID_EVAL_REPORT: candidate validity 未通过");
  if (candidate.validity.coverage !== "full") throw new Error("INVALID_EVAL_REPORT: candidate 非 full coverage（filtered run 不可比较）");
  if (candidate.validity.baselineEligible !== true) throw new Error("INVALID_EVAL_REPORT: candidate 非 baseline eligible");
  if (candidate.meta.runtimeParity !== "production") throw new Error("INVALID_EVAL_REPORT: candidate runtimeParity 非 production");
  if (baseline.contract.fingerprint !== candidate.contract.fingerprint) {
    throw new Error("INCOMPATIBLE_EVAL_CONTRACT: baseline 与 candidate 的 Benchmark Oracle 不一致");
  }
  const baselineIds = [...baseline.contract.scenarioIds];
  const candidateIds = [...candidate.contract.scenarioIds];
  if (baselineIds.length !== candidateIds.length || baselineIds.some((id, i) => id !== candidateIds[i])) {
    throw new Error("INCOMPATIBLE_SCENARIO_SET: baseline 与 candidate scenario set 不一致");
  }

  // comparisonKind：provider/model 是 subject under evaluation；gitSha 是 provenance
  const sameSubject = baseline.source.provider === candidate.meta.provider && baseline.source.model === candidate.meta.model;
  const sameSha = (baseline.source.gitSha ?? null) === (candidate.meta.gitSha ?? null);
  const comparisonKind: VisualEvalComparisonKind = sameSubject ? (sameSha ? "repeat-run" : "implementation-change") : "cross-model";

  // deterministic：按 contract.scenarioIds（canonical）排序，不依赖 report.scenarios 顺序
  const baselineById = new Map(baseline.scenarios.map((s) => [s.scenarioId, s]));
  const candidateById = new Map(candidate.scenarios.filter((s) => !s.runtimeError).map((s) => [s.scenarioId, s]));
  const deltas: VisualEvalScenarioDelta[] = [];
  for (const id of baselineIds) {
    const b = baselineById.get(id);
    const c = candidateById.get(id);
    if (!b || !c) throw new Error(`INCOMPATIBLE_SCENARIO_SET: missing scenario ${id}`);
    deltas.push({
      scenarioId: id,
      baselineOutcome: b.outcome,
      candidateOutcome: c.outcome,
      classification: classifyVisualEvalTransition(b.outcome, c.outcome),
    });
  }
  const regressions = deltas.filter((d) => d.classification === "regressed");
  const improvements = deltas.filter((d) => d.classification === "improved");
  const unchanged = deltas.filter((d) => d.classification.startsWith("unchanged"));

  // Metric delta（null 语义保持；绝不 null → 0）
  const metricDeltas: VisualEvalMetricDelta[] = (["actionPrecision", "actionRecall", "entityAccuracy", "timeAccuracy", "pendingAccuracy"] as const).map((m) => {
    const b = baseline.summary[m];
    const c = candidate.summary[m];
    return {
      metric: m,
      baseline: b,
      candidate: c,
      delta: b === null || c === null ? null : Math.round((c - b) * 10) / 10,
    };
  });

  const safetyRegression = {
    detected:
      candidate.safety.directWriteScenarios.length > 0 ||
      candidate.safety.wrongEntityProposals.length > 0 ||
      candidate.safety.inventedTimeProposals.length > 0 ||
      candidate.safety.wrongToolProposals.length > 0 ||
      candidate.safety.pendingMutationCapability > 0,
    directWriteScenarios: [...candidate.safety.directWriteScenarios],
    wrongEntityProposals: [...candidate.safety.wrongEntityProposals],
    inventedTimeProposals: [...candidate.safety.inventedTimeProposals],
    wrongToolProposals: [...candidate.safety.wrongToolProposals],
    pendingMutationCapability: candidate.safety.pendingMutationCapability,
  };

  return {
    compatible: true,
    comparisonKind,
    baseline: { provider: baseline.source.provider, model: baseline.source.model, ...(baseline.source.gitSha ? { gitSha: baseline.source.gitSha } : {}) },
    candidate: { provider: candidate.meta.provider, model: candidate.meta.model, ...(candidate.meta.gitSha ? { gitSha: candidate.meta.gitSha } : {}) },
    contractFingerprint: candidate.contract.fingerprint,
    metricDeltas,
    regressions,
    improvements,
    unchanged,
    safetyRegression,
  };
}

// ---------------- Markdown ----------------

export function renderVisualEvalComparisonMarkdown(comparison: VisualEvalComparison): string {
  const lines: string[] = [];
  lines.push("# Visual Intake Regression Comparison");
  lines.push("");
  lines.push(`Baseline: ${comparison.baseline.provider} / ${comparison.baseline.model}${comparison.baseline.gitSha ? ` · ${comparison.baseline.gitSha}` : ""}`);
  lines.push(`Candidate: ${comparison.candidate.provider} / ${comparison.candidate.model}${comparison.candidate.gitSha ? ` · ${comparison.candidate.gitSha}` : ""}`);
  lines.push("");
  lines.push(`Contract: ${comparison.contractFingerprint}`);
  lines.push(`Comparison: ${comparison.comparisonKind}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`Regressions: ${comparison.regressions.length}`);
  lines.push(`Improvements: ${comparison.improvements.length}`);
  lines.push(`Unchanged: ${comparison.unchanged.length}`);
  lines.push(`Safety regression: ${comparison.safetyRegression.detected ? "YES" : "NO"}`);
  if (comparison.safetyRegression.detected) {
    lines.push("");
    lines.push("Safety regression details:");
    if (comparison.safetyRegression.directWriteScenarios.length > 0) lines.push(`- Direct write: ${comparison.safetyRegression.directWriteScenarios.join(", ")}`);
    if (comparison.safetyRegression.wrongEntityProposals.length > 0) lines.push(`- Wrong entity: ${comparison.safetyRegression.wrongEntityProposals.join(", ")}`);
    if (comparison.safetyRegression.inventedTimeProposals.length > 0) lines.push(`- Invented time: ${comparison.safetyRegression.inventedTimeProposals.join(", ")}`);
    if (comparison.safetyRegression.wrongToolProposals.length > 0) lines.push(`- Wrong tool: ${comparison.safetyRegression.wrongToolProposals.join(", ")}`);
    if (comparison.safetyRegression.pendingMutationCapability > 0) lines.push(`- Pending mutation capability: ${comparison.safetyRegression.pendingMutationCapability}`);
  }
  lines.push("");
  lines.push("## Metric Delta");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Delta |");
  lines.push("| --- | --- | --- | --- |");
  for (const d of comparison.metricDeltas) {
    const fmt = (v: number | null) => (v === null ? "-" : `${v}%`);
    lines.push(`| ${d.metric} | ${fmt(d.baseline)} | ${fmt(d.candidate)} | ${d.delta === null ? "-" : `${d.delta > 0 ? "+" : ""}${d.delta}%`} |`);
  }
  if (comparison.regressions.length > 0) {
    lines.push("");
    lines.push("## Regressed Scenarios");
    lines.push("");
    for (const d of comparison.regressions) {
      lines.push(`${d.scenarioId}: ${d.baselineOutcome.toUpperCase()} → ${d.candidateOutcome.toUpperCase()}`);
    }
  }
  if (comparison.improvements.length > 0) {
    lines.push("");
    lines.push("## Improved Scenarios");
    lines.push("");
    for (const d of comparison.improvements) {
      lines.push(`${d.scenarioId}: ${d.baselineOutcome.toUpperCase()} → ${d.candidateOutcome.toUpperCase()}`);
    }
  }
  if (comparison.unchanged.length > 0) {
    lines.push("");
    lines.push("## Unchanged Scenarios");
    lines.push("");
    for (const d of comparison.unchanged) {
      lines.push(`${d.scenarioId}: ${d.candidateOutcome.toUpperCase()}`);
    }
  }
  return lines.join("\n");
}
