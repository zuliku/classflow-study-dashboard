import { AI, OPENCODE_NON_CHAT_MODEL_IDS } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * OpenCode Go：官方 Chat Completions 模型注册表。
 * 本列表为 Task 1 支持的 openai-chat 模型（fallback 与本地选择器数据源）；
 * 远端 /models 获取成功时以远端为最新来源，失败时回落到本列表。
 */
export const OPENCODE_CHAT_MODELS: AIModelDefinition[] = [
  { id: "grok-4.5", name: "Grok 4.5", provider: "opencode-go", vendor: "xai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false } },
  { id: "glm-5.2", name: "GLM 5.2", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.1", name: "GLM 5.1", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "kimi-k3", name: "Kimi K3", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false } },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "kimi-k2.6", name: "Kimi K2.6", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "mimo-v2.5", name: "MiMo V2.5", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false } },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "hy3", name: "Hy3", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
];

export const OPENCODE_DEFAULT_MODEL = "deepseek-v4-flash";

export function getOpenCodeGoConfig(apiKey: string): AIProviderConfig {
  return { baseURL: AI.OPENCODE_BASE_URL, apiKey };
}

/** 远端模型 metadata → 本 Task 支持的模型（只保留 openai-chat / 非黑名单） */
export function filterRemoteChatModels(
  raw: { id?: string; transport?: string }[]
): { id: string; transport: string }[] {
  const seen = new Set<string>();
  const out: { id: string; transport: string }[] = [];
  for (const m of raw) {
    const id = m.id;
    if (!id) continue;
    if (OPENCODE_NON_CHAT_MODEL_IDS.includes(id)) continue;
    const transport = (m.transport || "").toLowerCase() || "openai-chat";
    if (transport !== "openai-chat" && transport !== "openai-responses") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, transport });
  }
  return out;
}

/** 拉取 OpenCode Go 远端模型列表（Server-only）；失败返回 null，由调用方回落 registry */
export async function fetchOpenCodeGoModels(): Promise<{ id: string; transport: string }[] | null> {
  try {
    const res = await fetch(AI.OPENCODE_MODELS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { id?: string; transport?: string }[] };
    if (!Array.isArray(data.models)) return null;
    return filterRemoteChatModels(data.models);
  } catch {
    return null;
  }
}
