import JSZip from "jszip";
import { ClassFlowBackup, ClassFlowBackupData, Course } from "@/types";
import { getFileBlob } from "@/lib/fileStorage";
import { parseBackupJSON } from "@/lib/backup";

export interface MaterialRef {
  storageKey: string;
  title: string;
}

/** 收集所有具有 storageKey 的课程资料引用 */
export function collectMaterialRefs(courses: Course[]): MaterialRef[] {
  const refs: MaterialRef[] = [];
  for (const course of courses) {
    for (const material of course.materials) {
      if (material.storageKey) {
        refs.push({ storageKey: material.storageKey, title: material.title });
      }
    }
  }
  return refs;
}

export interface MaterialAvailability {
  total: number;
  available: number;
  missing: MaterialRef[];
}

/** 检测课程资料的本地文件可用性（不常驻扫描，按需调用） */
export async function checkMaterialAvailability(
  courses: Course[],
  getBlob: (storageKey: string) => Promise<Blob | null> = getFileBlob
): Promise<MaterialAvailability> {
  const refs = collectMaterialRefs(courses);
  const missing: MaterialRef[] = [];
  let available = 0;

  for (const ref of refs) {
    try {
      const blob = await getBlob(ref.storageKey);
      if (blob) available += 1;
      else missing.push(ref);
    } catch {
      missing.push(ref);
    }
  }

  return { total: refs.length, available, missing };
}

export interface FullBackupExportResult {
  packedMaterials: number;
  missingMaterials: MaterialRef[];
}

/** 根据文件名后缀推断 MIME（用于从 ZIP 恢复时重建 Blob 类型） */
export function mimeFromTitle(title: string): string {
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * 导出完整备份 ZIP：
 * classflow-backup.zip
 * ├── data.json          （ClassFlowBackup 结构）
 * └── materials/<storageKey> （IndexedDB 中的真实文件 Blob）
 *
 * 缺失的 Blob 不会导致整个备份失败，仅记录 warning。
 */
export async function buildFullBackupZip(
  data: ClassFlowBackupData,
  getBlob: (storageKey: string) => Promise<Blob | null> = getFileBlob
): Promise<{ zipBlob: Blob; result: FullBackupExportResult }> {
  const backup: ClassFlowBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };

  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(backup, null, 2));

  const refs = collectMaterialRefs(data.courses);
  const missingMaterials: MaterialRef[] = [];
  let packedMaterials = 0;

  for (const ref of refs) {
    let blob: Blob | null = null;
    try {
      blob = await getBlob(ref.storageKey);
    } catch {
      blob = null;
    }
    if (blob) {
      // 先转 ArrayBuffer 再写入（浏览器与 Node 均受支持）
      zip.file(`materials/${ref.storageKey}`, await blob.arrayBuffer());
      packedMaterials += 1;
    } else {
      missingMaterials.push(ref);
    }
  }

  const zipBlob = new Blob([await zip.generateAsync({ type: "arraybuffer" })], {
    type: "application/zip",
  });
  return { zipBlob, result: { packedMaterials, missingMaterials } };
}

export interface ParsedFullBackup {
  data: ClassFlowBackupData;
  /** storageKey → Blob（来自 ZIP 的 materials/ 目录） */
  materials: Map<string, Blob>;
  /** metadata 声明了 storageKey 但 ZIP 内缺少对应文件 */
  missingMaterials: MaterialRef[];
}

export type FullBackupParseOutcome =
  | { ok: true; parsed: ParsedFullBackup }
  | { ok: false; error: string };

/**
 * 读取并校验完整备份 ZIP。
 * 纯解析：在校验通过前不修改 Zustand / IndexedDB 任何数据。
 * 支持浏览器 File 与 Node 环境的 ArrayBuffer 输入。
 */
export async function parseFullBackupFile(file: Blob | ArrayBuffer): Promise<FullBackupParseOutcome> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { ok: false, error: "无法解析备份文件：不是有效的 ZIP 压缩包" };
  }

  const dataEntry = zip.file("data.json");
  if (!dataEntry) {
    return { ok: false, error: "备份包缺少 data.json，无法恢复" };
  }

  const dataText = await dataEntry.async("string");
  const validated = parseBackupJSON(dataText);
  if (!validated.ok) {
    return validated;
  }

  const materials = new Map<string, Blob>();
  const missingMaterials: MaterialRef[] = [];

  for (const ref of collectMaterialRefs(validated.data.courses)) {
    const entry = zip.file(`materials/${ref.storageKey}`);
    if (entry) {
      const buffer = await entry.async("arraybuffer");
      materials.set(ref.storageKey, new Blob([buffer], { type: mimeFromTitle(ref.title) }));
    } else {
      missingMaterials.push(ref);
    }
  }

  return {
    ok: true,
    parsed: { data: validated.data, materials, missingMaterials },
  };
}
