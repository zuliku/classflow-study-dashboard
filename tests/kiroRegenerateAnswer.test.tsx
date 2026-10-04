// @vitest-environment jsdom
/**
 * 空终答追答按钮（fix：思考吃光配额 → 工具成功但零正文）— KiroMessage 渲染层。
 * 完整三轮 wiring 走 tests/e2e/kiro-empty-answer.spec.ts（Playwright）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KiroMessage } from "@/components/kiro/KiroMessage";

vi.mock("@/hooks/useKiroArtifactActions", () => ({
  useKiroArtifactActions: () => ({
    previewArtifact: vi.fn(),
    downloadArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
    askKiroArtifact: vi.fn(),
  }),
}));

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
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root!.render(node);
  });
}

describe("空终答追答按钮", () => {
  it("showRegenerateAnswer → 文案 + 按钮可见，点击触发 onRegenerateAnswer", async () => {
    const onRegenerateAnswer = vi.fn();
    await render(
      <KiroMessage
        messageId="m-1"
        content=""
        showRegenerateAnswer
        onRegenerateAnswer={onRegenerateAnswer}
      />
    );
    const btn = container!.querySelector('[data-testid="kiro-regenerate-answer"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("重新生成回答");
    expect(container!.textContent).toContain("模型未返回正文");
    await act(async () => {
      btn.click();
    });
    expect(onRegenerateAnswer).toHaveBeenCalledTimes(1);
  });

  it("缺省不渲染（无 flag / 无 handler 都不出现）", async () => {
    await render(<KiroMessage messageId="m-1" content="" />);
    expect(container!.querySelector('[data-testid="kiro-regenerate-answer"]')).toBeNull();
    await render(<KiroMessage messageId="m-1" content="" showRegenerateAnswer />);
    expect(container!.querySelector('[data-testid="kiro-regenerate-answer"]')).toBeNull();
  });
});

describe("空终答追答接线守卫（源码锁定）", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
  const surface = read("components/kiro/KiroChatSurface.tsx");
  const conversation = read("components/kiro/KiroConversation.tsx");
  const message = read("components/kiro/KiroMessage.tsx");
  const hook = read("hooks/useKiroChat.ts");
  const route = read("app/api/ai/chat/route.ts");

  it("Surface 下发追答入口；hook 暴露 regenerateAnswer + view 层判定", () => {
    // Surface 经 useCallback 转发（in-flight 门在 hook 内；语义与直发一致）
    expect(surface).toContain("handleRegenerateAnswer");
    expect(surface).toContain("onRegenerateAnswer={handleRegenerateAnswer}");
    expect(hook).toContain("const regenerateAnswer = useCallback(");
    // 判定在 view 构建层（parts 可见；Surface 的 chat.messages 是 view，无 parts）
    expect(hook).toContain("messageNeedsAnswerRetry(m) ? { needsAnswerRetry: true as const } : {}");
    // 可见 nudge 走正常发送链（regenerate 会丢工具结果，禁止用于追答）
    expect(hook).toContain("textOnlyAnswer: true");
    expect(hook).not.toMatch(/regenerateAnswer[\s\S]{0,800}\.regenerate\(/);
  });

  it("Conversation 只给 settled 末条行布尔值（Row memo 安全）；Message 渲染 testid 按钮", () => {
    expect(conversation).toContain("m.needsAnswerRetry && idx === lastAssistantIndex && !turnInFlight");
    expect(conversation).toContain("showRegenerateAnswer={showRegenerateAnswer}");
    expect(message).toContain('data-testid="kiro-regenerate-answer"');
  });

  it("route：textOnlyAnswer 严格 true 才零工具 + 追答指引", () => {
    expect(route).toContain("textOnlyAnswer === true");
    expect(route).toContain("const assembledTools = textOnlyAnswer");
    expect(route).toContain("# 纯文本追答");
  });
});
