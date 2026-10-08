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
import { flushLearningHistoryQueue } from "@/lib/history/recorder";

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
  /** 备份内缺失文件的 storageKey（ZIP 缺包 + JSON 全量）：已从元数据摘除，需重新上传 */
  strippedMissing: string[];
  health: MaterialAvailability;
}

/**
 * 写入失败的附件 storageKey 从课程资料元数据中摘除（与头像 stripUnbackableAvatarRef 同模式）：
 * 否则恢复后资料指向不存在的 Blob（悬指），健康检查报缺失且用户无法从 UI 修复引用。
 * savedFailures 照常返回，调用方以 warning 告知用户。
 */
export function stripFailedMaterialRefs(
  courses: ClassFlowBackupData["courses"],
  failedKeys: ReadonlySet<string> | readonly string[]
): ClassFlowBackupData["courses"] {
  const failed: ReadonlySet<string> = failedKeys instanceof Set ? failedKeys : new Set(failedKeys);
  if (failed.size === 0) return courses;
  return courses.map((c) => ({
    ...c,
    materials: c.materials.map((m) =>
      m.storageKey && failed.has(m.storageKey) ? { ...m, storageKey: undefined } : m
    ),
  }));
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
      // 模块不变量「绝不保留不可用的 avatarStorageKey」：Blob 写入失败 →
      // 摘除引用（否则恢复后 profile 指向不存在的头像 Blob）
      restoreData = {
        ...prepared.data,
        userProfile: stripUnbackableAvatarRef(prepared.data.userProfile),
      };
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

  // 附件 Blob 写入失败的 storageKey 从资料元数据摘除（悬指修复；失败清单照常返回告警）
  if (savedFailures.length > 0) {
    restoreData = {
      ...restoreData,
      courses: stripFailedMaterialRefs(restoreData.courses, savedFailures),
    };
  }

  // 备份内缺失文件的 storageKey 同样摘除（此前只展示不摘，恢复即批量悬指）：
  // ZIP 缺包 + JSON（materials 为空，全部 storageKey 视为缺失）。与头像 strip 同不变量。
  const strippedMissing: string[] = prepared.missingMaterials.map((m) => m.storageKey);
  if (prepared.sourceType === "json") {
    for (const c of restoreData.courses) {
      for (const m of c.materials) {
        if (m.storageKey && !strippedMissing.includes(m.storageKey)) strippedMissing.push(m.storageKey);
      }
    }
  }
  if (strippedMissing.length > 0) {
    restoreData = {
      ...restoreData,
      courses: stripFailedMaterialRefs(restoreData.courses, strippedMissing),
    };
  }

  api.restoreAppData(restoreData);
  // History reset 是队列异步：落盘后再 toast，避免 Analytics 在 Reset 落盘前读到旧史混新数
  try {
    await flushLearningHistoryQueue();
  } catch {
    /* best-effort：History 失败不阻塞恢复结果 */
  }
  const health = await checkMaterialAvailability(restoreData.courses);
  return { savedFailures, strippedMissing, health };
}
