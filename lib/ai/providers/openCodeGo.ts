import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * OpenCode Go 官方模型注册表（Task 10 + Phase 3.0/3.1）：
 * 以官方 endpoint 表为准，每个模型声明真实 transport
 * （openai-chat / openai-responses / anthropic-messages）。
 *
 * source-of-truth 规则：
 * - /v1/models（远端）= availability source（「当前是否可用」）
 * - 官方 endpoint 表 + 本 verified registry = transport / vendor / capabilities / 展示名 source
 * 本列表是 /models 无法获取时的 fallback，也是远端模型 transport 的唯一来源
 * （远端 /models 只返回 id，不返回 transport；未知模型一律跳过，绝不猜测协议）。
 */
export const OPENCODE_MODELS: AIModelDefinition[] = [
  // ---- OpenAI Chat Completions（官方 endpoint：/v1/chat/completions）----
  { id: "glm-5.3", name: "GLM 5.3", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.2", name: "GLM 5.2", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.1", name: "GLM 5.1", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // kimi-k3 / mimo-v2.5 Vision：Phase 3.3B live 验证（PNG/JPEG/WEBP 颜色识别全通过，
  // 经生产 resolver → @ai-sdk/openai-compatible → OpenCode Go chat/completions）
  {
    id: "kimi-k3",
    name: "Kimi K3",
    provider: "opencode-go",
    vendor: "kimi",
    transport: "openai-chat",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      // Phase 3.5A：Kimi K3 reasoning（OpenAI-compatible reasoning_effort 直通，
      // 复用 mechanism "effort"，capability 归一下 max 不再折叠成 medium）。
      // 产品档位：默认（不覆盖 provider 默认）/ 低 / 高 / 极高；不暴露 medium。
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "high", "max"],
        mechanism: "effort",
      },
    },
  },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "kimi-k2.6", name: "Kimi K2.6", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "mimo-v2.5", name: "MiMo V2.5", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "hy3", name: "Hy3", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // ---- OpenAI Responses（官方 endpoint：/v1/responses → @ai-sdk/openai）----
  // Phase 3.1 正式接入。保守能力声明：vision/fileParts 未经 OpenCode Go proxy 实测不开。
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "opencode-go",
    vendor: "xai",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      fileParts: false,
      // Phase 3.2B：Grok 4.5 reasoning 经真实 OpenCode Go live smoke 验证
      // （low/medium/high + summary:"detailed" 均 200，含 client-tool continuation）。
      // 官方边界：low/medium/high，默认 high，不能关闭 → default=不发送 override。
      // 需要 forceReasoning（SDK id 启发式不识别 grok-*）。
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "medium", "high"],
        mechanism: "openai-responses-effort",
      },
    },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    provider: "opencode-go",
    vendor: "openai",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      fileParts: false,
      // Phase 3.2A：GPT 5.6 Luna 是首个启用 reasoning 的 OpenCode Go 模型。
      // mechanism=openai-responses-effort（providerOptions.openai.reasoningEffort → reasoning.effort）。
      // SDK/request-shape verified（request-body capture 测试）；OpenCode Go live smoke
      // 由 gated 测试（OPENCODE_GO_TEST_API_KEY）验证。
      // max 未经 live 验证 → 不暴露；只保留已验证档位。
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "medium", "high"],
        mechanism: "openai-responses-effort",
      },
    },
  },
  // Muse Spark 1.2 — 2026-08-19 live verified（OpenCode Go /v1/models 已返回 muse-spark-1.2；
  // 禁止根据厂商/名称猜测，必须先 live probe 再加入 registry）：
  // transport：openai-responses（@ai-sdk/openai .responses）
  //   - /v1/chat/completions → 200 for text/tools/reasoning/streaming but 400 for vision（image_url → 空 assistant，finish_reason null）
  //   - /v1/responses → 200 for all：text / streaming(event-stream) / tool_call(function_call) / reasoning(effort) / vision(input_image)
  //   - /v1/messages → 400
  //   → 唯一满足全能力的 transport 是 openai-responses；vision 仅在 responses 下通过（128x128 红/蓝 PNG/JPEG/WEBP 均识别 RED/BLUE）。
  // streaming：true（responses streaming 200 event: response.created/in_progress/output_item.added；chat streaming 亦 200 但 vision 仍 400）
  // tools：true（responses minimal/high 均返回 function_call get_current_time；chat 亦 200 但与 vision 互斥，统一走 responses）
  // reasoning：adjustable true，supportedEfforts ["default","minimal","low","medium","high","xhigh"]，mechanism openai-responses-effort
  //   - live：minimal/low/medium/high/xhigh 均 200 completed，reasoning_tokens 35-209；none 400 “does not support none”；max 400 “unknown variant max”
  //   - forceReasoning=true（SDK 启发式不识别 muse-*，需显式 force）
  //   - 与 Grok/Luna 同 mechanism，需合并到 providerOptions.openai
  // vision：true（responses input_image 200 RED for red png/jpeg/webp 128, BLUE for blue；chat 400）
  // fileParts/pdf：false（PDF via responses 400 “failed to parse PDF”；chat 200 空内容；未经有效 PDF 验证，不声明 true）
  {
    id: "muse-spark-1.2",
    name: "Muse Spark 1.2",
    provider: "opencode-go",
    vendor: "meta",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "minimal", "low", "medium", "high", "xhigh"],
        mechanism: "openai-responses-effort",
      },
    },
  },
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

