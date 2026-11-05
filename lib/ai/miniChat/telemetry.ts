/**
 * Kiro Mini Telemetry（纯投影）：
 *
 * 主窗口 runtime → Mini 快照的安全展示层：
 * - 只读取 KiroActivity 的用户语义 label / 状态、执行计划 metadata、当前来源 metadata；
 * - 不读取 tool input/output、文件路径、provider 原始响应、审批内部参数；
 * - 输出 plain data，可直接 structuredClone 给 Mini。
 */

import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";
import type {
  MiniChatActivitySummary,
  MiniChatApprovalSummary,
  MiniChatPhase,
  MiniChatPlanSummary,
  MiniChatSourceSummary,
  MiniChatStatus,
} from "@/lib/ai/miniChat/protocol";
import { MINI_DEFAULT_SUGGESTIONS } from "@/lib/ai/miniChat/protocol";

export type MiniSuggestionsKind = "assignment" | "course" | "group-project" | "week" | "generic" | null;

interface ActivityStepLike {
  label: string;
  status: "working" | "done" | "error";
}

interface ActivityLike {
  visible?: boolean;
  phase: "thinking" | "reading" | "acting" | "composing" | "done" | "error";
  steps: readonly ActivityStepLike[];
}

export interface MiniTelemetryInput {
  busy: boolean;
  streaming: boolean;
  /** 当前 assistant 正文已有内容（用于区分“思考中”与“正在回答”） */
  answerStarted?: boolean;
  waitingApproval: boolean;
  error?: boolean;
  activity?: ActivityLike | null;
  plans?: readonly PersistedExecutionPlan[] | null;
  sources?: readonly KiroSourceMeta[] | null;
  suggestionsKind?: MiniSuggestionsKind;
}

export interface MiniTelemetry {
  phase: MiniChatPhase;
  status: MiniChatStatus | null;
  plan: MiniChatPlanSummary | null;
  activity: MiniChatActivitySummary | null;
  sources: MiniChatSourceSummary[];
  approval: MiniChatApprovalSummary | null;
  suggestions: string[];
}

const SUGGESTIONS_BY_KIND: Record<Exclude<MiniSuggestionsKind, null>, readonly string[]> = {
  assignment: ["拆分这个任务", "制定完成计划", "总结任务要求"],
  course: ["总结这门课程", "安排复习计划", "分析最近任务"],
  "group-project": ["总结项目进度", "检查即将截止任务", "重新规划分工"],
  week: ["检查时间冲突", "查看本周空闲时间", "调整本周课表"],
  generic: MINI_DEFAULT_SUGGESTIONS,
};

function currentPlan(plans: readonly PersistedExecutionPlan[]): PersistedExecutionPlan | null {
  const live = plans.filter(
    (p) => p.status === "proposed" || p.status === "approved" || p.status === "deviated"
  );
  if (live.length > 0) {
    return [...live].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
  }
  const completed = plans.filter((p) => p.status === "completed");
  return completed.length > 0
    ? [...completed].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0]
    : null;
}

function summarizePlan(plans: readonly PersistedExecutionPlan[]): MiniChatPlanSummary | null {
  const plan = currentPlan(plans);
  if (!plan) return null;
  const completed = plan.steps.filter((s) => s.done).length;
  const next = plan.steps.find((s) => !s.done);
  return {
    title: plan.title,
    completed,
    total: plan.steps.length,
    status: plan.status,
    ...(next ? { currentStep: next.title } : {}),
  };
}

function summarizeActivity(activity: ActivityLike | null | undefined): MiniChatActivitySummary | null {
  if (!activity || !activity.steps || activity.steps.length === 0) return null;
  const working = [...activity.steps].reverse().find((s) => s.status === "working");
  const last = activity.steps[activity.steps.length - 1];
  const done = activity.steps.filter((s) => s.status === "done").length;
  return {
    label: (working ?? last).label,
    done,
    total: activity.steps.length,
  };
}

function safeSources(sources: readonly KiroSourceMeta[] | null | undefined): MiniChatSourceSummary[] {
  if (!sources) return [];
  return sources
    .filter((s) => s.source === "web")
    .slice(-3)
    .map((s) => ({
      id: s.sourceId,
      title: s.name,
      domain: s.domain ?? "",
      ...(s.url ? { url: s.url } : {}),
    }));
}

function derivePhase(input: MiniTelemetryInput): MiniChatPhase {
  if (input.error) return "error";
  if (input.waitingApproval) return "waiting-approval";
  if (!input.busy) return "idle";
  if (input.activity?.phase === "reading" || input.activity?.phase === "acting") return "working";
  if (input.activity?.phase === "composing") return "composing";
  if (input.streaming && input.answerStarted) return "answering";
  if (input.activity?.phase === "thinking") return "thinking";
  if (input.streaming) return "answering";
  return "thinking";
}

function labelForPhase(phase: MiniChatPhase, activity: MiniChatActivitySummary | null): string {
  switch (phase) {
    case "thinking":
      return "正在思考";
    case "working":
      return activity ? `正在${activity.label}` : "正在执行";
    case "composing":
      return "正在整理回答";
    case "answering":
      return "正在回答";
    case "waiting-approval":
      return "等待确认";
    case "error":
      return "出错了";
    case "idle":
      return "";
  }
}

export function deriveMiniTelemetry(input: MiniTelemetryInput): MiniTelemetry {
  const activity = summarizeActivity(input.activity);
  const phase = derivePhase(input);
  const label = labelForPhase(phase, activity);
  const status: MiniChatStatus | null = label ? { label } : null;
  const suggestions =
    input.suggestionsKind != null
      ? SUGGESTIONS_BY_KIND[input.suggestionsKind]
      : MINI_DEFAULT_SUGGESTIONS;
  return {
    phase,
    status,
    plan: summarizePlan(input.plans ?? []),
    activity,
    sources: safeSources(input.sources),
    approval: input.waitingApproval ? { pending: true } : null,
    suggestions: [...suggestions],
  };
}
