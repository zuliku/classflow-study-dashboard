/**
 * Startup File Blob Reconcile（V1.3A.1 fail-closed）：
 * 只有「所有持久化 Blob owner」的引用 key 完整枚举成功后，才允许删除 orphan Blob。
 * - Course Material keys：同步收集（来自 Zustand state，不会 async fail）
 * - Project File keys：IndexedDB async —— 这是唯一可能让引用集合“不完整”的阶段
 * 一旦 Project key enumeration 失败：完全 skip GC（宁可暂时留下 orphan，
 * 也绝不能把 Project File Blob 误判为 orphan 删除）。
 */
import { reconcileOrphanBlobs } from "@/lib/fileStorage";

export type FileReconcileResult =
  | { ok: true; deleted: number }
  | { ok: false; skipped: true };

export async function reconcilePersistedFileBlobs(input: {
  courseStorageKeys: string[] | Set<string>;
  listProjectStorageKeys: () => Promise<string[] | Set<string>>;
}): Promise<FileReconcileResult> {
  const validKeys = new Set<string>();
  for (const key of Array.from(input.courseStorageKeys)) {
    if (key) validKeys.add(key);
  }
  let projectKeys: string[] | Set<string>;
  try {
    projectKeys = await input.listProjectStorageKeys();
  } catch (err) {
    // fail closed：引用集合不完整，不能判断任何 Blob 是否真的 orphan
    console.warn("file reconcile skipped: project file references unavailable", err);
    return { ok: false, skipped: true };
  }
  for (const key of Array.from(projectKeys)) {
    if (key) validKeys.add(key);
  }
  const r = await reconcileOrphanBlobs(validKeys);
  return { ok: true, deleted: r.deleted };
}
