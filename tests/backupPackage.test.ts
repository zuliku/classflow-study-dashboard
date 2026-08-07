import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  buildFullBackupZip,
  parseFullBackupFile,
  collectMaterialRefs,
} from "@/lib/backupPackage";
import { ClassFlowBackupData, Course } from "@/types";

const mkData = (storageKeys: string[] = []): ClassFlowBackupData => {
  const courses: Course[] = [
    {
      id: "c_1",
      name: "微观经济学",
      code: "ECON-201",
      teacher: "王教授",
      classroom: "教二 201",
      credit: 4,
      bgHex: "#E3E6E0",
      borderHex: "#D0D5CC",
      textHex: "#313032",
      description: "",
      materials: storageKeys.map((k, i) => ({
        id: `m_${i}`,
        title: `讲义${i + 1}.pdf`,
        type: "pdf" as const,
        size: "1.2 MB",
        uploadDate: "2026-08-01",
        storageKey: k,
      })),
    },
  ];
  return {
    userProfile: { name: "张同学", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
    semester: { id: "sem", name: "2026年春季学期", startDate: "2026-02-23", totalWeeks: 16 },
    courses,
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
  };
};

describe("buildFullBackupZip", () => {
  it("打包 data.json 与存在的 Blob，缺失的计入 missingMaterials", async () => {
    const data = mkData(["file_ok", "file_missing"]);
    const blobs = new Map<string, Blob>([["file_ok", new Blob(["pdf-bytes"], { type: "application/pdf" })]]);

    const { zipBlob, result } = await buildFullBackupZip(data, async (key) => blobs.get(key) ?? null);

    expect(result.packedMaterials).toBe(1);
    expect(result.missingMaterials).toEqual([{ storageKey: "file_missing", title: "讲义2.pdf" }]);

    // 校验 ZIP 内容（Node 环境需先转 ArrayBuffer 再交给 JSZip）
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(zip.file("data.json")).toBeTruthy();
    const materialEntry = zip.file("materials/file_ok");
    expect(materialEntry).toBeTruthy();
    const content = await materialEntry!.async("string");
    expect(content).toBe("pdf-bytes");
    expect(zip.file("materials/file_missing")).toBeNull();
  });

  it("Blob 读取异常不会导致整个备份失败", async () => {
    const data = mkData(["file_broken"]);
    const { result } = await buildFullBackupZip(data, async () => {
      throw new Error("idb broken");
    });
    expect(result.packedMaterials).toBe(0);
    expect(result.missingMaterials).toHaveLength(1);
  });

  it("无附件时仍生成有效 ZIP（仅 data.json）", async () => {
    const data = mkData([]);
    const { zipBlob, result } = await buildFullBackupZip(data, async () => null);
    expect(result.packedMaterials).toBe(0);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(zip.file("data.json")).toBeTruthy();
  });
});

describe("parseFullBackupFile", () => {
  it("完整 ZIP round-trip：解析出 data 与 materials", async () => {
    const data = mkData(["file_a", "file_b"]);
    const blobs = new Map([
      ["file_a", new Blob(["AAA"], { type: "application/pdf" })],
      ["file_b", new Blob(["BBB"], { type: "application/pdf" })],
    ]);
    const { zipBlob } = await buildFullBackupZip(data, async (key) => blobs.get(key) ?? null);

    const outcome = await parseFullBackupFile(await zipBlob.arrayBuffer());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.data.courses[0].materials).toHaveLength(2);
    expect(outcome.parsed.materials.size).toBe(2);
    expect(await (await outcome.parsed.materials.get("file_a")!.text())).toBe("AAA");
    // 恢复的 Blob 带正确的 MIME 类型（PDF 可预览）
    expect(outcome.parsed.materials.get("file_a")!.type).toBe("application/pdf");
    expect(outcome.parsed.missingMaterials).toHaveLength(0);
  });

  it("ZIP 内缺少某 storageKey 文件 → 允许恢复 metadata 但标记缺失", async () => {
    const data = mkData(["file_ok", "file_gone"]);
    const blobs = new Map([["file_ok", new Blob(["x"])]]);
    const { zipBlob } = await buildFullBackupZip(data, async (key) => blobs.get(key) ?? null);

    // 手工移除一个文件模拟损坏/手工编辑的备份包
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    zip.remove("materials/file_gone");
    const rebuilt = await zip.generateAsync({ type: "arraybuffer" });

    const outcome = await parseFullBackupFile(rebuilt);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.materials.size).toBe(1);
    expect(outcome.parsed.missingMaterials).toHaveLength(1);
    expect(outcome.parsed.missingMaterials[0].storageKey).toBe("file_gone");
  });

  it("非 ZIP 文件 → 校验失败且不产生数据", async () => {
    const outcome = await parseFullBackupFile(new Blob(["not a zip"], { type: "text/plain" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("ZIP");
  });

  it("ZIP 缺少 data.json → 校验失败", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hello");
    const blob = await zip.generateAsync({ type: "arraybuffer" });
    const outcome = await parseFullBackupFile(blob);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("data.json");
  });

  it("data.json 非法 → 校验失败，沿用 validateBackup 错误", async () => {
    const zip = new JSZip();
    zip.file("data.json", JSON.stringify({ version: 99, data: { courses: [] } }));
    const blob = await zip.generateAsync({ type: "arraybuffer" });
    const outcome = await parseFullBackupFile(blob);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("版本");
  });

  it("collectMaterialRefs 保持稳定顺序", () => {
    const refs = collectMaterialRefs(mkData(["b", "a", "c"]).courses);
    expect(refs.map((r) => r.storageKey)).toEqual(["b", "a", "c"]);
  });
});
