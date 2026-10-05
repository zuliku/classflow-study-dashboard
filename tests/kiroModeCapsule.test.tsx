// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { KiroModeCapsule } from "@/components/kiro/KiroModeCapsule";

describe("KiroModeCapsule（聊天 / 工作两段）", () => {
  it("只渲染聊天与工作两段，无模型段", () => {
    const { container, unmount } = render(
      <KiroModeCapsule active="chat" onSelect={vi.fn()} />
    );
    expect(screen.getByText("聊天")).toBeTruthy();
    expect(screen.getByText("工作")).toBeTruthy();
    expect(container.textContent).not.toContain("仅规划");
    expect(container.textContent).not.toContain("受控访问");
    expect(container.querySelector('[data-testid="kiro-mode-capsule-model"]')).toBeNull();
    unmount();
    cleanup();
  });

  it("active 段 aria-pressed；点击直选", () => {
    const onSelect = vi.fn();
    const { unmount } = render(<KiroModeCapsule active="work" onSelect={onSelect} />);
    expect(screen.getByText("工作").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("聊天").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByText("聊天"));
    expect(onSelect).toHaveBeenCalledWith("chat");
    unmount();
    cleanup();
  });

  it("Turn 运行中切回聊天禁用（改当前 Turn scope），切工作常开", () => {
    const onSelect = vi.fn();
    const { unmount } = render(<KiroModeCapsule active="work" turnInFlight onSelect={onSelect} />);
    expect((screen.getByText("聊天") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("工作") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("工作"));
    expect(onSelect).toHaveBeenCalledWith("work");
    unmount();
    cleanup();
  });
});
