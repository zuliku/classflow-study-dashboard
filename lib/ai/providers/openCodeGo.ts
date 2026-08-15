import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * OpenCode Go 官方模型注册表（Task 10 + Phase 3.0 correctness）：
 * 以官方 endpoint 表为准，每个模型声明真实 transport（openai-chat / anthropic-messages）。
 *
 * source-of-truth 规则：
 * - /v1/models（远端）= availability source（「当前是否可用」）
 * - 官方 endpoint 表 + 本 verified registry = transport / vendor / capabilities / 展示名 source
 * 本列表是 /models 无法获取时的 fallback，也是远端模型 transport 的唯一来源
 * （远端 /models 只返回 id，不返回 transport；未知模型一律跳过，绝不猜测协议）。
 *
 * 注意：grok-4.5 官方当前 endpoint 为 /v1/responses（@ai-sdk/openai），
 * ClassFlow Runtime 尚未实现 openai-responses transport → 不进入本 supported 列表，
 * 见 OPENCODE_RESPONSES_MODEL_IDS。
 */
export const OPENCODE_MODELS: AIModelDefinition[] = [
  // ---- OpenAI Chat Completions（官方 endpoint：/v1/chat/completions）----
  { id: "glm-5.3", name: "GLM 5.3", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
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
  // ---- Anthropic Messages（官方 endpoint：/v1/messages）----
  // V1 保守能力声明：streaming + tools 为强要求；vision/fileParts 未经实测不开
  { id: "minimax-m3", name: "MiniMax M3", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "minimax-m2.7", name: "MiniMax M2.7", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "minimax-m2.5", name: "MiniMax M2.5", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.6-plus", name: "Qwen3.6 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
];

/**
 * OpenAI Responses transport 模型（官方 endpoint：/v1/responses → @ai-sdk/openai）：
 * 模型当前存在，但 ClassFlow Runtime 尚未实现 openai-responses transport（Phase 3.1）。
 * 本列表表达「存在但不可发送」，展示时过滤，绝不降级为 openai-chat 发送。
 * 当前至少：Grok 4.5、GPT 5.6 Luna。
 */
export const OPENCODE_RESPONSES_MODEL_IDS = ["grok-4.5", "gpt-5.6-luna"] as const;

export const OPENCODE_DEFAULT_MODEL = "deepseek-v4-flash";

export function getOpenCodeGoConfig(apiKey: string): AIProviderConfig {
  return { baseURL: AI.OPENCODE_BASE_URL, apiKey };
}

export interface RemoteGoModel {
  id: string;
  transport: "openai-chat" | "anthropic-messages";
}

/**
 * 远端模型筛选（Task 10 + Phase 3.0）：
 * 远端 /models 只返回 id（无 transport）→ transport 唯一来源是本地 OPENCODE_MODELS。
 * 对每个远端 id：
 * 1. 重复 id → skip
 * 2. id ∈ OPENCODE_RESPONSES_MODEL_IDS → skip（模型存在，但 Runtime transport 未支持）
 * 3. 本地 OPENCODE_MODELS 找不到 verified definition → skip（绝不按前缀/厂商猜 transport）
 * 4. transport 只允许当前 Runtime 已实现的 openai-chat / anthropic-messages → 否则 skip
 * 5. 输出 id + verified transport
 */
export function filterRemoteGoModels(raw: { id?: string }[]): RemoteGoModel[] {
  const seen = new Set<string>();
  const out: RemoteGoModel[] = [];
  for (const m of raw) {
    const id = m.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if ((OPENCODE_RESPONSES_MODEL_IDS as readonly string[]).includes(id)) continue;
    const known = OPENCODE_MODELS.find((d) => d.id === id);
    if (!known) continue;
    if (known.transport !== "openai-chat" && known.transport !== "anthropic-messages") continue;
    out.push({ id, transport: known.transport });
  }
  return out;
}

/** 远端模型列表短缓存（避免未知模型每条消息重复请求；模块级，不引入依赖） */
const REMOTE_CACHE_TTL_MS = 120_000;
let remoteCache: { at: number; models: RemoteGoModel[] | null } | null = null;

/** 清空远端模型缓存（测试用） */
export function resetOpenCodeGoModelsCache(): void {
  remoteCache = null;
}

/** 拉取 OpenCode Go 远端模型列表（Server-only）；失败返回 null，由调用方回落 registry */
export async function fetchOpenCodeGoModels(): Promise<RemoteGoModel[] | null> {
  if (remoteCache && Date.now() - remoteCache.at < REMOTE_CACHE_TTL_MS) {
    return remoteCache.models;
  }
  try {
    const res = await fetch(AI.OPENCODE_MODELS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) {
      remoteCache = { at: Date.now(), models: null };
      return null;
    }
    const data = (await res.json()) as { models?: { id?: string }[]; data?: { id?: string }[] };
    // 官方响应结构：{ object:"list", data:[...] }；旧版兼容 { models:[...] }
    const list = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : null;
    const filtered = list ? filterRemoteGoModels(list) : null;
    remoteCache = { at: Date.now(), models: filtered };
    return filtered;
  } catch {
    remoteCache = { at: Date.now(), models: null };
    return null;
  }
}
