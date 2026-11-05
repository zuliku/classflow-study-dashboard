// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { useToastStore } from "@/store/useToastStore";

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

describe("ToastViewport motion", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("关闭 Toast 时进入 ExitCollapse，退出完成后再从 store 移除", async () => {
    act(() => {
      useToastStore.getState().pushToast({ message: "测试提示", type: "success" });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ToastViewport />);
    });

    const item = container.querySelector('[data-testid="toast-item"]');
    expect(item).toBeTruthy();
    const collapse = item!.parentElement?.parentElement as HTMLElement | null;
    expect(collapse?.getAttribute("data-state")).toBe("present");

    const close = container.querySelector('button[aria-label="关闭提示"]') as HTMLButtonElement;
    await act(async () => {
      close.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(collapse?.getAttribute("data-state")).toBe("exiting");
    expect(useToastStore.getState().toasts).toHaveLength(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 210));
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });

  it("队列超限：旧 Toast 标记 retiring 并折叠退出，不直接硬删", async () => {
    act(() => {
      for (const message of ["一", "二", "三", "四"]) {
        useToastStore.getState().pushToast({ message, type: "success", duration: 60_000 });
      }
    });
    expect(useToastStore.getState().toasts).toHaveLength(4);
    expect(useToastStore.getState().toasts.filter((t) => t.retiring)).toHaveLength(1);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ToastViewport />);
    });
    expect(container.querySelectorAll('[data-testid="toast-item"]')).toHaveLength(4);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 210));
    });
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid="toast-item"]')).toHaveLength(3);

    act(() => root.unmount());
    container.remove();
  });
});
