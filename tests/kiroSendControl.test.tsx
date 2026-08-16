// @vitest-environment jsdom
/**
 * KiroSendControl（Motion V1 §14/§47）：四态 + DOM identity + aria-label。
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { KiroSendControl } from "@/components/kiro/KiroSendControl";

function render(props: {
  canSend: boolean;
  preparing: boolean;
  inFlight: boolean;
  onSend?: () => void;
  onStop?: () => void;
}) {
  const onSend = props.onSend ?? vi.fn();
  const onStop = props.onStop ?? vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = (next: Partial<typeof props>) =>
    act(() => {
      root.render(
        <KiroSendControl
          canSend={next.canSend ?? props.canSend}
          preparing={next.preparing ?? props.preparing}
          inFlight={next.inFlight ?? props.inFlight}
          onSend={onSend}
          onStop={onStop}
        />
      );
    });
  act(() => {
    root.render(
      <KiroSendControl
        canSend={props.canSend}
        preparing={props.preparing}
        inFlight={props.inFlight}
        onSend={onSend}
        onStop={onStop}
      />
    );
  });
  const button = () => container.querySelector("button") as HTMLButtonElement;
  return {
    container,
    onSend,
    onStop,
    button,
    rerender,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("KiroSendControl", () => {
  it("disabled（idle）：Arrow + disabled + aria 发送", () => {
    const h = render({ canSend: false, preparing: false, inFlight: false });
    expect(h.button().getAttribute("aria-label")).toBe("发送");
    expect(h.button().disabled).toBe(true);
    expect(h.button().querySelector('[data-send-icon="arrow"]')).not.toBeNull();
    expect(h.button().getAttribute("data-send-state")).toBe("idle");
    h.cleanup();
  });

  it("ready：Arrow + 可点击 → onSend", () => {
    const h = render({ canSend: true, preparing: false, inFlight: false });
    expect(h.button().disabled).toBe(false);
    expect(h.button().getAttribute("data-send-state")).toBe("ready");
    act(() => h.button().click());
    expect(h.onSend).toHaveBeenCalledTimes(1);
    expect(h.onStop).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("preparing：Loader + disabled + aria 正在准备", () => {
    const h = render({ canSend: true, preparing: true, inFlight: false });
    expect(h.button().getAttribute("aria-label")).toBe("正在准备");
    expect(h.button().disabled).toBe(true);
    expect(h.button().querySelector('[data-send-icon="loader"]')).not.toBeNull();
    expect(h.button().getAttribute("data-send-state")).toBe("preparing");
    act(() => h.button().click());
    expect(h.onSend).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("inFlight：Square + 可点击 → onStop", () => {
    const h = render({ canSend: true, preparing: false, inFlight: true });
    expect(h.button().getAttribute("aria-label")).toBe("停止生成");
    expect(h.button().disabled).toBe(false);
    expect(h.button().querySelector('[data-send-icon="stop"]')).not.toBeNull();
    expect(h.button().getAttribute("data-send-state")).toBe("stop");
    act(() => h.button().click());
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(h.onSend).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("状态切换：button DOM identity 保持（不 remount）", () => {
    const h = render({ canSend: false, preparing: false, inFlight: false });
    const before = h.button();
    h.rerender({ canSend: true });
    h.rerender({ preparing: true });
    h.rerender({ inFlight: true });
    const after = h.button();
    expect(after).toBe(before);
    expect(after.getAttribute("data-send-state")).toBe("stop");
    h.cleanup();
  });
});
