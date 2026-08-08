import { NextRequest } from "next/server";
import { generateText } from "ai";
import { AI } from "@/lib/ai/config";
import { getProviderConfig } from "@/lib/ai/providers/registry";
import { AI_ERROR_MESSAGES, normalizeAIError } from "@/lib/ai/errors";
import { createChatProvider, validateAIChatBody, createTimeoutController } from "@/lib/ai/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 测试连接：只发送极小的测试请求（要求模型输出 OK），
 * 不发送任何 ClassFlow 数据与用户聊天。
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, code: "UNKNOWN", message: "请求格式无效。" }, { status: 400 });
  }

  const parsed = validateAIChatBody(body);
  if (!parsed.ok) {
    return Response.json({ ok: false, code: parsed.code, message: parsed.message }, { status: 400 });
  }

  let cfg;
  try {
    cfg = getProviderConfig({
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      custom: parsed.customConfig,
    });
  } catch (err) {
    const aiErr = normalizeAIError(err);
    return Response.json({ ok: false, code: aiErr.code, message: aiErr.message }, { status: 400 });
  }

  const provider = createChatProvider(cfg);
  const timeout = parsed.timeoutMs ?? AI.TEST_TIMEOUT_MS;
  const { signal, done } = createTimeoutController(timeout, req.signal);

  try {
    await generateText({
      model: provider(parsed.model),
      prompt: "只回复两个字母：OK",
      maxOutputTokens: 8,
      abortSignal: signal,
    });
    done();
    return Response.json({ ok: true });
  } catch (err) {
    done();
    const aiErr = normalizeAIError(err);
    return Response.json(
      { ok: false, code: aiErr.code, message: aiErr.message ?? AI_ERROR_MESSAGES[aiErr.code] },
      { status: 400 }
    );
  }
}
