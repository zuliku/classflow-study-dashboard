import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/** DeepSeek 官方模型（Task 1 正式支持；默认 V4 Flash：速度/价格更适合日常 Kiro Chat） */
export const DEEPSEEK_MODELS: AIModelDefinition[] = [
  {
    id: "deepseek-v4-flash",
    name: "V4 Flash",
    provider: "deepseek",
    vendor: "deepseek",
    transport: "openai-chat",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
  {
    id: "deepseek-v4-pro",
    name: "V4 Pro",
    provider: "deepseek",
    vendor: "deepseek",
    transport: "openai-chat",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
];

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

export function getDeepSeekConfig(apiKey: string): AIProviderConfig {
  return { baseURL: AI.DEEPSEEK_BASE_URL, apiKey };
}

/**
 * DeepSeek 兼容层（resolver 对 provider === "deepseek" 的 openai-chat 注入）。
 *
 * 1. V4 默认 Thinking Mode = on，与 tool calling 组合不稳定 → 显式禁用 thinking；
 * 2. DeepSeek 对 tool 参数 schema 的校验比 OpenAI 严格：根节点必须 type:"object"。
 *    z.discriminatedUnion 等 zod 结构经 AI SDK 转换后根节点无 type，会被 400 拒绝
 *    （实测 create_reminder 曾触发 "schema must be a JSON Schema of 'type: object'"）。
 *    这里只对「缺少根 type 且明显是 object 结构」的 schema 补 type:"object"，
 *    不改变任何字段/校验语义，也不触碰工具定义本身（客户端 zod 校验不受影响）。
 *
 * 只作用于 DeepSeek 官方 transport；不影响 OpenCode Go / Custom Provider / Anthropic。
 */

function ensureObjectRootSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  if (s.type === "object") return schema;
  // 只有明确是对象结构（有 properties 或成员分支）才补根 type，避免误改标量/枚举
  const looksLikeObject = s.properties !== undefined || Array.isArray(s.anyOf) || Array.isArray(s.oneOf);
  if (!looksLikeObject) return schema;
  return { ...s, type: "object" };
}

export function deepSeekTransformRequestBody(body: Record<string, unknown>): Record<string, unknown> {
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
  return {
    ...body,
    tools,
    thinking: { type: "disabled" },
  };
}
