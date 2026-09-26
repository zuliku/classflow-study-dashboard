/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApprovalCountdown, formatApprovalCountdown } from "@/components/kiro/run/ApprovalCountdown";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";

afterEach(() => {
  cleanup();
  useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: null });
});

/**
 * S-fix：审批 3 分钟自动取消可预期 —— deadline 入 store，UI 倒计时。
 */
describe("formatApprovalCountdown", () => {
  it("分+秒格式", () => {
    expect(formatApprovalCountdown(180_000)).toBe("3 分 00 秒");
    expect(formatApprovalCountdown(119_000)).toBe("1 分 59 秒");
    expect(formatApprovalCountdown(59_000)).toBe("59 秒");
    expect(formatApprovalCountdown(0)).toBe("0 秒");
    expect(formatApprovalCountdown(-5000)).toBe("0 秒");
  });
});

describe("ApprovalCountdown", () => {
  it("无 deadline 渲染 null（超时 effect 写入前一帧空白）", () => {
    const { container } = render(<ApprovalCountdown />);
    expect(container.textContent).toBe("");
  });

  it("有 deadline 显示剩余时间（非紧急态）", () => {
    useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: Date.now() + 120_000 });
    render(<ApprovalCountdown />);
    const el = screen.getByRole("timer");
    expect(el.textContent).toContain("内未决定将自动取消");
    expect(el.className).not.toContain("text-danger");
  });

  it("30s 内转 danger 强调", () => {
    useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: Date.now() + 20_000 });
    render(<ApprovalCountdown />);
    const el = screen.getByRole("timer");
    expect(el.textContent).toContain("后自动取消");
    expect(el.className).toContain("text-danger");
  });

  it("过期 deadline 渲染 null（超时决策落地即消失）", () => {
    useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: Date.now() - 1000 });
    const { container } = render(<ApprovalCountdown />);
    expect(container.textContent).toBe("");
  });
});

describe("approvalDeadlineAt store 契约", () => {
  it("setPendingApproval(null) 同步清理 deadline", () => {
    useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: Date.now() + 60_000 });
    useKiroComputerRuntimeStore.getState().setPendingApproval(null);
    expect(useKiroComputerRuntimeStore.getState().approvalDeadlineAt).toBeNull();
  });

  it("clearRuntime 清理 deadline", () => {
    useKiroComputerRuntimeStore.setState({ approvalDeadlineAt: Date.now() + 60_000 });
    useKiroComputerRuntimeStore.getState().clearRuntime();
    expect(useKiroComputerRuntimeStore.getState().approvalDeadlineAt).toBeNull();
  });
});
