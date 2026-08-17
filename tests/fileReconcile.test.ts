/**
 * Startup File Blob Reconcile（V1.3A.1 fail-closed）测试：
 * - 正常：Course + Project 引用完整 → 真 orphan 删除
 * - fail-closed：Project key enumeration 失败 → 完全 skip GC，任何 Blob 都不删除
 */
import { describe, it, expect, beforeEach } from "vitest";
import { reconcilePersistedFileBlobs } from "@/lib/fileReconcile";
import {
  createStorageKey,
  saveFileBlob,
  getFileBlob,
  clearAllFileBlobs,
} from "@/lib/fileStorage";

const blob = (text: string) => new Blob([text], { type: "text/plain" });

beforeEach(async () => {
  await clearAllFileBlobs().catch(() => {});
});

describe("reconcilePersistedFileBlobs", () => {
  it("正常路径：Course + Project Blob 保留，真 orphan 删除", async () => {
    const courseKey = createStorageKey();
    const projectKey = createStorageKey();
    const orphanKey = createStorageKey();
    await saveFileBlob(courseKey, blob("course"));
    await saveFileBlob(projectKey, blob("project"));
    await saveFileBlob(orphanKey, blob("orphan"));

    const r = await reconcilePersistedFileBlobs({
      courseStorageKeys: [courseKey],
      listProjectStorageKeys: async () => [projectKey],
    });

    expect(r).toEqual({ ok: true, deleted: 1 });
    expect(await getFileBlob(courseKey)).not.toBeNull();
    expect(await getFileBlob(projectKey)).not.toBeNull();
    expect(await getFileBlob(orphanKey)).toBeNull();
  });

  it("fail-closed：Project key enumeration 抛错 → skip，三个 Blob 全部保留", async () => {
    const courseKey = createStorageKey();
    const projectKey = createStorageKey();
    const orphanKey = createStorageKey();
    await saveFileBlob(courseKey, blob("course"));
    await saveFileBlob(projectKey, blob("project"));
    await saveFileBlob(orphanKey, blob("orphan"));

    const r = await reconcilePersistedFileBlobs({
      courseStorageKeys: [courseKey],
      listProjectStorageKeys: async () => {
        throw new Error("indexeddb unavailable");
      },
    });

    expect(r).toEqual({ ok: false, skipped: true });
    // 引用集合不完整：不能判断 orphanKey 是否真的 orphan → 全部保留
    expect(await getFileBlob(courseKey)).not.toBeNull();
    expect(await getFileBlob(projectKey)).not.toBeNull();
    expect(await getFileBlob(orphanKey)).not.toBeNull();
  });

  it("fail-closed 后 Blob 数据内容未被篡改", async () => {
    const projectKey = createStorageKey();
    await saveFileBlob(projectKey, blob("PROJECT_SENTINEL"));
    await reconcilePersistedFileBlobs({
      courseStorageKeys: [],
      listProjectStorageKeys: async () => {
        throw new Error("boom");
      },
    });
    expect((await getFileBlob(projectKey))?.text()).resolves.toBe("PROJECT_SENTINEL");
  });
});
