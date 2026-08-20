// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

// Polyfill ResizeObserver & matchMedia (jsdom)
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

// Mock bridges to control skills/mcp empty vs list
const mockSkills = vi.hoisted(() => ({
  list: vi.fn(async () => ({ skills: [] })),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  setEnabled: vi.fn(),
  import: vi.fn(async () => ({ cancelled: true })),
  get: vi.fn(async () => ({ skill: { name: "test", description: "desc", instructions: "instr" } })),
  export: vi.fn(async () => ({ content: "# skill" })),
  test: vi.fn(async () => ({ ok: true, errors: [] })),
  activate: vi.fn(),
}));
const mockMcp = vi.hoisted(() => ({
  list: vi.fn(async () => ({ connections: [] })),
  add: vi.fn(),
  test: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
}));

// Need to mock window.classflowDesktop before ExtensionsSettings reads it
function setBridge(skills: unknown, mcp: unknown) {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: {
      pickDirectory: vi.fn(), getGrantStatus: vi.fn(), forgetGrant: vi.fn(),
      list: vi.fn(), stat: vi.fn(), readText: vi.fn(), readBytes: vi.fn(),
      readTextPrefix: vi.fn(), createDirectory: vi.fn(), writeText: vi.fn(),
      writeBytes: vi.fn(), remove: vi.fn(), move: vi.fn(),
    },
    skills,
    mcp,
  };
}

import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useExtensionsStore } from "@/store/useExtensionsStore";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";

describe("SettingsGroup hierarchy — Task 16B L/M/N/O", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("description renders even when title present (fixes !title bug)", () => {
    render(<SettingsGroup title="Skills" description="将常用的 Kiro 工作流程保存为可复用能力。" action={<button>action</button>}><div>body</div></SettingsGroup>);
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("将常用的 Kiro 工作流程保存为可复用能力。")).toBeTruthy();
    // action should be in header outside bordered body
    const actionBtn = screen.getByText("action");
    // Header flex should contain title and action sibling
    const header = actionBtn.closest("div")?.parentElement;
    expect(header?.textContent).toContain("Skills");
  });

  it("action is in header (flex justify-between) not inside bordered body", () => {
    const { container } = render(
      <SettingsGroup title="Skills" description="desc" action={<button data-testid="header-action">创建</button>}>
        <div data-testid="inside-body">content</div>
      </SettingsGroup>
    );
    const headerAction = screen.getByTestId("header-action");
    const borderedBody = screen.getByTestId("inside-body").closest("div.rounded-xl");
    // Header action should NOT be inside bordered body
    expect(borderedBody?.contains(headerAction)).toBe(false);
    // Bordered body should contain content, not header action
    expect(borderedBody?.textContent).toContain("content");
    expect(borderedBody?.textContent).not.toContain("创建");
  });

  it("contentClassName controls body padding and does not break SettingRow geometry", () => {
    const { container: c1 } = render(
      <SettingsGroup title="Test" contentClassName="px-4 py-4"><div>body</div></SettingsGroup>
    );
    const body1 = c1.querySelector("div.rounded-xl");
    expect(body1?.className).toContain("px-4");
    expect(body1?.className).toContain("py-4");
    cleanup();
    // Default should be px-4 only (preserve SettingRow)
    const { container: c2 } = render(<SettingsGroup title="Test"><div>body</div></SettingsGroup>);
    const body2 = c2.querySelector("div.rounded-xl");
    expect(body2?.className).toContain("px-4");
  });
});

