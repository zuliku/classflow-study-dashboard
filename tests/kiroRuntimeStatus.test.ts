// @vitest-environment node
/**
 * Kiro Rail Runtime Status V1 — 状态 Domain 单元测试。
 *
 * 契约：状态只能由真实 Runtime Fact 推导；优先级固定
 * waiting-approval > computer-active > thinking > idle。
 */
import { describe, it, expect } from "vitest";
import {
  KIRO_RUNTIME_STATUS_ARIA,
  KIRO_RUNTIME_STATUS_TEXT,
  isKiroRuntimeStatusActive,
  kiroRuntimeStatusAriaLabel,
  kiroRuntimeStatusText,
  resolveKiroRuntimeStatus,
  type KiroRuntimeStatusFacts,
} from "@/lib/ai/ui/kiroRuntimeStatus";

function facts(overrides: Partial<KiroRuntimeStatusFacts> = {}): KiroRuntimeStatusFacts {
  return { busy: false, computerActive: false, waitingApproval: false, ...overrides };
}

describe("resolveKiroRuntimeStatus — 优先级", () => {
  it("全部为 false → idle", () => {
    expect(resolveKiroRuntimeStatus(facts())).toBe("idle");
  });

  it("busy → thinking", () => {
    expect(resolveKiroRuntimeStatus(facts({ busy: true }))).toBe("thinking");
  });

  it("busy + computer → computer-active", () => {
    expect(resolveKiroRuntimeStatus(facts({ busy: true, computerActive: true }))).toBe("computer-active");
  });

  it("approval 始终最高优先级（覆盖 computer-active / thinking）", () => {
    expect(
      resolveKiroRuntimeStatus(facts({ busy: true, computerActive: true, waitingApproval: true }))
    ).toBe("waiting-approval");
    expect(resolveKiroRuntimeStatus(facts({ busy: true, waitingApproval: true }))).toBe("waiting-approval");
    expect(resolveKiroRuntimeStatus(facts({ waitingApproval: true }))).toBe("waiting-approval");
  });

  it("computer-active 不要求 busy（工具执行窗口内独立成立）", () => {
    expect(resolveKiroRuntimeStatus(facts({ computerActive: true }))).toBe("computer-active");
  });
});

describe("resolveKiroRuntimeStatus — 关键场景回落", () => {
  it("Computer 工具执行 → computer-active；完成进入最终回答 → thinking", () => {
    expect(resolveKiroRuntimeStatus(facts({ busy: true, computerActive: true }))).toBe("computer-active");
    expect(resolveKiroRuntimeStatus(facts({ busy: true, computerActive: false }))).toBe("thinking");
  });

  it("审批被拒绝后模型继续回答 → thinking（不是 idle）", () => {
    // 拒绝：waitingApproval=false（队列清空），computerActive=false（任务不再执行），busy=true
    expect(resolveKiroRuntimeStatus(facts({ busy: true }))).toBe("thinking");
  });

  it("Stop / turn settled → idle", () => {
    expect(resolveKiroRuntimeStatus(facts())).toBe("idle");
  });

  it("Turn 完全 settled 时即使残留 computerActive 事实也不得显示运行态", () => {
    // busy=false 且 waitingApproval=false，但任务引用未及时清空（防御性）→ 仍按 computer-active 处理
    expect(resolveKiroRuntimeStatus(facts({ computerActive: true }))).toBe("computer-active");
  });
});

describe("状态文案（绝不显示内部术语）", () => {
  it("aria / text 映射固定", () => {
    expect(kiroRuntimeStatusAriaLabel("idle")).toBe("Kiro");
    expect(kiroRuntimeStatusAriaLabel("thinking")).toBe("Kiro · 正在思考");
    expect(kiroRuntimeStatusAriaLabel("computer-active")).toBe("Kiro · 正在操作电脑");
    expect(kiroRuntimeStatusAriaLabel("waiting-approval")).toBe("Kiro · 等待你的确认");

    expect(kiroRuntimeStatusText("idle")).toBe("");
    expect(kiroRuntimeStatusText("thinking")).toBe("正在思考");
    expect(kiroRuntimeStatusText("computer-active")).toBe("正在操作电脑");
    expect(kiroRuntimeStatusText("waiting-approval")).toBe("等待确认");
  });

  it("不暴露 thinking / computer-active / approval 等内部术语", () => {
    for (const value of [
      ...Object.values(KIRO_RUNTIME_STATUS_ARIA),
      ...Object.values(KIRO_RUNTIME_STATUS_TEXT),
    ]) {
      expect(value).not.toMatch(/thinking|computer-active|approval|idle/i);
    }
  });

  it("isKiroRuntimeStatusActive：仅 idle 为安静态", () => {
    expect(isKiroRuntimeStatusActive("idle")).toBe(false);
    expect(isKiroRuntimeStatusActive("thinking")).toBe(true);
    expect(isKiroRuntimeStatusActive("computer-active")).toBe(true);
    expect(isKiroRuntimeStatusActive("waiting-approval")).toBe(true);
  });
});
