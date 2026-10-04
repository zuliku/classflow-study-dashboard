/**
 * Task 6B-B：Material Upload 共享 Domain Helper（Course Upload / Task Upload 唯一实现）。
 * 原则：上传到 Task = 创建真实 Course Material + 自动关联 Assignment.materialIds。
 * 文件底层永远属于 Course.materials（IndexedDB Blob / Backup / read_material 全复用）；
 * 本 helper 只负责：扩展名 → Material.type、Blob 保存 → metadata 创建（顺序不可颠倒）。
 */

import { Material } from "@/types";
import { createStorageKey, saveFileBlob, deleteFileBlob, isQuotaExceededError } from "@/lib/fileStorage";

/** P1 存储安全：上传前置校验（此前 accept 仅 UI 提示，可绕过；超大/0B/可执行直接进 IndexedDB 才报配额） */
const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
const MATERIAL_BLOCKED_EXT = new Set(["exe", "bat", "cmd", "ps1", "msi", "dll", "scr", "com", "docm", "xlsm"]);
export function validateMaterialFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (MATERIAL_BLOCKED_EXT.has(ext)) return `不支持的文件类型（.${ext}），请选择文档/图片/PDF`;
  if (file.size === 0) return "文件为空，无法上传";
  if (file.size > MATERIAL_MAX_BYTES) return `文件过大（${(file.size / 1048576).toFixed(1)}MB），上限 20MB`;
  return null;
}

/** 扩展名 → Material type（txt/md 及未知类型继续映射 doc；不重构 Material Type Domain） */
export function inferMaterialType(fileName: string): Material["type"] {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext)) return "image";
  return "doc";
}

/** addCourseMaterial 的最小接口形状（与 Store Domain Action 一致） */
export type AddCourseMaterialFn = (
  courseId: string,
  material: { title: string; type: Material["type"]; size?: string; url?: string; storageKey?: string }
) => Material;

export interface UploadCourseMaterialInput {
  courseId: string;
  file: File;
  addMaterial: AddCourseMaterialFn;
  /** 测试注入用；缺省使用真实 IndexedDB saveFileBlob */
  saveBlob?: (storageKey: string, blob: Blob) => Promise<void>;
}

export type UploadCourseMaterialResult =
  | { ok: true; material: Material }
  | { ok: false; fileName: string; quotaExceeded?: boolean; reason?: string };

/**
 * 单文件上传：
 * 1. createStorageKey
 * 2. saveFileBlob（失败 → 不产生任何 metadata）
 * 3. 创建 Course Material（返回含真实 id）
 */
export async function uploadCourseMaterial(
  input: UploadCourseMaterialInput
): Promise<UploadCourseMaterialResult> {
  const { courseId, file, addMaterial } = input;
  const saveBlob = input.saveBlob ?? saveFileBlob;
  const precheck = validateMaterialFile(file);
  if (precheck) return { ok: false, fileName: file.name, reason: precheck };
  const storageKey = createStorageKey();
  try {
    await saveBlob(storageKey, file);
  } catch (err) {
    return { ok: false, fileName: file.name, quotaExceeded: isQuotaExceededError(err) };
  }

  const sizeStr = file.size > 0 ? (file.size / (1024 * 1024)).toFixed(2) + " MB" : undefined;
  try {
    const material = addMaterial(courseId, {
      title: file.name,
      type: inferMaterialType(file.name),
      size: sizeStr,
      storageKey,
    });
    return { ok: true, material };
  } catch (err) {
    // addMaterial 抛错（配额/校验）→ 补偿删除已存 Blob，避免孤儿 storageKey 膨胀（此前无补偿，只靠启动对账）
    try {
      await deleteFileBlob(storageKey);
    } catch {
      /* 补偿失败：启动对账兜底 */
    }
    return { ok: false, fileName: file.name, quotaExceeded: isQuotaExceededError(err) };
  }
}

/** 批量上传：逐文件独立成败（普通文件上传，不是业务事务；一个失败不影响其余） */
export async function uploadCourseMaterials(input: {
  courseId: string;
  files: File[];
  addMaterial: AddCourseMaterialFn;
  saveBlob?: (storageKey: string, blob: Blob) => Promise<void>;
}): Promise<{ succeeded: Material[]; failed: string[]; quotaExceeded: boolean }> {
  const succeeded: Material[] = [];
  const failed: string[] = [];
  let quotaExceeded = false;
  for (const file of input.files) {
    const r = await uploadCourseMaterial({
      courseId: input.courseId,
      file,
      addMaterial: input.addMaterial,
      saveBlob: input.saveBlob,
    });
    if (r.ok) succeeded.push(r.material);
    else {
      failed.push(r.fileName);
      if (r.quotaExceeded) quotaExceeded = true;
    }
  }
  return { succeeded, failed, quotaExceeded };
}