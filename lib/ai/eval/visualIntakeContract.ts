/**
 * Visual Intake Eval V1.3 —— Benchmark Contract Descriptor & Fingerprint。
 *
 * Comparability Contract：两份 Report 只有在同一 Benchmark Oracle 下才允许比较。
 * Fingerprint 覆盖 Benchmark Definition：
 *   - VISUAL_INTAKE_EVAL_SCENARIOS（id / userPrompt / screenshot descriptor /
 *     expected outcome / actions / entity / fields / pending / forbiddenTools）
 *   - VISUAL_EVAL_WORLD
 *   - VISUAL_EVAL_BASE_CONTEXT
 *   - VISUAL_EVAL_NOW
 *   - VISUAL_EVAL_TIMEZONE
 *   - 显式 VISUAL_EVAL_CONTRACT_VERSION（承担 scoring/harness semantic version）
 *
 * 绝不进入 fingerprint（属于 subject under evaluation / provenance）：
 *   provider / model / gitSha / KIRO_SYSTEM_PROMPT 正文 / tool implementation / API key / reasoning。
 */
import { createHash } from "node:crypto";
import {
  VISUAL_EVAL_BASE_CONTEXT,
  VISUAL_EVAL_NOW,
  VISUAL_EVAL_TIMEZONE,
  VISUAL_EVAL_WORLD,
  VISUAL_INTAKE_EVAL_SCENARIOS,
} from "@/lib/ai/eval/visualIntakeScenarios";

/**
 * Scoring / Harness semantic version：修改以下任一语义必须 bump：
 * - action matching semantics
 * - pending matching semantics
 * - entity/time accuracy semantics
 * - outcome pass/partial/fail semantics
 * - screenshot renderer semantic contract
 * 只是修产品代码（Prompt / Agent implementation）不要 bump。
 */
export const VISUAL_EVAL_CONTRACT_VERSION = "visual-intake-v1";

export interface VisualEvalContractDescriptor {
  contractVersion: string;
  fixedNow: string;
  timezone: string;
  /** canonical full suite IDs（= Benchmark Definition，不是本次执行范围） */
  scenarioIds: string[];
  /** SHA-256（完整 64 hex） */
  fingerprint: string;
}

/**
 * stable canonical JSON：
 * - object key 递归排序（不赌 property insertion order）
 * - array 顺序保持
 * - primitive 原样
 * - undefined object property omit
 * - 出现 function / symbol → throw INVALID_CONTRACT_PAYLOAD
 */
export function stableCanonicalJson(value: unknown, keyPath = "root"): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error(`INVALID_CONTRACT_PAYLOAD: ${keyPath} 不允许 function/symbol`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v, i) => stableCanonicalJson(v, `${keyPath}[${i}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries: [string, string][] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue; // undefined property omit
      entries.push([JSON.stringify(k), stableCanonicalJson(v, `${keyPath}.${k}`)]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${v}`).join(",")}}`;
  }
  throw new Error(`INVALID_CONTRACT_PAYLOAD: ${keyPath} 不支持的类型`);
}

/** Contract fingerprint payload（Benchmark Definition 的稳定投影） */
export function buildVisualEvalContractPayload(): unknown {
  return {
    contractVersion: VISUAL_EVAL_CONTRACT_VERSION,
    fixedNow: VISUAL_EVAL_NOW,
    timezone: VISUAL_EVAL_TIMEZONE,
    world: VISUAL_EVAL_WORLD,
    baseContext: VISUAL_EVAL_BASE_CONTEXT,
    scenarios: VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => ({
      id: s.id,
      category: s.category,
      userPrompt: s.userPrompt,
      screenshot: s.screenshot,
      expected: {
        outcome: s.expected.outcome,
        actions: s.expected.actions,
        pendingItems: s.expected.pendingItems,
        forbiddenTools: s.expected.forbiddenTools,
      },
    })),
  };
}

/** SHA-256（完整 64 hex）of stable canonical payload */
export function computeVisualEvalContractFingerprint(): string {
  const canonical = stableCanonicalJson(buildVisualEvalContractPayload());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** canonical helper：Report Builder / Promotion / Comparison 统一从这里拿 Contract（Runner 不自己拼） */
export function buildCurrentVisualEvalContract(): VisualEvalContractDescriptor {
  return {
    contractVersion: VISUAL_EVAL_CONTRACT_VERSION,
    fixedNow: VISUAL_EVAL_NOW,
    timezone: VISUAL_EVAL_TIMEZONE,
    scenarioIds: VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id),
    fingerprint: computeVisualEvalContractFingerprint(),
  };
}
