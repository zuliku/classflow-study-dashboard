import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * OpenCode Go 官方模型注册表（Task 10 + Phase 3.0/3.1）。
 *
 * 2026-10-29 按官方 Go 模型表（/docs/go）与远端 /v1/models 全量同步为 28 款非免费模型：
 * - 官方 30 款中排除 2 款免费模型（beam-free / iceman-contributor-free，免费额度与付费
 *   Provider 语义不同，不进入选择器）；
 * - 移除已不在官方列表的 grok-4.6 / mimo-v2-omni / minimax-m2.7；
 * - 新增 kimi-k3.1-pro / minimax-m3.1-flash / gemini-4-argon / claude-haiku-5-5 /
 *   step-5-preview / deepseek-v4-pro / glm-5.2 / muse-spark-1.2-contributor。
 *
 * source-of-truth 规则（不变）：
 * - /v1/models（远端）= availability source（「当前是否可用」）
 * - 官方 endpoint 表 + 本 verified registry = transport / vendor / capabilities / 展示名 source
 * 本列表是 /models 无法获取时的 fallback，也是远端模型 transport 的唯一来源
 * （远端 /models 只返回 id，不返回 transport；未知模型一律跳过，绝不猜测协议）。
 *
 * transport 来自官方 endpoint 表：
 * - openai-responses：Grok 4.7 / GPT 6 Luna / GPT 5.6 Luna / Muse Spark 1.2 / 1.3
 * - anthropic-messages：Claude Haiku 5.5 / MiniMax M3 / Qwen3.7 Plus / Qwen3.8 Flash / Max
 * - openai-chat：其余（Kimi / DeepSeek / GLM / MiMo / Hy / LongCat / Step / MiniMax M3.1 Flash）
 * - Gemini 4 Argon 官方原生端点是 Google（@ai-sdk/google，未安装）。OpenCode 文档明确
 *   「每个文本模型也可经其他 API 翻译调用」→ 走已验证的 openai-chat 翻译层，不新增
 *   未安装的 Google transport（无法 live 验证，不发明协议）。
 *
 * 能力声明规则：
 * - 已有 live/官方文档证据的模型保留原声明（不因同步回退）；
 * - 新模型的 reasoning 档位以官方 Go model variants 为准（none 表示关闭，不进入档位）；
 * - 新模型 vision 仅在厂商/家族有明确多模态证据时开启，否则保守关闭（绝不按名字猜）。
 *
 * 历史验证要点：
 * - kimi-k3 / mimo-v2.5：Phase 3.3B live（PNG/JPEG/WEBP 颜色识别通过）
 * - grok-4.7：2026-09 live（text / tool / PNG-JPEG-WEBP / reasoning high 通过）
 * - muse-spark-1.2：live（responses vision + reasoning minimal..xhigh；chat vision 400）
 * - gpt-5.6-luna / gpt-6-luna：OpenAI 官方 reasoning.effort none..max + 文图输入
 * - deepseek-v4.1-flash：DeepSeek 官方 vision + thinking low/high/max
 * - glm-5.3 / glm-5.3-flash：智谱官方 text-only（5.3）/ 原生多模态（5.3-flash）+ effort low/high/max
 * - qwen3.8-max：阿里云百炼图像/视频理解 + reasoning low/medium/xhigh（anthropic-effort）
 * - minimax-m3 / kimi-k2.7-code / qwen3.8-flash / qwen3.7-plus：官方多模态证据 → vision 开
 * - longcat-2.0：纯语言 coding 模型 → vision 不开
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
    // Kimi 官方 quickstart：Kimi K3 为 1M-token context window
    contextWindowTokens: 1_000_000,
  },
  // 2026-10-29 官方 Go 新增：Kimi K3.1 Pro（同 Kimi 多模态家族 → 文/图/视频输入；
  // variants low/high/max，无 medium）
  {
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    provider: "opencode-go",
    vendor: "kimi",
    transport: "openai-chat",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "high", "max"],
        mechanism: "effort",
      },
    },
  },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "opencode-go", vendor: "kimi", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] }, contextWindowTokens: 262_144 },
  // DeepSeek 官方 Models & Pricing + Thinking Mode：DeepSeek-V4.1-Flash 支持 Vision（PNG/JPEG/WEBP）；
  // thinking 默认开启，reasoning_effort 支持 low/high/max（无 medium）→ 走 "effort" 直通
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "high", "max"], mechanism: "effort" } }, contextWindowTokens: 1_000_000 },
  // DeepSeek V4 Pro：官方 variants high/max（无 low/medium）；纯文本推理模型，vision 不开
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "high", "max"], mechanism: "effort" } } },
  { id: "mimo-v2.5", name: "MiMo V2.5", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
  { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "high"], mechanism: "effort" } } },
  // 小米官方（MiMo V2.6 系列同协议族）：Flash 为原生全模态（文本/图像/视频/音频理解）+ 1M context；
  // effort 参数无官方证据 → 不声明 reasoning（保守）
  { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] }, contextWindowTokens: 1_000_000 },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", provider: "opencode-go", vendor: "mimo", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // 2026-10-29 官方 Go variants：hy3 none/low/high；hy4-preview none/high
  { id: "hy3", name: "Hy3", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "low", "high"], mechanism: "effort" } } },
  { id: "hy4-preview", name: "Hy4 preview", provider: "opencode-go", vendor: "tencent", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "high"], mechanism: "effort" } } },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "high", "max"], mechanism: "effort" } }, contextWindowTokens: 1_000_000 },
  // 智谱官方 GLM-5.3 文档：text-only（vision 不开）；thinking 常开不可关，
  // reasoning_effort 支持 low/high/max（默认 max，无 medium）
  { id: "glm-5.3", name: "GLM 5.3", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "low", "high", "max"], mechanism: "effort" } }, contextWindowTokens: 1_000_000 },
  // 2026-10-29 官方 Go 新增：GLM-5.2（text-only；variants high/max）
  { id: "glm-5.2", name: "GLM 5.2", provider: "opencode-go", vendor: "zai", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "high", "max"], mechanism: "effort" } } },
  { id: "longcat-2.0", name: "LongCat 2.0", provider: "opencode-go", vendor: "longcat", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
  // 2026-10-29 官方 Go 新增：Step 5 Preview（variants low/medium/high；无多模态证据 → vision 不开）
  { id: "step-5-preview", name: "Step 5 Preview", provider: "opencode-go", vendor: "stepfun", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false, reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "high"], mechanism: "effort" } } },
  // Gemini 4 Argon：官方原生端点 @ai-sdk/google（未安装）；OpenCode 文档明确文本模型可经其他
  // API 翻译调用 → 走已验证的 openai-chat。Gemini 原生多模态（图像输入）→ vision 开。
  { id: "gemini-4-argon", name: "Gemini 4 Argon", provider: "opencode-go", vendor: "google", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "high"], mechanism: "effort" } } },
  // MiniMax M3.1 Flash：官方 chat endpoint（与 M3 的 Messages 不同）；原生多模态 →
  // vision 开；variants low/medium/high/xhigh/max
  { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash", provider: "opencode-go", vendor: "minimax", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"], mechanism: "effort" } } },
  // ---- OpenAI Responses（官方 endpoint：/v1/responses → @ai-sdk/openai）----
  // Phase 3.1 正式接入。保守能力声明：vision/fileParts 未经 OpenCode Go proxy 实测不开。
  // grok-4.5 等旧版已按去旧留新移出（同 xai responses 协议族；如回归远端列表再收录）
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    provider: "opencode-go",
    vendor: "xai",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      // 2026-09 live probe：text / tool call / PNG-JPEG-WEBP 颜色识别 / reasoning high 全部通过
      // （reasoning effort 经 openai Responses reasoning.effort 直通；官方 Go variants 另含 xhigh）
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "medium", "high", "xhigh"],
        mechanism: "openai-responses-effort",
      },
    },
    // xAI 官方 Models & Pricing：grok-4.7 context = 500k
    contextWindowTokens: 500_000,
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
      // OpenAI 官方 images-vision 文档：GPT-5.6 Luna 属 vision 模型（PNG/JPEG/WEBP/GIF 输入）
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      // Phase 3.2A：GPT 5.6 Luna 是首个启用 reasoning 的 OpenCode Go 模型。
      // mechanism=openai-responses-effort（providerOptions.openai.reasoningEffort → reasoning.effort）。
      // OpenAI 官方 reasoning 文档：reasoning.effort 支持 none/low/medium/high/xhigh/max
      // （none = 关闭推理，不进入档位；默认 medium）。
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"],
        mechanism: "openai-responses-effort",
      },
    },
    // OpenAI 官方模型页：gpt-5.6-luna 1,050,000 context window
    contextWindowTokens: 1_050_000,
  },
  {
    id: "gpt-6-luna",
    name: "GPT 6 Luna",
    provider: "opencode-go",
    vendor: "openai",
    transport: "openai-responses",
    capabilities: {
      streaming: true,
      tools: true,
      // OpenAI 官方模型页（2026-09-22 发布）：文图输入 / 文本输出，函数调用与结构化输出；
      // 推理配工具走 Responses API（Chat Completions 仅 reasoning_effort=none 才接 function calling）
      vision: true,
      fileParts: false,
      visionMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      // OpenAI 官方 reasoning 文档：reasoning.effort 支持 none/low/medium/high/xhigh/max
      // （默认 medium；与 5.6-luna 同档），mechanism 沿用 openai-responses-effort
      reasoning: {
        adjustable: true,
        supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"],
        mechanism: "openai-responses-effort",
      },
    },
    // OpenAI 官方模型页：gpt-6-luna 1,050,000 context window（922K max input / 128K max output）
    contextWindowTokens: 1_050_000,
  },
  // 2026-10-29 官方 Go 回归：Muse Spark 1.2 Contributor。1.2 时代 live 已验证 responses
  // vision（PNG/JPEG/WEBP 颜色识别）与 reasoning minimal..xhigh；沿用同家族 contributor 端点。
  {
    id: "muse-spark-1.2-contributor",
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
  // ---- Anthropic Messages（官方 endpoint：/v1/messages）----
  // V1 保守能力声明：streaming + tools 为强要求；vision/fileParts 未经实测不开
  { id: "minimax-m3", name: "MiniMax M3", provider: "opencode-go", vendor: "minimax", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] }, contextWindowTokens: 1_000_000 },
  // 2026-10-29 官方 Go 新增：Claude Haiku 5.5（Anthropic Messages；vision 模型；
  // variants none/low/medium/high/xhigh/max → anthropic thinking budget 阶梯，none 不进入档位）
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "opencode-go", vendor: "anthropic", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"], mechanism: "anthropic-effort" } } },
  // Qwen3.7 Plus variants none/high/max；Qwen3.8 Flash variants none/low/medium/xhigh
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "high", "max"], mechanism: "anthropic-effort" } }, contextWindowTokens: 1_000_000 },
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "xhigh"], mechanism: "anthropic-effort" } }, contextWindowTokens: 1_000_000 },
  // 阿里云百炼官方：qwen3.8-max 同时列于「文本生成」与「图像/视频理解」→ vision 开；
  // 千问AI平台官方：reasoning_effort 档位 low/medium/xhigh（默认 xhigh）→ 经
  // anthropic-effort（thinking budget 上限阶梯，见 providerOptions）放开
  { id: "qwen3.8-max", name: "Qwen3.8 Max", provider: "opencode-go", vendor: "qwen", transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"], reasoning: { adjustable: true, supportedEfforts: ["default", "low", "medium", "xhigh"], mechanism: "anthropic-effort" } }, contextWindowTokens: 1_000_000 },
];

