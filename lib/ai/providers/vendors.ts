import { AIModelVendor, AIModelVendorMeta } from "@/lib/ai/providers/types";

/**
 * 模型厂商元数据（Logo / 名称）：模型选择器的唯一来源。
 * 与「服务商」（opencode-go / deepseek / custom-openai）是不同维度：
 * 同一厂商 Logo 供多个模型复用（如多个 DeepSeek 模型共用 DeepSeek Logo）。
 * Logo 全部为本地静态资源（public/ai-providers/），禁止 hotlink。
 */
export const AI_PROVIDER_META: Record<AIModelVendor, AIModelVendorMeta> = {
  xai: { id: "xai", name: "xAI", logo: "/ai-providers/xai.png" },
  zai: { id: "zai", name: "Z.ai", logo: "/ai-providers/zai.png" },
  kimi: { id: "kimi", name: "Moonshot AI · Kimi", logo: "/ai-providers/kimi.png" },
  deepseek: { id: "deepseek", name: "DeepSeek", logo: "/ai-providers/deepseek.png" },
  mimo: { id: "mimo", name: "Xiaomi · MiMo", logo: "/ai-providers/mimo.png" },
  tencent: { id: "tencent", name: "Tencent · Hunyuan", logo: "/ai-providers/tencent.png" },
  minimax: { id: "minimax", name: "MiniMax", logo: "/ai-providers/minimax.svg" },
  qwen: { id: "qwen", name: "Qwen", logo: "/ai-providers/qwen.svg" },
};

/** 未知厂商的统一 fallback（ProviderLogo 组件兜底） */
export const AI_PROVIDER_FALLBACK = {
  name: "AI 模型",
  logo: "",
} as const;

export function getVendorMeta(vendor: AIModelVendor | null | undefined): AIModelVendorMeta | typeof AI_PROVIDER_FALLBACK {
  if (vendor && AI_PROVIDER_META[vendor]) return AI_PROVIDER_META[vendor];
  return AI_PROVIDER_FALLBACK;
}
