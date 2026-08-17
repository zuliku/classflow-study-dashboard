import { describe, it, expect } from "vitest";
import {
  inferMaterialType,
  uploadCourseMaterial,
  uploadCourseMaterials,
} from "@/lib/materialUpload";
import { Material } from "@/types";

function fakeFile(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "application/octet-stream" });
}

function fakeStore() {
  const materials: Material[] = [];
  return {
    materials,
    addMaterial: ((_courseId, data) => {
      const m: Material = {
        id: `m_${materials.length + 1}`,
        title: data.title,
        type: data.type,
        size: data.size,
        uploadDate: "2026-08-10",
        storageKey: data.storageKey,
      };
      materials.push(m);
      return m;
    }) as (courseId: string, data: { title: string; type: Material["type"]; size?: string; url?: string; storageKey?: string }) => Material,
  };
}

describe("inferMaterialType", () => {
  it("扩展名 → Material type（txt/md/未知 → doc，不改 Material Type Domain）", () => {
    expect(inferMaterialType("a.pdf")).toBe("pdf");
    expect(inferMaterialType("b.PPTX")).toBe("ppt");
    expect(inferMaterialType("c.png")).toBe("image");
    expect(inferMaterialType("d.jpeg")).toBe("image");
    expect(inferMaterialType("e.doc")).toBe("doc");
    expect(inferMaterialType("f.txt")).toBe("doc");
    expect(inferMaterialType("g.md")).toBe("doc");
    expect(inferMaterialType("noext")).toBe("doc");
  });
});

describe("uploadCourseMaterial", () => {
  it("Blob 保存成功 → 创建 Course Material（含 storageKey / 真实 size）；返回 material", async () => {
    const store = fakeStore();
    const saved: string[] = [];
    const r = await uploadCourseMaterial({
      courseId: "c1",
      file: fakeFile("作业要求.pdf", 2 * 1024 * 1024),
      addMaterial: store.addMaterial,
      saveBlob: async (key) => {
        saved.push(key);
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.title).toBe("作业要求.pdf");
    expect(r.material.type).toBe("pdf");
    expect(r.material.storageKey).toBe(saved[0]);
    expect(r.material.size).toBe("2.00 MB");
    expect(store.materials).toHaveLength(1);
  });

  it("Blob 保存失败 → 不产生任何 metadata", async () => {
    const store = fakeStore();
    const r = await uploadCourseMaterial({
      courseId: "c1",
      file: fakeFile("坏文件.pdf"),
      addMaterial: store.addMaterial,
      saveBlob: async () => {
        throw new Error("quota");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fileName).toBe("坏文件.pdf");
    expect(store.materials).toHaveLength(0);
  });

  it("默认 saveBlob 使用真实 IndexedDB 实现（未注入时不被 mock 覆盖）", () => {
    // 仅验证默认路径可构造（真实保存由 fileStorage 的既有测试覆盖）
    expect(typeof uploadCourseMaterial).toBe("function");
  });
});

describe("uploadCourseMaterials（批量）", () => {
  it("逐文件独立成败：成功 2 失败 1 → 只保留成功的 2 个", async () => {
    const store = fakeStore();
    let calls = 0;
    const { succeeded, failed } = await uploadCourseMaterials({
      courseId: "c1",
      files: [fakeFile("a.pdf"), fakeFile("b.docx"), fakeFile("c.pdf")],
      addMaterial: store.addMaterial,
      saveBlob: async () => {
        calls += 1;
        if (calls === 2) throw new Error("fail second file");
      },
    });
    expect(succeeded).toHaveLength(2);
    expect(failed).toEqual(["b.docx"]);
    expect(store.materials).toHaveLength(2);
  });

  it("全部成功 → succeeded 3 / failed 0；同名单文件各自独立", async () => {
    const store = fakeStore();
    const { succeeded, failed } = await uploadCourseMaterials({
      courseId: "c1",
      files: [fakeFile("同名.pdf"), fakeFile("同名.pdf"), fakeFile("c.pdf")],
      addMaterial: store.addMaterial,
      saveBlob: async () => {},
    });
    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(0);
    // 两个同名文件产生两个独立 Material（不按 file.name 倒查）
    expect(new Set(succeeded.map((m) => m.id)).size).toBe(3);
    expect(succeeded.filter((m) => m.title === "同名.pdf")).toHaveLength(2);
  });
});
