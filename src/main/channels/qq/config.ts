/**
 * QQ Channel Config — Task 13
 * AppSecret never enters config, only credentialRef. All persistence atomic.
 */

import { z } from "zod";

export interface QQChannelConfig {
  id: string;
  enabled: boolean;
  displayName: string;
  appId: string;
  credentialRef: string;
  requireMentionInGroup: boolean;
  allowedUsers: string[];
  allowedGroups: string[];
  receiveDirectMessages: boolean;
  receiveGroupMessages: boolean;
}

export const qqChannelConfigSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  displayName: z.string().min(1).max(64),
  appId: z.string().min(1).max(64),
  credentialRef: z.string().min(1).max(128),
  requireMentionInGroup: z.boolean(),
  allowedUsers: z.array(z.string().min(1).max(64)).max(100),
  allowedGroups: z.array(z.string().min(1).max(64)).max(100),
  receiveDirectMessages: z.boolean(),
  receiveGroupMessages: z.boolean(),
});

export function validateQQChannelConfig(input: unknown): { ok: true; config: QQChannelConfig } | { ok: false; code: string; message: string } {
  const parsed = qqChannelConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "QQ_INVALID_CONFIG", message: parsed.error.issues[0]?.message ?? "Invalid QQ config" };
  }
  // Additional: appId numeric check (QQ appId is digits)
  if (!/^\d+$/.test(parsed.data.appId)) {
    return { ok: false, code: "QQ_INVALID_CONFIG", message: "appId must be numeric" };
  }
  if (!parsed.data.credentialRef.startsWith("cred_")) {
    return { ok: false, code: "QQ_INVALID_CONFIG", message: "credentialRef must start with cred_" };
  }
  return { ok: true, config: parsed.data };
}

export function createQQChannelConfig(input: {
  displayName: string;
  appId: string;
  credentialRef: string;
  requireMentionInGroup?: boolean;
  allowedUsers?: string[];
  allowedGroups?: string[];
  receiveDirectMessages?: boolean;
  receiveGroupMessages?: boolean;
  id?: string;
  enabled?: boolean;
}): QQChannelConfig {
  return {
    id: input.id ?? `qq_${Math.random().toString(36).slice(2, 8)}`,
    enabled: input.enabled ?? true,
    displayName: input.displayName,
    appId: input.appId.trim(),
    credentialRef: input.credentialRef,
    requireMentionInGroup: input.requireMentionInGroup ?? true,
    allowedUsers: input.allowedUsers ?? [],
    allowedGroups: input.allowedGroups ?? [],
    receiveDirectMessages: input.receiveDirectMessages ?? true,
    receiveGroupMessages: input.receiveGroupMessages ?? true,
  };
}
