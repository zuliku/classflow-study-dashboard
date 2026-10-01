// @vitest-environment jsdom
/**
 * 主 store hydrate 归一（脏数据熔断）：
 * courses / schedules / marks / overrides 此前 cast-only，缺字段即崩渲染；
 * 现逐条归一（id 系缺失丢弃，其余补默认），经真实 rehydrate 路径验证。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";

const KEY = "classflow-storage-v2";

function seed(state: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 8 }));
}

async function rehydrate() {
  // @ts-expect-error — persist 存在于 store
  await (useAppStore.persist as unknown as { rehydrate: () => Promise<void> }).rehydrate();
}

beforeEach(() => {
  localStorage.clear();
});

describe("hydrate normalize（脏数据不崩）", () => {
  it("缺 name 的课程丢弃；缺 materials 的补 []；非法 material 条目剔除", async () => {
    seed({
      courses: [
        { id: "c-bad" },
        { id: "c1", name: "高数", materials: [{ id: "m1", title: "讲义" }, null, "junk"] },
      ],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
    });
    await rehydrate();
    const courses = useAppStore.getState().courses;
    expect(courses.map((c) => c.id)).toEqual(["c1"]);
    expect(courses[0].materials).toEqual([{ id: "m1", title: "讲义" }]);
    expect(courses[0].teacher).toBe("");
  });

  it("缺 courseId 的排课丢弃；dayOfWeek 越界收敛到 1-7", async () => {
    seed({
      courses: [],
      schedules: [
        { id: "s-bad" },
        { id: "s1", courseId: "c1", dayOfWeek: 9, startTime: "08:00", endTime: "09:40", location: "", weeks: "" },
      ],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
    });
    await rehydrate();
    const schedules = useAppStore.getState().schedules;
    expect(schedules.map((s) => s.id)).toEqual(["s1"]);
    expect(schedules[0].dayOfWeek).toBe(7);
  });

  it("非法 mark/override 丢弃，合法保留", async () => {
    seed({
      courses: [],
      schedules: [],
      calendarMarks: [
        { id: "mk-bad" },
        { id: "mk1", date: "2026-01-01", type: "weird", title: "考试" },
      ],
      scheduleOccurrenceOverrides: [
        { id: "o-bad", kind: "cancel" },
        { id: "o1", kind: "cancel", courseId: "c1", baseScheduleId: "s1", week: 3 },
      ],
    });
    await rehydrate();
    const marks = useAppStore.getState().calendarMarks;
    // mk1 type 非法 → 回落 activity；注意 DDL 自动 mark 可能追加，此处只断言包含关系
    const mk1 = marks.find((m) => m.id === "mk1");
    expect(mk1?.type).toBe("activity");
    expect(marks.some((m) => m.id === "mk-bad")).toBe(false);
    const overrides = useAppStore.getState().scheduleOccurrenceOverrides;
    expect(overrides.map((o) => o.id)).toEqual(["o1"]);
  });
});
