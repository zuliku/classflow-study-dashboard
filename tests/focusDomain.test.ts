import { describe, it, expect } from "vitest";
import { FocusSession } from "@/types";
import {
  completeFocusSessionRecord,
  deriveFocusClock,
  finishFocusSessionRecord,
  normalizeFocusSession,
  pauseFocusSessionRecord,
  resumeFocusSessionRecord,
  sumCompletedFocusMs,
} from "@/lib/focus/focusDomain";

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

describe("deriveFocusClock", () => {
  it("running：elapsed = accumulated + max(0, now - activeStartedAt)", () => {
    const s = mk({ activeStartedAt: T0 + 120_000 });
    const clock = deriveFocusClock(s, T0 + 150_000);
    expect(clock.elapsedMs).toBe(30_000);
    expect(clock.remainingMs).toBe(30 * 60_000 - 30_000);
  });

  it("paused：elapsed = accumulated，不随 now 增长", () => {
    const s = mk({ status: "paused", accumulatedActiveMs: 5 * 60_000 });
    const clock = deriveFocusClock(s, T0 + 3600_000);
    expect(clock.elapsedMs).toBe(5 * 60_000);
  });
});

describe("pause / resume", () => {
  it("pause → 很久后 resume：暂停区间不计入 active 时间", () => {
    let s = mk({ activeStartedAt: T0 + 60_000 });
    s = pauseFocusSessionRecord(s, T0 + 120_000); // active 60s
    expect(s.status).toBe("paused");
    expect(s.accumulatedActiveMs).toBe(60_000);
    expect(s.activeStartedAt).toBeUndefined();

    s = resumeFocusSessionRecord(s, T0 + 3600_000); // 暂停了 1h
    expect(s.status).toBe("running");
    expect(s.activeStartedAt).toBe(T0 + 3600_000);
    expect(s.accumulatedActiveMs).toBe(60_000); // 暂停区间不计入
  });
});

describe("finish / complete", () => {
  it("manual finish：actualActiveMs = 真正 active 时间，不把暂停时间计入", () => {
    let s = mk({ activeStartedAt: T0 + 60_000 });
    s = pauseFocusSessionRecord(s, T0 + 120_000); // active 60s
    s = resumeFocusSessionRecord(s, T0 + 3600_000);
    const finished = finishFocusSessionRecord(s, T0 + 3600_000 + 120_000); // 再 active 120s
    expect(finished.status).toBe("completed");
    expect(finished.endReason).toBe("manual");
    expect(finished.actualActiveMs).toBe(180_000);
    expect(finished.endedAt).toBe(T0 + 3600_000 + 120_000);
  });

  it("natural timer / recovered 完成：actualActiveMs clamp 到 plannedMs（不会 30分20秒）", () => {
    const s = mk({ activeStartedAt: T0, accumulatedActiveMs: 30 * 60_000 - 10_000 });
    const late = completeFocusSessionRecord(s, "timer", T0 + 30 * 60_000 + 20_000);
    expect(late.actualActiveMs).toBe(30 * 60_000);
    const recovered = completeFocusSessionRecord(s, "recovered", T0 + 60 * 60_000);
    expect(recovered.actualActiveMs).toBe(30 * 60_000);
  });

  it("manual 提前结束：actualActiveMs 为真实 active 时间（可小于 plannedMs）", () => {
    const s = mk({ activeStartedAt: T0 });
    const f = finishFocusSessionRecord(s, T0 + 10 * 60_000);
    expect(f.actualActiveMs).toBe(10 * 60_000);
    expect(f.endReason).toBe("manual");
  });
});

describe("normalizeFocusSession", () => {
  it("非法数据 → null（缺 id / 非整数时长 / 非法状态）", () => {
    expect(normalizeFocusSession({ plannedMinutes: 30, status: "running" })).toBeNull();
    expect(normalizeFocusSession(mk({ plannedMinutes: 2.5 }))).toBeNull();
    expect(normalizeFocusSession(mk({ status: "weird" as FocusSession["status"] }))).toBeNull();
  });

  it("合法数据归一（optional 字段清理）", () => {
    const n = normalizeFocusSession(mk({ assignmentId: "a1", courseId: "c1", note: "专注" }));
    expect(n).not.toBeNull();
    expect(n!.plannedMinutes).toBe(30);
    expect(n!.assignmentId).toBe("a1");
  });
});

describe("sumCompletedFocusMs", () => {
  it("精确累计 completed 的 actualActiveMs（不 round 分钟）", () => {
    const sessions = [
      mk({ status: "completed", actualActiveMs: 10 * 60_000 + 30_000 }),
      mk({ status: "completed", actualActiveMs: 5 * 60_000 + 500 }),
      mk({ status: "running", activeStartedAt: T0, actualActiveMs: 1000 }),
      mk({ status: "paused", accumulatedActiveMs: 60_000 }),
    ];
    expect(sumCompletedFocusMs(sessions)).toBe(15 * 60_000 + 30_500);
  });

  it("空数组 → 0", () => {
    expect(sumCompletedFocusMs([])).toBe(0);
  });
});
