// @vitest-environment jsdom
/**
 * P5 — 「最近画面」Preview 组件 / Store 测试（§57）。
 *
 * 覆盖：evidence 存在才显示；sessionId 精确匹配（旧 session 不显示）；展开面板只读
 * （alt / pointer-events-none / 不可拖拽）；不调用 bridge.observe（不产生额外观察）；
 * 只保存最新一张；完全 ephemeral（不 persist / 不进入 history / audit）。
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KiroComputerSessionPreview } from "@/components/kiro/computer/session/KiroComputerSessionPreview";
import { useDesktopSessionPreviewStore } from "@/store/useDesktopSessionPreviewStore";
import { FakeDesktopWorld, installFakeDesktopBridge } from "@/tests/helpers/fakeDesktopRuntime";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";
const SESSION_B = "cs-99999999-8888-7777-6666-555555555555";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useDesktopSessionPreviewStore.getState().clearPreview();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionPreviewStore.getState().clearPreview();
});

/** 源码扫描：剥离注释（注释里的禁止清单不算违规） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function seedPreview(sessionId: string, dataUrl = "data:image/jpeg;base64,AAAA") {
  useDesktopSessionPreviewStore.getState().setPreview({
    sessionId,
    dataUrl,
    mimeType: "image/jpeg",
    width: 1280,
    height: 800,
    capturedAt: "2026-09-23T10:00:00.000Z",
    appName: "wechat",
    windowTitle: "文件传输助手",
    appProfileBlocked: false,
  });
}

async function renderPreview(sessionId: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<KiroComputerSessionPreview sessionId={sessionId} />);
  });
}

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector) as HTMLElement | null;
}

describe("P5 Preview — 显示与只读交互", () => {
  it("无 evidence → 不显示「最近画面」按钮（绝不主动截图）", async () => {
    await renderPreview(SESSION);
    expect(q('[data-testid="computer-session-preview-toggle"]')).toBeNull();
  });

  it("evidence sessionId 不匹配 → 完全忽略（旧 session 截图不闪现）", async () => {
    seedPreview(SESSION_B);
    await renderPreview(SESSION);
    expect(q('[data-testid="computer-session-preview-toggle"]')).toBeNull();
  });

  it("匹配 → 展开面板：应用 · 窗口 + 只读图片 + 最近一次查看", async () => {
    seedPreview(SESSION);
    await renderPreview(SESSION);
    const toggle = q('[data-testid="computer-session-preview-toggle"]')!;
    expect(toggle.textContent).toContain("最近画面");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("kiro-computer-session-preview-panel");

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = q('[data-testid="computer-session-preview"]')!;
    expect(panel.textContent).toContain("微信".length ? "wechat · 文件传输助手" : "");
    expect(panel.textContent).toContain("最近一次查看");

    const img = panel.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("Kiro 最近一次桌面观察");
    expect(img.getAttribute("draggable")).toBe("false");
    expect(img.className).toContain("pointer-events-none");
    expect(img.className).toContain("object-contain");
    // 只读：不可 focus
    expect(img.getAttribute("tabindex")).toBeNull();
  });

  it("点击「最近画面」不调用 bridge.observe（不增加 observation count）", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    seedPreview(SESSION);
    await renderPreview(SESSION);

    await act(async () => {
      q('[data-testid="computer-session-preview-toggle"]')!.click();
    });
    expect(world.observe).not.toHaveBeenCalled();
  });
});

describe("P5 Preview Store — ephemeral / 最小数据面", () => {
  it("只保存最新一张（替换而非累积）", () => {
    seedPreview(SESSION, "data:image/jpeg;base64,AAAA");
    seedPreview(SESSION, "data:image/jpeg;base64,BBBB");
    const preview = useDesktopSessionPreviewStore.getState().preview;
    expect(preview?.dataUrl).toBe("data:image/jpeg;base64,BBBB");
    expect(Object.keys(useDesktopSessionPreviewStore.getState())).not.toContain("history");
    expect(Object.keys(useDesktopSessionPreviewStore.getState())).not.toContain("frames");
  });

  it("blocked evidence → 拒绝写入", () => {
    useDesktopSessionPreviewStore.getState().setPreview({
      sessionId: SESSION,
      dataUrl: "data:image/jpeg;base64,AAAA",
      mimeType: "image/jpeg",
      width: 1280,
      height: 800,
      capturedAt: "2026-09-23T10:00:00.000Z",
      appName: "bank",
      windowTitle: "网上银行",
      appProfileBlocked: true,
    });
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });

  it("clearPreview(sessionId)：只清理匹配 session（旧 session 迟到事件不影响新 session）", () => {
    seedPreview(SESSION_B);
    useDesktopSessionPreviewStore.getState().clearPreview(SESSION);
    expect(useDesktopSessionPreviewStore.getState().preview?.sessionId).toBe(SESSION_B);
    useDesktopSessionPreviewStore.getState().clearPreview(SESSION_B);
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });

  it("不 persist（刷新即消失）；不进入 localStorage", () => {
    localStorage.clear();
    seedPreview(SESSION);
    expect(localStorage.getItem("classflow-desktop-session-preview")).toBeNull();
    expect(localStorage.length).toBe(0);
    const source = stripComments(
      readFileSync(join(process.cwd(), "store/useDesktopSessionPreviewStore.ts"), "utf8")
    );
    expect(source).not.toContain("persist(");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("indexedDB");
  });

  it("Desktop Session store 不保存 screenshot（既有 contract 保持）", () => {
    const source = readFileSync(join(process.cwd(), "store/useDesktopSessionStore.ts"), "utf8");
    expect(source).not.toContain("dataUrl");
    expect(source).not.toContain("screenshot");
  });

  it("Preview / evidence 不进入 Conversation history / Audit", () => {
    const previewStore = stripComments(
      readFileSync(join(process.cwd(), "store/useDesktopSessionPreviewStore.ts"), "utf8")
    );
    expect(previewStore).not.toContain("history");
    expect(previewStore).not.toContain("audit");
    const evidence = stripComments(
      readFileSync(join(process.cwd(), "lib/ai/computer/gui/uiEvidence.ts"), "utf8")
    );
    expect(evidence).not.toContain("history");
    expect(evidence).not.toContain("audit");
    // 历史持久化路径不引用 preview store / evidence
    for (const file of [
      "lib/ai/history/persist.ts",
      "lib/ai/history/sanitize.ts",
      "lib/ai/computer/audit.ts",
    ]) {
      let source = "";
      try {
        source = readFileSync(join(process.cwd(), file), "utf8");
      } catch {
        continue;
      }
      expect(source, file).not.toContain("useDesktopSessionPreviewStore");
      expect(source, file).not.toContain("uiEvidence");
    }
  });

  it("Preview 组件不调用 bridge.observe / 不 import observe 模块", () => {
    const source = stripComments(
      readFileSync(
        join(process.cwd(), "components/kiro/computer/session/KiroComputerSessionPreview.tsx"),
        "utf8"
      )
    );
    expect(source).not.toContain("bridge.observe");
    expect(source).not.toContain("executeKiroObserveDesktop");
    expect(source).not.toContain("observationId");
  });

  it("evidence 类型不含 elementId / observationId / windowId / PID / HWND", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/ai/computer/gui/uiEvidence.ts"),
      "utf8"
    );
    // 注释中的禁止清单不计入（只看 interface 字段名）
    const fields = source
      .split("\n")
      .filter((line) => /^\s{2}\w+[?]?:/.test(line))
      .join("\n");
    for (const forbidden of ["elementId", "observationId", "windowId", "pid", "hwnd", "elements"]) {
      expect(fields.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
