// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

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

// Reduced Motion flag：hoisted mock 经 flag 控制（避免文件级 vi.mock 影响全部用例）
const reducedFlag = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useEffectiveReducedMotion", () => ({
  useEffectiveReducedMotion: () => reducedFlag.value,
}));

import { PageTransition } from "@/components/ui/PageTransition";
import { resolveWorkspaceMotionDirection } from "@/components/layout/navItems";

/**
 * Workflow UX Motion Productization M1 —— Workspace Page Direction：
 * MAIN workspace 之间有方向感（Sidebar 顺序向下 forward / 向上 backward，±4px 进入）；
 * Kiro（非 MAIN）与首次挂载 → neutral；Reduced Motion → neutral（contract 不被绕过）。
 */

function renderPT(tab: string) {
  return render(
    <PageTransition tab={tab}>
      <div>content-{tab}</div>
    </PageTransition>
  );
}

function rerenderPT(ui: ReturnType<typeof renderPT>, tab: string) {
  ui.rerender(
    <PageTransition tab={tab}>
      <div>content-{tab}</div>
    </PageTransition>
  );
}

const dirOf = () =>
  document.querySelector("[data-motion-direction]")?.getAttribute("data-motion-direction");

beforeEach(() => {
  reducedFlag.value = false;
});

describe("resolveWorkspaceMotionDirection（pure）", () => {
  it("Sidebar 顺序向下 → forward；向上 → backward", () => {
    expect(resolveWorkspaceMotionDirection("overview", "assignments")).toBe("forward");
    expect(resolveWorkspaceMotionDirection("assignments", "overview")).toBe("backward");
    expect(resolveWorkspaceMotionDirection("group", "timetable")).toBe("backward");
  });
});

describe("PageTransition directional motion", () => {
  afterEach(() => {
    cleanupPT();
  });

  function cleanupPT() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cleanup } = require("@testing-library/react") as typeof import("@testing-library/react");
    cleanup();
  }

  it("initial mount → neutral（App 启动直接落最终页面，无方向滑入）", () => {
    renderPT("overview");
    expect(dirOf()).toBe("neutral");
  });

  it("MAIN forward：overview → assignments → forward", () => {
    const ui = renderPT("overview");
    rerenderPT(ui, "assignments");
    expect(dirOf()).toBe("forward");
  });

  it("MAIN backward：assignments → overview → backward", () => {
    const ui = renderPT("assignments");
    rerenderPT(ui, "overview");
    expect(dirOf()).toBe("backward");
  });

  it("Kiro neutral：任意 MAIN ↔ kiro → neutral（独立 Featured Workspace）", () => {
    const ui = renderPT("overview");
    rerenderPT(ui, "kiro");
    expect(dirOf()).toBe("neutral");
    rerenderPT(ui, "timetable");
    expect(dirOf()).toBe("neutral");
  });

  it("Reduced Motion → 始终 neutral（contract 不被绕过）", () => {
    reducedFlag.value = true;
    const ui = renderPT("overview");
    rerenderPT(ui, "assignments");
    expect(dirOf()).toBe("neutral");
  });
});
