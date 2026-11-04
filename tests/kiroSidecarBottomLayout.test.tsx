// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    suggestionsKind: "assignment",
    suggestionsGen: 2,
    lastUserTurnGen: 0,
    chat: { send: vi.fn() },
  }),
}));

import { KiroContextSuggestions } from "@/components/kiro/KiroContextSuggestions";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * Sidecar 底部布局回归：
 * - follow-up 建议必须与 Composer 同宽、同 inset，且允许收缩（否则右列贴边被 Shell 裁切）；
 * - 错误态隐藏 follow-up 建议，避免短 Sidecar 中固定底部区域挤压 Composer。
 */
describe("Kiro sidecar bottom layout", () => {
  it("compact suggestions：根/网格为 w-full min-w-0，inset 提供与 Composer 一致的横向留白", () => {
    render(<KiroContextSuggestions compact inset />);
    const root = screen.getByTestId("kiro-context-suggestions");
    expect(root.className).toContain("w-full");
    expect(root.className).toContain("min-w-0");
    expect(root.className).toContain("px-3");
    const grid = root.firstElementChild as HTMLElement;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("w-full");
    expect(grid.className).toContain("min-w-0");
  });

  it("ChatSurface：follow-up 建议使用 inset，并在 chat.error 时隐藏", () => {
    const src = read("components/kiro/KiroChatSurface.tsx");
    expect(src).toContain("<KiroContextSuggestions compact inset />");
    expect(src).toContain("hasContextSuggestions && !chat.error");
  });

  it("EmptyState：建议容器撑满可用宽度并居中（避免 shrink-to-fit 造成窄列/左对齐错位）", () => {
    const src = read("components/kiro/KiroEmptyState.tsx");
    expect(src).toContain('data-kiro-empty-suggestions className="w-full min-w-0"');
    expect(src).toContain("w-full max-w-md mx-auto");
  });
});
