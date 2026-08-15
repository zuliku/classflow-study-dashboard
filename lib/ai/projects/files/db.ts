/**
 * Kiro Project File IndexedDB 服务（V1.3A）。
 * - metadata 存 classflow-kiro.project-files；Blob 复用 classflow-files（lib/fileStorage）
 * - storageKey 是 Blob implementation detail，绝不进入模型 / UI
 * - 上传：验证 Project 存在 → routeAttachment → count cap → save blob → write metadata；
 *   metadata 写失败时 best-effort 删除 blob（不制造 orphan）
 * - 删除 Project：metadata 在同一 kiro transaction 删除；Blob 删除为 best-effort
 *   （跨 DB 无法伪造原子性），orphan reconcile 兜底
 */
import {
  openKiroDB,
  KIRO_PROJECT_FILES_STORE,
  KIRO_PROJECTS_STORE,
  KIRO_CONVERSATIONS_STORE,
} from "@/lib/ai/storage/kiroDb";
import { getKiroProject } from "@/lib/ai/projects/db";
import {
  KiroProjectFileRecord,
  MAX_PROJECT_FILES_PER_PROJECT,
  createProjectFileId,
} from "@/lib/ai/projects/files/types";
import {
  createStorageKey,
  saveFileBlob,
  getFileBlob,
  deleteFileBlob,
} from "@/lib/fileStorage";
import { KiroConversationRecord } from "@/lib/ai/history/types";

export async function listProjectFiles(projectId: string): Promise<KiroProjectFileRecord[]> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECT_FILES_STORE, "readonly");
    const req = t.objectStore(KIRO_PROJECT_FILES_STORE).index("projectId").getAll(projectId);
    req.onsuccess = () => {
      const files = (req.result as KiroProjectFileRecord[]).filter(
        (f) => f && typeof f.id === "string" && typeof f.storageKey === "string"
      );
      files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      resolve(files);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getProjectFile(id: string): Promise<KiroProjectFileRecord | null> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECT_FILES_STORE, "readonly");
    const req = t.objectStore(KIRO_PROJECT_FILES_STORE).get(id);
    req.onsuccess = () => resolve((req.result as KiroProjectFileRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 创建 Project File：
 * 1. Project 必须存在（PROJECT_NOT_FOUND）
 * 2. count < MAX_PROJECT_FILES_PER_PROJECT（PROJECT_FILE_LIMIT_REACHED）
 * 3. save blob → write metadata；metadata 失败 → best-effort 删 blob 再失败
 */
export async function createProjectFile(input: {
  projectId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: KiroProjectFileRecord["kind"];
  blob: Blob;
}): Promise<KiroProjectFileRecord> {
  const project = await getKiroProject(input.projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  const existing = await listProjectFiles(input.projectId);
  if (existing.length >= MAX_PROJECT_FILES_PER_PROJECT) {
    throw new Error("PROJECT_FILE_LIMIT_REACHED");
  }

  const storageKey = createStorageKey();
  await saveFileBlob(storageKey, input.blob);

  const record: KiroProjectFileRecord = {
    id: createProjectFileId(),
    projectId: input.projectId,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
    storageKey,
    createdAt: new Date().toISOString(),
  };

  const db = await openKiroDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(KIRO_PROJECT_FILES_STORE, "readwrite");
      const req = t.objectStore(KIRO_PROJECT_FILES_STORE).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // Blob 已保存但 metadata 失败 → best-effort 清理，不制造 orphan Blob
    await deleteFileBlob(storageKey).catch(() => {});
    throw err;
  }
  return record;
}

/** 删除单个 Project File：metadata 不存在 → FILE_NOT_FOUND；Blob cleanup 失败不恢复 metadata */
export async function deleteProjectFile(id: string): Promise<void> {
  const record = await getProjectFile(id);
  if (!record) throw new Error("FILE_NOT_FOUND");
  const db = await openKiroDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECT_FILES_STORE, "readwrite");
    const req = t.objectStore(KIRO_PROJECT_FILES_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  // Blob 清理失败 → 交给 reconcileOrphanBlobs 兜底
  await deleteFileBlob(record.storageKey).catch(() => {});
}

/** 全部 Project File storageKey（orphan reconcile 的 validKeys 一部分） */
export async function listAllProjectFileStorageKeys(): Promise<string[]> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECT_FILES_STORE, "readonly");
    const req = t.objectStore(KIRO_PROJECT_FILES_STORE).getAll();
    req.onsuccess = () => {
      const files = (req.result as KiroProjectFileRecord[]).filter((f) => f && typeof f.storageKey === "string");
      resolve(files.map((f) => f.storageKey));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 删除 Project：同一 kiro transaction 内删 Project + unassign conversations + 删 project-files metadata；
 * 收集 storageKey，transaction 成功后 best-effort 删 Blob（classflow-files 是另一 DB，无法跨库原子）。
 *
 * V1.3A.1 修复：files 删除必须通过 projectId index 限定目标 Project（绝不全表 cursor 无条件删除，
 * 否则删除 A 会连带删除 B/C 的 Project Files metadata 与 Blob）。
 */
export async function deleteProjectWithFilesAndUnassignConversations(id: string): Promise<void> {
  const db = await openKiroDB();
  const storageKeysToDelete: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([KIRO_PROJECTS_STORE, KIRO_CONVERSATIONS_STORE, KIRO_PROJECT_FILES_STORE], "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).delete(id);

    const convStore = t.objectStore(KIRO_CONVERSATIONS_STORE);
    const convCursor = convStore.openCursor();
    convCursor.onsuccess = () => {
      const cursor = convCursor.result;
      if (!cursor) return;
      const value = cursor.value as KiroConversationRecord | undefined;
      if (value && value.projectId === id) {
        const cleaned = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "projectId"));
        cursor.update(cleaned);
      }
      cursor.continue();
    };
    convCursor.onerror = () => reject(convCursor.error);

    // projectId index scoped：只遍历目标 Project 的文件（其它 Project 完全不访问）
    const filesStore = t.objectStore(KIRO_PROJECT_FILES_STORE);
    const filesIndex = filesStore.index("projectId");
    const filesCursor = filesIndex.openCursor(IDBKeyRange.only(id));
    filesCursor.onsuccess = () => {
      const cursor = filesCursor.result;
      if (!cursor) return;
      const value = cursor.value as KiroProjectFileRecord | undefined;
      // index 限定 + 值级校验（双保险；绝不触碰其它 Project 文件）
      if (value && value.projectId === id) {
        if (value.storageKey) storageKeysToDelete.push(value.storageKey);
        cursor.delete();
      }
      cursor.continue();
    };
    filesCursor.onerror = () => reject(filesCursor.error);

    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

  // Blob cleanup：best-effort（跨 DB）；失败由 reconcileOrphanBlobs 兜底
  await Promise.all(storageKeysToDelete.map((key) => deleteFileBlob(key).catch(() => {})));
}

/** read_project_file executor 用：按 storageKey 取 Blob */
export { getFileBlob as getProjectFileBlob };