export const OPENCODE_DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * OpenCode Go chat/completions 对 tool 参数 schema 校验严格（与 DeepSeek 官方一致）：
 * z.discriminatedUnion 等 zod 结构经 AI SDK 转换后根节点无 type / type 非 "object" 会被 400 拒绝
 * （真实验证：create_reminder 曾触发 "schema must be a JSON Schema of 'type: "object"', got 'type: null'"）。
 * 与 DeepSeek 兼容层同一规则：只对「缺少根 type 且明显是 object 结构」的 schema 补 type:"object"，
 * 不改字段/校验语义，不触碰工具定义（客户端 zod 校验不受影响）。
 */
function ensureObjectRootSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  if (s.type === "object") return schema;
  const looksLikeObject = s.properties !== undefined || Array.isArray(s.anyOf) || Array.isArray(s.oneOf);
  if (!looksLikeObject) return schema;
  return { ...s, type: "object" };
}

export function openCodeGoTransformRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const tools = Array.isArray(body.tools)
    ? body.tools.map((t) => {
        if (!t || typeof t !== "object") return t;
        const toolObj = t as Record<string, unknown>;
        const fn =
          typeof toolObj.function === "object" && toolObj.function !== null
            ? (toolObj.function as Record<string, unknown>)
            : null;
        if (!fn || typeof fn.parameters !== "object" || fn.parameters === null) return t;
        const fixed = ensureObjectRootSchema(fn.parameters);
        if (fixed === fn.parameters) return t;
        return { ...toolObj, function: { ...fn, parameters: fixed } };
      })
    : body.tools;
  return { ...body, tools };
}

export function getOpenCodeGoConfig(apiKey: string): AIProviderConfig {
  return { baseURL: AI.OPENCODE_BASE_URL, apiKey };
}

export interface RemoteGoModel {
  id: string;
  transport: "openai-chat" | "openai-responses" | "anthropic-messages";
}

/**
 * 远端模型筛选（Task 10 + Phase 3.1）：
 * 远端 /models 只返回 id（无 transport）→ transport 唯一来源是本地 OPENCODE_MODELS。
 * 对每个远端 id：
 * 1. 重复 id → skip
 * 2. 本地 OPENCODE_MODELS 找不到 verified definition → skip（绝不按前缀/厂商猜 transport）
 * 3. transport 只允许当前 Runtime 已实现的 openai-chat / openai-responses / anthropic-messages → 否则 skip
 * 4. 输出 id + verified transport
 */
export function filterRemoteGoModels(raw: { id?: string }[]): RemoteGoModel[] {
  const seen = new Set<string>();
  const out: RemoteGoModel[] = [];
  for (const m of raw) {
    const id = m.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const known = OPENCODE_MODELS.find((d) => d.id === id);
    if (!known) continue;
    if (
      known.transport !== "openai-chat" &&
      known.transport !== "openai-responses" &&
      known.transport !== "anthropic-messages"
    ) {
      continue;
    }
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
