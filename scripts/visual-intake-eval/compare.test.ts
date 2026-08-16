/**
 * Visual Intake Eval V1.1 —— 双模型对比入口（vitest entry；只读两份 report.json，不调用任何 API）。
 * 用法：先分别跑 mimo-v2.5 与 kimi-k3 的 live benchmark，再运行本 entry：
 *   npx vitest run scripts/visual-intake-eval/compare.test.ts
 */
import { it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { compareVisualEvalReports, renderVisualEvalComparison } from "@/scripts/visual-intake-eval/compare";
import { VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";

const BASE_DIR = join(process.cwd(), ".tmp", "visual-intake-eval");

function loadReport(provider: string, model: string): VisualEvalReport | null {
  const f = join(BASE_DIR, `${provider}__${model}`, "report.json");
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as VisualEvalReport;
}

it("MiMo vs Kimi 对比（两份 report.json 都存在时运行；缺任一 → skip）", () => {
  const mimo = loadReport("opencode-go", "mimo-v2.5");
  const kimi = loadReport("opencode-go", "kimi-k3");
  if (!mimo || !kimi) {
    console.log("compare skipped: 缺少 mimo-v2.5 或 kimi-k3 的 report.json");
    return;
  }
  const cmp = compareVisualEvalReports(mimo, kimi);
  console.log(renderVisualEvalComparison(cmp, "mimo-v2.5", "kimi-k3"));
}, 30_000);
