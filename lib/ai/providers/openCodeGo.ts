import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * OpenCode Go 官方模型注册表（Task 10 + Phase 3.0/3.1，2026-09 按 Go 使用/限额表同步；
 * 2026-09-16 按远端 /v1/models 实测 37 款同步为 36 款）：
 * 以官方 endpoint 表为准，每个模型声明真实 transport
 * （openai-chat / openai-responses / anthropic-messages）。
 *
 * source-of-truth 规则：
 * - /v1/models（远端）= availability source（「当前是否可用」）
 * - 官方 endpoint 表 + 本 verified registry = transport / vendor / capabilities / 展示名 source
 * 本列表是 /models 无法获取时的 fallback，也是远端模型 transport 的唯一来源
 * （远端 /models 只返回 id，不返回 transport；未知模型一律跳过，绝不猜测协议）。
 *
 * 新增模型 transport 按同厂商已验证家族归属（同协议族），能力一律保守
 * （streaming/tools 开；vision/reasoning 未经 live 验证不开）；
 * omen-alpha（未知厂商、无协议证据）按规则跳过，不进入注册表。
 *
 * 2026-09-03 live/文档验证后放开（key：live = 真实 Go probe，docs = 厂商官方文档）：
 * - grok-4.6（xai, responses）：reasoning [default,low,medium,high] live 通过（B/C；
 *   D continuation 空文本两次，待跟进，不阻塞档位声明）；vision=true + JPEG/PNG（xAI 官方 docs）
 * - hy4-preview（tencent 混元, chat）：与 Hy3 同协议族；发布报道无 vision 声明 → vision 不开
 * - glm-5.3-flash（zai, chat）：vision=true + JPEG/PNG/WEBP（智谱官方：原生多模态）
 * - qwen3.8-flash（qwen, messages）：vision=true + JPEG/PNG/WEBP（阿里官方：图文视频输入）
 * - qwen3.7-plus（qwen, messages）：同官方表确认 vision，顺手补上（此前保守 false）
 * - minimax-m3（minimax, messages）：vision=true + JPEG/PNG/WEBP（MiniMax 官方：原生多模态）
 * - longcat-2.0（longcat 美团, chat）：LongCat 官方文档兼容 OpenAI Chat Completions；
 *   2.0 为纯语言 coding 模型（视觉属 LongCat-Next/Omni 线）→ vision 不开
 * - muse-spark-1.3-contributor（meta, responses）：reasoning [default,minimal,low,medium,high,xhigh]
 *   live 通过（max 无输出，不声明；high 以上 hungry， trivial prompt 约 450+ reasoning tokens）；
 *   vision PNG/JPEG/WEBP 均无识别 → vision 不开
 * - deepseek-v4-flash：官方确认 vision 属独立 -vision-exp 模型 → 保持 false
 */
export const OPENCODE_MODELS: AIModelDefinition[] = [
  // ---- OpenAI Chat Completions（官方 endpoint：/v1/chat/completions）----
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
  { id: "kimi-k2.5", name: "Kimi K2.5", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-flash", name: "DeepSeek Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // deepseek-v4-flash-vision-exp：官方确认 vision 属该独立模型（此前 flash 本体保持 false）
  { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "mimo-v2.5", name: "MiMo V2.5", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "mimo-v2-pro", name: "MiMo V2 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "mimo-v2-omni", name: "MiMo V2 Omni", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "hy3", name: "Hy3", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "hy3-preview", name: "Hy3 Preview", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "hy4-preview", name: "Hy4 preview", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "glm-5.3", name: "GLM 5.3", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.2", name: "GLM 5.2", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5.1", name: "GLM 5.1", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "glm-5", name: "GLM 5", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "longcat-2.0", name: "LongCat 2.0", provider: "opencode-go", vendor: "longcat", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // ---- OpenAI Responses（官方 endpoint：/v1/responses → @ai-sdk/openai）----
  // Phase 3.1 正式接入。保守能力声明：vision/fileParts 未经 OpenCode Go proxy 实测不开。
  // grok-4.5：同 xai responses 协议族；reasoning 未经 live 验证，不声明
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "opencode-go",
    vendor: "xai",
    transport: "openai-responses",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    provider: "opencode-go",
    vendor: "xai",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png"],
      // 2026-09-03 live：reasoning low/medium/high outbound 回显 + 文本通过（Smoke B/C）；
      // 官方边界沿用 4.5（low/medium/high，默认 high，不能关闭）+ forceReasoning。
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
  {
    id: "muse-spark-1.3-contributor",
    name: "Muse Spark 1.3",
    provider: "opencode-go",
    vendor: "meta",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      fileParts: false,
      // 2026-09-03 live：minimal/low/medium/high/xhigh outbound 回显 + 文本通过；
      // max 无输出（NoOutputGeneratedError），不声明；high 以上 hungry（trivial prompt 约 450+ reasoning tokens）；
      // vision PNG/JPEG/WEBP 均无识别，不开。
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "minimal", "low", "medium", "high", "xhigh"],
        mechanism: "openai-responses-effort",
      },
    },
  },
  // muse-spark-1.2-contributor：曾下架后回归远端列表；同 meta responses 协议族，
  // reasoning/vision 均未经 live 验证，不声明（保守能力）
  {
    id: "muse-spark-1.2-contributor",
    name: "Muse Spark 1.2",
    provider: "opencode-go",
    vendor: "meta",
    transport: "openai-responses",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
  // ---- Anthropic Messages（官方 endpoint：/v1/messages）----
  // V1 保守能力声明：streaming + tools 为强要求；vision/fileParts 未经实测不开
  { id: "minimax-m3", name: "MiniMax M3", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "minimax-m2.7", name: "MiniMax M2.7", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "minimax-m2.5", name: "MiniMax M2.5", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.6-plus", name: "Qwen3.6 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  { id: "qwen3.5-plus", name: "Qwen3.5 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
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

/**
 * OpenCode Go 路由会话头（2026-09-05 起强制；缺失 → 400 MissingSessionID）。
 * 用途是同一会话请求的 provider 亲和与 prompt 缓存：同会话稳定、跨会话/用户隔离、
 * 不透明（任意字符串均可）。凡是发往 OPENCODE_BASE_URL 的模型调用都必须携带，
 * 与 transport（chat / responses / messages）无关。
 */
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

/** 无依赖 53 位哈希（cyrb53）：Node / 浏览器 / Edge 均可跑，不引入 node:crypto（本模块被客户端 registry 同包引用） */
function hash53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * 解析本次调用的 x-opencode-session 值：
 * - 调用方显式会话 id 优先（同会话稳定；去除空白并截断 128 字符）；
 * - 否则由 API Key 稳定派生（同 key 稳定、跨 key 隔离；只发送哈希，绝不发送 key 本身）。
 */
export function resolveOpenCodeGoSessionId(input: { sessionId?: string; apiKey: string }): string {
  const explicit = (input.sessionId ?? "").trim().replace(/\s+/g, "-").slice(0, 128);
  if (explicit) return explicit;
  return `classflow-${hash53(`classflow-opencode-go:${input.apiKey}`).toString(16)}`;
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
