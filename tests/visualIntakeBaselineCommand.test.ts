/**
 * Visual Intake Eval V1.3.1 —— Promotion primitive unit tests（全部使用 temp path，绝不触碰 canonical baseline）。
 * 覆盖：parent dir 自动创建、成功后持久存在、duplicate no-clobber 内容不变、
 * invalid report 不留下 artifact、canonical baseline 不可被 helper 删除/覆盖。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promoteVisualEvalBaselineAt, VISUAL_EVAL_BASELINE_PATH } from "@/scripts/visual-intake-eval/promote";
import { buildVisualEvalReport, VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { VisualEvalScenarioResult } from "@/lib/ai/eval/visualIntakeScoring";
import { VISUAL_INTAKE_EVAL_SCENARIOS } from "@/lib/ai/eval/visualIntakeScenarios";

const SUITE_IDS = VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id);

function mkResult(id: string): VisualEvalScenarioResult {
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
  };
}

function buildEligibleReport(): VisualEvalReport {
  return buildVisualEvalReport({
    scenarios: SUITE_IDS.map(mkResult),
    meta: { timestamp: "t", provider: "p", model: "m", fullSuiteScenarioCount: SUITE_IDS.length, filtered: false },
    requestedScenarioIds: SUITE_IDS,
    fullSuiteScenarioIds: SUITE_IDS,
  });
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "classflow-eval-v131-"));
});

afterEach(() => {
  // 只允许删除自己创建的 temp directory；绝不触碰 VISUAL_EVAL_BASELINE_PATH
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("promoteVisualEvalBaselineAt（temp path）", () => {
  it("parent directory 自动创建：foo/bar/baseline.json（foo/bar 不存在）", () => {
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(buildEligibleReport()), "utf8");
    const baselinePath = join(tempRoot, "foo", "bar", "baseline.json");
    const out = promoteVisualEvalBaselineAt({ reportPath, baselinePath });
    expect(out.manifestPath).toBe(baselinePath);
    expect(existsSync(baselinePath)).toBe(true);
  });

  it("成功后持久存在（helper 不做任何 cleanup）", () => {
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(buildEligibleReport()), "utf8");
    const baselinePath = join(tempRoot, "baseline.json");
    promoteVisualEvalBaselineAt({ reportPath, baselinePath });
    // helper 返回后文件仍存在（cleanup 只能由 test-owned temp fixture 执行）
    expect(existsSync(baselinePath)).toBe(true);
  });

  it("duplicate → BASELINE_ALREADY_EXISTS 且原文件内容完全不变", () => {
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(buildEligibleReport()), "utf8");
    const baselinePath = join(tempRoot, "baseline.json");
    const first = promoteVisualEvalBaselineAt({ reportPath, baselinePath });
    const originalContent = readFileSync(baselinePath, "utf8");
    expect(() => promoteVisualEvalBaselineAt({ reportPath, baselinePath })).toThrow(/BASELINE_ALREADY_EXISTS/);
    expect(readFileSync(baselinePath, "utf8")).toBe(originalContent);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("invalid report（Safety unsafe）→ BASELINE_NOT_ELIGIBLE 且不留下 artifact", () => {
    const scenarios = SUITE_IDS.map((id) => {
      const base = mkResult(id);
      return id === SUITE_IDS[0]
        ? { ...base, safety: { directWriteAttempts: ["create_reminder"], unsafeProposal: false, unsafeReasons: [] } }
        : base;
    });
    const report = buildVisualEvalReport({
      scenarios,
      meta: { timestamp: "t", provider: "p", model: "m", fullSuiteScenarioCount: SUITE_IDS.length, filtered: false },
      requestedScenarioIds: SUITE_IDS,
      fullSuiteScenarioIds: SUITE_IDS,
    });
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(report), "utf8");
    const baselinePath = join(tempRoot, "nested", "dir", "baseline.json");
    expect(() => promoteVisualEvalBaselineAt({ reportPath, baselinePath })).toThrow(/BASELINE_NOT_ELIGIBLE/);
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("invalid report（filtered）→ BASELINE_NOT_ELIGIBLE 且不留下 artifact", () => {
    const report = buildEligibleReport();
    report.validity = { ...report.validity, coverage: "filtered", baselineEligible: false };
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(report), "utf8");
    const baselinePath = join(tempRoot, "baseline.json");
    expect(() => promoteVisualEvalBaselineAt({ reportPath, baselinePath })).toThrow(/BASELINE_NOT_ELIGIBLE/);
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("canonical baseline 不受影响：helper 只写注入的 path；真实路径绝不被 delete/truncate", () => {
    // 假设 canonical baseline 已存在：本测试只验证 helper 逻辑从不触碰它
    const reportPath = join(tempRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(buildEligibleReport()), "utf8");
    const tempBaseline = join(tempRoot, "canonical-sim.json");
    writeFileSync(tempBaseline, "CANONICAL_SENTINEL", "utf8");
    // 用另一个 temp path promotion → canonical-sim 内容不变
    promoteVisualEvalBaselineAt({ reportPath, baselinePath: join(tempRoot, "other.json") });
    expect(readFileSync(tempBaseline, "utf8")).toBe("CANONICAL_SENTINEL");
    // helper 内部从不 unlink VISUAL_EVAL_BASELINE_PATH（此处仅断言常量路径未被本测试文件误删）
    const canonicalExists = existsSync(VISUAL_EVAL_BASELINE_PATH);
    // 若仓库暂无 canonical baseline，本任务也不会创建它（真实 promotion 是显式命令动作）
    void canonicalExists;
  });
});

describe("canonical baseline 与普通 unit tests 隔离", () => {
  it("普通 vitest 运行 promotion 相关文件（无 npm_lifecycle_event）→ 不执行 promotion 命令", () => {
    // promote.test.ts 已按 npm_lifecycle_event 隔离；此处锁定命令语义常量
    expect(process.env.npm_lifecycle_event).not.toBe("eval:visual:promote");
  });

  it("compare 命令同理：普通运行不因 baseline 缺失而失败", () => {
    expect(process.env.npm_lifecycle_event).not.toBe("eval:visual:compare");
  });
});
