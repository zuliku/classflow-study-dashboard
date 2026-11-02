// @vitest-environment jsdom
/**
 * 上下文占用 ring 组件测试（Codex-style）。
 *
 * 覆盖：unknown / ok / warn / danger 四态（tone + aria-label）；进度弧只在有数据时绘制；
 * 受控 open/onOpenChange；明细文案（对话 / 固定开销 / 压缩阈值）；compact 模式尺寸；
 * 无快照时的说明文案；安全（不渲染消息内容 / 路径）。
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComposerContextUsage } from "@/components/kiro/composer/KiroComposerContextUsage";
import { buildContextUsageSnapshot } from "@/lib/ai/contextBudget/usage";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";

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

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function usage(conversationTokens: number) {
  return buildContextUsageSnapshot({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    systemPromptTokens: 16342,
    toolSchemaTokens: 4200,
    conversationTokens,
    attachmentTokens: 1200,
    summaryTokens: 800,
    budget: DEFAULT_CONTEXT_BUDGET,
    compacted: false,
    at: Date.parse("2026-09-24T10:00:00.000Z"),
  });
}

async function render(props: Partial<React.ComponentProps<typeof KiroComposerContextUsage>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onOpenChange = props.onOpenChange ?? vi.fn();
  await act(async () => {
    root!.render(
      <KiroComposerContextUsage
        snapshot={props.snapshot ?? null}
        overflow={props.overflow}
        compact={props.compact}
        windowTokens={props.windowTokens}
        open={props.open ?? false}
        onOpenChange={onOpenChange}
      />
    );
  });
  return { onOpenChange };
}

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector) as HTMLElement | null;
}

describe("上下文占用 ring — 状态与可访问性", () => {
  it("无快照 → unknown 空心环 + 「等待首次请求」aria-label", async () => {
    await render();
    const button = q('[data-testid="kiro-composer-context-usage"]')!;
    expect(button.getAttribute("data-tone")).toBe("unknown");
    expect(button.getAttribute("aria-label")).toBe("上下文：等待首次请求");
    // 无数据 → 只有轨道，无进度弧
    expect(button.querySelectorAll("circle").length).toBe(1);
  });

  it("正常占用 → ok tone + 数字 label + 进度弧", async () => {
    await render({ snapshot: usage(9800) });
    const button = q('[data-testid="kiro-composer-context-usage"]')!;
    expect(button.getAttribute("data-tone")).toBe("ok");
    expect(button.getAttribute("aria-label")).toBe("上下文 9.8k / 24k");
    expect(button.getAttribute("title")).toBeNull();
    expect(button.querySelectorAll("circle").length).toBe(2);
    expect(button.querySelectorAll("circle")[1].getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("达到压缩阈值 → warn tone + 「较早对话将自动压缩」", async () => {
    await render({ snapshot: usage(19_000) });
    const button = q('[data-testid="kiro-composer-context-usage"]')!;
    expect(button.getAttribute("data-tone")).toBe("warn");
    expect(button.getAttribute("aria-label")).toContain("较早对话将自动压缩");
  });

  it("超出输入预算失败 → danger tone（来自真实 error code）", async () => {
    await render({ snapshot: usage(9800), overflow: true });
    const button = q('[data-testid="kiro-composer-context-usage"]')!;
    expect(button.getAttribute("data-tone")).toBe("danger");
    expect(button.getAttribute("aria-label")).toContain("已超出输入预算");
  });

  it("compact 模式：更大点击区（w-9 h-9）", async () => {
    await render({ snapshot: usage(9800), compact: true });
    expect(q('[data-testid="kiro-composer-context-usage"]')!.className).toContain("w-9");
  });
});

describe("上下文占用 ring — 受控弹层与明细", () => {
  it("点击触发 onOpenChange(true/false)（单一 menu ownership 由 Composer 提供）", async () => {
    const { onOpenChange } = await render({ snapshot: usage(9800) });
    await act(async () => {
      q('[data-testid="kiro-composer-context-usage"]')!.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(q('[data-testid="kiro-composer-context-usage"]')!.getAttribute("aria-expanded")).toBe("false");
  });

  it("展开：Codex-style 三段式（无窗口 → 对话上下文为分母）", async () => {
    await render({ snapshot: usage(9800), open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("对话上下文：");
    expect(menu.textContent).toContain("41% 已用（剩余 59%）");
    expect(menu.textContent).toContain("已用 9.8k tokens，共 24k");
    // 去除描述性段落：不再出现口径解释 / 固定开销 / 压缩阈值说明
    expect(menu.textContent).not.toContain("固定开销");
    expect(menu.textContent).not.toContain("CJK");
    expect(menu.textContent).not.toContain("自动压缩较早对话");
    expect(menu.textContent).not.toContain("deepseek-v4.1-flash");
  });

  it("展开（有官方窗口）：以模型窗口为分母", async () => {
    await render({ snapshot: usage(9800), open: true, windowTokens: 1_050_000 });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("上下文窗口：");
    expect(menu.textContent).toContain("3% 已用（剩余 97%）");
    expect(menu.textContent).toContain("已用 30.3k tokens，共 1.05M");
  });

  it("compacted → 单行短句（只在真实发生压缩时出现）", async () => {
    const compacted = { ...usage(9800), conversationBudget: { ...usage(9800).conversationBudget, compacted: true } };
    await render({ snapshot: compacted, open: true });
    expect(q('[data-testid="kiro-composer-context-usage-menu"]')!.textContent).toContain("已压缩较早对话");
  });

  it("无快照展开：单行提示（无描述段落）", async () => {
    await render({ open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("发送第一条消息后显示");
    expect(menu.textContent).not.toContain("只统计对话上下文");
    expect(menu.textContent).not.toContain("估算值");
  });

  it("overflow 展开：单行短句", async () => {
    await render({ snapshot: usage(9800), overflow: true, open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("已超出输入预算");
    expect(menu.textContent).not.toContain("请新开会话或清理上下文");
  });

  it("渲染内容不含消息正文 / 路径 / 内部字段", async () => {
    await render({ snapshot: usage(9800), open: true });
    const html = container!.innerHTML;
    for (const forbidden of ["storageKey", "adapterRef", "C:\\", "sk-"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it("弹窗锚点：位于 ring 中心、面板固定宽度居中（与下方状态环对齐）", async () => {
    await render({ snapshot: usage(9800), open: true });
    const anchor = q('[data-testid="kiro-composer-context-usage-anchor"]')!;
    expect(anchor.style.position).toBe("absolute");
    // 非 compact：w-7（28px）→ 锚点 left = 14
    expect(anchor.style.left).toBe("14px");
    expect(anchor.style.width).toBe("0px");
    const panel = q('[data-testid="kiro-composer-context-usage-menu"]')!.parentElement!;
    expect(panel.className).toContain("w-56");
    expect(panel.style.left).toBe("50%");
    expect(panel.style.bottom).toBe("100%");
    expect(panel.style.marginLeft).toBe("-112px");

    // compact：w-9（36px）→ 锚点 left = 18
    await render({ snapshot: usage(9800), open: true, compact: true });
    expect(q('[data-testid="kiro-composer-context-usage-anchor"]')!.style.left).toBe("18px");
  });
});
