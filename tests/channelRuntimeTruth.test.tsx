// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// Polyfills
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} } as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

import { ChannelSettings } from "@/components/settings/ChannelSettings";
import { useToastStore } from "@/store/useToastStore";
import { resolveChannelUserMessage } from "@/lib/channels/errorContract";

function setChannelsBridge(mock: unknown) {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    channels: mock,
    credentials: {
      create: async () => ({ credentialRef: "cred_test" }),
      replace: async () => {},
      delete: async () => {},
    },
  } as never;
}

function setNoBridge() {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    credentials: { create: async () => ({ credentialRef: "cred_test" }) },
  } as never;
}

describe("Channel Runtime Truth — ChannelSettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] } as never);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("CASE 1 list resolve [] => empty state, not error", async () => {
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByText("还没有消息渠道")).toBeTruthy());
    expect(screen.queryByText("暂时无法读取消息渠道")).toBeNull();
    expect(screen.queryByTestId("channel-error")).toBeNull();
    expect(screen.queryByTestId("channel-loading")).toBeNull();
  });

  it("CASE 2 list reject => error state with retry, not empty", async () => {
    setChannelsBridge({ list: vi.fn(async () => { throw { code: "CHANNEL_RUNTIME_ERROR", message: "fail" }; }), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-error")).toBeTruthy());
    expect(screen.getByText("暂时无法读取消息渠道")).toBeTruthy();
    expect(screen.getByTestId("channel-retry")).toBeTruthy();
    expect(screen.queryByText("还没有消息渠道")).toBeNull();
  });

  it("CASE 3 bridge unavailable => unavailable state", async () => {
    setNoBridge();
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-unavailable")).toBeTruthy());
    expect(screen.getByText("消息渠道管理在桌面环境中可用")).toBeTruthy();
    expect(screen.queryByText("还没有消息渠道")).toBeNull();
    expect(screen.queryByTestId("channel-error")).toBeNull();
  });

  it("CASE 4 first fail -> retry -> ready", async () => {
    const listMock = vi.fn(async () => { throw { code: "CHANNEL_RUNTIME_ERROR" }; });
    setChannelsBridge({ list: listMock, addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-error")).toBeTruthy());
    // now make next list succeed with empty
    listMock.mockResolvedValue({ channels: [] });
    fireEvent.click(screen.getByTestId("channel-retry"));
    await waitFor(() => expect(screen.getByText("还没有消息渠道")).toBeTruthy());
    expect(screen.queryByTestId("channel-error")).toBeNull();
  });

  it("loading state shows loading not empty", async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise<{ channels: unknown[] }>((r) => { resolve = r as never; });
    setChannelsBridge({ list: vi.fn(() => pending), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-loading")).toBeTruthy());
    expect(screen.queryByText("还没有消息渠道")).toBeNull();
    expect(screen.queryByTestId("channel-error")).toBeNull();
    resolve({ channels: [] });
    await waitFor(() => expect(screen.getByText("还没有消息渠道")).toBeTruthy());
  });

  it("CASE 5 health.lastError shows user message not raw code/message", async () => {
    const channel = {
      config: { id: "qq_1", channel: "qq-bot", displayName: "TestBot", appId: "123", credentialRef: "cred_1", enabled: true, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      health: { channel: "qq-bot", id: "qq_1", state: "error", lastError: { code: "QQ_NETWORK_ERROR", message: "socket ECONNRESET at 127.0.0.1" } },
    };
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [channel] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-card-qq_1")).toBeTruthy());
    const errEl = screen.getByTestId("channel-error-qq_1");
    expect(errEl.textContent).toBe("网络连接失败，请稍后重试");
    expect(errEl.textContent).not.toContain("QQ_NETWORK_ERROR");
    expect(errEl.textContent).not.toContain("ECONNRESET");
    expect(errEl.textContent).not.toContain("127.0.0.1");
  });

  it("CASE 6 connect reject with QQ_AUTH_FAILED shows user toast not raw", async () => {
    const channel = {
      config: { id: "qq_1", channel: "qq-bot", displayName: "Bot", appId: "123", credentialRef: "cred_1", enabled: true, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      health: { channel: "qq-bot", id: "qq_1", state: "disconnected" },
    };
    const connectMock = vi.fn(async () => { throw { code: "QQ_AUTH_FAILED", message: "invalid app secret xxx" }; });
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [channel] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: connectMock, disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-card-qq_1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("channel-connect-qq_1"));
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.length).toBeGreaterThan(0);
      const last = toasts[toasts.length - 1];
      expect(last.message).toBe("QQ 机器人认证失败，请检查 App ID / Secret");
      expect(last.message).not.toContain("invalid");
      expect(last.message).not.toContain("QQ_AUTH_FAILED");
    });
  });

  it("CASE 7 unknown code shows fallback not technical details", async () => {
    const channel = {
      config: { id: "qq_1", channel: "qq-bot", displayName: "Bot", appId: "123", credentialRef: "cred_1", enabled: true, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      health: { channel: "qq-bot", id: "qq_1", state: "error", lastError: { code: "FUTURE_PROVIDER_FAILURE", message: "technical details" } },
    };
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [channel] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-card-qq_1")).toBeTruthy());
    const errEl = screen.getByTestId("channel-error-qq_1");
    // unknown code should fallback to generic
    expect(errEl.textContent).toBe("操作失败，请稍后重试");
    expect(errEl.textContent).not.toContain("FUTURE_PROVIDER_FAILURE");
    expect(errEl.textContent).not.toContain("technical details");

    // also test resolveChannelUserMessage directly for unknown
    expect(resolveChannelUserMessage({ code: "FUTURE_PROVIDER_FAILURE" }, "连接失败，请稍后重试")).toBe("连接失败，请稍后重试");
  });

  it("CASE 8 syncNow reject EMAIL_SYNC_FAILED shows user message", async () => {
    const channel = {
      config: { id: "gmail_1", channel: "gmail", displayName: "test@gmail.com", emailAddress: "test@gmail.com", credentialRef: "cred_g", enabled: true, syncIntervalSeconds: 60 },
      health: { channel: "gmail", id: "gmail_1", state: "connected" },
    };
    const syncMock = vi.fn(async () => { throw { code: "EMAIL_SYNC_FAILED", message: "sync error" }; });
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [channel] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: syncMock });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-card-gmail_1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("channel-sync-gmail_1"));
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      const last = toasts[toasts.length - 1];
      expect(last.message).toBe("邮件同步失败");
      expect(last.message).not.toContain("EMAIL_SYNC_FAILED");
    });
  });

  it("test toast for unknown error uses fallback", async () => {
    const channel = {
      config: { id: "qq_1", channel: "qq-bot", displayName: "Bot", appId: "123", credentialRef: "cred_1", enabled: true, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      health: { channel: "qq-bot", id: "qq_1", state: "disconnected" },
    };
    const testMock = vi.fn(async () => ({ ok: false, error: "FUTURE_PROVIDER_FAILURE" }));
    setChannelsBridge({ list: vi.fn(async () => ({ channels: [channel] })), addQQ: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), test: testMock, remove: vi.fn(), startGmailOAuth: vi.fn(), syncNow: vi.fn() });
    render(<ChannelSettings />);
    await waitFor(() => expect(screen.getByTestId("channel-card-qq_1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("channel-test-qq_1"));
    await waitFor(() => {
      const last = useToastStore.getState().toasts.slice(-1)[0];
      // future code should map to fallback "测试失败，请稍后重试" via resolveChannelUserMessage
      expect(last.message).not.toContain("FUTURE_PROVIDER_FAILURE");
      // should be fallback, not raw
      expect(["测试失败，请稍后重试", "操作失败，请稍后重试"].some(s => last.message.includes(s) || last.message === s) || last.message === "测试失败，请稍后重试" || last.message.includes("请稍后重试")).toBeTruthy();
    });
  });
});
