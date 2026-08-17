import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Focus Integration Hotfix：Store 层 active Session 选择回归测试。
 * 背景：pauseFocusSession / finishFocusSession 只查找 status==="running"，
 * paused 会话被误判为「无 active Session」。
 */
const T0 = 1_000_000;
const MIN = 60_000;

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("Focus Store 状态转换回归（pause / finish）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("CASE 1: running → pauseFocusSession → ok:true → status=paused", async () => {
    const store = await freshStore();
    const started = store.getState().startFocusSession({ plannedMinutes: 30, now: T0 });
    if (!started.ok) throw new Error("start 应成功");
    const id = started.session.id;

    const paused = store.getState().pauseFocusSession(T0 + 10 * MIN);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.session.id).toBe(id);
    expect(paused.session.status).toBe("paused");
    expect(paused.session.accumulatedActiveMs).toBe(10 * MIN);
  });

  it("CASE 2: paused → 再次 pause → ok:false code=FOCUS_ALREADY_PAUSED", async () => {
    const store = await freshStore();
    store.getState().startFocusSession({ plannedMinutes: 30, now: T0 });
    store.getState().pauseFocusSession(T0 + 10 * MIN);

    const again = store.getState().pauseFocusSession(T0 + 20 * MIN);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("FOCUS_ALREADY_PAUSED");
    // 不产生状态变化
    const s = store.getState().focusSessions[0];
    expect(s.status).toBe("paused");
    expect(s.accumulatedActiveMs).toBe(10 * MIN);
  });

  it("CASE 3: paused → finish → completed(manual)，actualActiveMs 只含暂停前真实 active 时间", async () => {
    const store = await freshStore();
    store.getState().startFocusSession({ plannedMinutes: 30, now: T0 });
    store.getState().pauseFocusSession(T0 + 10 * MIN); // active 10 分钟

    const finished = store.getState().finishFocusSession(T0 + 60 * MIN); // 暂停后 50 分钟不进入 active
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.session.status).toBe("completed");
    expect(finished.session.endReason).toBe("manual");
    expect(finished.session.actualActiveMs).toBe(10 * MIN); // 暂停时间不计入
  });

  it("CASE 4: 无 active Session → pause → NO_ACTIVE_FOCUS_SESSION", async () => {
    const store = await freshStore();
    const r = store.getState().pauseFocusSession(T0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_ACTIVE_FOCUS_SESSION");
  });

  it("CASE 5: 无 active Session → finish → NO_ACTIVE_FOCUS_SESSION", async () => {
    const store = await freshStore();
    const r = store.getState().finishFocusSession(T0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_ACTIVE_FOCUS_SESSION");
  });
});
