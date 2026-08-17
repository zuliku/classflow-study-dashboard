import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { JSDOM } from "jsdom";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { KiroStreamingMarkdown } from "@/components/kiro/KiroStreamingMarkdown";
import { KiroStreamPerfCounters } from "@/lib/ai/perf/streamPerf";

/**
 * V4.5 Promotion-Stable Markdown DOM（jsdom + react-dom client 渲染）：
 * - active → stable promotion：outer block DOM node 保持同一实体（不 remount）
 * - 非 append-only（retry/regenerate/edit/history restore）→ render epoch +1，
 *   旧 block DOM 被替换（data-kiro-stream-epoch / block id 改变）
 * - promotion 帧不重新 parse 已展示正文（promotionParsedChars === 0）
 */

const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
});
const g = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  g.MutationObserver = dom.window.MutationObserver;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    Object.defineProperty(g, "navigator", {
      value: dom.window.navigator,
      configurable: true,
    });
  } catch {
    g.navigator = dom.window.navigator;
  }
  (dom.window as unknown as { __kiroStreamPerf?: Partial<KiroStreamPerfCounters> }).__kiroStreamPerf = {};
});
afterEach(() => {
  delete (dom.window as unknown as { __kiroStreamPerf?: Partial<KiroStreamPerfCounters> }).__kiroStreamPerf;
});

function counters(): KiroStreamPerfCounters {
  return (dom.window as unknown as { __kiroStreamPerf: KiroStreamPerfCounters }).__kiroStreamPerf;
}

function renderTo(render: (content: string, streaming: boolean) => void, content: string, streaming: boolean) {
  act(() => {
    render(content, streaming);
  });
}

describe("KiroStreamingMarkdown V4.5（Promotion-Stable DOM）", () => {
  it("普通段落 promotion：outer block DOM identity 保持，promotion 帧 0 re-parse", () => {
    let root: Root;
    act(() => {
      root = createRoot(dom.window.document.getElementById("root")!);
    });
    const render = (content: string, streaming: boolean) => {
      act(() => {
        root.render(
          React.createElement(KiroStreamingMarkdown, { content, streaming })
        );
      });
    };

    // active 阶段：单一 block
    renderTo(render, "这是第一段正在流式输出的文字。", true);
    const outer = dom.window.document.querySelector("[data-kiro-stream-block-id]")!;
    expect(outer).toBeTruthy();
    expect(outer.getAttribute("data-kiro-stream-block-id")).toBe("0");
    const rendersBefore = counters().blockRenders;

    // append-only + 空行 → promotion（text 未变）+ 新 tail
    renderTo(render, "这是第一段正在流式输出的文字。\n\n这是第二段。", true);
    // 同一个 outer node（React 用同一 key/组件实例 reconcile）
    expect(outer.isConnected).toBe(true);
    expect(dom.window.document.querySelectorAll("[data-kiro-stream-block-id]")).toHaveLength(2);
    // block 0 的 epoch/id 不变
    expect(outer.getAttribute("data-kiro-stream-epoch")).toBe("0");
    // promotion 帧：memo comparator 跳过 → block 0 不重 render，0 re-parse
    expect(counters().blockPromotions).toBeGreaterThanOrEqual(1);
    expect(counters().promotionParsedChars).toBe(0);
    // 第二段（新 tail）是新的 block
    const second = dom.window.document.querySelectorAll("[data-kiro-stream-block-id]")[1];
    expect(second.getAttribute("data-kiro-stream-block-id")).toBe("1");
    // 8K 段落场景下 promotion 不得重新 parse 全文（counter 有界于 mutable window）
    expect(counters().promotionParsedChars).toBeLessThanOrEqual(512);
  });

  it("非 append-only 替换 → render epoch +1，旧 block DOM 被替换", () => {
    let root: Root;
    act(() => {
      root = createRoot(dom.window.document.getElementById("root")!);
    });
    const render = (content: string, streaming: boolean) => {
      act(() => {
        root.render(React.createElement(KiroStreamingMarkdown, { content, streaming }));
      });
    };

    renderTo(render, "版本A的内容。", true);
    const oldOuter = dom.window.document.querySelector("[data-kiro-stream-block-id]")!;
    expect(oldOuter.getAttribute("data-kiro-stream-epoch")).toBe("0");

    // append-only 增长：epoch 不变
    renderTo(render, "版本A的内容。继续增长", true);
    expect(oldOuter.isConnected).toBe(true);
    expect(oldOuter.getAttribute("data-kiro-stream-epoch")).toBe("0");

    // 非 append-only 替换（retry/regenerate/edit 语义）→ epoch +1 → 旧 node 被替换
    renderTo(render, "完全不同的版本B内容", true);
    expect(oldOuter.isConnected).toBe(false);
    const newOuter = dom.window.document.querySelector("[data-kiro-stream-block-id]")!;
    expect(newOuter.getAttribute("data-kiro-stream-epoch")).toBe("1");
    expect(newOuter.getAttribute("data-kiro-stream-block-id")).toBe("0");
  });

  it("长段落（>256）inline 状态随 block 冻结：promotion 后仍为 chunk 表示，不升级 full-document parse", () => {
    let root: Root;
    act(() => {
      root = createRoot(dom.window.document.getElementById("root")!);
    });
    const render = (content: string, streaming: boolean) => {
      act(() => {
        root.render(React.createElement(KiroStreamingMarkdown, { content, streaming }));
      });
    };
    const unit = "这是一段没有空行的超长中文内容用于验证自适应切分与有界整形";
    const long = unit.repeat(40); // ~1000 chars

    // 增量增长（300 → 1000）：window cut 触发 chunk 表示 → fragment paragraph
    renderTo(render, long.slice(0, 300), true);
    renderTo(render, long, true);
    const fragmentP = dom.window.document.querySelector('[data-testid="kiro-inline-fragment-paragraph"]')!;
    expect(fragmentP).toBeTruthy();
    // 渲染过程中 promotion（append 空行 + 新段）
    renderTo(render, long + "\n\n第二段。", true);
    // fragment paragraph 保持同一 node（chunk 表示冻结，不再 KiroMarkdown(full 1000)）
    expect(fragmentP.isConnected).toBe(true);
    // promotion 不重 parse 全文（长段 promotion：text 未变 → 0；允许最终 mutable window 上界）
    expect(counters().promotionParsedChars).toBeLessThanOrEqual(512);
    // inline scanner 仍在增量工作（chunk 表示存在）
    expect(dom.window.document.querySelectorAll("[data-testid='kiro-inline-fragment-paragraph']").length).toBeGreaterThanOrEqual(1);
  });
});
