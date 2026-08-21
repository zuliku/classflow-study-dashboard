/**
 * Channel Error Model — Task 13 unified error codes
 * User UI: short Chinese message. Dev log: code + state + operation (no secrets)
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

export class ChannelError extends Error {
  code: ChannelErrorCode;
  details?: unknown;
  constructor(code: ChannelErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export function channelErrorToIpc(e: unknown): never {
  if (e instanceof ChannelError) {
    throw new Error(JSON.stringify({ code: e.code, message: e.message }));
  }
  const raw = e instanceof Error ? e.message : String(e);
  // Try to preserve JSON code if already stringified
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    if (parsed.code) throw new Error(JSON.stringify({ code: parsed.code, message: parsed.message ?? raw }));
  } catch {}
  throw new Error(JSON.stringify({ code: "QQ_SDK_ERROR", message: raw }));
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
  GMAIL_OAUTH_CONFIG_MISSING: "Gmail OAuth 未配置",
  GMAIL_OAUTH_STATE_MISMATCH: "OAuth 状态不匹配",
  GMAIL_OAUTH_TIMEOUT: "OAuth 超时",
  GMAIL_OAUTH_DENIED: "OAuth 已拒绝",
  QQ_MAIL_AUTH_FAILED: "QQ 邮箱认证失败，请检查邮箱地址/授权码",
  EMAIL_INVALID_CONFIG: "Email 配置错误",
  EMAIL_SYNC_FAILED: "邮件同步失败",
  EMAIL_REPLY_CONTEXT_INVALID: "邮件回复上下文无效",
  EMAIL_SEND_REJECTED: "邮件发送被拒绝",
  EMAIL_SEND_UNCERTAIN: "邮件发送结果不确定，请检查 Gmail",
  CHANNEL_RUNTIME_ERROR: "渠道运行错误",
};

export function userMessageForCode(code: ChannelErrorCode): string {
  return USER_MESSAGES[code] ?? "未知错误";
}
