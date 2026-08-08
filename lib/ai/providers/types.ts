/** AI Provider 类型定义（唯一来源） */

export type AIProviderId = "opencode-go" | "deepseek" | "custom-openai";

/** 传输协议：Task 1 真正实现 openai-chat；其余为后续扩展预留 */
export type AITransport = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface AIModelDefinition {
  id: string;
  /** 展示名（短名称，如 "V4 Flash"），不暴露 provider 全名 */
  name: string;
  provider: AIProviderId;
  transport: AITransport;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    vision: boolean;
    fileParts: boolean;
  };
}

/** Provider 连接配置（Server Route 使用） */
export interface AIProviderConfig {
  /** OpenAI Chat Completions base URL（不含 /chat/completions 后缀） */
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
}

/** AI 服务设置（持久化于独立 storage，不含 API Key） */
export interface AISettings {
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  custom: AICustomConfig;
}
