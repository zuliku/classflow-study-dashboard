import { it, expect } from "vitest";
import { buildFullDemoData } from "@/lib/dev/fullDemoData";
import { useAppStore } from "@/store/useAppStore";

it("full demo data 全模块形状", () => {
  const data = buildFullDemoData();
  expect(data.courses).toHaveLength(5);
  expect(data.schedules).toHaveLength(5);
  expect(data.assignments).toHaveLength(15);
  expect(data.calendarMarks).toHaveLength(12);
  expect(data.studyBlocks).toHaveLength(6);
  expect(data.groupProjects).toHaveLength(2);

  const materials = data.courses.flatMap((c) => c.materials);
  expect(materials.length).toBeGreaterThan(5);
  expect(new Set(materials.map((m) => m.type))).toEqual(new Set(["pdf", "link", "ppt", "doc"]));
  expect(materials.filter((m) => m.type === "link").every((m) => !!m.url)).toBe(true);

  const marks = data.calendarMarks;
  expect(marks.filter((m) => m.type === "ddl").every((m) => !!m.sourceId)).toBe(true);
  expect(marks.filter((m) => m.type !== "ddl").every((m) => !!m.startTime && !!m.endTime)).toBe(true);

  const blocks = data.studyBlocks ?? [];
  expect(blocks.filter((b) => b.assignmentId === "a7")).toHaveLength(2);
});

it("restoreAppData 归一化后全模块可用", () => {
  const store = useAppStore.getState();
  store.restoreAppData(buildFullDemoData());
  const s = useAppStore.getState();
  expect(s.courses).toHaveLength(5);
  expect(s.assignments).toHaveLength(15);
  expect(s.groupProjects).toHaveLength(2);
  expect(s.groupProjects[0].progress).toBe(50);
  expect(s.groupProjects[1].progress).toBe(50);
  expect(s.calendarMarks.filter((m) => m.type === "ddl").every((m) => !!m.sourceId)).toBe(true);
  expect(s.studyBlocks).toHaveLength(6);
});
