// @vitest-environment jsdom
/**
 * 面板内 drill 切换动效回归：
 * - KiroComposerAddMenu（root ↔ 课程资料/上下文）：行为级断言
 * - KiroMessage More（actions ↔ 来源）、AssignmentContextMenu（main ↔ priority/ddl）：源码契约断言
 * 统一语法：keyed view + ux-kiro-view-enter + --motion-shift-x（进入 +4px / 返回 -4px）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { KiroComposerAddMenu } from "@/components/kiro/composer/KiroComposerAddMenu";
import { useAppStore } from "@/store/useAppStore";

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

function renderMenu() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <KiroComposerAddMenu
        scopeLocked={false}
        preferencesLocked={false}
        webSearchEnabled={false}
        visionEnabled
        onToggleWebSearch={vi.fn()}
        onFiles={vi.fn()}
        onAddMaterial={vi.fn()}
        onAddContext={vi.fn()}
        onClose={vi.fn()}
      />
    );
  });
  return container;
}

function viewBox() {
  return container!.querySelector(
    '[data-testid="kiro-composer-add-menu"] > .ux-kiro-view-enter'
  ) as HTMLElement | null;
}

beforeEach(() => {
  useAppStore.setState({
    courses: [
      {
        id: "c1",
        name: "高等数学",
        materials: [{ id: "m1", title: "讲义一", type: "file" }],
      },
    ] as unknown as ReturnType<typeof useAppStore.getState>["courses"],
  });
});

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
  useAppStore.setState({ courses: [] });
});

describe("KiroComposerAddMenu drill 切换动效", () => {
  it("root 初态：左向进入容器（-4px）", () => {
    renderMenu();
    const box = viewBox();
    expect(box).toBeTruthy();
    expect(box!.style.getPropertyValue("--motion-shift-x")).toBe("-4px");
  });

  it("root → 课程资料：右向进入（+4px），返回后恢复左向", () => {
    renderMenu();
    const entry = Array.from(container!.querySelectorAll('button[role="menuitem"]')).find((b) =>
      b.textContent?.includes("课程资料")
    ) as HTMLElement;
    expect(entry).toBeTruthy();
    act(() => {
      entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sub = viewBox();
    expect(sub).toBeTruthy();
    expect(sub!.style.getPropertyValue("--motion-shift-x")).toBe("4px");
    // 子视图带返回入口（标题即来源名）
    expect(sub!.textContent).toContain("课程资料");

    const back = Array.from(sub!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("课程资料")
    ) as HTMLElement;
    act(() => {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const backRoot = viewBox();
    expect(backRoot).toBeTruthy();
    expect(backRoot!.style.getPropertyValue("--motion-shift-x")).toBe("-4px");
  });
});

describe("同类 drill 切换源码契约", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  it("KiroMessage More（actions ↔ 来源）：keyed + 方向进入", () => {
    const src = read("components/kiro/KiroMessage.tsx");
    expect(src).toMatch(/key=\{moreView\}[\s\S]*?ux-kiro-view-enter/);
    expect(src).toMatch(/--motion-shift-x.*moreView === "sources" \? "4px" : "-4px"/);
  });

  it("AssignmentContextMenu（main ↔ priority/ddl）：keyed + 方向进入", () => {
    const src = read("components/assignment/AssignmentContextMenu.tsx");
    expect(src).toMatch(/key=\{view\}[\s\S]*?ux-kiro-view-enter/);
    expect(src).toMatch(/--motion-shift-x.*view === "main" \? "-4px" : "4px"/);
  });
});

describe("横向滚动条闪现回归（overflow-y-auto 必须显式 overflow-x-clip）", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("Popover 基座：进入 ±3px / drill ±4px 不在面板底部闪出横向滚动条", () => {
    const src = read("components/ui/Popover.tsx");
    expect(src).toMatch(/overflow-y-auto overflow-x-clip/);
  });

  it.each([
    "components/kiro/composer/KiroComposerAddMenu.tsx",
    "components/kiro/KiroMaterialPicker.tsx",
    "components/assignment/AssignmentContextMenu.tsx",
    "components/kiro/KiroAttachmentChip.tsx",
    "components/kiro/KiroContextBar.tsx",
    "components/kiro/computer/KiroRecentArtifactsPopover.tsx",
    "components/ui/Select.tsx",
    "components/motion/MotionGallery.tsx",
  ])("%s：纵向滚动/浮层容器裁剪横向溢出", (f) => {
    expect(read(f)).toMatch(/overflow-x-clip/);
  });
});
