/**
 * Visual Intake Eval V1.1 —— 双模型 Report 对比（deterministic；不决定产品路由）。
 * 用法：node 经 vitest entry 运行（见 compare.test.ts）或由 run 后手动查看。
 * 输入两个模型各自的 report.json，输出 console 对比表 + scenario-level diff。
 */
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";

export interface VisualEvalComparison {
  metricRows: { metric: string; a: string | number; b: string | number }[];
  onlyAFailed: string[];
  onlyBFailed: string[];
  bothFailed: string[];
  bothPassed: string[];
}

function outcomeOf(report: VisualEvalReport, scenarioId: string): "pass" | "partial" | "fail" | "n/a" {
  return report.scenarios.find((s) => s.scenarioId === scenarioId)?.outcome ?? "n/a";
}

/** 对比两份 report.json（A = 主 baseline，B = 对照） */
export function compareVisualEvalReports(a: VisualEvalReport, b: VisualEvalReport): VisualEvalComparison {
  const rows = (key: string, va: string | number | null, vb: string | number | null) => ({
    metric: key,
    a: va ?? "-",
    b: vb ?? "-",
  });
  const metricRows = [
    rows("Action Precision", a.summary.actionPrecision, b.summary.actionPrecision),
    rows("Action Recall", a.summary.actionRecall, b.summary.actionRecall),
    rows("Entity Accuracy", a.summary.entityAccuracy, b.summary.entityAccuracy),
    rows("Time Accuracy", a.summary.timeAccuracy, b.summary.timeAccuracy),
    rows("Pending Accuracy", a.summary.pendingAccuracy, b.summary.pendingAccuracy),
    rows("Direct Write Attempts", a.summary.directWriteAttempts, b.summary.directWriteAttempts),
    rows("Unsafe Proposal Scenarios", a.summary.unsafeProposalScenarios, b.summary.unsafeProposalScenarios),
    rows("PASS", a.summary.pass, b.summary.pass),
    rows("PARTIAL", a.summary.partial, b.summary.partial),
    rows("FAIL", a.summary.fail, b.summary.fail),
  ];
  const allIds = Array.from(new Set([...a.scenarios.map((s) => s.scenarioId), ...b.scenarios.map((s) => s.scenarioId)]));
  const onlyAFailed: string[] = [];
  const onlyBFailed: string[] = [];
  const bothFailed: string[] = [];
  const bothPassed: string[] = [];
  for (const id of allIds) {
    const oa = outcomeOf(a, id);
    const ob = outcomeOf(b, id);
    if (oa === "fail" && ob !== "fail") onlyAFailed.push(id);
    else if (oa !== "fail" && ob === "fail") onlyBFailed.push(id);
    else if (oa === "fail" && ob === "fail") bothFailed.push(id);
    else if (oa === "pass" && ob === "pass") bothPassed.push(id);
  }
  return { metricRows, onlyAFailed, onlyBFailed, bothFailed, bothPassed };
}

export function renderVisualEvalComparison(c: VisualEvalComparison, labelA: string, labelB: string): string {
  const lines: string[] = [];
  const w = (s: string, n: number) => s.padEnd(n);
  lines.push(`Metric                 ${w(labelA, 14)} ${w(labelB, 14)}`);
  lines.push("-".repeat(60));
  for (const r of c.metricRows) {
    lines.push(`${w(r.metric, 22)} ${w(String(r.a), 14)} ${w(String(r.b), 14)}`);
  }
  lines.push("");
  lines.push(`Only ${labelA} failed:`);
  lines.push(c.onlyAFailed.length > 0 ? c.onlyAFailed.map((s) => `- ${s}`).join("\n") : "- (none)");
  lines.push("");
  lines.push(`Only ${labelB} failed:`);
  lines.push(c.onlyBFailed.length > 0 ? c.onlyBFailed.map((s) => `- ${s}`).join("\n") : "- (none)");
  lines.push("");
  lines.push("Both failed:");
  lines.push(c.bothFailed.length > 0 ? c.bothFailed.map((s) => `- ${s}`).join("\n") : "- (none)");
  return lines.join("\n");
}
