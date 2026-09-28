/**
 * plan-approve 模式 — 计划构建与校验（纯函数）。
 * 模型输入（已过 proposeExecutionPlanSchema）→ PersistedExecutionPlan；
 * 锚点规则保证偏离门可匹配每一步 mutation（无锚点步骤直接拒绝并给出修正指引）。
 */
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import type { ComputerCapability } from "@/lib/ai/computer/types";
import { proposeExecutionPlanSchema } from "@/lib/ai/computer/tools/schemas";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import type {
  PersistedExecutionPlan,
  PersistedPlanStep,
  PlanStepInput,
  ProposeExecutionPlanInput,
} from "@/lib/ai/computer/plans/types";

export const PROPOSE_EXECUTION_PLAN_TOOL_NAME = "propose_execution_plan";

/** 步骤 capability 缺省时按 toolName 派生（registry 唯一真源） */
export function deriveStepCapability(toolName: string): ComputerCapability | null {
  const def = COMPUTER_TOOLS.find((t) => t.name === toolName);
  return def ? def.capability : null;
}

/** 会话延续类工具（仅 opaque handle / observation 引用，无可锚定字段；不应单独成步） */
const SESSION_CONTINUATION_TOOLS = new Set([
  "write_terminal_input",
  "wait_terminal_command",
  "write_terminal_session_input",
  "close_terminal_session",
]);

/**
 * 单步锚点校验：mutation 类步骤必须携带至少一个 scope 锚点。
 * 返回 null = 通过；字符串 = 给模型的修正指引。
 */
export function validatePlanStepAnchors(step: PlanStepInput, index: number): string | null {
  const label = `第 ${index + 1} 步「${step.title}」`;
  if (step.toolName && SESSION_CONTINUATION_TOOLS.has(step.toolName)) {
    return `${label}使用了会话延续工具 ${step.toolName}（仅凭 handle 继续已发起的命令），请不要为它单独成步，并入发起该命令的步骤。`;
  }
  const capability: ComputerCapability | undefined =
    step.capability ?? (step.toolName ? deriveStepCapability(step.toolName) ?? undefined : undefined);
  if (step.toolName && !deriveStepCapability(step.toolName)) {
    return `${label}的 toolName「${step.toolName}」不是已知的 Computer 工具，请使用真实工具名。`;
  }
  if (step.toolName && step.capability) {
    const derived = deriveStepCapability(step.toolName);
    if (derived && derived !== step.capability) {
      return `${label}的 toolName（${step.toolName} → ${derived}）与 capability（${step.capability}）不一致，请修正。`;
    }
  }
  // 无 capability 且无 toolName：纯说明步骤（允许；偏离门永不匹配它）
  if (!capability) return null;
  switch (capability) {
    case "fs.create":
    case "fs.modify":
    case "fs.move":
    case "fs.delete":
    case "document.create":
    case "document.modify":
      if (!step.path && !step.pathPrefix && !step.artifactId) {
        return `${label}是文件/文档操作，必须给出 path、pathPrefix 或 artifactId 中的至少一个，否则执行时无法匹配计划。`;
      }
      return null;
    case "shell.execute":
      if (!step.commandPrefix) {
        return `${label}是终端命令，必须给出 commandPrefix（计划执行的命令原文开头），否则执行时无法匹配计划。`;
      }
      return null;
    case "ui.interact":
    case "app.open":
    case "app.activate":
      if (!step.action && !step.detail) {
        return `${label}是桌面/GUI 操作，必须给出 action（click/type/key 等）或 detail 描述，否则执行时无法匹配计划。`;
      }
      return null;
    default:
      return null;
  }
}

export type BuildExecutionPlanResult =
  | { ok: true; plan: PersistedExecutionPlan }
  | { ok: false; error: string };

/**
 * 模型输入 → 可持久计划（status=proposed；调用方负责落盘与 UI 绑定）。
 * schema 失败 / 锚点失败一律返回可读错误（executor 原样转给模型修正）。
 */
export function buildExecutionPlan(
  toolInput: unknown,
  ctx: { conversationId: string; toolCallId: string; now?: string }
): BuildExecutionPlanResult {
  const parsed = proposeExecutionPlanSchema.safeParse(toolInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? [...first.path].join(".") : "steps";
    return {
      ok: false,
      error: `执行计划格式不正确（${where || "根"}：${first?.message ?? "未知错误"}）。请按 propose_execution_plan 的 schema 重提：标题 1–80 字、步骤 1–20 个、mutation 步骤带 scope 锚点。`,
    };
  }
  const input: ProposeExecutionPlanInput = parsed.data;
  for (let i = 0; i < input.steps.length; i++) {
    const problem = validatePlanStepAnchors(input.steps[i], i);
    if (problem) return { ok: false, error: problem };
  }
  const now = ctx.now ?? new Date().toISOString();
  const steps: PersistedPlanStep[] = input.steps.map((s, i) => ({
    ...s,
    id: `step-${i + 1}`,
    done: false,
  }));
  return {
    ok: true,
    plan: {
      planId: `plan-${ctx.toolCallId}`,
      conversationId: ctx.conversationId,
      title: input.title,
      ...(input.goal ? { goal: input.goal } : {}),
      status: "proposed",
      steps,
      proposingToolCallId: ctx.toolCallId,
      createdAt: now,
      updatedAt: now,
      deviationCount: 0,
    },
  };
}

/**
 * Executor 接入点（零 IO：不计数、不走 policy/approval、不产生 checkpoint）。
 * sink 缺失 / 无会话归属 → fail-closed 错误（绝不构造无归属计划）。
 */
export function runProposeExecutionPlanTool(input: {
  toolCallId: string;
  toolInput: unknown;
  conversationId: string;
  sink?: (plan: PersistedExecutionPlan) => void;
}): ComputerExecutionAttempt {
  if (!input.sink) {
    return {
      kind: "completed",
      output: { ok: false, code: "PLAN_SINK_UNAVAILABLE", message: "当前运行环境不支持提交执行计划（无计划接收器）。" },
    };
  }
  if (!input.conversationId) {
    return {
      kind: "completed",
      output: { ok: false, code: "PLAN_NO_CONVERSATION", message: "无归属会话，拒绝创建无归属执行计划。" },
    };
  }
  const built = buildExecutionPlan(input.toolInput, {
    conversationId: input.conversationId,
    toolCallId: input.toolCallId,
  });
  if (!built.ok) {
    return {
      kind: "completed",
      output: { ok: false, code: "PLAN_REJECTED", message: built.error },
    };
  }
  input.sink(built.plan);
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        planId: built.plan.planId,
        title: built.plan.title,
        stepCount: built.plan.steps.length,
        hint: "执行计划已提交，等待用户在计划卡片上批准；批准前不要执行任何改写操作。",
      },
    },
  };
}
