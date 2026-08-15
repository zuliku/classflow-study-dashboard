// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { ReactNode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { LearningHistoryEvent, LearningHistorySource } from "@/lib/history/types";
import { enqueueLearningHistoryEvents, flushLearningHistoryQueue } from "@/lib/history/recorder";
import { clearLearningHistoryStorage, resetLearningHistoryCoverage } from "@/lib/history/store";
import { useEntityLearningHistory, UseEntityLearningHistoryInput } from "@/hooks/useEntityLearningHistory";
import * as activityView from "@/lib/history/activityView";

let seq = 0;
function mkEvent(
  type: LearningHistoryEvent["type"],
  assignmentId: string,
  data: unknown,
  source: LearningHistorySource = "manual"
): LearningHistoryEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    schemaVersion: 1,
    type,
    occurredAt: 1786700000000 + seq,
    localDate: "2026-08-15",
    timezoneOffsetMinutes: -480,
    source,
    entityType: "assignment",
    entityId: assignmentId,
    semesterId: "s1",
    semesterNameSnapshot: "S",
    semesterWeek: 3,
    sequence: seq,
    assignmentId,
    data,
  } as LearningHistoryEvent;
}

interface OutState {
  ids: string[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  coverage: number | null;
}

function Harness({ input }: { input: UseEntityLearningHistoryInput }) {
  const r = useEntityLearningHistory(input);
  const out: OutState = {
    ids: r.rows.map((x) => x.id),
    loading: r.loading,
    error: r.error,
    hasMore: r.hasMore,
    coverage: r.coverageStartedAt,
  };
  return (
    <div>
      <div data-testid="out" data-json={JSON.stringify(out)} />
      <button type="button" data-testid="retry" onClick={r.retry}>
        retry
      </button>
    </div>
  );
}

async function renderHarness(input: UseEntityLearningHistoryInput): Promise<{
  root: Root;
  el: HTMLElement;
  read: () => OutState;
  update: (input: UseEntityLearningHistoryInput) => Promise<void>;
  unmount: () => void;
  clickRetry: () => void;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest = input;
  const render = () => {
    root.render(
      <Harness
        key={JSON.stringify(latest)}
        input={latest}
      />
    );
  };
  await act(async () => {
    render();
    await Promise.resolve();
  });
  const el = container.querySelector('[data-testid="out"]') as HTMLElement;
  const read = () => {
    // key remount 后 DOM 元素会替换 → 每次重新查询
    const node = container.querySelector('[data-testid="out"]');
    return JSON.parse(node!.getAttribute("data-json")!) as OutState;
  };
  return {
    root,
    el,
    read,
    update: async (next) => {
      latest = next;
      await act(async () => {
        render();
        await Promise.resolve();
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    clickRetry: () => {
      act(() => {
        container
          .querySelector('[data-testid="retry"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
  };
}

/** 等待 hook 的 async load 结束（loading=false），最多 ~1s */
async function waitForIdle(h: { read: () => OutState }) {
  for (let i = 0; i < 100; i++) {
    if (!h.read().loading) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function flushAll() {
  await act(async () => {
    await flushLearningHistoryQueue();
  });
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await resetLearningHistoryCoverage();
  vi.restoreAllMocks();
});

describe("useEntityLearningHistory", () => {
  it("enabled=false 不主动 query（loadEntityActivity 不被调用）", async () => {
    const spy = vi.spyOn(activityView, "loadEntityActivity");
    const h = await renderHarness({ assignmentId: "a1", enabled: false });
    await flushAll();
    expect(spy).not.toHaveBeenCalled();
    expect(h.read().ids).toEqual([]);
    h.unmount();
  });

  it("enabled=true + assignmentId → 正确过滤；真实 IndexedDB 数据可见", async () => {
    await enqueueLearningHistoryEvents([
      mkEvent("assignment.created", "a1", { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null }),
      mkEvent("assignment.created", "a2", { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null }),
    ]);
    await flushAll();
    const h = await renderHarness({ assignmentId: "a1", enabled: true });
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(1);
    expect(h.read().coverage).not.toBeNull();
    h.unmount();
  });

  it("courseId 正确过滤", async () => {
    const c1 = { ...mkEvent("course.created", "a1", { name: "C1", code: "C", credit: 3 }), courseId: "c1", entityType: "course" } as LearningHistoryEvent;
    const c2 = { ...mkEvent("course.created", "a1", { name: "C2", code: "C", credit: 3 }), courseId: "c2", entityType: "course" } as LearningHistoryEvent;
    await enqueueLearningHistoryEvents([c1, c2]);
    await flushAll();
    const h = await renderHarness({ courseId: "c1", enabled: true });
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(1);
    expect(h.read().ids[0]).toBe(c1.id);
    h.unmount();
  });

  it("History 变更（append）→ 订阅自动刷新（已展开）", async () => {
    const h = await renderHarness({ assignmentId: "a1", enabled: true });
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(0);
    await enqueueLearningHistoryEvents([
      mkEvent("assignment.completed", "a1", { previousStatus: "doing", completionTrigger: "status" }),
    ]);
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(1);
    h.unmount();
  });

  it("A→B 实体切换：stale A async result 不覆盖 B", async () => {
    let resolveA: ((v: activityView.EntityActivityLoadResult) => void) | null = null;
    const calls: string[] = [];
    const spy = vi
      .spyOn(activityView, "loadEntityActivity")
      .mockImplementation(async (input) => {
        calls.push(input.assignmentId ?? input.courseId ?? "?");
        if (input.assignmentId === "a1") {
          return new Promise<activityView.EntityActivityLoadResult>((resolve) => {
            resolveA = resolve;
          });
        }
        return {
          rows: [{ id: "b-row", occurredAt: 1, localDate: "2026-08-15", title: "B", tone: "neutral", category: "task" }],
          hasMore: false,
          coverageStartedAt: 100,
        };
      });

    const h = await renderHarness({ assignmentId: "a1", enabled: true });
    expect(calls).toEqual(["a1"]);
    // A 尚未 resolve → 切换 B
    await h.update({ assignmentId: "a2", enabled: true });
    await waitForIdle(h);
    expect(calls).toEqual(["a1", "a2"]);
    expect(h.read().ids).toEqual(["b-row"]);
    // 迟到的 A 结果到达 → 不得覆盖 B
    await act(async () => {
      resolveA!({
        rows: [{ id: "a-row", occurredAt: 2, localDate: "2026-08-15", title: "A", tone: "neutral", category: "task" }],
        hasMore: false,
        coverageStartedAt: 50,
      });
      await Promise.resolve();
    });
    expect(h.read().ids).toEqual(["b-row"]);
    h.unmount();
    spy.mockRestore();
  });

  it("clear History 后实时变空（subscription 响应）", async () => {
    await enqueueLearningHistoryEvents([
      mkEvent("assignment.created", "a1", { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null }),
    ]);
    await flushAll();
    const h = await renderHarness({ assignmentId: "a1", enabled: true });
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(1);
    // 走真实 reset 路径（resetLearningHistoryForDomainReset → 队列内清空 + 通知订阅者）
    const { resetLearningHistoryForDomainReset } = await import("@/lib/history/clear");
    resetLearningHistoryForDomainReset();
    await flushAll();
    await waitForIdle(h);
    expect(h.read().ids).toHaveLength(0);
    expect(h.read().coverage).not.toBeNull();
    h.unmount();
  });

  it("query error → error=true；retry 后恢复", async () => {
    let fail = true;
    const spy = vi
      .spyOn(activityView, "loadEntityActivity")
      .mockImplementation(async () => {
        if (fail) throw new Error("boom");
        return {
          rows: [{ id: "ok-row", occurredAt: 1, localDate: "2026-08-15", title: "OK", tone: "neutral", category: "task" }],
          hasMore: false,
          coverageStartedAt: null,
        };
      });
    const h = await renderHarness({ assignmentId: "a1", enabled: true });
    await waitForIdle(h);
    expect(h.read().error).toBe(true);
    fail = false;
    h.clickRetry();
    await flushAll();
    await waitForIdle(h);
    expect(h.read().error).toBe(false);
    expect(h.read().ids).toEqual(["ok-row"]);
    h.unmount();
    spy.mockRestore();
  });
});
