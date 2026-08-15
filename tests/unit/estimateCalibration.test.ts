import { describe, it, expect } from "vitest";
import {
  buildEstimateCalibration,
  EstimateCalibration,
  interpretRatio,
} from "@/lib/analytics/estimateCalibration";
import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

function ev(
  type: string,
  entityId: string,
  occurredAt: number,
  data: Record<string, unknown>,
  seq = 1,
  patch: { courseId?: string; assignmentId?: string; courseNameSnapshot?: string } = {}
): AnalyticsProjectionEvent {
  return { type, entityId, occurredAt, sequence: seq, courseId: patch.courseId, assignmentId: patch.assignmentId, courseNameSnapshot: patch.courseNameSnapshot, data };
}

const DAY = 86400000;
const T0 = new Date(2026, 7, 10, 9, 0, 0).getTime();
const MIN = 60000;

const created = (id: string, at: number, estimate: number | null, courseId = "c1") =>
  ev("assignment.created", id, at, { status: "todo", priority: "medium", ddl: null, estimatedMinutes: estimate }, 1, { courseId, assignmentId: id, courseNameSnapshot: "数据结构" });
const estimateChanged = (id: string, at: number, after: number | null) =>
  ev("assignment.estimate_changed", id, at, { before: null, after }, 1, { assignmentId: id });
const completed = (id: string, at: number) =>
  ev("assignment.completed", id, at, { previousStatus: "doing", completionTrigger: "status" }, 1, { assignmentId: id });
const reopened = (id: string, at: number) =>
  ev("assignment.reopened", id, at, { from: "completed", to: "doing" }, 1, { assignmentId: id });
const focus = (id: string, assignmentId: string, at: number, actualMs: number, courseId = "c1") =>
  ev("focus.completed", id, at, { actualActiveMs: actualMs, startedAt: at, plannedMinutes: Math.round(actualMs / MIN) }, 1, { assignmentId, courseId });

