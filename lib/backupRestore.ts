import { ClassFlowBackupData } from "@/types";
import { parseBackupJSON } from "@/lib/backup";
import {
  parseFullBackupFile,
  checkMaterialAvailability,
  MaterialAvailability,
  stripUnbackableAvatarRef,
} from "@/lib/backupPackage";
import { findDataIntegrityIssues, classifyIntegrityIssues } from "@/lib/dataIntegrity";
import { saveFileBlob } from "@/lib/fileStorage";
import { saveAvatarBlob, deleteAvatarBlob } from "@/lib/profileAvatar";

/**
 * Backup Restore orchestrator：
 * - prepare：只读取/解析/验证，绝不修改 Store 或 IndexedDB（无副作用是 cancel 安全的架构保证）
 * - commit：用户确认后才写 materials + avatar + restoreAppData
 * React 组件不接触 ZIP/JSON 解析细节。
 */

export interface PreparedRestore {
  sourceType: "zip" | "json";
  fileName: string;
  data: ClassFlowBackupData;
  summary: {
    courses: number;
    schedules: number;
    assignments: number;
    groupProjects: number;
    materials: number;
  };
  integrity: {
    fatal: string[];
    warnings: string[];
  };
  /** ZIP 内实际的附件 Blob（JSON 为空） */
  materials: Map<string, Blob>;
  /** metadata 声明 storageKey 但备份内缺少文件 */
  missingMaterials: { storageKey: string; title: string }[];
  /** ZIP 内实际的本地头像 Blob（JSON 恒为 null） */
  avatar: Blob | null;
}

export type PrepareResult = { ok: true; prepared: PreparedRestore } | { ok: false; error: string };

function buildSummary(data: ClassFlowBackupData): PreparedRestore["summary"] {
  const materials = data.courses.reduce((sum, c) => sum + c.materials.length, 0);
  return {
    courses: data.courses.length,
    schedules: data.schedules.length,
    assignments: data.assignments.length,
    groupProjects: data.groupProjects.length,
    materials,
  };
}

function countMaterialRefs(courses: ClassFlowBackupData["courses"]): number {
  return courses.reduce((sum, c) => sum + c.materials.filter((m) => !!m.storageKey).length, 0);
}

/** 选择文件 → 解析 + 验证 + 摘要。不写 Store / IDB。 */
export async function prepareBackupRestore(file: File): Promise<PrepareResult> {
  const isZip = file.name.toLowerCase().endsWith(".zip");

  if (isZip) {
    // 转 ArrayBuffer：JSZip 对 Blob/File 的 node 支持有限，ArrayBuffer 路径稳定
    const outcome = await parseFullBackupFile(await file.arrayBuffer());
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const { data, materials, missingMaterials, issues, avatar } = outcome.parsed;
    const integrity = classifyIntegrityIssues(issues);
    return {
      ok: true,
      prepared: {
        sourceType: "zip",
        fileName: file.name,
        data,
        summary: buildSummary(data),
        integrity,
        materials,
        missingMaterials: missingMaterials.map((m) => ({
          storageKey: m.storageKey,
          title: m.title,
        })),
        avatar,
      },
    };
  }

  // JSON：仅数据备份
  const text = await file.text();
  const result = parseBackupJSON(text);
  if (!result.ok) return { ok: false, error: result.error };
  const integrity = classifyIntegrityIssues(findDataIntegrityIssues(result.data));
  const warnings = [...integrity.warnings];
  if (countMaterialRefs(result.data.courses) > 0) {
    warnings.push("该备份不含课程资料文件，恢复后相关附件需要重新上传");
  }
  if (result.data.userProfile.avatarStorageKey) {
    warnings.push("该备份不含本地头像，恢复后需要重新设置头像");
  }
  return {
    ok: true,
    prepared: {
      sourceType: "json",
      fileName: file.name,
      data: result.data,
      summary: buildSummary(result.data),
      integrity: { fatal: integrity.fatal, warnings },
      materials: new Map(),
      missingMaterials: [],
      avatar: null,
    },
  };
}

export interface CommitResult {
  savedFailures: string[];
  health: MaterialAvailability;
}

/**
 * 用户确认后执行：先写附件 Blob + 头像，再原子恢复业务数据，最后刷新资料健康。
 * 头像一致性：ZIP 携带头像 → 覆盖写入；未携带但 metadata 声明 → 清理陈旧本地头像并摘除
 * 悬挂引用（绝不保留不可用的 avatarStorageKey，也绝不复用恢复前的旧头像）。
 */
export async function commitBackupRestore(
  prepared: PreparedRestore,
  api: {
    restoreAppData: (data: ClassFlowBackupData) => void;
    saveAvatarBlob?: (blob: Blob) => Promise<void>;
    deleteAvatarBlob?: () => Promise<void>;
  }
): Promise<CommitResult> {
  const savedFailures: string[] = [];
  await Promise.all(
    Array.from(prepared.materials.entries()).map(async ([storageKey, blob]) => {
      try {
        await saveFileBlob(storageKey, blob);
      } catch {
        savedFailures.push(storageKey);
      }
    })
  );

  const saveAvatar = api.saveAvatarBlob ?? saveAvatarBlob;
  const deleteAvatar = api.deleteAvatarBlob ?? deleteAvatarBlob;
  let restoreData = prepared.data;
  if (prepared.avatar) {
    try {
      await saveAvatar(prepared.avatar);
    } catch {
      savedFailures.push("avatar");
    }
  } else if (prepared.data.userProfile.avatarStorageKey) {
    // 备份内无头像 Blob：清理陈旧本地头像（失败不阻塞恢复），并摘除悬挂引用
    try {
      await deleteAvatar();
    } catch {
      // best-effort：引用摘除后陈旧 Blob 不会被任何 UI 复用
    }
    restoreData = {
      ...prepared.data,
      userProfile: stripUnbackableAvatarRef(prepared.data.userProfile),
    };
  }

  api.restoreAppData(restoreData);
  const health = await checkMaterialAvailability(restoreData.courses);
  return { savedFailures, health };
}
