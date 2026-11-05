/**
 * Kiro Subagent stream consumer（client-side）。
 *
 * 子代理 endpoint 返回 AI SDK UI message stream（SSE）。本模块只提取：
 * - text-delta → 实时正文
 * - tool-input-start / available / output-available / output-error → 右侧步骤状态
 * - error → 失败
 *
 * 不把原始事件 / tool input JSON 暴露给 UI；detail 仅保留 query/topic/来源数量。
 */

import { toolLabel } from "@/lib/ai/tools/formatters";
import type { KiroSubagentStep, KiroSubagentStepStatus } from "@/store/useKiroSubagentStore";

export interface KiroSubagentStreamCallbacks {
  onText: (delta: string) => void;
  onStep: (step: KiroSubagentStep) => void;
  onError: (message: string) => void;
}

function truncateDetail(value: string, max = 72): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function inputDetail(toolName: string, input: unknown): string | undefined {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (toolName === "web_search" && typeof record.query === "string") {
    return truncateDetail(record.query);
  }
  if (toolName === "web_research" && typeof record.topic === "string") {
    return truncateDetail(record.topic);
  }
  if (toolName === "read_web_source" && Array.isArray(record.sourceIds)) {
    return `读取 ${record.sourceIds.length} 个来源`;
  }
  return undefined;
}

function outputDetail(toolName: string, output: unknown): string | undefined {
  const data = (output && typeof output === "object" ? (output as { data?: unknown }).data : null) as
    | { results?: unknown[]; sources?: unknown[] }
    | null;
  if (toolName === "web_search" && Array.isArray(data?.results)) {
    return `${data.results.length} 个来源`;
  }
  if (toolName === "web_research" && Array.isArray(data?.results)) {
    return `${data.results.length} 个来源`;
  }
  if (toolName === "read_web_source" && Array.isArray(data?.sources)) {
    return `${data.sources.length} 个来源`;
  }
  return undefined;
}

function statusFromEvent(type: string): KiroSubagentStepStatus {
  if (type === "tool-output-available") return "done";
  if (type === "tool-output-error") return "error";
  return "working";
}

/** 消费子代理 SSE；返回 false 表示流内出现 error（正文可能已有部分输出） */
export async function consumeKiroSubagentStream(
  response: Response,
  callbacks: KiroSubagentStreamCallbacks
): Promise<boolean> {
  if (!response.ok) {
    let message = `子代理启动失败（HTTP ${response.status}）`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body?.message === "string" && body.message.trim()) message = body.message;
    } catch {
      /* non-JSON */
    }
    callbacks.onError(message);
    return false;
  }
  if (!response.body) {
    callbacks.onError("子代理没有返回数据流。");
    return false;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let errored = false;
  const toolNames = new Map<string, string>();

  const processBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n").trim();
    if (!raw || raw === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "text-delta") {
      const delta =
        typeof event.delta === "string"
          ? event.delta
          : typeof event.textDelta === "string"
            ? event.textDelta
            : typeof event.text === "string"
              ? event.text
              : "";
      if (delta) callbacks.onText(delta);
      return;
    }
    if (type === "error") {
      const message =
        (typeof event.errorText === "string" && event.errorText) ||
        (typeof event.message === "string" && event.message) ||
        "子代理执行失败。";
      callbacks.onError(message);
      errored = true;
      return;
    }
    if (!type.startsWith("tool-input") && !type.startsWith("tool-output")) return;
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
    const eventToolName = typeof event.toolName === "string" ? event.toolName : "";
    if (!toolCallId) return;
    if (eventToolName) toolNames.set(toolCallId, eventToolName);
    const toolName = eventToolName || toolNames.get(toolCallId) || "";
    const status = statusFromEvent(type);
    callbacks.onStep({
      id: toolCallId,
      toolName,
      label: toolLabel(toolName),
      status,
      detail:
        inputDetail(toolName, event.input) ??
        outputDetail(toolName, event.output) ??
        undefined,
    });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      processBlock(block);
      split = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);
  return !errored;
}
