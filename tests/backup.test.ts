import { describe, it, expect } from "vitest";
import {
  parseBackupJSON,
  validateBackup,
  hasMaterialStorageKeys,
} from "@/lib/backup";
import { checkMaterialAvailability, collectMaterialRefs } from "@/lib/backupPackage";
import { ClassFlowBackup, ClassFlowBackupData, Course, Priority, AssignmentStatus } from "@/types";

const validData: ClassFlowBackupData = {
  userProfile: { name: "张同学", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
  semester: { id: "sem", name: "2026年春季学期", startDate: "2026-02-23", totalWeeks: 16 },
  courses: [{ id: "c_1", name: "微观经济学", code: "ECON-201", teacher: "王教授", classroom: "教二", credit: 4, bgHex: "#fff", borderHex: "#fff", textHex: "#000", description: "", materials: [] }],
  schedules: [{ id: "s_1", courseId: "c_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教二", weeks: "1-16周" }],
  assignments: [{ id: "a_1", courseId: "c_1", title: "习题", description: "", ddl: "2026-08-10T23:59:00", priority: "medium" as Priority, status: "todo" as AssignmentStatus, progress: 0, tags: [] }],
  calendarMarks: [{ id: "cm_1", date: "2026-08-10", type: "ddl", title: "习题" }],
  groupProjects: [],
};

describe("validateBackup / parseBackupJSON", () => {
  it("接受合法 v1 结构", () => {
    const backup: ClassFlowBackup = { version: 1, exportedAt: "2026-08-10T00:00:00Z", data: validData };
    const r = validateBackup(backup);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.courses).toHaveLength(1);
      expect(r.data.semester.totalWeeks).toBe(16);
    }
  });

  it("拒绝非法版本号", () => {
    const r = validateBackup({ version: 99, exportedAt: "x", data: validData });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("版本");
  });

  it("拒绝缺少关键字段", () => {
    const r = validateBackup({ version: 1, exportedAt: "x", data: { courses: [], schedules: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("assignments");
  });

  it("拒绝非 JSON 文本", () => {
    const r = parseBackupJSON("{{{");
    expect(r.ok).toBe(false);
  });

  it("兼容旧版无 version 的扁平结构", () => {
    const r = validateBackup({ exportTime: "x", ...validData });
    expect(r.ok).toBe(true);
  });
});

describe("hasMaterialStorageKeys", () => {
  it("存在 storageKey 时返回 true", () => {
    const courses: Course[] = [
      {
        id: "c1",
        name: "x",
        code: "x",
        teacher: "x",
        classroom: "x",
        credit: 3,
        bgHex: "#fff",
        borderHex: "#fff",
        textHex: "#000",
        description: "",
        materials: [{ id: "m1", title: "a.pdf", type: "pdf", size: "1 MB", uploadDate: "2026-08-01", storageKey: "file_1" }],
      },
    ];
    expect(hasMaterialStorageKeys(courses)).toBe(true);
  });

  it("没有 storageKey 时返回 false", () => {
    const courses: Course[] = [
      {
        id: "c1",
        name: "x",
        code: "x",
        teacher: "x",
        classroom: "x",
        credit: 3,
        bgHex: "#fff",
        borderHex: "#fff",
        textHex: "#000",
        description: "",
        materials: [{ id: "m1", title: "a.pdf", type: "pdf", size: "1 MB", uploadDate: "2026-08-01" }],
      },
    ];
    expect(hasMaterialStorageKeys(courses)).toBe(false);
  });
});

describe("checkMaterialAvailability", () => {
  const mkCourse = (storageKeys: string[]): Course[] => [
    {
      id: "c1",
      name: "x",
      code: "x",
      teacher: "x",
      classroom: "x",
      credit: 3,
      bgHex: "#fff",
      borderHex: "#fff",
      textHex: "#000",
      description: "",
      materials: storageKeys.map((k, i) => ({
        id: `m${i}`,
        title: `file-${k}.pdf`,
        type: "pdf" as const,
        size: "1 MB",
        uploadDate: "2026-08-01",
        storageKey: k,
      })),
    },
  ];

  it("统计正常 / 缺失数量", async () => {
    const blobs = new Map<string, Blob>([["file_ok", new Blob(["x"])]]);
    const health = await checkMaterialAvailability(
      mkCourse(["file_ok", "file_missing"]),
      async (key) => blobs.get(key) ?? null
    );
    expect(health.total).toBe(2);
    expect(health.available).toBe(1);
    expect(health.missing).toHaveLength(1);
    expect(health.missing[0].storageKey).toBe("file_missing");
  });

  it("无 storageKey 资料时不报错", async () => {
    const health = await checkMaterialAvailability(mkCourse([]), async () => null);
    expect(health.total).toBe(0);
    expect(health.available).toBe(0);
    expect(health.missing).toHaveLength(0);
  });

  it("collectMaterialRefs 仅收集带 storageKey 的资料", () => {
    const refs = collectMaterialRefs(mkCourse(["file_1"]));
    expect(refs).toEqual([{ storageKey: "file_1", title: "file-file_1.pdf" }]);
  });
});
