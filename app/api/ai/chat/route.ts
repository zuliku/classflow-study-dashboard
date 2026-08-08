import { NextRequest } from "next/server";
import {
  streamText,
  toUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  TextStreamPart,
  ToolSet,
} from "ai";
import { AI, KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { getProviderConfig } from "@/lib/ai/providers/registry";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { normalizeAIError, AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { createChatProvider, validateAIChatBody, createTimeoutController } from "@/lib/ai/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 超时 abort → 归一化错误 part；用户主动 Stop 的 abort 原样透传 */
function guardStream<TOOLS extends ToolSet>(
  src: ReadableStream<TextStreamPart<TOOLS>>
): ReadableStream<TextStreamPart<TOOLS>> {
  return src.pipeThrough(
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        if (part.type === "abort" && part.reason && /timeout|timed out/i.test(String(part.reason))) {
          controller.enqueue({
            type: "error",
            error: new AIError("TIMEOUT", AI_ERROR_MESSAGES.TIMEOUT),
          } as TextStreamPart<TOOLS>);
          return;
        }
        controller.enqueue(part);
      },
    })
  );
}

/**
 * Kiro Chat 流式接口（官方 UI Message Stream）。
 * - 接受 provider/model/apiKey/customConfig/messages + 可选 baseContext / contextRefs
 * - Read Tools 只向 Browser 发 Tool Call（无 server execute）
 * - 错误经 onError → normalizeAIError → 只下发 { code, message }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: "UNKNOWN", message: "请求格式无效。" }, { status: 400 });
  }

  const parsed = validateAIChatBody(body);
  if (!parsed.ok) {
    return Response.json({ code: parsed.code, message: parsed.message }, { status: 400 });
  }
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    return Response.json({ code: "UNKNOWN", message: "缺少对话消息。" }, { status: 400 });
  }

  // Custom Base URL SSRF 校验（registry 内执行）
  let cfg;
  try {
    cfg = getProviderConfig({
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      custom: parsed.customConfig,
    });
  } catch (err) {
    const aiErr = normalizeAIError(err);
    return Response.json({ code: aiErr.code, message: aiErr.message }, { status: 400 });
  }

  const provider = createChatProvider(cfg);
  const timeout = parsed.timeoutMs ?? AI.CHAT_TIMEOUT_MS;
  const { signal } = createTimeoutController(timeout, req.signal);

  // 客户端的 Base Context + 显式 Context 引用（不含敏感字段与完整实体）
  const b = body as Record<string, unknown>;
  const baseContext = (typeof b.baseContext === "object" && b.baseContext !== null ? b.baseContext : null) as Record<string, unknown> | null;
  const contextRefs = Array.isArray(b.contextRefs) ? (b.contextRefs as Record<string, unknown>[]) : [];

  const systemMessage = baseContext
    ? `${KIRO_SYSTEM_PROMPT}\n\n# 当前 ClassFlow 上下文\n${JSON.stringify({
        baseContext,
        contextRefs,
      })}`
    : KIRO_SYSTEM_PROMPT;

  // 兼容性归一：旧 {role, content} 形状 → UIMessage parts 形状（客户端始终发送 parts 版）
  const normalizedMessages = (parsed.messages as { id?: string; role: string; content?: string; parts?: unknown[] }[]).map(
    (m) =>
      Array.isArray(m.parts) && m.parts.length > 0
        ? m
        : { id: m.id ?? `m_${Math.random().toString(36).slice(2)}`, role: m.role, parts: [{ type: "text", text: m.content ?? "" }] }
  );

  try {
    const modelMessages = await convertToModelMessages(normalizedMessages as never);
    const result = streamText({
      model: provider(parsed.model),
      messages: modelMessages,
      system: systemMessage,
      tools: KIRO_TOOLS,
      maxOutputTokens: AI.CHAT_MAX_OUTPUT_TOKENS,
      abortSignal: signal,
    });

    const uiStream = toUIMessageStream({
      stream: guardStream(result.stream),
      // 多轮 client tool call 时保留同一 assistant message id，避免重复消息
      originalMessages: parsed.messages as never,
      onError: (err: unknown) => {
        const aiErr = normalizeAIError(err);
        // 客户端只收到归一化的 code + 自然语言，不泄漏 Provider 细节
        return JSON.stringify({ code: aiErr.code, message: aiErr.message ?? aiErr.code });
      },
    });

    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (err) {
    const aiErr = normalizeAIError(err);
    return Response.json({ code: aiErr.code, message: aiErr.message }, { status: 500 });
  }
}
