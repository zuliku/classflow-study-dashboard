import { z } from "zod";

export interface GmailChannelConfigBase {
  id: string;
  channel: "gmail";
  enabled: boolean;
  displayName: string;
  emailAddress: string;
  credentialRef: string;
  syncIntervalSeconds: 60;
}

export const gmailChannelConfigSchema = z.object({
  id: z.string().min(1).max(64),
  channel: z.literal("gmail"),
  enabled: z.boolean(),
  displayName: z.string().min(1).max(64),
  emailAddress: z.string().email().max(128),
  credentialRef: z.string().min(1).max(128),
  syncIntervalSeconds: z.literal(60),
});

export function validateGmailChannelConfig(input: unknown): { ok: true; config: GmailChannelConfigBase } | { ok: false; code: string; message: string } {
  const parsed = gmailChannelConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "EMAIL_INVALID_CONFIG", message: parsed.error.issues[0]?.message ?? "Invalid Gmail config" };
  }
  if (!parsed.data.credentialRef.startsWith("cred_")) {
    return { ok: false, code: "EMAIL_INVALID_CONFIG", message: "credentialRef must start with cred_" };
  }
  return { ok: true, config: parsed.data };
}

export interface QQMailChannelConfigBase {
  id: string;
  channel: "qq-mail";
  enabled: boolean;
  displayName: string;
  emailAddress: string;
  credentialRef: string;
  syncIntervalSeconds: 60;
}

export const qqMailChannelConfigSchema = z.object({
  id: z.string().min(1).max(64),
  channel: z.literal("qq-mail"),
  enabled: z.boolean(),
  displayName: z.string().min(1).max(64),
  emailAddress: z.string().email().max(128),
  credentialRef: z.string().min(1).max(128),
  syncIntervalSeconds: z.literal(60),
});

export function validateQQMailChannelConfig(input: unknown): { ok: true; config: QQMailChannelConfigBase } | { ok: false; code: string; message: string } {
  const parsed = qqMailChannelConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "EMAIL_INVALID_CONFIG", message: parsed.error.issues[0]?.message ?? "Invalid QQ Mail config" };
  }
  return { ok: true, config: parsed.data };
}
