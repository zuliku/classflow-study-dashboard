import { NextRequest } from "next/server";
import { generateText } from "ai";
import { AI } from "@/lib/ai/config";
import { AI_ERROR_MESSAGES, normalizeAIError } from "@/lib/ai/errors";
import { logProviderError } from "@/lib/ai/providerLog";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { validateAIChatBody, createTimeoutController } from "@/lib/ai/server";

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

  let resolved;
  try {
    resolved = await resolveLanguageModel({
      provider: parsed.provider,
      model: parsed.model,
      apiKey: parsed.apiKey,
      custom: parsed.customConfig,
    });
  } catch (err) {
    logProviderError("test/resolve", err);
    const aiErr = normalizeAIError(err);
    return Response.json({ ok: false, code: aiErr.code, message: aiErr.message }, { status: 400 });
  }

  const timeout = parsed.timeoutMs ?? AI.TEST_TIMEOUT_MS;
  const { signal, done } = createTimeoutController(timeout, req.signal);

  try {
    await generateText({
      model: resolved.model,
      prompt: "只回复两个字母：OK",
      maxOutputTokens: 8,
      abortSignal: signal,
    });
    done();
    return Response.json({ ok: true });
  } catch (err) {
    done();
    logProviderError("test/generate", err);
    const aiErr = normalizeAIError(err);
    return Response.json(
      { ok: false, code: aiErr.code, message: aiErr.message ?? AI_ERROR_MESSAGES[aiErr.code] },
      { status: 400 }
    );
  }
}
