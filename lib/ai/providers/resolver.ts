/**
 * Provider Model Resolver（Task 10）：
 * provider/model → AIModelDefinition（transport 唯一来源）→ AI SDK LanguageModel。
 * - openai-chat        → @ai-sdk/openai-compatible
 * - anthropic-messages → @ai-sdk/anthropic（OpenCode Go Messages：Bearer authToken，baseURL 不带 /messages）
 * - openai-responses   → 明确 UNSUPPORTED_TRANSPORT（本轮不实现，绝不当 openai-chat 发送）
 * 所有 Runtime Route（chat / test / compact）共用；Tool 语义与 transport 完全解耦。
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LanguageModel } from "ai";
import { AIError } from "@/lib/ai/errors";
import { AIProviderId, AICustomConfig, AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";
import { DEEPSEEK_MODELS, deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";
import { OPENCODE_MODELS, fetchOpenCodeGoModels } from "@/lib/ai/providers/openCodeGo";
import { getProviderConfig } from "@/lib/ai/providers/registry";

export interface ResolveModelInput {
  provider: AIProviderId;
  model: string;
  apiKey: string;
  custom?: AICustomConfig;
}

/**
 * provider/model → AIModelDefinition。
 * OpenCode Go：先查静态 OPENCODE_MODELS；未命中时查询远端 catalog（带短缓存），
 * 远端模型 transport 仍以本地注册表为准；未知模型返回 null（调用方 → MODEL_UNAVAILABLE）。
 */
export async function resolveModelDefinition(input: Pick<ResolveModelInput, "provider" | "model" | "custom">): Promise<AIModelDefinition | null> {
  const model = input.model;
  if (!model) return null;

  if (input.provider === "deepseek") {
    return DEEPSEEK_MODELS.find((m) => m.id === model) ?? null;
  }

  if (input.provider === "custom-openai") {
    // Custom 固定 openai-chat；不扩展 Anthropic-compatible 设置
    return {
      id: model,
      name: input.custom?.model || model,
      provider: "custom-openai",
      vendor: null,
      transport: "openai-chat",
      capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
    };
  }

  if (input.provider === "opencode-go") {
    const known = OPENCODE_MODELS.find((m) => m.id === model);
    if (known) return known;
    // 远端 catalog：只用于确认模型存在；transport 以本地注册表为准（远端不返回 transport）
    const remote = await fetchOpenCodeGoModels();
    if (remote && remote.some((m) => m.id === model)) {
      return OPENCODE_MODELS.find((m) => m.id === model) ?? null;
    }
    return null;
  }

  return null;
}

/**
 * AIModelDefinition → AI SDK LanguageModel。
 * Custom noRedirect（SSRF 防护）只存在于 openai-chat 分支。
 */
export function createLanguageModelFromDefinition(
  definition: AIModelDefinition,
  cfg: AIProviderConfig
): LanguageModel {
  if (definition.transport === "anthropic-messages") {
    // OpenCode Go Messages：Bearer token（authToken），baseURL 由 Provider 自行拼接 /messages
    return createAnthropic({
      name: "classflow-kiro",
      baseURL: cfg.baseURL,
      authToken: cfg.apiKey ?? "",
    })(definition.id);
  }
  if (definition.transport === "openai-chat") {
    // DeepSeek V4：V4 默认 thinking=on，与 tool calling 不兼容 → 显式禁用（仅 DeepSeek 官方 transport）
    const deepSeekCompat = definition.provider === "deepseek";
    return createOpenAICompatible({
      name: "classflow-kiro",
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey ?? "",
      ...(deepSeekCompat ? { transformRequestBody: deepSeekTransformRequestBody } : {}),
      // Custom Provider：不自动跟随 redirect，避免 SSRF 跳转到私网地址
      fetch: cfg.noRedirect
        ? (input, init) =>
            fetch(input, {
              ...init,
              redirect: "manual",
            } as RequestInit)
        : undefined,
    })(definition.id);
  }
  // openai-responses 及一切未知 transport：明确拒绝，不偷偷降级为 openai-chat
  throw new AIError("UNSUPPORTED_TRANSPORT");
}

/** 统一入口：所有 Runtime Route（chat / test / compact）共用 */
export async function resolveLanguageModel(input: ResolveModelInput): Promise<{
  model: LanguageModel;
  definition: AIModelDefinition;
}> {
  const definition = await resolveModelDefinition(input);
  if (!definition) {
    throw new AIError("MODEL_UNAVAILABLE");
  }
  // Custom Base URL SSRF 校验在 getProviderConfig 内执行（非法 → AIError INVALID_CUSTOM_URL）
  const cfg = getProviderConfig({ provider: input.provider, apiKey: input.apiKey, custom: input.custom });
  return {
    model: createLanguageModelFromDefinition(definition, cfg),
    definition,
  };
}
