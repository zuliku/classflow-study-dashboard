// @vitest-environment jsdom
/**
 * Kiro Composer 输入高亮 + / 与 @ 展开动画：
 * - tokenizeComposerPrompt 纯逻辑（/ 开头命令 + @ 上下文，邮箱不误触，concat 恒等于原文）
 * - Composer 渲染镜像（data-testid="kiro-composer-highlight"，token span 零布局位移）
 * - / 菜单用 kiro-slash-enter（左下弹出）与 @ 菜单用 kiro-mention-enter（中央柔附着 + stagger）区分
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { useAppStore } from "@/store/useAppStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { tokenizeComposerPrompt } from "@/lib/ai/composer/promptHighlight";

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

describe("tokenizeComposerPrompt（纯逻辑）", () => {
  it("空输入 → 空分段", () => {
    expect(tokenizeComposerPrompt("")).toEqual([]);
  });

  it("/ 开头命令成段（选中后 /name … 仍高亮命令段）", () => {
    expect(tokenizeComposerPrompt("/")).toEqual([{ text: "/", kind: "slash" }]);
    expect(tokenizeComposerPrompt("/doc 帮我整理")).toEqual([
      { text: "/doc", kind: "slash" },
      { text: " 帮我整理", kind: "plain" },
    ]);
  });

  it("@ 上下文成段（CJK 前无空格正常高亮）", () => {
    expect(tokenizeComposerPrompt("帮我看下@高数 明天")).toEqual([
      { text: "帮我看下", kind: "plain" },
      { text: "@高数", kind: "mention" },
      { text: " 明天", kind: "plain" },
    ]);
  });

  it("邮箱不误触（@ 前是 ASCII 词字符则整段 plain）", () => {
    const tokens = tokenizeComposerPrompt("发到foo@bar");
    expect(tokens).toEqual([{ text: "发到foo@bar", kind: "plain" }]);
    expect(tokens.map((t) => t.text).join("")).toBe("发到foo@bar");
  });

  it("分段 concat 恒等于原文", () => {
    for (const text of ["/doc @讲义一 明天", "k @", "@本周", "你好 /doc"]) {
      expect(tokenizeComposerPrompt(text).map((t) => t.text).join("")).toBe(text);
    }
  });
});

describe("KiroComposer 输入高亮镜像", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const handlers = {
    onSend: vi.fn(async () => true),
    onAddContext: vi.fn(),
  };

  function props() {
    return {
      contexts: [],
      onAddContext: handlers.onAddContext,
      onRemoveContext: vi.fn(),
      onSend: handlers.onSend,
      streaming: false,
      turnInFlight: false,
      runtimeStatus: "ready" as const,
      onStop: vi.fn(),
      configured: true,
      modelOptions: [{ value: "m", label: "M", vendor: null }],
      activeModelName: "M",
      selectedModelId: "m",
      activeModelVendor: null,
      onSelectModel: vi.fn(),
      onOpenSettings: vi.fn(),
      attachments: [],
      hasProcessing: false,
      visionEnabled: true,
      onAddFiles: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onRetryAttachment: vi.fn(),
      onSaveAttachmentToCourse: vi.fn(),
      onAddMaterial: vi.fn(),
    };
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** presence 进入需要两帧 rAF（对称进退契约：先挂载隐藏态，再显示播进入 keyframe） */
  async function pumpEnterFrames() {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useKiroPreferencesStore.setState({ webSearchEnabled: false });
    useAppStore.setState({
      courses: [{ id: "c1", name: "中级计量经济学", teacher: "王老师", materials: [] }] as never,
      assignments: [] as never,
      groupProjects: [] as never,
    });
    delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function renderComposer() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<KiroComposer {...(props() as never)} />);
    });
    await flush();
  }

  async function typeText(value: string) {
    const ta = container!.querySelector('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  it("镜像与 textarea 同在输入区；/ 与 @ 以 token 段突出显示", async () => {
    await renderComposer();
    const mirror = container!.querySelector('[data-testid="kiro-composer-highlight"]');
    expect(mirror).toBeTruthy();
    expect(mirror!.getAttribute("aria-hidden")).toBe("true");

    await typeText("帮我看下@中级");
    const mention = container!.querySelector(
      '[data-testid="kiro-composer-highlight"] [data-token="mention"]'
    );
    expect(mention?.textContent).toBe("@中级");
    // @ 菜单用专用动效类（不再复用 slash）；进入 keyframe 在两帧后生效（对称进退）
    await pumpEnterFrames();
    expect(container!.querySelector('[data-testid="kiro-mention-menu"]')?.className).toContain(
      "kiro-mention-enter"
    );
    expect(container!.querySelector('[data-testid="kiro-mention-menu"]')?.className).not.toContain(
      "kiro-slash-enter"
    );
    // 关闭走退出过渡（非硬切）：先 opacity-0 + 不可点，再延迟卸载
    await typeText("帮我看下@中级 ");
    const closing = container!.querySelector('[data-testid="kiro-mention-menu"]');
    expect(closing?.className).toContain("opacity-0");
    expect(closing?.className).toContain("duration-[var(--motion-exit-fast)]");
  });

  it("/ token 高亮 + / 菜单保持 kiro-slash-enter（左下弹出）", async () => {
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      skills: { list: async () => ({ skills: [{ name: "doc", description: "文档", enabled: true, kind: "workflow" }] }) },
    };
    await renderComposer();
    await typeText("/d");
    const slash = container!.querySelector(
      '[data-testid="kiro-composer-highlight"] [data-token="slash"]'
    );
    expect(slash?.textContent).toBe("/d");
    await pumpEnterFrames();
    await new Promise((r) => setTimeout(r, 250));
    expect(container!.querySelector('[data-testid="skill-slash-menu"]')?.className).toContain(
      "kiro-slash-enter"
    );
    // 关闭走退出过渡：先 opacity-0 + 不可点（延迟卸载由 usePresence 生命周期测试覆盖）
    await typeText("你好");
    const closing = container!.querySelector('[data-testid="skill-slash-menu"]');
    expect(closing?.className).toContain("opacity-0");
    expect(closing?.className).toContain("ease-[var(--ease-exit)]");
  });
});

describe("KiroComposer / 与 @ 展开动画契约（源码锁定）", () => {
  const composerSrc = readFileSync(join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("/ 与 @ 使用不同进入类（指令弹出 vs 上下文附着）", () => {
    expect(composerSrc).toContain("kiro-slash-enter");
    expect(composerSrc).toContain("kiro-mention-enter");
    expect(composerSrc).toContain("kiro-mention-item-enter");
    expect(composerSrc).toContain("--kiro-mention-index");
  });

  it("动效定义：/ 左下 spring 弹出；@ 中央柔附着 + 选项 stagger；均有 reduced-motion 与拖拽降权", () => {
    expect(css).toContain(".kiro-mention-enter");
    expect(css).toContain("@keyframes kiro-mention-in");
    expect(css).toContain("@keyframes kiro-mention-item-in");
    expect(css).toContain("transform-origin: bottom left");
    expect(css).toContain("transform-origin: bottom center");
    expect(css).toContain("var(--kiro-mention-index, 0)");
    expect(css).toContain('html[data-motion-effective="reduced"] .kiro-mention-enter');
    expect(css).toContain("[data-geometry-interacting] .kiro-mention-enter");
  });

  it("高亮 token 样式：只用背景 + 内描边（无 padding/border，避免换行错位）", () => {
    expect(css).toContain(".kiro-prompt-mirror");
    expect(css).toContain(".kiro-prompt-token-slash");
    expect(css).toContain(".kiro-prompt-token-mention");
  });
});


