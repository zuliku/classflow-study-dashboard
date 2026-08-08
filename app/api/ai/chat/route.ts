import { NextRequest } from "next/server";
import { streamText } from "ai";
import { AI, KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { getProviderConfig } from "@/lib/ai/providers/registry";
import { normalizeAIError } from "@/lib/ai/errors";
import { createChatProvider, validateAIChatBody, createTimeoutController } from "@/lib/ai/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEXT_PART_ID = "kiro-text";
const MESSAGE_ID = "kiro-msg-1";

/**
 * Kiro Chat 流式接口（UI message stream / SSE）。
 * 只接受 provider/model/apiKey/customConfig/messages（Task 1 不接受任何 ClassFlow 数据）。
 * 错误以 `{"type":"error","errorText":"{code,message} JSON"}` 下发，
 * 客户端只收到归一化 code + 自然语言，不返回 Provider 原始 error body。
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

  const result = streamText({
    model: provider(parsed.model),
    messages: parsed.messages as never,
    system: KIRO_SYSTEM_PROMPT,
    maxOutputTokens: AI.CHAT_MAX_OUTPUT_TOKENS,
    abortSignal: signal,
  });

  // 手动构建 UI message stream：流式 error 行为完全可控（不依赖 SDK error-part 兼容性）
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      write({ type: "start", messageId: MESSAGE_ID });
      write({ type: "text-start", id: TEXT_PART_ID });
      let failed = false;
      try {
        for await (const part of result.stream) {
          if (part.type === "text-delta") {
            write({ type: "text-delta", id: TEXT_PART_ID, delta: part.text });
          } else if (part.type === "error") {
            failed = true;
            const aiErr = normalizeAIError(part.error);
            write({ type: "error", errorText: JSON.stringify({ code: aiErr.code, message: aiErr.message }) });
          } else if (part.type === "abort") {
            failed = true;
            write({
              type: "error",
              errorText: JSON.stringify({ code: "TIMEOUT", message: "请求超时，请重试。" }),
            });
          }
        }
        if (!failed) {
          write({ type: "text-end", id: TEXT_PART_ID });
          write({ type: "finish", finishReason: "stop" });
        }
      } catch (err) {
        const aiErr = normalizeAIError(err);
        write({ type: "error", errorText: JSON.stringify({ code: aiErr.code, message: aiErr.message }) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      signal.dispatchEvent(new Event("abort"));
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
