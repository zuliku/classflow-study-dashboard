import { describe, it, expect, vi, beforeEach } from "vitest";
import { FocusSession } from "@/types";
import {
  FocusRuntimePhase,
  getFocusRuntimeDecision,
} from "@/lib/focus/focusRuntime";

const T0 = 1_000_000;

function mk(patch: Partial<FocusSession>): FocusSession {
  return {
    id: "f1",
    plannedMinutes: 30,
    startedAt: T0,
    accumulatedActiveMs: 0,
    status: "running",
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  };
}

describe("getFocusRuntimeDecision", () => {
  it("无 session → none", () => {
    expect(getFocusRuntimeDecision(null, T0, "running")).toBe("none");
    expect(getFocusRuntimeDecision(undefined, T0, "booting")).toBe("none");
  });

  it("paused → none", () => {
    const s = mk({ status: "paused", accumulatedActiveMs: 60_000 });
    expect(getFocusRuntimeDecision(s, T0 + 3600_000, "running")).toBe("none");
  });

  it("paused 但已恰好到点（remaining=0）→ 结算（不留下 00:00 僵尸会话）", () => {
    const s = mk({ status: "paused", accumulatedActiveMs: 30 * 60_000 });
    expect(getFocusRuntimeDecision(s, T0 + 3600_000, "running")).toBe("complete-live");
    expect(getFocusRuntimeDecision(s, T0 + 3600_000, "booting")).toBe("complete-recovered");
  });

  it("running 但 remaining > 0 → none", () => {
    const s = mk({ activeStartedAt: T0 });
    expect(getFocusRuntimeDecision(s, T0 + 60_000, "running")).toBe("none");
    expect(getFocusRuntimeDecision(s, T0 + 60_000, "booting")).toBe("none");
  });

  it("due + booting → complete-recovered", () => {
    const s = mk({ activeStartedAt: T0 - 30 * 60_000 });
    expect(getFocusRuntimeDecision(s, T0, "booting")).toBe("complete-recovered");
  });

  it("due + running phase → complete-live", () => {
    const s = mk({ activeStartedAt: T0 - 30 * 60_000 });
    expect(getFocusRuntimeDecision(s, T0, "running")).toBe("complete-live");
  });

  it("恰好 remaining = 0（due 边界）→ complete", () => {
    const s = mk({ activeStartedAt: T0 - 30 * 60_000 });
    expect(getFocusRuntimeDecision(s, T0, "running")).toBe("complete-live");
  });
});

describe("Store completeFocusSession（第二次调用不能成功）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    return mod.useAppStore;
  }

  it("live 完成成功后再次 complete → 失败（不重复结算）", async () => {
    const store = await freshStore();
    const start = store.getState().startFocusSession({ plannedMinutes: 30, now: T0 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const id = start.session.id;

    const first = store.getState().completeFocusSession(id, "timer", T0 + 30 * 60_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.session.status).toBe("completed");
    expect(first.session.actualActiveMs).toBe(30 * 60_000);
    expect(first.session.endReason).toBe("timer");

    const second = store.getState().completeFocusSession(id, "timer", T0 + 40 * 60_000);
    expect(second.ok).toBe(false);
    // 第二次结算不产生新的 actualActiveMs
    const persisted = store.getState().focusSessions.find((s) => s.id === id)!;
    expect(persisted.actualActiveMs).toBe(30 * 60_000);
  });

  it("paused 到点边界允许完成结算（actual clamp 到 planned）", async () => {
    const store = await freshStore();
    const start = store.getState().startFocusSession({ plannedMinutes: 1, now: T0 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const id = start.session.id;

    const paused = store.getState().pauseFocusSession(T0 + 60_000);
    expect(paused.ok).toBe(true);
    const result = store.getState().completeFocusSession(id, "timer", T0 + 120_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.status).toBe("completed");
    expect(result.session.actualActiveMs).toBe(60_000);
    expect(result.session.endReason).toBe("timer");
  });

  it("paused 但尚未到点 → complete 失败（保持冻结，不被提前记为 timer）", async () => {
    const store = await freshStore();
    const start = store.getState().startFocusSession({ plannedMinutes: 30, now: T0 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const id = start.session.id;

    const paused = store.getState().pauseFocusSession(T0 + 60_000);
    expect(paused.ok).toBe(true);
    const result = store.getState().completeFocusSession(id, "timer", T0 + 120_000);
    expect(result.ok).toBe(false);
    expect(store.getState().focusSessions.find((s) => s.id === id)!.status).toBe("paused");
  });
});
