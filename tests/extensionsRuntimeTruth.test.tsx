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

import { useExtensionsStore } from "@/store/useExtensionsStore";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";

function setWindowBridges(opts: { skills?: unknown; mcp?: unknown; channels?: unknown }) {
  const base: Record<string, unknown> = {
    version: 1,
    platform: "windows",
    filesystem: {
      pickDirectory: vi.fn(), getGrantStatus: vi.fn(), forgetGrant: vi.fn(),
      list: vi.fn(), stat: vi.fn(), readText: vi.fn(), readBytes: vi.fn(),
      readTextPrefix: vi.fn(), createDirectory: vi.fn(), writeText: vi.fn(),
      writeBytes: vi.fn(), remove: vi.fn(), move: vi.fn(),
    },
  };
  if (opts.skills !== undefined) base.skills = opts.skills;
  if (opts.mcp !== undefined) base.mcp = opts.mcp;
  if (opts.channels !== undefined) base.channels = opts.channels;
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = base;
}

function legacySkill(name: string, enabled = true) {
  return { id: `ext_skill_${name}`, kind: "skill" as const, providerId: name, name, description: "legacy", status: "connected" as const, enabled, createdAt: Date.now(), updatedAt: Date.now() };
}
function legacyMcp(name: string, status: "connected" | "disconnected" = "disconnected") {
  return { id: `ext_mcp_${name}`, kind: "mcp" as const, providerId: name, name, description: "legacy", status, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
}

function getSummaryExact(label: string) {
  const el = screen.getByTestId(`summary-${label}`);
  return el.textContent ?? "";
}
function getSummarySecondLine(label: string) {
  const exactEl = screen.getByTestId(`summary-${label}`);
  const card = exactEl.closest("div");
  // second span is next sibling
  const spans = card?.querySelectorAll("span");
  // spans[0] is exact, spans[1] is value/total
  return spans?.[1]?.textContent?.trim() ?? "";
}
function getSummaryContainerText() {
  const c = screen.getByTestId("extensions-summary");
  return c.textContent ?? "";
}

describe("Extensions Runtime Truth V1", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useExtensionsStore.setState({ activeTab: "skills", extensions: [] });
    // default bridges that return empty ready
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(async () => ({ cancelled: true })), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("CASE 1 Live Skills [] Legacy 3 => 0/0 empty not legacy", async () => {
    useExtensionsStore.setState({ extensions: [legacySkill("a"), legacySkill("b"), legacySkill("c")] as never });
    const skillsBridge = { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() };
    setWindowBridges({ skills: skillsBridge, mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("0 个 Skills 已启用"));
    expect(getSummarySecondLine("Skills 已启用")).toBe("0 / 0");
    expect(screen.getByText("还没有 Skill")).toBeTruthy();
    // must not show legacy 3
    const summaryText = getSummaryContainerText();
    expect(summaryText).not.toContain("3 个 Skills");
    // ensure not showing 3 / 3
    expect(getSummarySecondLine("Skills 已启用")).not.toBe("3 / 3");
  });

  it("CASE 2 Live Skills 2 enabled 1 Legacy 5 => 1/2 not legacy", async () => {
    useExtensionsStore.setState({ extensions: Array.from({ length: 5 }, (_, i) => legacySkill(`leg${i}`)) as never });
    const liveSkills = [
      { name: "skill-a", description: "a", folderName: "a", enabled: true },
      { name: "skill-b", description: "b", folderName: "b", enabled: false },
    ];
    const skillsBridge = { list: vi.fn(async () => ({ skills: liveSkills })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() };
    setWindowBridges({ skills: skillsBridge, mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("1 个 Skills 已启用"));
    expect(getSummarySecondLine("Skills 已启用")).toBe("1 / 2");
    expect(getSummaryContainerText()).not.toContain("5");
  });

  it("CASE 3 Skills loading Legacy 4 => — not legacy count", async () => {
    useExtensionsStore.setState({ extensions: Array.from({ length: 4 }, (_, i) => legacySkill(`leg${i}`)) as never });
    let resolveList: (v: unknown) => void = () => {};
    const pending = new Promise<{ skills: unknown[] }>((res) => { resolveList = res as never; });
    const skillsBridge = { list: vi.fn(() => pending), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() };
    setWindowBridges({ skills: skillsBridge, mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    render(<ExtensionsSettings />);
    // While pending, summary should be —
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("—"));
    expect(getSummarySecondLine("Skills 已启用")).toBe("—");
    // panel should show loading
    expect(screen.getByTestId("skills-loading")).toBeTruthy();
    expect(screen.queryByText("还没有 Skill")).toBeNull();
    // legacy not shown
    expect(getSummaryContainerText()).not.toContain("4");
    // resolve to verify transition to 0/0
    resolveList({ skills: [] });
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("0 个 Skills 已启用"));
  });

  it("CASE 4 Skills bridge error => — + 暂时无法读取 Skills + retry not empty", async () => {
    useExtensionsStore.setState({ extensions: [] });
    const skillsBridge = { list: vi.fn(async () => { throw new Error("bridge error"); }), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() };
    setWindowBridges({ skills: skillsBridge, mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("—"));
    expect(getSummarySecondLine("Skills 已启用")).toBe("—");
    expect(screen.getByTestId("skills-error")).toBeTruthy();
    expect(screen.getByText("暂时无法读取 Skills")).toBeTruthy();
    expect(screen.getByTestId("skills-retry")).toBeTruthy();
    expect(screen.queryByText("还没有 Skill")).toBeNull();
    // retry should call list again
    const retryBridge = { list: vi.fn(async () => ({ skills: [{ name: "s1", description: "d", folderName: "s1", enabled: true }] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() };
    setWindowBridges({ skills: retryBridge, mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    fireEvent.click(screen.getByTestId("skills-retry"));
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("1 个 Skills 已启用"));
  });

  it("CASE 5 Skills bridge unavailable Legacy 5 => — not legacy", async () => {
    useExtensionsStore.setState({ extensions: Array.from({ length: 5 }, (_, i) => legacySkill(`leg${i}`)) as never });
    // no skills bridge
    setWindowBridges({ mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() }, channels: { list: vi.fn(async () => ({ channels: [] })) } });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("Skills 已启用")).toBe("—"));
    expect(getSummarySecondLine("Skills 已启用")).toBe("—");
    expect(screen.getByTestId("skills-unavailable")).toBeTruthy();
    expect(screen.getByText("当前环境无法读取 Skills")).toBeTruthy();
    expect(screen.queryByText("还没有 Skill")).toBeNull();
    expect(getSummaryContainerText()).not.toContain("5");
  });

  it("CASE 6 Live MCP [] Legacy 2 => 0/0 empty not legacy", async () => {
    useExtensionsStore.setState({ activeTab: "mcp", extensions: [legacyMcp("a", "connected"), legacyMcp("b", "connected")] as never });
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("0 个 MCP 已连接"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("0 / 0");
    expect(screen.getByText("还没有 MCP 连接")).toBeTruthy();
    expect(getSummaryContainerText()).not.toContain("2 个 MCP");
  });

  it("CASE 7 Live MCP 2 Connected 1 Legacy 4/4 => 1/2 not legacy", async () => {
    useExtensionsStore.setState({ activeTab: "mcp", extensions: Array.from({ length: 4 }, (_, i) => legacyMcp(`leg${i}`, "connected")) as never });
    const liveConns = [
      { config: { id: "1", name: "mcp1", endpoint: "https://a", enabled: true }, state: "connected", toolCount: 0, resourceCount: 0, promptCount: 0 },
      { config: { id: "2", name: "mcp2", endpoint: "https://b", enabled: true }, state: "disconnected", toolCount: 0, resourceCount: 0, promptCount: 0 },
    ];
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: liveConns })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("1 个 MCP 已连接"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("1 / 2");
    expect(getSummaryContainerText()).not.toContain("4 / 4");
  });

  it("CASE 8 Delete last MCP => 0/0 not legacy", async () => {
    useExtensionsStore.setState({ activeTab: "mcp", extensions: [legacyMcp("legacy", "connected")] as never });
    const oneConn = [{ config: { id: "1", name: "m1", endpoint: "https://a", enabled: true }, state: "connected", toolCount: 1, resourceCount: 0, promptCount: 0 }];
    const mcpListMock = vi.fn(async () => ({ connections: oneConn }));
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: mcpListMock, add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(async () => {}), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    const { unmount } = render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("1 个 MCP 已连接"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("1 / 1");
    unmount();
    // simulate after delete: list returns []
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("0 个 MCP 已连接"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("0 / 0");
    expect(screen.getByText("还没有 MCP 连接")).toBeTruthy();
  });

  it("CASE 9 MCP loading Legacy non-zero => —", async () => {
    useExtensionsStore.setState({ activeTab: "mcp", extensions: Array.from({ length: 3 }, (_, i) => legacyMcp(`leg${i}`)) as never });
    let resolveMcp: (v: unknown) => void = () => {};
    const pending = new Promise<{ connections: unknown[] }>((res) => { resolveMcp = res as never; });
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(() => pending), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("—"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("—");
    expect(screen.getByTestId("mcp-loading")).toBeTruthy();
    expect(screen.queryByText("还没有 MCP 连接")).toBeNull();
    // resolve to check transition
    resolveMcp({ connections: [] });
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("0 个 MCP 已连接"));
  });

  it("CASE 10 MCP error => — + 暂时无法读取 MCP not empty", async () => {
    useExtensionsStore.setState({ activeTab: "mcp", extensions: [] });
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => { throw new Error("mcp error"); }), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("MCP 已连接")).toBe("—"));
    expect(getSummarySecondLine("MCP 已连接")).toBe("—");
    expect(screen.getByTestId("mcp-error")).toBeTruthy();
    expect(screen.getByText("暂时无法读取 MCP")).toBeTruthy();
    expect(screen.getByTestId("mcp-retry")).toBeTruthy();
    expect(screen.queryByText("还没有 MCP 连接")).toBeNull();
  });

  it("Channel sanity: channels.list [] => 0/0", async () => {
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      channels: { list: vi.fn(async () => ({ channels: [] })) },
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("消息渠道在线")).toBe("0 个消息渠道在线"));
    expect(getSummarySecondLine("消息渠道在线")).toBe("0 / 0");
  });

  it("Channel unavailable => —", async () => {
    setWindowBridges({
      skills: { list: vi.fn(async () => ({ skills: [] })), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(), import: vi.fn(), export: vi.fn(), test: vi.fn(), activate: vi.fn() },
      mcp: { list: vi.fn(async () => ({ connections: [] })), add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn() },
      // no channels bridge
    });
    render(<ExtensionsSettings />);
    await waitFor(() => expect(getSummaryExact("消息渠道在线")).toBe("—"));
    expect(getSummarySecondLine("消息渠道在线")).toBe("—");
  });

  it("static audit: no zero->legacy fallback code in ExtensionsSettings", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ExtensionsSettings.tsx"), "utf8");
    expect(src).not.toContain("skills.length ||");
    expect(src).not.toContain("mcpConnections.length ||");
    expect(src).not.toContain("enabledSkillsFallback");
    expect(src).not.toContain("mcpFallback");
    expect(src).not.toContain("connectedMcpFallback");
    expect(src).not.toContain("skillsCount");
    // should not filter extensions for counts
    // allow activeTab usage but not extensions.filter for skills/mcp
    const countFiltering = src.match(/extensions\.filter/g);
    expect(countFiltering).toBeNull();
    expect(src).toContain('type RuntimeLoadState');
  });
});
