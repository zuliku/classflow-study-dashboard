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
    expect(button.getAttribute("title")).toBe("上下文 9.8k / 24k");
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

  it("展开：对话占用 / 固定开销 / 压缩阈值 / 附件与摘要明细", async () => {
    await render({ snapshot: usage(9800), open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("上下文占用");
    expect(menu.textContent).toContain("deepseek-v4.1-flash");
    expect(menu.textContent).toContain("对话上下文 9.8k / 24k");
    expect(menu.textContent).toContain("固定开销（不计入压缩预算）");
    expect(menu.textContent).toContain("系统提示 ~16.3k");
    expect(menu.textContent).toContain("工具定义 ~4.2k");
    expect(menu.textContent).toContain("达到 18k 时会自动压缩较早对话");
    expect(menu.textContent).toContain("附件正文 ~1.2k");
    expect(menu.textContent).toContain("较早对话摘要 ~800");
    expect(menu.textContent).toContain("估算值（CJK ≈ 1 token/字）");
  });

  it("附件 / 摘要为 0 时不渲染对应行", async () => {
    const snapshot = { ...usage(9800), breakdown: { ...usage(9800).breakdown, attachmentTokens: 0, summaryTokens: 0 } };
    await render({ snapshot, open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).not.toContain("附件正文");
    expect(menu.textContent).not.toContain("较早对话摘要");
  });

  it("无快照展开：说明「发送第一条消息后显示占用估算」", async () => {
    await render({ open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("发送第一条消息后显示占用估算");
  });

  it("overflow 展开：说明本次请求因超出输入预算失败", async () => {
    await render({ snapshot: usage(9800), overflow: true, open: true });
    const menu = q('[data-testid="kiro-composer-context-usage-menu"]')!;
    expect(menu.textContent).toContain("本次请求因超出输入预算失败");
  });

  it("Phase 2：提供官方模型窗口 → 明细显示「占模型窗口 %」；缺失 → 不显示", async () => {
    await render({ snapshot: usage(9800), open: true, windowTokens: 1_050_000 });
    const windowLine = q('[data-testid="kiro-context-window-usage"]')!;
    expect(windowLine.textContent).toContain("占模型窗口");
    expect(windowLine.textContent).toContain("1.05M");

    await render({ snapshot: usage(9800), open: true });
    expect(q('[data-testid="kiro-context-window-usage"]')).toBeNull();
  });

  it("渲染内容不含消息正文 / 路径 / 内部字段", async () => {
    await render({ snapshot: usage(9800), open: true });
    const html = container!.innerHTML;
    for (const forbidden of ["storageKey", "adapterRef", "C:\\", "sk-"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});
