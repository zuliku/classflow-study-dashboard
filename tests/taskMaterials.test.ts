import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment, Course, Material } from "@/types";
import {
  resolveAssignmentMaterials,
  sanitizeAssignmentMaterialIds,
} from "@/lib/tasks/taskMaterials";
import { normalizeAssignment } from "@/lib/tasks/taskSemantics";

function mat(id: string, title: string): Material {
  return { id, title, type: "pdf", uploadDate: "2026-08-01" };
}

function course(id: string, materials: Material[]): Course {
  return {
    id,
    name: id,
    code: id,
    teacher: "",
    classroom: "",
    credit: 3,
    bgHex: "#E3E6E0",
    borderHex: "#D0D5CC",
    textHex: "#313032",
    description: "",
    materials,
  };
}

const COURSES = [
  course("c1", [mat("m1", "讲义一.pdf"), mat("m2", "讲义二.pdf"), mat("m3", "讲义三.pdf")]),
  course("c2", [mat("m4", "英语资料.pdf")]),
];

const mkAssignment = (patch: Partial<Assignment>): Assignment => ({
  id: "a1",
  courseId: "c1",
  title: "任务",
  description: "",
  priority: "medium",
  status: "todo",
  progress: 0,
  tags: [],
  ...patch,
});

describe("resolveAssignmentMaterials", () => {
  it("按 materialIds 原顺序返回所属课程的真实 Material", () => {
    const a = mkAssignment({ materialIds: ["m3", "m1"] });
    expect(resolveAssignmentMaterials(a, COURSES).map((m) => m.id)).toEqual(["m3", "m1"]);
  });

  it("Missing ID 自动忽略，不 throw", () => {
    const a = mkAssignment({ materialIds: ["m1", "ghost", "m2"] });
    expect(resolveAssignmentMaterials(a, COURSES).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("跨课程 ID（c2 的 m4）被忽略", () => {
    const a = mkAssignment({ materialIds: ["m4", "m1"] });
    expect(resolveAssignmentMaterials(a, COURSES).map((m) => m.id)).toEqual(["m1"]);
  });

  it("无 materialIds / 课程不存在 → []", () => {
    expect(resolveAssignmentMaterials(mkAssignment({}), COURSES)).toEqual([]);
    expect(resolveAssignmentMaterials(mkAssignment({ courseId: "nope", materialIds: ["m1"] }), COURSES)).toEqual([]);
  });
});

describe("sanitizeAssignmentMaterialIds", () => {
  it("只保留所属课程真实存在的 ID（跨课程被拒绝）", () => {
    const a = mkAssignment({ courseId: "c1" });
    expect(sanitizeAssignmentMaterialIds(a, COURSES, ["m1", "m4", "ghost"])).toEqual(["m1"]);
  });

  it("去重", () => {
    const a = mkAssignment({ courseId: "c1" });
    expect(sanitizeAssignmentMaterialIds(a, COURSES, ["m2", "m2", "m1"])).toEqual(["m2", "m1"]);
  });

  it("全非法 / 课程不存在 → []", () => {
    const a = mkAssignment({ courseId: "c1" });
    expect(sanitizeAssignmentMaterialIds(a, COURSES, ["ghost"])).toEqual([]);
    expect(sanitizeAssignmentMaterialIds(mkAssignment({ courseId: "nope" }), COURSES, ["m1"])).toEqual([]);
  });
});

describe("normalizeAssignment materialIds", () => {
  it("非数组 → undefined（旧数据兼容）", () => {
    expect(normalizeAssignment(mkAssignment({ materialIds: "m1" } as unknown as Partial<Assignment>)).materialIds).toBeUndefined();
    expect(normalizeAssignment(mkAssignment({})).materialIds).toBeUndefined();
  });

  it("清洗：只保留非空 string + 去重；空结果 → undefined", () => {
    const a = normalizeAssignment(mkAssignment({ materialIds: ["m1", "", "m1", " m2 "] }));
    expect(a.materialIds).toEqual(["m1", " m2 "]);
    const empty = normalizeAssignment(mkAssignment({ materialIds: ["", " "] }));
    expect(empty.materialIds).toBeUndefined();
  });
});

// ---- Store 级行为（Case 4 / Case 5） ----

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [
      { id: "c1", name: "数据结构", code: "CS-1", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [
        { id: "m1", title: "讲义一.pdf", type: "pdf", uploadDate: "2026-08-01" },
        { id: "m2", title: "讲义二.pdf", type: "pdf", uploadDate: "2026-08-01" },
      ] },
      { id: "c2", name: "英语", code: "EN-1", teacher: "", classroom: "", credit: 2, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [
        { id: "m4", title: "英语资料.pdf", type: "pdf", uploadDate: "2026-08-01" },
      ] },
    ],
    schedules: [],
    assignments: [
      { id: "a1", courseId: "c1", title: "任务一", description: "", priority: "medium", status: "todo", progress: 0, tags: [], materialIds: ["m1"] },
    ],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 4, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Store setAssignmentMaterialIds / deleteCourseMaterial 清理", () => {
  it("Case 4：传入其它课程 materialId → 自动拒绝；空结果 → undefined", async () => {
    seedState();
    const store = await freshStore();
    store.getState().setAssignmentMaterialIds("a1", ["m2", "m4"]);
    const a = store.getState().assignments.find((x: Assignment) => x.id === "a1");
    expect(a!.materialIds).toEqual(["m2"]); // m4 跨课程被清洗

    store.getState().setAssignmentMaterialIds("a1", ["ghost"]);
    const a2 = store.getState().assignments.find((x: Assignment) => x.id === "a1");
    expect(a2!.materialIds).toBeUndefined();
  });

  it("Case 5：删除课程资料 → 同课程任务 materialIds 同步清理；其他任务不受影响", async () => {
    seedState();
    const store = await freshStore();
    // a1 关联 m1；先加一条 c1 的第二个关联
    store.getState().setAssignmentMaterialIds("a1", ["m1", "m2"]);
    store.getState().deleteCourseMaterial("c1", "m1");
    const a = store.getState().assignments.find((x: Assignment) => x.id === "a1");
    expect(a!.materialIds).toEqual(["m2"]);
    // 课程侧 Material 也被删除
    const c1 = store.getState().courses.find((c: Course) => c.id === "c1");
    expect(c1!.materials.map((m) => m.id)).toEqual(["m2"]);
    // c2 的资料与任务不受影响
    const c2 = store.getState().courses.find((c: Course) => c.id === "c2");
    expect(c2!.materials.map((m) => m.id)).toEqual(["m4"]);
  });

  it("Case 5b：删除唯一关联 → materialIds 变 undefined（不留空数组）", async () => {
    seedState();
    const store = await freshStore();
    store.getState().deleteCourseMaterial("c1", "m1");
    const a = store.getState().assignments.find((x: Assignment) => x.id === "a1");
    expect(a!.materialIds).toBeUndefined();
  });
});
