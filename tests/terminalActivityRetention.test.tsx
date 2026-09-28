/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { useTerminalActivityStore } from "@/store/useTerminalActivityStore";

/**
 * S-fix 长会话内存：已终态 terminal activity 有界保留（运行中永不丢弃）。
 * 此前 activities 数组随 app 生命周期单调增长（clearAll 从未被 kiro 链路调用）。
 */
function register(id: string) {
  useTerminalActivityStore.getState().registerActivity({
    executionId: id,
    toolCallId: `tc-${id}`,
    shell: "powershell",
    commandPreview: `echo ${id}`,
  });
}

function exit(id: string, seq = 1) {
  useTerminalActivityStore.getState().pushEvent({
    type: "exit",
    executionId: id,
    sequence: seq,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    durationMs: 10,
  });
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

beforeEach(() => {
  useTerminalActivityStore.getState().clearAll();
});

describe("terminal activity retention bound", () => {
  // 9 批 × 12（注册即退出的完整执行）= 108 个终态 → 裁剪到 100
  // （注：单批内 active 上限 12 先行，终态累积跨批增长才是本裁剪的目标场景）
  async function nineBatches(prefix: string) {
    for (let b = 0; b < 9; b++) {
      for (let i = 0; i < 12; i++) register(`${prefix}${b}-${i}`);
      for (let i = 0; i < 12; i++) exit(`${prefix}${b}-${i}`);
      await flush();
    }
  }

  it("108 个已终态 → 裁剪到 100，丢最旧、保最新", async () => {
    await nineBatches("e");
    const { activities } = useTerminalActivityStore.getState();
    expect(activities.length).toBe(100);
    const ids = activities.map((a) => a.executionId);
    // 108 - 100 = 8：丢最旧 8 个
    expect(ids).not.toContain("e0-0");
    expect(ids).not.toContain("e0-7");
    expect(ids).toContain("e0-8");
    expect(ids).toContain("e1-0");
    expect(ids).toContain("e8-11");
  });

  it("运行中项永不丢弃（即使总量超限）", async () => {
    await nineBatches("m");
    // 100 个终态 + 12 个运行中 = 112 → 剪掉最旧 12 个终态，运行中全留
    for (let i = 0; i < 12; i++) register(`live${i}`);
    await flush();
    const { activities } = useTerminalActivityStore.getState();
    expect(activities.length).toBe(100);
    const ids = activities.map((a) => a.executionId);
    for (let i = 0; i < 12; i++) expect(ids).toContain(`live${i}`);
    expect(ids).not.toContain("m0-0");
  });

  it("顺序稳定：保留项按注册顺序排列", async () => {
    await nineBatches("s");
    const { activities } = useTerminalActivityStore.getState();
    const ids = activities.map((a) => a.executionId);
    expect(ids[0]).toBe("s0-8");
    expect(ids[ids.length - 1]).toBe("s8-11");
  });
});
