import JSZip from "jszip";
import { ClassFlowBackup, ClassFlowBackupData, Course, UserProfile } from "@/types";
import { getFileBlob } from "@/lib/fileStorage";
import { loadAvatarBlob, detectImageMime, AVATAR_STORAGE_KEY } from "@/lib/profileAvatar";
import { parseBackupJSON } from "@/lib/backup";
import { findDataIntegrityIssues, DataIntegrityIssues } from "@/lib/dataIntegrity";

/** ZIP 内头像条目的固定目录（data.json 中 avatarStorageKey 指向该条目） */
export const AVATAR_ZIP_PATH = `avatar/${AVATAR_STORAGE_KEY}`;

/**
 * 剥离不可随 JSON 备份携带的头像引用（avatarStorageKey 依赖本地 IndexedDB Blob，
 * JSON 备份只含纯数据，导出时必须摘除，避免恢复后出现悬挂引用）。
 * 旧版 avatarUrl（外部 URL / 自包含）保持原样。
 */
export function stripUnbackableAvatarRef(profile: UserProfile): UserProfile {
  if (!profile.avatarStorageKey) return profile;
  return { ...profile, avatarStorageKey: undefined };
}

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
  /** 本地头像导出状态：packed = 已包含 / missing = 声明了但本地 Blob 缺失 / none = 未设置 */
  avatar: "packed" | "missing" | "none";
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
 * ├── materials/<storageKey> （IndexedDB 中的真实文件 Blob）
 * └── avatar/profile-avatar   （本地头像 Blob，可选）
 *
 * 缺失的 Blob 不会导致整个备份失败，仅记录 warning。
 */
export async function buildFullBackupZip(
  data: ClassFlowBackupData,
  getBlob: (storageKey: string) => Promise<Blob | null> = getFileBlob,
  getAvatarBlob: () => Promise<Blob | null> = loadAvatarBlob
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

  // 本地头像：仅当 userProfile 声明 avatarStorageKey 时尝试携带
  let avatar: FullBackupExportResult["avatar"] = "none";
  if (data.userProfile.avatarStorageKey) {
    let avatarBlob: Blob | null = null;
    try {
      avatarBlob = await getAvatarBlob();
    } catch {
      avatarBlob = null;
    }
    if (avatarBlob) {
      zip.file(AVATAR_ZIP_PATH, await avatarBlob.arrayBuffer());
      avatar = "packed";
    } else {
      avatar = "missing";
    }
  }

  const zipBlob = new Blob([await zip.generateAsync({ type: "arraybuffer" })], {
    type: "application/zip",
  });
  return { zipBlob, result: { packedMaterials, missingMaterials, avatar } };
}

export interface ParsedFullBackup {
  data: ClassFlowBackupData;
  /** storageKey → Blob（来自 ZIP 的 materials/ 目录） */
  materials: Map<string, Blob>;
  /** metadata 声明了 storageKey 但 ZIP 内缺少对应文件 */
  missingMaterials: MaterialRef[];
  /** 本地头像 Blob（ZIP 的 avatar/ 目录）；metadata 声明但 ZIP 缺失时为 null */
  avatar: Blob | null;
  /** 数据完整性检查结果（fatal 阻止恢复，warnings 提示） */
  issues: DataIntegrityIssues;
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

  // 本地头像：metadata 声明 avatarStorageKey 时尝试从 avatar/ 目录读取（MIME 按字节签名重建）
  let avatar: Blob | null = null;
  if (validated.data.userProfile.avatarStorageKey) {
    const entry = zip.file(AVATAR_ZIP_PATH);
    if (entry) {
      const buffer = new Uint8Array(await entry.async("arraybuffer"));
      avatar = new Blob([buffer], { type: detectImageMime(buffer) });
    }
  }

  return {
    ok: true,
    parsed: {
      data: validated.data,
      materials,
      missingMaterials,
      avatar,
      issues: findDataIntegrityIssues(validated.data),
    },
  };
}
