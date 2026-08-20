/**
 * Workflow Trace — 提取本轮 Kiro 成功工作流
 * 只允许使用成功执行事实，失败调用仅用于注意事项
 * Turn Boundary: User N → Assistant/Tools → Confirmation UI receipt → Tool Apply → Final Answer → User N+1
 */

import type { WorkflowTrace } from "@/lib/ai/skills/types";

export interface KiroMessageForTrace {
  id: string;
  role: "user" | "assistant";
  parts?: Array<{ type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; text?: string; state?: string }>;
  content?: string;
}

export interface WorkflowActionFact {
  toolCallId: string;
  toolName: string;
  input: unknown;
  outcome: "success" | "failed" | "pending";
  proposal?: boolean;
  mutation?: boolean;
  verified?: boolean;
}

/**
 * 从 Kiro Chat 的 messages 中提取最近一次成功 Turn 的 Workflow Trace
 * 成功 Turn 定义：包含至少一个 outcome=success 的 mutation，且无 pending
 */
export function extractWorkflowTrace(messages: KiroMessageForTrace[]): WorkflowTrace | null {
  if (!messages || messages.length === 0) return null;

  // 找到最后一个 user 消息（User N）
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;

  const userMessage = messages[lastUserIdx];
  const userGoal = extractTextFromMessage(userMessage);
  if (!userGoal || userGoal.trim().length === 0) return null;

  // 确定 Turn 边界：User N+1 为下一轮开始
  let nextUserIdx = -1;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].role === "user") {
      nextUserIdx = i;
      break;
    }
  }
  const turnEndIdx = nextUserIdx === -1 ? messages.length : nextUserIdx;
  const turnMessages = messages.slice(lastUserIdx + 1, turnEndIdx).filter((m) => m.role === "assistant");

  const toolCalls: WorkflowTrace["toolCalls"] = [];
  const toolResults: WorkflowTrace["toolResults"] = [];
  const facts: WorkflowActionFact[] = [];
  let hasProposal = false;
  let hasSuccessMutation = false;
  let hasPending = false;

  for (const msg of turnMessages) {
    const parts = msg.parts ?? [];
    for (const part of parts) {
      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        const toolName = part.type.slice("tool-".length);
        const isProposal = toolName.startsWith("propose_");
        if (isProposal) hasProposal = true;

        const isMutation = !isProposal && !toolName.startsWith("search_") && !toolName.startsWith("get_") && toolName !== "get_current_context";
        const output = part.output as { ok?: boolean; data?: unknown } | undefined;
        const state = (part as { state?: string }).state;

        let outcome: WorkflowActionFact["outcome"] = "pending";
        if (output) {
          if (output.ok === true) outcome = "success";
          else if (output.ok === false) outcome = "failed";
          else outcome = "pending";
        } else if (state === "output-available") {
          outcome = "pending";
        } else if (part.toolCallId) {
          outcome = "pending";
        }

        if (outcome === "pending") hasPending = true;
        if (outcome === "success" && isMutation) hasSuccessMutation = true;
        // proposal 本身不代表 Apply 成功，需有后续 mutation
        if (isProposal && outcome === "success") {
          // proposal 生成成功，但不算 mutation 成功
        }

        if (part.toolCallId) {
          const fact: WorkflowActionFact = {
            toolCallId: part.toolCallId,
            toolName,
            input: part.input ?? {},
            outcome,
            proposal: isProposal,
            mutation: isMutation,
            verified: outcome === "success" && isMutation,
          };
          facts.push(fact);
          toolCalls.push({ toolName, input: part.input ?? {}, toolCallId: part.toolCallId });
          if (output) {
            toolResults.push({ toolName, result: output, toolCallId: part.toolCallId });
          }
        }
      }
    }
  }

  // 成功判定：必须有至少一个 success 的 mutation，且无 pending
  // Proposal 未 Apply 不得伪造成已执行（hasProposal 但无 hasSuccessMutation 则不算 reusable）
  if (toolCalls.length === 0) return null;
  if (hasPending) return null;
  // 若只有 proposal 而无 mutation 成功，则视为 proposal 型 Skill（instructions 停在 Proposal），但仍可提取，只是 finalStatus 为 success 但需标记
  // 此处要求至少有一个 success（proposal 或 mutation）且无 pending
  const hasAnySuccess = facts.some((f) => f.outcome === "success");
  if (!hasAnySuccess) return null;

  // 对于纯 Proposal 工作流，允许提取但需在 Distill 中说明仅到 Proposal
  // 此处 hasSuccessMutation 为 false 但 hasProposal 为 true 时，仍视为可复用（Proposal 型 Skill）
  // 但需确保不是将 Proposal 伪造成已执行
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 过滤：只保留 success 的 toolCalls 作为正常流程，failed 仅用于注意事项（此处不计入）
  const successToolCalls = toolCalls.filter((c) => {
    const f = facts.find((fact) => fact.toolCallId === c.toolCallId);
    return f?.outcome === "success";
  });
  const successResults = toolResults.filter((r) => (r.result as { ok?: boolean })?.ok === true);

  // 若过滤后无成功 mutation 且有 proposal，则保留 proposal 的 success 作为 Proposal 型
  // 否则需有 success mutation
  const hasSuccessForDistill = successToolCalls.length > 0;
  if (!hasSuccessForDistill) return null;

  return {
    turnId,
    userGoal,
    toolCalls: successToolCalls,
    toolResults: successResults,
    proposals: hasProposal ? [{}] : undefined,
    userConfirmation: hasProposal ? hasSuccessMutation : undefined, // 真实 receipt：有 mutation 成功才算 confirmed
    finalStatus: "success",
    timestamp: Date.now(),
  };
}

function extractTextFromMessage(msg: KiroMessageForTrace): string {
  if (msg.content) return msg.content;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n")
      .trim();
  }
  return "";
}

export function isWorkflowTraceReusable(trace: WorkflowTrace | null): boolean {
  if (!trace) return false;
  if (trace.finalStatus !== "success") return false;
  if (trace.toolCalls.length === 0) return false;
  // 必须来自真实 User Goal，非空
  if (!trace.userGoal || trace.userGoal.trim().length === 0) return false;
  return true;
}

export function getWorkflowActionFacts(trace: WorkflowTrace): WorkflowActionFact[] {
  // 从 trace 重建 facts（只读）
  return trace.toolCalls.map((c) => {
    const result = trace.toolResults.find((r) => r.toolCallId === c.toolCallId);
    const outcome: WorkflowActionFact["outcome"] = result ? ((result.result as { ok?: boolean })?.ok === true ? "success" : "failed") : "pending";
    const isProposal = c.toolName.startsWith("propose_");
    return {
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input,
      outcome,
      proposal: isProposal,
      mutation: !isProposal,
      verified: outcome === "success" && !isProposal,
    };
  });
}
