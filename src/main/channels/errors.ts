/**
 * Channel Error Model — Task 13 unified error codes
 * User UI: short Chinese message. Dev log: code + state + operation (no secrets)
 * Shared contract lives in lib/channels/errorContract.ts (pure, renderer-safe)
 */

import {
  type ChannelErrorCode as SharedChannelErrorCode,
  isChannelErrorCode,
  userMessageForChannelCode as sharedUserMessageForCode,
  resolveChannelUserMessage as sharedResolveChannelUserMessage,
  CHANNEL_ERROR_CODES,
} from "@/lib/channels/errorContract";

export type ChannelErrorCode = SharedChannelErrorCode;
export { isChannelErrorCode, CHANNEL_ERROR_CODES };

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

// 用户文案单一来源：lib/channels/errorContract.ts 的 USER_MESSAGES
//（Main 侧不再维护第二份 Record，防止两份映射漂移）

export function userMessageForCode(code: ChannelErrorCode): string {
  return sharedUserMessageForCode(code);
}

export function resolveChannelUserMessage(error: unknown, fallback?: string): string {
  return sharedResolveChannelUserMessage(error, fallback);
}
