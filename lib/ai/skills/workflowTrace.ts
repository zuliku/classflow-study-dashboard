/**
 * Workflow Trace — 提取本轮 Kiro 成功工作流
 * 只允许使用成功执行事实，失败调用仅用于注意事项
 */

import type { WorkflowTrace } from "@/lib/ai/skills/types";

export interface KiroMessageForTrace {
  id: string;
  role: "user" | "assistant";
  parts?: Array<{ type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; text?: string }>;
  content?: string;
}

/**
 * 从 Kiro Chat 的 messages 中提取最近一次成功 Turn 的 Workflow Trace
 * 成功 Turn 定义：包含 Tool Actions 且最终状态为 success（无失败的 mutation）
 */
export function extractWorkflowTrace(messages: KiroMessageForTrace[]): WorkflowTrace | null {
  if (!messages || messages.length === 0) return null;

  // 找到最后一个 user 消息
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

  // 收集该 Turn 之后的所有 assistant 消息的 tool calls/results
  const turnMessages = messages.slice(lastUserIdx + 1).filter((m) => m.role === "assistant");
  const toolCalls: WorkflowTrace["toolCalls"] = [];
  const toolResults: WorkflowTrace["toolResults"] = [];
  let hasProposal = false;
  let hasConfirmation = false;
  let hasSuccess = false;
  let hasFailedMutation = false;

  for (const msg of turnMessages) {
    const parts = msg.parts ?? [];
    for (const part of parts) {
      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        const toolName = part.type.slice("tool-".length);
        // 提议类工具视为 proposal
        if (toolName.includes("propose_") || toolName === "propose_visual_actions" || toolName === "propose_timetable_import") {
          hasProposal = true;
        }
        if (part.toolCallId) {
          toolCalls.push({ toolName, input: part.input ?? {}, toolCallId: part.toolCallId });
          // 检查 output
          const output = part.output as { ok?: boolean } | undefined;
          if (output) {
            toolResults.push({ toolName, result: output, toolCallId: part.toolCallId });
            if (output.ok === true) hasSuccess = true;
            if (output.ok === false) {
              // 失败的 mutation 不应作为正常流程步骤，但可用于注意事项
              hasFailedMutation = true;
            }
          }
        }
      }
      // 用户确认可能在后续 user 消息中，此处仅检测本 Turn 内的确认
      if (part.type === "text" && typeof part.text === "string" && part.text.includes("确认")) {
        hasConfirmation = true;
      }
    }
  }

  // 检查是否有后续 user 确认消息
  const nextUserIdx = messages.findIndex((_, idx) => idx > lastUserIdx && messages[idx].role === "user");
  if (nextUserIdx !== -1) {
    const nextUserText = extractTextFromMessage(messages[nextUserIdx]);
    if (nextUserText && /确认|同意|执行|好的|可以/.test(nextUserText)) {
      hasConfirmation = true;
    }
  }

  // 只允许成功执行事实：至少有一个成功的 tool 且无失败的 mutation 作为正常步骤
  // 失败调用仅用于注意事项，不计入正常流程，但不阻止 trace 提取（只要最终有 success）
  if (toolCalls.length === 0) return null;
  if (!hasSuccess) return null;

  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    turnId,
    userGoal,
    toolCalls: toolCalls.filter((c) => {
      // 过滤掉失败的 mutation 的 tool calls（仅保留成功的）
      const result = toolResults.find((r) => r.toolCallId === c.toolCallId);
      if (result && (result.result as { ok?: boolean })?.ok === false) return false;
      return true;
    }),
    toolResults: toolResults.filter((r) => (r.result as { ok?: boolean })?.ok === true),
    proposals: hasProposal ? [{}] : undefined,
    userConfirmation: hasConfirmation,
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

/**
 * 检查 Turn 是否可复用为 Skill（需包含至少一个成功 Tool Action）
 */
export function isWorkflowTraceReusable(trace: WorkflowTrace | null): boolean {
  if (!trace) return false;
  if (trace.finalStatus !== "success") return false;
  if (trace.toolCalls.length === 0) return false;
  return true;
}
