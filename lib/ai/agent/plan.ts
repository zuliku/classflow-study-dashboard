/**
 * Kiro Agent Plan Board — 可见执行计划（ChatGPT / Claude 式 checklist）。
 *
 * 纯控制信号：不写 Store、不执行工具、不提升权限。
 * - tool: update_agent_plan（Server-side execute，零 IO）
 * - 同一条 assistant message 中后一次调用覆盖前一次；UI 只展示最新 plan
 * - 历史恢复直接从 messages parts 重建，无需额外持久化
 */

import { z } from "zod";

export const KIRO_UPDATE_AGENT_PLAN_TOOL_NAME = "update_agent_plan";
export const MAX_AGENT_PLAN_STEPS = 12;
export const MAX_AGENT_PLAN_TITLE_CHARS = 80;
export const MAX_AGENT_PLAN_STEP_TITLE_CHARS = 120;

export const kiroAgentPlanStepStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export const kiroUpdateAgentPlanInputSchema = z.object({
  title: z.string().trim().max(MAX_AGENT_PLAN_TITLE_CHARS).optional(),
  steps: z
    .array(
      z.object({
        id: z.string().trim().max(40).optional(),
        title: z.string().trim().min(1).max(MAX_AGENT_PLAN_STEP_TITLE_CHARS),
        status: kiroAgentPlanStepStatusSchema.optional(),
      })
    )
    .min(1)
    .max(MAX_AGENT_PLAN_STEPS),
});

export type KiroAgentPlanStepStatus = z.infer<typeof kiroAgentPlanStepStatusSchema>;

export interface KiroAgentPlanStep {
  id: string;
  title: string;
  status: KiroAgentPlanStepStatus;
}

export interface KiroAgentPlan {
  title?: string;
  steps: KiroAgentPlanStep[];
  /** Server 生成的时间戳（仅展示排序/调试用，不参与权限） */
  updatedAt?: number;
}

export interface KiroAgentPlanSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  /** 当前/下一步（in_progress 优先，否则第一个 pending） */
  nextStep: KiroAgentPlanStep | null;
  progressPercent: number;
}

function normalizeStatus(value: unknown): KiroAgentPlanStepStatus {
  if (value === "completed" || value === "complete" || value === "done") return "completed";
  if (value === "in_progress" || value === "in-progress" || value === "doing") return "in_progress";
  return "pending";
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

/**
 * 归一化模型输入 / Server 输出。
 * 对不合法结构返回 null（UI 不渲染半截 plan）；对字符串步骤等常见偏差做确定性修复。
 */
export function normalizeAgentPlan(value: unknown): KiroAgentPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { title?: unknown; steps?: unknown; updatedAt?: unknown };
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: KiroAgentPlanStep[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < rawSteps.length && steps.length < MAX_AGENT_PLAN_STEPS; i++) {
    const item = rawSteps[i];
    const title = cleanText(
      typeof item === "string" ? item : (item as { title?: unknown } | null)?.title,
      MAX_AGENT_PLAN_STEP_TITLE_CHARS
    );
    if (!title) continue;
    const requestedId =
      item && typeof item === "object"
        ? cleanText((item as { id?: unknown }).id, 40)
        : "";
    let id = requestedId || `step-${steps.length + 1}`;
    if (usedIds.has(id)) id = `step-${steps.length + 1}`;
    // 极端情况下派生 id 也可能冲突（模型手写了 step-2）：继续加后缀直到唯一
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `step-${steps.length + 1}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    steps.push({
      id,
      title,
      status: item && typeof item === "object" ? normalizeStatus((item as { status?: unknown }).status) : "pending",
    });
  }

  if (steps.length === 0) return null;
  const title = cleanText(raw.title, MAX_AGENT_PLAN_TITLE_CHARS);
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined;
  return {
    ...(title ? { title } : {}),
    steps,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function summarizeAgentPlan(plan: KiroAgentPlan): KiroAgentPlanSummary {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const step of plan.steps) {
    if (step.status === "completed") completed += 1;
    else if (step.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  const total = plan.steps.length;
  const nextStep =
    plan.steps.find((s) => s.status === "in_progress") ??
    plan.steps.find((s) => s.status === "pending") ??
    null;
  return {
    total,
    completed,
    inProgress,
    pending,
    nextStep,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
