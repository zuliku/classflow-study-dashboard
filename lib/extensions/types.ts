/**
 * Extensions Domain Model — Task 04
 * 三类扩展：skill / mcp / channel；提供方与凭据隔离
 */

export type ExtensionKind = "skill" | "mcp" | "channel";

export type ExtensionStatus =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type ChannelProvider = "qq-bot" | "gmail" | "qq-mail";

export type ExtensionProviderId = ChannelProvider | string;

export interface ExtensionRecord {
  id: string;
  kind: ExtensionKind;
  providerId: ExtensionProviderId;
  name: string;
  description: string;
  status: ExtensionStatus;
  /** 永远只存引用，禁止存 secret/plaintext */
  credentialRef?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
}

/** Channel 专属的 Provider 元数据（registry 渲染用） */
export interface ChannelProviderMeta {
  id: ChannelProvider;
  kind: "channel";
  name: string;
  description: string;
  capabilities: string[];
}

export interface SkillProviderMeta {
  id: string;
  kind: "skill";
  name: string;
  description: string;
  capabilities: string[];
}

export interface McpProviderMeta {
  id: string;
  kind: "mcp";
  name: string;
  description: string;
  capabilities: string[];
}

export type ProviderMeta = ChannelProviderMeta | SkillProviderMeta | McpProviderMeta;

/** 仅允许存储 credentialRef，禁止明文 */
export type CredentialRef = string;

/** 创建扩展的输入（UI 层） */
export interface CreateExtensionInput {
  kind: ExtensionKind;
  providerId: ExtensionProviderId;
  name?: string;
  credentialRef?: CredentialRef;
}

/** 防止 secret 误入：运行时校验 */
export function isValidCredentialRef(ref: unknown): ref is CredentialRef {
  return typeof ref === "string" && ref.length > 0 && ref.length <= 256 && !ref.includes(" ");
}

/** 检测对象是否意外包含 secret 字段（persist 白名单校验用） */
export function containsSecretField(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const forbidden = ["secret", "accessToken", "refreshToken", "password", "apiKey", "token"];
  for (const key of forbidden) {
    if (key in o) return true;
  }
  // 递归检查首层扩展记录
  if (Array.isArray((o as { extensions?: unknown }).extensions)) {
    for (const ext of (o as { extensions: unknown[] }).extensions) {
      if (ext && typeof ext === "object") {
        for (const k of forbidden) {
          if (k in (ext as Record<string, unknown>)) return true;
        }
      }
    }
  }
  return false;
}