describe("ExtensionsSettings layout — Task 16B", () => {
  beforeEach(() => {
    cleanup();
    setBridge(mockSkills, mockMcp);
    mockSkills.list.mockResolvedValue({ skills: [] });
    mockMcp.list.mockResolvedValue({ connections: [] });
    // Reset extensions store activeTab
    useExtensionsStore.setState({ activeTab: "skills", extensions: [] });
  });
  afterEach(() => cleanup());

  it("Skills header uses SettingsGroup action (not bordered body first row)", async () => {
    const { container } = render(<ExtensionsSettings />);
    // Wait for skills loading? Use act
    await new Promise((r) => setTimeout(r, 50));
    // Find Skills group title h4 (not tab button)
    const title = container.querySelector("section h4");
    expect(title?.textContent).toBe("Skills");
    // The create skill button should be in header action (outside bordered body's first row touching border)
    const createBtn = screen.getByTestId("extensions-create-skill");
    const borderedBody = createBtn.closest("section")?.querySelector("div.rounded-xl");
    // Create button should NOT be inside bordered body
    expect(borderedBody?.contains(createBtn)).toBe(false);
    // It should be in header flex (sibling to title)
    const headerDiv = title?.closest("div.flex");
    expect(headerDiv?.contains(createBtn)).toBe(true);
  });

  it("Skills empty state has min-h-[220px] centered (not p-6 touching border uneven)", async () => {
    render(<ExtensionsSettings />);
    await new Promise((r) => setTimeout(r, 80));
    // Find empty state container that contains "还没有 Skill"
    const emptyTitle = screen.getByText("还没有 Skill");
    const emptyContainer = emptyTitle.closest("div");
    // It should have min-h-[220px] class somewhere in parent chain
    let el: Element | null = emptyTitle;
    let foundMinH = false;
    while (el) {
      if (el.className.includes("min-h-[220px]")) { foundMinH = true; break; }
      el = el.parentElement;
    }
    expect(foundMinH).toBe(true);
    // Should be flex items-center justify-center py-8
    let foundFlexCenter = false;
    el = emptyTitle;
    while (el) {
      if (el.className.includes("items-center") && el.className.includes("justify-center")) { foundFlexCenter = true; break; }
      el = el.parentElement;
    }
    expect(foundFlexCenter).toBe(true);
  });

  it("MCP header uses SettingsGroup action and empty state is simplified (no duplicate primary CTA)", async () => {
    useExtensionsStore.setState({ activeTab: "mcp" });
    const { container } = render(<ExtensionsSettings />);
    await new Promise((r) => setTimeout(r, 80));
    // Find MCP h4 title inside MCP panel section (not Skills hidden one)
    const mcpPanel = container.querySelector('[data-testid="extensions-mcp-panel"]');
    const mcpTitle = mcpPanel?.querySelector("section h4");
    expect(mcpTitle?.textContent).toBe("MCP");
    const addBtn = screen.getByTestId("extensions-add-mcp");
    const mcpSection = addBtn.closest("section");
    const borderedBody = mcpSection?.querySelector("div.rounded-xl");
    expect(borderedBody?.contains(addBtn)).toBe(false);
    const headerDiv = mcpTitle?.closest("div.flex");
    expect(headerDiv?.contains(addBtn)).toBe(true);
    // Empty state should have icon/title/desc but not duplicate primary button inside body
    const emptyMcpTitle = screen.getByText("还没有 MCP 连接");
    let emptyContainer: Element | null = emptyMcpTitle as Element;
    let foundMinH = false;
    while (emptyContainer) {
      if ((emptyContainer as HTMLElement).className?.includes("min-h-[220px]")) { foundMinH = true; break; }
      emptyContainer = emptyContainer.parentElement;
    }
    expect(foundMinH).toBe(true);
    // Use the found container for next check
    let containerEl: Element | null = emptyMcpTitle as Element;
    while (containerEl && !(containerEl as HTMLElement).className?.includes("min-h-[220px]")) {
      containerEl = containerEl.parentElement;
    }
    emptyContainer = containerEl;
    // Empty state should NOT contain another "添加 MCP" button (top already has it)
    const addBtnsInsideEmpty = emptyContainer ? Array.from(emptyContainer.querySelectorAll("button")).filter(b => b.textContent?.includes("添加 MCP")) : [];
    expect(addBtnsInsideEmpty.length).toBe(0);
  });

  it("ChannelSettings not regressed by SettingsGroup changes (padding, controls intact)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const groupSrc = fs.readFileSync(path.join(process.cwd(), "components/settings/SettingsGroup.tsx"), "utf-8");
    // Default body should be px-4, not py-4 globally
    expect(groupSrc).toContain('contentClassName ?? "px-4"');
    // ChannelSettings uses its own cards, not SettingsGroup body, should remain unaffected
    const channelSrc = fs.readFileSync(path.join(process.cwd(), "components/settings/ChannelSettings.tsx"), "utf-8");
    expect(channelSrc).toContain("channel-card-");
    // Ensure ExtensionsSettings channels panel still renders ChannelSettings
    useExtensionsStore.setState({ activeTab: "channels" });
    const { container } = render(<ExtensionsSettings />);
    await new Promise((r) => setTimeout(r, 50));
    // Should contain 消息渠道 title from ChannelSettings (use getAll due to tab duplicate)
    expect(screen.getAllByText("消息渠道").length).toBeGreaterThan(1);
    expect(container.textContent).toContain("消息渠道");
  });

  it("spacing rhythm: title/description/action/bordered content have stable gap", () => {
    const { container } = render(
      <SettingsGroup title="Skills" description="desc" action={<button>act</button>} contentClassName="px-4 py-4">
        <div>body</div>
      </SettingsGroup>
    );
    const section = container.querySelector("section");
    expect(section?.className).toContain("space-y-2");
    const header = screen.getByText("Skills").closest("div.flex");
    expect(header).toBeTruthy();
    const desc = screen.getByText("desc");
    expect(desc).toBeTruthy();
    // Title + action header and description and body should be siblings with space-y-2
    const children = Array.from(section?.children ?? []);
    expect(children.length).toBe(3); // header, description, body
  });
});