describe("Estimate Calibration", () => {
  it("A：estimate 60 + 关联专注 90 + completed → ratio 1.5", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        focus("f1", "a1", T0 + 1 * DAY, 90 * MIN),
        completed("a1", T0 + 2 * DAY),
      ],
    });
    expect(cal.sampleCount).toBe(1);
    expect(cal.samples[0].estimatedMinutesAtCompletion).toBe(60);
    expect(cal.samples[0].trackedFocusMinutes).toBe(90);
    expect(cal.samples[0].ratio).toBe(1.5);
  });

  it("B：estimate_changed 60→120，tracked=120 → ratio 1.0（使用完成时生效的估时）", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        estimateChanged("a1", T0 + 1 * DAY, 120),
        focus("f1", "a1", T0 + 2 * DAY, 120 * MIN),
        completed("a1", T0 + 3 * DAY),
      ],
    });
    expect(cal.samples).toHaveLength(1);
    expect(cal.samples[0].estimatedMinutesAtCompletion).toBe(120);
    expect(cal.samples[0].ratio).toBe(1);
  });

  it("C：completed → reopened → 新 focus → completed：两个 episode，旧 focus 不重复累计", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        focus("f1", "a1", T0 + 1 * DAY, 30 * MIN), // episode 1
        completed("a1", T0 + 2 * DAY),
        reopened("a1", T0 + 3 * DAY),
        focus("f2", "a1", T0 + 4 * DAY, 60 * MIN), // episode 2
        completed("a1", T0 + 5 * DAY),
      ],
    });
    expect(cal.samples).toHaveLength(2);
    expect(cal.samples[0].trackedFocusMinutes).toBe(30);
    expect(cal.samples[1].trackedFocusMinutes).toBe(60);
  });

  it("D：focus 无 assignmentId → 忽略（不在任何 episode）", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        focus("f1", "OTHER", T0 + 1 * DAY, 90 * MIN),
        completed("a1", T0 + 2 * DAY),
      ],
    });
    expect(cal.sampleCount).toBe(0);
  });

  it("E：无 created（估时历史不可靠）→ 忽略；有 focus 无估时 → 忽略", () => {
    const noCreated = buildEstimateCalibration({
      events: [completed("a1", T0 + 2 * DAY)],
    });
    expect(noCreated.sampleCount).toBe(0);

    const noEstimate = buildEstimateCalibration({
      events: [
        created("a2", T0, null),
        focus("f2", "a2", T0 + 1 * DAY, 90 * MIN),
        completed("a2", T0 + 2 * DAY),
      ],
    });
    expect(noEstimate.sampleCount).toBe(0);

    const onlyEstimate = buildEstimateCalibration({
      events: [created("a3", T0, 60), completed("a3", T0 + 2 * DAY)],
    });
    expect(onlyEstimate.sampleCount).toBe(0);
  });

  it("F：outlier ratio >4（或 <0.25）→ excludedOutliers，不入样本", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        focus("f1", "a1", T0 + 1 * DAY, 480 * MIN), // ratio 8
        completed("a1", T0 + 2 * DAY),
      ],
    });
    expect(cal.sampleCount).toBe(0);
    expect(cal.excludedOutliers).toBe(1);

    const low = buildEstimateCalibration({
      events: [
        created("a2", T0, 60),
        focus("f2", "a2", T0 + 1 * DAY, 10 * MIN), // ratio 0.17 < 0.25；且 <15min 本就不达标
        completed("a2", T0 + 2 * DAY),
      ],
    });
    // 10min 低于 15min 门槛 → 不计为 outlier（也不计样本）
    expect(low.sampleCount).toBe(0);
    expect(low.excludedOutliers).toBe(0);
  });

  it("G：样本 <5 → insufficient-data（不展示伪精确 ratio）", () => {
    const events: AnalyticsProjectionEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `a${i}`;
      events.push(created(id, T0 + i * DAY, 60, `c${i}`));
      events.push(focus(`f${id}`, id, T0 + (i + 1) * DAY, 60 * MIN, `c${i}`));
      events.push(completed(id, T0 + (i + 2) * DAY));
    }
    const cal = buildEstimateCalibration({ events });
    expect(cal.status).toBe("insufficient-data");
    expect(cal.medianRatio).not.toBeNull(); // 内部仍可给 median（测试可断言），但 UI 不展示
  });

  it("H：5+ 样本 → ready，median（偶数取中位两值平均）", () => {
    const events: AnalyticsProjectionEvent[] = [];
    const ratios = [0.5, 1.0, 1.5, 2.0, 3.0]; // median = 1.5
    for (let i = 0; i < ratios.length; i++) {
      const id = `a${i}`;
      events.push(created(id, T0 + i * DAY, 60, `c${i}`));
      events.push(focus(`f${id}`, id, T0 + (i + 1) * DAY, Math.round(60 * ratios[i]) * MIN, `c${i}`));
      events.push(completed(id, T0 + (i + 2) * DAY));
    }
    const cal = buildEstimateCalibration({ events });
    expect(cal.status).toBe("ready");
    expect(cal.sampleCount).toBe(5);
    expect(cal.medianRatio).toBe(1.5);
    expect(cal.interpretation).toBe("tracked-above-estimate");
  });

  it("interpretation 阈值：<0.8 below / 0.8–1.2 aligned / >1.2 above", () => {
    expect(interpretRatio(0.5)).toBe("tracked-below-estimate");
    expect(interpretRatio(1.0)).toBe("roughly-aligned");
    expect(interpretRatio(1.5)).toBe("tracked-above-estimate");
  });

  it("course 校准：同 course ≥3 样本 → ready；fallback 语义留给调用方", () => {
    const events: AnalyticsProjectionEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `a${i}`;
      events.push(created(id, T0 + i * DAY, 60, "c1"));
      events.push(focus(`f${id}`, id, T0 + (i + 1) * DAY, 60 * MIN, "c1"));
      events.push(completed(id, T0 + (i + 2) * DAY));
    }
    const cal = buildEstimateCalibration({ events });
    const c1 = cal.byCourse.find((c) => c.courseId === "c1");
    expect(c1?.status).toBe("ready");
    expect(c1?.sampleCount).toBe(3);
  });

  it("trackedFocusMinutes 低于 15min 门槛 → 不计样本", () => {
    const cal = buildEstimateCalibration({
      events: [
        created("a1", T0, 60),
        focus("f1", "a1", T0 + 1 * DAY, 10 * MIN),
        completed("a1", T0 + 2 * DAY),
      ],
    });
    expect(cal.sampleCount).toBe(0);
    expect(cal.excludedOutliers).toBe(0);
  });
});
