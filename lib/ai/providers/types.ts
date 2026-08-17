/** AI Provider 类型定义（唯一来源） */

import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";

export type AIProviderId = "opencode-go" | "deepseek" | "custom-openai";

/** 模型厂商（Logo 与展示名来源；与「服务商」是不同维度） */
export type AIModelVendor =
  | "xai"
  | "zai"
  | "kimi"
  | "deepseek"
  | "mimo"
  | "tencent"
  | "minimax"
  | "qwen"
  | "openai";

/** 厂商元数据（Logo 本地静态资源，唯一来源） */
export interface AIModelVendorMeta {
  id: AIModelVendor;
  /** 展示名（alt/title 用） */
  name: string;
  /** 本地 Logo 路径 */
  logo: string;
}

/** 传输协议：三种 transport 均有 Runtime adapter（openai-chat / openai-responses / anthropic-messages） */
export type AITransport = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface AIModelDefinition {
  id: string;
  /** 展示名（短名称，如 "V4 Flash"），不暴露 provider 全名 */
  name: string;
  provider: AIProviderId;
  /** 模型厂商（决定 Logo）；未知厂商为 null → UI 使用 neutral fallback */
  vendor: AIModelVendor | null;
  transport: AITransport;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    vision: boolean;
    fileParts: boolean;
    pdf?: boolean;
    /**
     * 该模型 vision 明确支持的图片 MIME 白名单（如 Grok: JPEG/PNG）。
     * undefined = 无额外 ClassFlow MIME 限制，保持历史行为；绝不从 vendor/model 名推断。
     */
    visionMimeTypes?: string[];
    /** 显式声明的推理可调能力；缺失 = fixed（绝不由模型名/厂商/transport 推断） */
    reasoning?: ReasoningCapability;
  };
  /** 可靠的模型 Context 覆盖（无可靠 metadata 时不设；Custom Provider 一律用 ClassFlow 默认预算） */
  contextBudget?: {
    maxInputTokens: number;
  };
}

/** Provider 连接配置（Server Route 使用） */
export interface AIProviderConfig {
  /** Provider API base URL，具体 endpoint 由 transport adapter 拼接 */
  baseURL: string;
  apiKey?: string;
  /** 仅 Custom：阻止自动跟随 redirect，防 SSRF 跳转 */
  noRedirect?: boolean;
}

/** Custom Provider 用户配置 */
export interface AICustomConfig {
  providerName: string;
  baseURL: string;
  model: string;
  /** 高级：用户明确声明兼容服务的能力（默认全 false，保守策略） */
  vision?: boolean;
  fileParts?: boolean;
  /** 高级：用户明确声明服务支持思考程度（reasoning effort）。只有 true 才允许映射。 */
  reasoningEffort?: boolean;
}

/** AI 服务设置（持久化于独立 storage，不含 API Key） */
export interface AISettings {
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  custom: AICustomConfig;
  /** Kiro 长期学习记忆开关（关闭不读不写，但保留已有记忆） */
  memoryEnabled: boolean;
  /**
   * 用户请求的推理投入（requested preference）：跨模型切换保留，不随模型变化重置。
   * 实际生效的是 effective（resolveEffectiveReasoningEffort 结合当前 capability 归一）；
   * 当前模型不支持 requested 时 effective 为 default，raw Store 值不需要改为 default。
   */
  reasoningEffort: KiroReasoningEffort;
}
