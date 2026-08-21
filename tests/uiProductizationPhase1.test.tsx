// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

// Polyfill
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

const mockSkills = vi.hoisted(() => ({
  list: vi.fn(async () => ({ skills: [] })),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(), setEnabled: vi.fn(),
  import: vi.fn(async () => ({ cancelled: true })),
  get: vi.fn(async () => ({ skill: { name: "test", description: "desc", instructions: "instr" } })),
  export: vi.fn(async () => ({ content: "# skill" })),
  test: vi.fn(async () => ({ ok: true, errors: [] })), activate: vi.fn(),
}));
const mockMcp = vi.hoisted(() => ({
  list: vi.fn(async () => ({ connections: [] })),
  add: vi.fn(), test: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), setEnabled: vi.fn(),
}));
function setBridge(skills: unknown, mcp: unknown) {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1, platform: "windows",
    filesystem: { pickDirectory: vi.fn(), getGrantStatus: vi.fn(), forgetGrant: vi.fn(), list: vi.fn(), stat: vi.fn(), readText: vi.fn(), readBytes: vi.fn(), readTextPrefix: vi.fn(), createDirectory: vi.fn(), writeText: vi.fn(), writeBytes: vi.fn(), remove: vi.fn(), move: vi.fn() },
    skills, mcp,
  } as never;
}

import { useExtensionsStore } from "@/store/useExtensionsStore";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { InboxPanel } from "@/components/inbox/InboxPanel";
import { EmailReplyDialog } from "@/components/inbox/EmailReplyDialog";
import { DataHealth } from "@/components/settings/DataHealth";

