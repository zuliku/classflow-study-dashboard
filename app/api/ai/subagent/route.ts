/**
 * Kiro Subagent endpoint（Agent Superpowers V1.2）。
 *
 * - 只接受 local-user invocation；remote-channel 明确拒绝
 * - 只提供 server-side web tools（researcher）或纯文本推理（planner / reviewer）
 * - 无 ClassFlow client tools、无写权限、无审批、无终端/桌面/MCP
 * - 返回 AI SDK UI message stream，client 侧实时解析 text + tool steps
 */

import { stepCountIs, streamText } from "ai";
import { validateAIChatBody } from "@/lib/ai/server";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { resolveKiroWebSearchAccessWithStoredRef } from "@/lib/ai/web/storedCredentials";
import { assembleKiroToolsForRequest } from "@/lib/ai/web/tool";
import {
  MAX_SUBAGENT_WEB_READS,
  MAX_SUBAGENT_WEB_SEARCHES,
  SUBAGENT_TIMEOUT_MS,
  buildSubagentSystemPrompt,
  buildSubagentUserPrompt,
  normalizeSubagentRequest,
} from "@/lib/ai/agent/subagent";

export const runtime = "nodejs";

function fail(code: string, message: string, status = 200) {
  return Response.json({ ok: false, code, message }, { status });
}

export async function handleSubagent(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("SUBAGENT_FAILED", "请求格式无效。", 400);
  }

  const parsed = validateAIChatBody(body);
  if (!parsed.ok) return fail(parsed.code, parsed.message, 400);

  const request = normalizeSubagentRequest((body as Record<string, unknown>).subagent);
  if (!request) return fail("SUBAGENT_INVALID_INPUT", "子代理任务无效。", 400);

  // Invocation trust：只允许本地用户；remote-channel 不提供子代理
  try {
    const { resolveInvocationOrThrow } = await import("@/src/main/security/invocationTrust");
    const invocation = resolveInvocationOrThrow(parsed.invocationId ?? "");
    if (invocation.origin !== "local-user") {
      return fail("SUBAGENT_LOCAL_ONLY", "子代理仅支持本地用户。", 403);
    }
  } catch (err) {
    const raw = (err as Error)?.message ?? "";
    try {
      const parsedErr = JSON.parse(raw) as { code?: string; message?: string };
      return fail(parsedErr.code ?? "INVOCATION_REQUIRED", parsedErr.message ?? "Invocation 校验失败。", 401);
    } catch {
      return fail("INVOCATION_REQUIRED", "Invocation 校验失败。", 401);
    }
  }

  const webSearchEnabled = parsed.webSearchConfig?.enabled === true;
  const webSearchAccess = webSearchEnabled
    ? await resolveKiroWebSearchAccessWithStoredRef({
        mode: parsed.webSearchConfig?.credentialMode ?? "server",
        userApiKey: parsed.webSearchConfig?.apiKey,
        credentialRef: parsed.webSearchConfig?.credentialRef,
      })
    : null;

  // researcher 才暴露 web tools；planner / reviewer 不触网（避免无意义成本）
  const tools =
    request.role === "researcher"
      ? assembleKiroToolsForRequest({
          webSearchEnabled,
          credential: {
            mode: parsed.webSearchConfig?.credentialMode ?? "server",
            userApiKey: parsed.webSearchConfig?.apiKey,
          },
          access: webSearchAccess,
          origin: "local-user",
          maxSearchAttempts: MAX_SUBAGENT_WEB_SEARCHES,
          maxReadAttempts: MAX_SUBAGENT_WEB_READS,
          messages: [],
          clientTools: {},
        })
      : {};

  let model: Awaited<ReturnType<typeof resolveLanguageModel>>["model"];
  try {
    const resolved = await resolveLanguageModel({
      provider: parsed.provider,
      model: parsed.model,
      apiKey: parsed.apiKey,
      custom: parsed.customConfig,
    });
    model = resolved.model;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[kiro-subagent] model resolve failed", (err as Error)?.message);
    }
    return fail("SUBAGENT_MODEL_UNAVAILABLE", "当前模型暂不可用于子代理。", 400);
  }

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(SUBAGENT_TIMEOUT_MS)]);
  try {
    const result = streamText({
      model,
      system: buildSubagentSystemPrompt(request.role),
      messages: [{ role: "user", content: buildSubagentUserPrompt(request) }],
      tools,
      stopWhen: stepCountIs(6),
      maxOutputTokens: 2600,
      temperature: 0.2,
      abortSignal: signal,
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[kiro-subagent] stream start failed", (err as Error)?.message);
    }
    return fail("SUBAGENT_FAILED", "子代理启动失败。", 500);
  }
}
