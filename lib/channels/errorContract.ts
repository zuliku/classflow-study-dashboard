/**
 * Shared Channel Error Contract — pure data / pure functions
 * Renderer 与 Main 共享，不依赖 electron / ipc / fs
 */

export type ChannelErrorCode =
  | "QQ_AUTH_FAILED"
  | "QQ_NETWORK_ERROR"
  | "QQ_GATEWAY_DISCONNECTED"
  | "QQ_RATE_LIMITED"
  | "QQ_INVALID_CONFIG"
  | "QQ_SDK_ERROR"
  | "CHANNEL_NOT_FOUND"
  | "CHANNEL_ALREADY_EXISTS"
  | "CHANNEL_DISABLED"
  | "INVALID_INPUT"
  | "PERSISTENCE_FAILED"
  | "GMAIL_AUTH_FAILED"
  | "GMAIL_OAUTH_CONFIG_MISSING"
  | "GMAIL_OAUTH_STATE_MISMATCH"
  | "GMAIL_OAUTH_TIMEOUT"
  | "GMAIL_OAUTH_DENIED"
  | "QQ_MAIL_AUTH_FAILED"
  | "EMAIL_INVALID_CONFIG"
  | "EMAIL_SYNC_FAILED"
  | "EMAIL_REPLY_CONTEXT_INVALID"
  | "EMAIL_SEND_REJECTED"
  | "EMAIL_SEND_UNCERTAIN"
  | "CHANNEL_RUNTIME_ERROR";

export const CHANNEL_ERROR_CODES: readonly ChannelErrorCode[] = [
  "QQ_AUTH_FAILED",
  "QQ_NETWORK_ERROR",
  "QQ_GATEWAY_DISCONNECTED",
  "QQ_RATE_LIMITED",
  "QQ_INVALID_CONFIG",
  "QQ_SDK_ERROR",
  "CHANNEL_NOT_FOUND",
  "CHANNEL_ALREADY_EXISTS",
  "CHANNEL_DISABLED",
  "INVALID_INPUT",
  "PERSISTENCE_FAILED",
  "GMAIL_AUTH_FAILED",
  "GMAIL_OAUTH_CONFIG_MISSING",
  "GMAIL_OAUTH_STATE_MISMATCH",
  "GMAIL_OAUTH_TIMEOUT",
  "GMAIL_OAUTH_DENIED",
  "QQ_MAIL_AUTH_FAILED",
  "EMAIL_INVALID_CONFIG",
  "EMAIL_SYNC_FAILED",
  "EMAIL_REPLY_CONTEXT_INVALID",
  "EMAIL_SEND_REJECTED",
  "EMAIL_SEND_UNCERTAIN",
  "CHANNEL_RUNTIME_ERROR",
] as const;

const CODE_SET = new Set<string>(CHANNEL_ERROR_CODES as unknown as string[]);

export function isChannelErrorCode(value: unknown): value is ChannelErrorCode {
  return typeof value === "string" && CODE_SET.has(value);
}

const USER_MESSAGES: Record<ChannelErrorCode, string> = {
  QQ_AUTH_FAILED: "QQ 机器人认证失败，请检查 App ID / Secret",
  QQ_NETWORK_ERROR: "网络连接失败，请稍后重试",
  QQ_GATEWAY_DISCONNECTED: "网关连接已断开，正在重连",
  QQ_RATE_LIMITED: "请求过于频繁，请稍后重试",
  QQ_INVALID_CONFIG: "QQ 配置不完整或格式错误",
  QQ_SDK_ERROR: "QQ 服务异常",
  CHANNEL_NOT_FOUND: "未找到消息渠道",
  CHANNEL_ALREADY_EXISTS: "该渠道已存在",
  CHANNEL_DISABLED: "该渠道已停用",
  INVALID_INPUT: "输入参数不合法",
  PERSISTENCE_FAILED: "保存配置失败",
  GMAIL_AUTH_FAILED: "Gmail 认证失败",
  GMAIL_OAUTH_CONFIG_MISSING: "Gmail 授权服务暂不可用，请稍后重试",
  GMAIL_OAUTH_STATE_MISMATCH: "Gmail 登录验证失败，请重新连接",
  GMAIL_OAUTH_TIMEOUT: "授权超时，请重试",
  GMAIL_OAUTH_DENIED: "已拒绝授权",
  QQ_MAIL_AUTH_FAILED: "QQ 邮箱认证失败，请检查邮箱地址/授权码",
  EMAIL_INVALID_CONFIG: "Email 配置错误",
  EMAIL_SYNC_FAILED: "邮件同步失败",
  EMAIL_REPLY_CONTEXT_INVALID: "邮件回复上下文无效",
  EMAIL_SEND_REJECTED: "邮件发送被拒绝",
  EMAIL_SEND_UNCERTAIN: "邮件发送结果不确定，请检查 Gmail",
  CHANNEL_RUNTIME_ERROR: "渠道运行错误",
};

export function userMessageForChannelCode(code: ChannelErrorCode): string {
  return USER_MESSAGES[code] ?? "操作失败，请稍后重试";
}

/**
 * 将任意错误形态解析为正式用户提示
 * 优先使用 error.code，若为已知 ChannelErrorCode 则映射中文，否则 fallback
 */
export function resolveChannelUserMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试"
): string {
  if (error == null) return fallback;
  // direct code string
  if (typeof error === "string" && isChannelErrorCode(error)) {
    return userMessageForChannelCode(error);
  }
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    // { code: "QQ_..." }
    if (typeof obj.code === "string" && isChannelErrorCode(obj.code)) {
      return userMessageForChannelCode(obj.code as ChannelErrorCode);
    }
    // { error: "CODE" } — testChannel shape
    if (typeof obj.error === "string" && isChannelErrorCode(obj.error)) {
      return userMessageForChannelCode(obj.error as ChannelErrorCode);
    }
    // nested { error: { code: ... } }
    if (obj.error != null && typeof obj.error === "object") {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.code === "string" && isChannelErrorCode(nested.code)) {
        return userMessageForChannelCode(nested.code as ChannelErrorCode);
      }
    }
    // message 可能是 code 字符串
    if (typeof obj.message === "string" && isChannelErrorCode(obj.message)) {
      return userMessageForChannelCode(obj.message as ChannelErrorCode);
    }
  }
  return fallback;
}
