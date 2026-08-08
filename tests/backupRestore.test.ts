import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import {
  prepareBackupRestore,
  commitBackupRestore,
} from "@/lib/backupRestore";
import { useAppStore } from "@/store/useAppStore";
import { ClassFlowBackupData, AppPreferences } from "@/types";

/** 构造最小合法备份 data（v1 结构，无 preferences 字段 = legacy） */
function buildBackupData(): ClassFlowBackupData {
  return {
    userProfile: { name: "备份用户", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s2", name: "备份学期", startDate: "2026-02-23", totalWeeks: 16 },
    courses: [
      { id: "c_bak", name: "备份课程", code: "B-01", teacher: "t", classroom: "r", credit: 2, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] },
    ],
    schedules: [{ id: "s_bak", courseId: "c_bak", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "r", weeks: "1-16周" }],
    assignments: [{ id: "a_bak", courseId: "c_bak", title: "备份任务", description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
    calendarMarks: [{ id: "cm_bak", date: "2026-09-01", type: "ddl", title: "备份任务", sourceId: "a_bak" }],
    groupProjects: [],
  };
}

function backupJSON(data: unknown): string {
  return JSON.stringify({ version: 1, exportedAt: "2026-08-08T00:00:00.000Z", data });
}

async function makeZip(data: unknown, materials: Record<string, Blob> = {}): Promise<Blob> {
  const zip = new JSZip();
  zip.file("data.json", backupJSON(data));
  for (const [key, blob] of Object.entries(materials)) {
    zip.file(`materials/${key}`, await blob.arrayBuffer());
  }
  return new Blob([await zip.generateAsync({ type: "arraybuffer" })], { type: "application/zip" });
}

function toFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type });
}

const validData = () => buildBackupData();

describe("prepareBackupRestore（orchestrator，无副作用）", () => {
  it("prepare ZIP：正确 summary 且不调用 Store / IDB", async () => {
    const zip = await makeZip(validData(), {});
    const spy = vi.spyOn(useAppStore.getState(), "restoreAppData");
    const result = await prepareBackupRestore(toFile(zip, "classflow_full_backup.zip"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.sourceType).toBe("zip");
    expect(result.prepared.summary).toEqual({
      courses: 1,
      schedules: 1,
      assignments: 1,
      groupProjects: 0,
      materials: 0,
    });
    expect(result.prepared.integrity.fatal).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prepare JSON：正确 summary；存储键存在但无附件 → recoverable warning", async () => {
    const data = buildBackupData();
    data.courses[0].materials = [
      { id: "m1", title: "讲义.pdf", type: "pdf", uploadDate: "2026-08-01", storageKey: "f1" },
    ];
    const result = await prepareBackupRestore(
      toFile(new Blob([backupJSON(data)]), "classflow_backup.json")
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.sourceType).toBe("json");
    expect(result.prepared.summary.materials).toBe(1);
    expect(result.prepared.integrity.fatal).toEqual([]);
    expect(
      result.prepared.integrity.warnings.some((w) => w.includes("不含课程资料文件"))
    ).toBe(true);
  });

  it("fatal（orphan schedule）→ blocked：fatal 非空", async () => {
    const data = buildBackupData();
    data.schedules.push({ id: "s_orphan", courseId: "c_gone", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", location: "r", weeks: "1-16周" });
    const result = await prepareBackupRestore(
      toFile(new Blob([backupJSON(data)]), "bad.json")
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.integrity.fatal.length).toBeGreaterThan(0);
  });

  it("warning（ZIP 内缺少声明文件）→ recoverable", async () => {
    const data = buildBackupData();
    data.courses[0].materials = [
      { id: "m1", title: "讲义.pdf", type: "pdf", uploadDate: "2026-08-01", storageKey: "f1" },
    ];
    const zip = await makeZip(data, {}); // 声明了 f1 但 ZIP 无文件
    const result = await prepareBackupRestore(toFile(zip, "classflow_full_backup.zip"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.integrity.fatal).toEqual([]);
    expect(result.prepared.missingMaterials.length).toBe(1);
  });

  it("legacy backup（无 preferences 字段）→ 正常 prepare", async () => {
    const data = buildBackupData();
    expect("preferences" in data).toBe(false);
    const result = await prepareBackupRestore(
      toFile(new Blob([backupJSON(data)]), "legacy.json")
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.data.courses[0].id).toBe("c_bak");
  });

  it("非法文件 → ok:false 且无副作用", async () => {
    const result = await prepareBackupRestore(
      toFile(new Blob(["not a zip"], { type: "application/zip" }), "bad.zip")
    );
    expect(result.ok).toBe(false);
    const store = useAppStore.getState();
    expect(store.courses.some((c) => c.id === "c_bak")).toBe(false);
  });
});

describe("commitBackupRestore（确认后恢复）", () => {
  it("commit ZIP：先写附件再精确恢复数据；preferences 缺失时保留当前偏好", async () => {
    const data = buildBackupData();
    data.courses[0].materials = [
      { id: "m1", title: "讲义.pdf", type: "pdf", uploadDate: "2026-08-01", storageKey: "f1" },
    ];
    const zip = await makeZip(data, { f1: new Blob(["pdf"], { type: "application/pdf" }) });
    const prepared = (await prepareBackupRestore(toFile(zip, "backup.zip")));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // 当前偏好设为 reduced，legacy 备份恢复后应保留
    useAppStore.getState().updatePreferences({ motionPreference: "reduced" });
    const result = await commitBackupRestore(prepared.prepared, {
      restoreAppData: (d) => useAppStore.getState().restoreAppData(d),
    });

    // node 环境无 IndexedDB：附件写入失败被收集为 savedFailures，但不阻断数据恢复
    expect(result.savedFailures).toEqual(["f1"]);
    const after = useAppStore.getState();
    expect(after.courses.map((c) => c.id)).toEqual(["c_bak"]);
    expect(after.assignments.map((a) => a.id)).toEqual(["a_bak"]);
    expect(after.calendarMarks.find((m) => m.id === "cm_bak")?.sourceId).toBe("a_bak");
    expect(after.preferences.motionPreference).toBe("reduced"); // legacy 备份保留当前偏好
  });

  it("commit JSON：精确恢复且含 preferences 时应用", async () => {
    const data = buildBackupData();
    data.preferences = { showWeekends: false, ddlWarningDays: 7, defaultDDLTime: "21:00", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "full" } as AppPreferences;
    const prepared = await prepareBackupRestore(
      toFile(new Blob([backupJSON(data)]), "backup.json")
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    await commitBackupRestore(prepared.prepared, {
      restoreAppData: (d) => useAppStore.getState().restoreAppData(d),
    });
    const after = useAppStore.getState();
    expect(after.courses.map((c) => c.id)).toEqual(["c_bak"]);
    expect(after.preferences.motionPreference).toBe("full");
    expect(after.preferences.defaultDDLTime).toBe("21:00");
  });
});
