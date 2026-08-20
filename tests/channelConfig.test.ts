import { describe, it, expect } from "vitest";
import { validateQQChannelConfig, createQQChannelConfig } from "@/src/main/channels/qq/config";

describe("channelConfig", () => {
  it("valid config passes", () => {
    const cfg = createQQChannelConfig({ displayName: "Test Bot", appId: "123456", credentialRef: "cred_abc123" });
    const res = validateQQChannelConfig(cfg);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.appId).toBe("123456");
  });

  it("missing appId fails", () => {
    const res = validateQQChannelConfig({ id: "qq_1", enabled: true, displayName: "t", appId: "", credentialRef: "cred_1", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true });
    expect(res.ok).toBe(false);
  });

  it("non-numeric appId fails", () => {
    const res = validateQQChannelConfig({ id: "qq_1", enabled: true, displayName: "t", appId: "abc", credentialRef: "cred_1", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true });
    expect(res.ok).toBe(false);
  });

  it("credentialRef must start with cred_", () => {
    const res = validateQQChannelConfig({ id: "qq_1", enabled: true, displayName: "t", appId: "123", credentialRef: "bad_1", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true });
    expect(res.ok).toBe(false);
  });

  it("create helper fills defaults", () => {
    const cfg = createQQChannelConfig({ displayName: "Bot", appId: "999", credentialRef: "cred_xyz" });
    expect(cfg.requireMentionInGroup).toBe(true);
    expect(cfg.receiveDirectMessages).toBe(true);
    expect(cfg.receiveGroupMessages).toBe(true);
    expect(cfg.allowedUsers).toEqual([]);
    expect(cfg.allowedGroups).toEqual([]);
    expect(cfg.enabled).toBe(true);
  });

  it("config does not contain appSecret", () => {
    const cfg = createQQChannelConfig({ displayName: "Bot", appId: "123", credentialRef: "cred_123" });
    expect((cfg as Record<string, unknown>).appSecret).toBeUndefined();
    expect((cfg as Record<string, unknown>).secret).toBeUndefined();
    const json = JSON.stringify(cfg);
    expect(json).not.toContain("appSecret");
    expect(json).toContain("credentialRef");
  });
});