export const OPENCODE_DEFAULT_MODEL = "deepseek-v4.1-flash";

/**
 * 选择器精选列表（Kiro 模型选择器展示的唯一来源；顺序 = 展示顺序）。
 *
 * 产品策略（2026-10-29 官方目录同步）：**少而精（≤10）** —— 新 / 强优先，覆盖主要厂商：
 * - 旗舰推理：GPT 6 Luna（OpenAI）/ Claude Haiku 5.5（Anthropic，新）/ Gemini 4 Argon
 *   （Google，新）/ Kimi K3.1 Pro（新）/ GPT 5.6 Luna / Grok 4.7（xAI）
 * - 多模态 + 快模型：MiniMax M3.1 Flash（新）/ DeepSeek V4.1 Flash（默认）
 * - 旗舰综合：Qwen3.8 Max / GLM 5.3 Flash
 * 未入选的已验证模型仍保留在 OPENCODE_MODELS（transport / 历史选择可继续解析），只是不在选择器中展示。
 */
export const OPENCODE_SELECTOR_MODEL_IDS: readonly string[] = [
  "gpt-6-luna",
  "claude-haiku-5-5",
  "gemini-4-argon",
  "kimi-k3.1-pro",
  "gpt-5.6-luna",
  "grok-4.7",
  "minimax-m3.1-flash",
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "glm-5.3-flash",
];

/** 精选模型（按精选顺序；过滤掉注册表缺失项，fail closed） */
export function getOpenCodeSelectorModels(): AIModelDefinition[] {
  const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
  return OPENCODE_SELECTOR_MODEL_IDS.map((id) => byId.get(id)).filter(
    (m): m is AIModelDefinition => !!m
  );
}

/** 远端模型是否属于精选列表 */
export function isOpenCodeSelectorModelId(id: string): boolean {
  return OPENCODE_SELECTOR_MODEL_IDS.includes(id);
}

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
