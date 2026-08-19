// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { KiroTerminalBlock } from "@/components/kiro/computer/KiroTerminalBlock";
import { TerminalActivity } from "@/lib/ai/computer/terminal/activity";

/**
 * Phase 1 — KiroTerminalBlock UI 契约：
 * - working → completed 不 remount（引用稳定由外层 memo 保证；此处验证状态渲染切换）
 * - Stop button 只调用一次 cancel
 * - 输出 bounded + 查看全部输出
 */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    media: "",
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

function makeActivity(partial: Partial<TerminalActivity> = {}): TerminalActivity {
  return {
    executionId: "term-test-1",
    toolCallId: "call-1",
    shell: "powershell",
    commandPreview: 'npm run typecheck',
    status: "running",
    startedAt: Date.now() - 4_000,
    exitCode: null,
    durationMs: 0,
    stdoutLines: ["Checking...", "src/a.ts", "src/b.ts"],
    stderrLines: [],
    truncated: false,
    waitingForInput: false,
    ...partial,
  };
}

beforeEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

afterEach(() => {
  cleanup();
});

describe("KiroTerminalBlock", () => {
  it("running：显示 shell、command preview、elapsed、停止按钮", () => {
    render(<KiroTerminalBlock activity={makeActivity()} />);
    expect(screen.getByText("PowerShell")).toBeTruthy();
    expect(screen.getByText("npm run typecheck")).toBeTruthy();
    expect(screen.getByTestId("kiro-terminal-stop")).toBeTruthy();
    expect(screen.getByText(/运行中/)).toBeTruthy();
  });

  it("completed：显示 exit code + duration；停止按钮消失", () => {
    render(
      <KiroTerminalBlock
        activity={makeActivity({ status: "completed", exitCode: 0, durationMs: 2_300 })}
      />
    );
    expect(screen.queryByTestId("kiro-terminal-stop")).toBeNull();
    expect(screen.getByText(/exit 0/)).toBeTruthy();
    expect(screen.getByText(/2\.3s/)).toBeTruthy();
  });

  it("failed：轻量 danger 文案，不把整个 card 染红", () => {
    const { container } = render(
      <KiroTerminalBlock
        activity={makeActivity({ status: "failed", exitCode: 1, durationMs: 4_200 })}
      />
    );
    expect(screen.getByText(/exit 1/)).toBeTruthy();
    // card 自身不带 danger 边框/背景（只有文本 tone）
    expect(container.firstElementChild?.className).not.toMatch(/bg-danger|border-danger/);
  });

  it("cancelled：显示已停止", () => {
    render(<KiroTerminalBlock activity={makeActivity({ status: "cancelled", durationMs: 1_000 })} />);
    expect(screen.getByText("已停止")).toBeTruthy();
  });

  it("Stop button：点击只调用一次 bridge.cancel", async () => {
    let calls = 0;
    const noopFs = Object.fromEntries(
      ["pickDirectory", "getGrantStatus", "forgetGrant", "list", "stat", "readText", "readBytes", "readTextPrefix", "createDirectory", "writeText", "writeBytes", "remove", "move"].map(
        (m) => [m, async () => ({})]
      )
    );
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      filesystem: noopFs,
      terminal: {
        version: 2,
        execute: async () => ({}),
        cancel: async () => {
          calls += 1;
        },
        start: async () => ({}),
        subscribe: () => () => {},
      },
    };
    render(<KiroTerminalBlock activity={makeActivity()} />);
    const btn = screen.getByTestId("kiro-terminal-stop");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });

  it("输出 bounded：>10 行时出现「查看全部输出」，展开后可见全部", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`);
    const { container } = render(<KiroTerminalBlock activity={makeActivity({ stdoutLines: lines })} />);
    // 先展开终端输出 body
    fireEvent.click(container.querySelector('button[aria-label="展开终端输出"]') as HTMLElement);
    expect(screen.getByText(/查看全部输出（15 行）/)).toBeTruthy();
    // 折叠时默认 max-h bounded：只显示最近 10 行（line-6..line-15）
    expect(screen.queryByText("line-1")).toBeNull();
    expect(screen.getByText("line-15")).toBeTruthy();
    fireEvent.click(screen.getByText(/查看全部输出/));
    expect(screen.getByText("line-1")).toBeTruthy();
  });

  it("展开终端输出：默认折叠 body，点击 header chevron 展开", () => {
    const { container } = render(<KiroTerminalBlock activity={makeActivity()} />);
    // 默认折叠：输出 body 不可见
    expect(screen.queryByTestId("kiro-terminal-output")).toBeNull();
    fireEvent.click(container.querySelector('button[aria-label="展开终端输出"]') as HTMLElement);
    expect(screen.getByTestId("kiro-terminal-output")).toBeTruthy();
  });
});