describe("Phase1 - Demo leakage cleanup RED tests", () => {
  beforeEach(() => {
    cleanup();
    setBridge(mockSkills, mockMcp);
    useExtensionsStore.setState({ activeTab: "skills", extensions: [] });
  });
  afterEach(() => cleanup());

  it("1. Extensions should NOT render legacy channel placeholder cards (gmail/qq-mail)", async () => {
    useExtensionsStore.setState({ activeTab: "channels", extensions: [] });
    const { container } = render(<ExtensionsSettings />);
    await new Promise(r => setTimeout(r, 60));
    // Legacy provider cards were filtered with opacity-60 and testid channel-card-gmail
    // Now ChannelSettings is truth source, so these should NOT exist
    const legacyGmail = container.querySelector('[data-testid="channel-card-gmail"]');
    const legacyQQMail = container.querySelector('[data-testid="channel-card-qq-mail"]');
    // Also check for Chinese placeholder text
    const placeholderText = container.textContent ?? "";
    expect(legacyGmail).toBeNull();
    expect(legacyQQMail).toBeNull();
    expect(placeholderText).not.toContain("（占位）");
    expect(placeholderText).not.toContain("基础设施尚未启用");
    expect(placeholderText).not.toContain("当前为占位预览");
  });

  it("1b. Extensions file should not contain legacy placeholder source", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ExtensionsSettings.tsx"), "utf8");
    expect(src).not.toContain("Legacy provider cards");
    expect(src).not.toContain("（占位）");
    expect(src).not.toContain("基础设施尚未启用");
    expect(src).not.toContain("当前为占位预览");
    // providerDetail should be removed
    expect(src).not.toContain("providerDetail");
    expect(src).not.toContain("mcpPlaceholderOpen");
  });

  it("2. Channel summary should use real Channel state not extensions legacy", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ExtensionsSettings.tsx"), "utf8");
    // Should call window.classflowDesktop.channels.list or similar, not just extensions.filter
    // We check that summary counts don't purely rely on extensions for channels
    // After fix, it should have channels bridge logic
    expect(src).toMatch(/classflowDesktop.*channels.*list|getChannelsBridge|useChannelStatus/i);
  });

  it("3. Skill trigger should not fallback to fake '课程 · DDL · 通知'", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ExtensionsSettings.tsx"), "utf8");
    expect(src).not.toContain('?? "课程 · DDL · 通知"');
    // Also check rendered skill card doesn't show fake fallback when triggers empty
    // Render a skill with no triggers
    mockSkills.list.mockResolvedValueOnce({ skills: [{ name: "test-skill", description: "desc", folderName: "test", enabled: true, triggers: [] }] });
    useExtensionsStore.setState({ activeTab: "skills" });
    render(<ExtensionsSettings />);
    // wait a bit
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const text = document.body.textContent ?? "";
        // Should not contain fake trigger string when skill has no triggers
        // Instead should contain "未设置自动触发" or no chip
        expect(text).not.toContain("课程 · DDL · 通知");
        resolve();
      }, 100);
    });
  });

  it("4. About should not show demo preview", () => {
    const { container } = render(<AboutSettings />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("demo 预览版");
    expect(text).not.toContain("demo");
    expect(text.toLowerCase()).not.toContain("demo");
    // Should contain APP_VERSION but not duplicate （测试版） after version if badge already shows it
    // The version line should be just version, not "（测试版）" duplicated? Check spec: version = {APP_VERSION} without （测试版）
    const versionText = container.textContent ?? "";
    // Ensure "测试版" appears only once (badge)
    const occurrences = (versionText.match(/测试版/g) || []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it("5. Inbox should not show EXTERNAL UNTRUSTED CONTENT banner", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/inbox/InboxPanel.tsx"), "utf8");
    expect(src).not.toContain("EXTERNAL UNTRUSTED CONTENT");
    // Also rendered
    render(<InboxPanel open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent).not.toContain("EXTERNAL UNTRUSTED CONTENT");
    // Should contain user-friendly "外部消息" instead
    // At least check that old banner gone; new one optional
  });

  it("6. Inbox should not show static Kiro may recognize promo", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/inbox/InboxPanel.tsx"), "utf8");
    expect(src).not.toContain("Kiro 可能识别");
    render(<InboxPanel open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent).not.toContain("Kiro 可能识别");
    expect(document.body.textContent).not.toContain("课程通知 · 作业 · DDL");
  });

  it("7. EmailReplyDialog should use Chinese copy, no Prepare/Final Confirm, provider-neutral", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/inbox/EmailReplyDialog.tsx"), "utf8");
    expect(src).not.toContain(">Prepare<");
    expect(src).not.toContain("Final Confirm");
    expect(src).not.toContain("Subject:");
    expect(src).not.toContain("保持原 Gmail 线程");
    expect(src).not.toContain("检查 Gmail");
    // Should contain new copy
    expect(src).toContain("继续");
    expect(src).toContain("确认发送");
    expect(src).toContain("原主题");
    expect(src).toContain("将在原邮件会话中回复");
  });

  it("8. MCP copy should be user-friendly, no Remote MCP (Streamable HTTP) in main description", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ExtensionsSettings.tsx"), "utf8");
    expect(src).not.toContain("Remote MCP (Streamable HTTP)");
    expect(src).not.toContain("Tools");
    // Check that at least main description uses simplified wording
    expect(src).toContain("支持远程 MCP 服务");
  });

  it("9. Channel technical copy should be simplified, no PKCE/loopback in user UI", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ChannelSettings.tsx"), "utf8");
    // Main user description should not contain raw technical values
    // They should be either removed or hidden under dev check
    const hasPkgRaw = src.includes("PKCE") && src.includes("loopback") && src.indexOf("PKCE") < 600; // crude
    // After fix, PKCE should only be under dev guard or removed
    // We check that plain "PKCE + loopback" not in main description without dev guard
    const lines = src.split("\n");
    const plainTechnicalLines = lines.filter(l => l.includes("PKCE") && !l.includes("development") && !l.includes("NODE_ENV") && !l.includes("isDev"));
    expect(plainTechnicalLines.length).toBe(0);
    expect(src).not.toMatch(/IMAP:.*993.*TLS/);
    expect(src).not.toMatch(/仅 INBOX/);
  });

  it("10. Terminal should not show exit code in main label", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/kiro/computer/KiroTerminalBlock.tsx"), "utf8");
    expect(src).not.toContain("`已完成 · exit ${activity.exitCode}`");
    expect(src).not.toContain("`失败 · exit ${activity.exitCode}`");
    expect(src).not.toContain("向进程输入（敏感内容请在此输入，不会发送给模型）");
    expect(src).toContain("向本地终端输入");
  });

  it("11. DataHealth should compute real issue count, not hardcoded 1", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/DataHealth.tsx"), "utf8");
    expect(src).not.toContain('"发现 1 项需要注意"');
    expect(src).toMatch(/issueCount|发现 \$\{|发现 \${/);
    // Render check: with issues, should show dynamic count
  });
});
