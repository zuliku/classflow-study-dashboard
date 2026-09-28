/**
 * plan-approve 模式 — 计划生命周期（纯函数，可单测；hook 只做 ref 接线 + 落盘）。
 * 单会话单活跃计划：新提案 supersede 旧 live 计划（proposed/approved/deviated）；
 * terminal（completed/cancelled/superseded）保留作历史。
 */
import type {
  ExecutionPlanStatus,
  PersistedExecutionPlan,
  PersistedPlanStep,
} from "@/lib/ai/computer/plans/types";

/** 单会话保留计划上限（超限丢最旧 terminal；live 永不丢） */
export const MAX_STORED_PLANS_PER_CONVERSATION = 20;

const LIVE_STATUSES: ReadonlySet<ExecutionPlanStatus> = new Set(["proposed", "approved", "deviated"]);

const ALL_STATUSES: ReadonlySet<string> = new Set([
  "proposed",
  "approved",
  "completed",
  "deviated",
  "cancelled",
  "superseded",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asOptionalString(v: unknown, maxLen: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) return undefined;
  return v;
}

function restoreStep(v: unknown): PersistedPlanStep | null {
  if (!isRecord(v)) return null;
  const id = asNonEmptyString(v["id"]);
  const title = asNonEmptyString(v["title"]);
  if (!id || !title || title.length > 80) return null;
  if (typeof v["done"] !== "boolean") return null;
  const step: PersistedPlanStep = { id, title, done: v["done"] };
  const detail = asOptionalString(v["detail"], 500);
  if (detail !== undefined) step.detail = detail;
  for (const key of ["toolName", "capability", "rootId", "path", "pathPrefix", "artifactId", "action"] as const) {
    const s = asOptionalString(v[key], key === "action" ? 32 : 1024);
    if (s !== undefined) (step as unknown as Record<string, unknown>)[key] = s;
  }
  const commandPrefix = asOptionalString(v["commandPrefix"], 1024);
  if (commandPrefix !== undefined) step.commandPrefix = commandPrefix;
  return step;
}

function restorePlan(v: unknown): PersistedExecutionPlan | null {
  if (!isRecord(v)) return null;
  const planId = asNonEmptyString(v["planId"]);
  const conversationId = asNonEmptyString(v["conversationId"]);
  const title = asNonEmptyString(v["title"]);
  const status = asNonEmptyString(v["status"]);
  if (!planId || !conversationId || !title || title.length > 80) return null;
  if (!status || !ALL_STATUSES.has(status)) return null;
  if (!Array.isArray(v["steps"]) || v["steps"].length === 0 || v["steps"].length > 20) return null;
  const steps: PersistedPlanStep[] = [];
  for (const s of v["steps"]) {
    const step = restoreStep(s);
    if (!step) return null;
    steps.push(step);
  }
  if (asNonEmptyString(v["proposingToolCallId"]) === null) return null;
  if (asNonEmptyString(v["createdAt"]) === null || asNonEmptyString(v["updatedAt"]) === null) return null;
  // proposingMessageId 缺省（旧记录）→ 空字符串（卡片不绑定，但计划仍在记录中可见）
  const proposingMessageId = typeof v["proposingMessageId"] === "string" ? v["proposingMessageId"] : "";
  const deviationCount = v["deviationCount"];
  if (typeof deviationCount !== "number" || !Number.isInteger(deviationCount) || deviationCount < 0) return null;
  return {
    planId,
    conversationId,
    title,
    ...(asOptionalString(v["goal"], 500) !== undefined ? { goal: asOptionalString(v["goal"], 500)! } : {}),
    status: status as ExecutionPlanStatus,
    steps,
    proposingToolCallId: v["proposingToolCallId"] as string,
    proposingMessageId,
    createdAt: v["createdAt"] as string,
    updatedAt: v["updatedAt"] as string,
    ...(asOptionalString(v["approvedAt"], 64) !== undefined ? { approvedAt: v["approvedAt"] as string } : {}),
    ...(asOptionalString(v["completedAt"], 64) !== undefined ? { completedAt: v["completedAt"] as string } : {}),
    deviationCount,
  };
}

/** 会话记录 → 内存计划（严格校验：非法项丢弃；绝不构造半吊子计划） */
export function restoreExecutionPlans(value: unknown): PersistedExecutionPlan[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedExecutionPlan[] = [];
  for (const item of value) {
    const plan = restorePlan(item);
    if (plan) out.push(plan);
  }
  return out;
}

function touch(plan: PersistedExecutionPlan, now: string): PersistedExecutionPlan {
  return { ...plan, updatedAt: now };
}

/** 新提案入库（旧 live → superseded；超限丢最旧 terminal） */
export function insertProposedPlan(
  existing: PersistedExecutionPlan[],
  plan: PersistedExecutionPlan,
  now?: string
): PersistedExecutionPlan[] {
  const at = now ?? new Date().toISOString();
  const next = existing.map((p) => (LIVE_STATUSES.has(p.status) ? { ...p, status: "superseded" as const, updatedAt: at } : p));
  next.push(plan);
  if (next.length <= MAX_STORED_PLANS_PER_CONVERSATION) return next;
  const live = next.filter((p) => LIVE_STATUSES.has(p.status));
  const terminal = next
    .filter((p) => !LIVE_STATUSES.has(p.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const keepTerminal = terminal.slice(
    Math.max(0, terminal.length - (MAX_STORED_PLANS_PER_CONVERSATION - live.length))
  );
  return [...live, ...keepTerminal].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export interface PlanMutationResult {
  plans: PersistedExecutionPlan[];
  ok: boolean;
}

/** 批准（proposed → approved；其余 live → superseded；单活跃语义） */
export function approvePlan(
  existing: PersistedExecutionPlan[],
  planId: string,
  now?: string
): PlanMutationResult {
  const at = now ?? new Date().toISOString();
  const target = existing.find((p) => p.planId === planId);
  if (!target || target.status !== "proposed") return { plans: existing, ok: false };
  return {
    ok: true,
    plans: existing.map((p) => {
      if (p.planId === planId) return { ...p, status: "approved" as const, approvedAt: at, updatedAt: at };
      if (LIVE_STATUSES.has(p.status)) return { ...p, status: "superseded" as const, updatedAt: at };
      return p;
    }),
  };
}

/** 取消（live → cancelled；terminal 不变） */
export function cancelPlan(
  existing: PersistedExecutionPlan[],
  planId: string,
  now?: string
): PlanMutationResult {
  const at = now ?? new Date().toISOString();
  const target = existing.find((p) => p.planId === planId);
  if (!target || !LIVE_STATUSES.has(target.status)) return { plans: existing, ok: false };
  return {
    ok: true,
    plans: existing.map((p) =>
      p.planId === planId ? { ...p, status: "cancelled" as const, updatedAt: at } : touch(p, p.updatedAt)
    ),
  };
}

export interface MarkStepDoneResult extends PlanMutationResult {
  /** 本步导致计划完成（全部 done） */
  completed: boolean;
}

/** 标记步骤完成（仅 approved/deviated；全 done → completed） */
export function markPlanStepDone(
  existing: PersistedExecutionPlan[],
  planId: string,
  stepId: string,
  now?: string
): MarkStepDoneResult {
  const at = now ?? new Date().toISOString();
  const target = existing.find((p) => p.planId === planId);
  if (!target || (target.status !== "approved" && target.status !== "deviated")) {
    return { plans: existing, ok: false, completed: false };
  }
  const step = target.steps.find((s) => s.id === stepId);
  if (!step || step.done) return { plans: existing, ok: false, completed: false };
  const steps = target.steps.map((s) => (s.id === stepId ? { ...s, done: true } : s));
  const allDone = steps.every((s) => s.done);
  return {
    ok: true,
    completed: allDone,
    plans: existing.map((p) =>
      p.planId === planId
        ? {
            ...p,
            steps,
            status: allDone ? ("completed" as const) : p.status,
            updatedAt: at,
            ...(allDone ? { completedAt: at } : {}),
          }
        : p
    ),
  };
}

/** 记录偏离（approved → deviated；计数+1；已 deviated 仅计数） */
export function recordPlanDeviation(
  existing: PersistedExecutionPlan[],
  planId: string,
  now?: string
): PlanMutationResult {
  const at = now ?? new Date().toISOString();
  const target = existing.find((p) => p.planId === planId);
  if (!target || (target.status !== "approved" && target.status !== "deviated")) {
    return { plans: existing, ok: false };
  }
  return {
    ok: true,
    plans: existing.map((p) =>
      p.planId === planId
        ? {
            ...p,
            status: "deviated" as const,
            deviationCount: p.deviationCount + 1,
            updatedAt: at,
          }
        : p
    ),
  };
}

/** 当前活跃计划（approved/deviated；单活跃语义下至多一个） */
export function getActivePlan(plans: PersistedExecutionPlan[]): PersistedExecutionPlan | null {
  return plans.find((p) => p.status === "approved" || p.status === "deviated") ?? null;
}

/**
 * 已批准计划的冻结范围文本（A3 route 注入用；有界：标题+目标+未完成步骤 ≤ 上限）。
 * 只描述计划边界（做什么/做到哪），不含任何授权语义——授权仍由 policy/偏离门执行。
 */
export function buildApprovedPlanPromptContext(plan: PersistedExecutionPlan, maxChars = 2000): string {
  const lines = [
    `# 已批准执行计划：${plan.title}`,
    ...(plan.goal ? [`目标：${plan.goal}`] : []),
    "仅执行下列步骤；计划外改写操作会被拦截并请求用户确认：",
  ];
  for (const s of plan.steps) {
    const mark = s.done ? "（已完成）" : "";
    const scope = [s.toolName, s.path ?? s.pathPrefix, s.commandPrefix, s.artifactId, s.action]
      .filter(Boolean)
      .join(" · ");
    lines.push(`- ${s.title}${mark}${scope ? `（${scope}）` : ""}${s.detail ? `：${s.detail}` : ""}`);
  }
  const text = lines.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
