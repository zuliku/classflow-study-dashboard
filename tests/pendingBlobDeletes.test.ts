// @vitest-environment jsdom
/**
 * 待删 Blob 持久化队列：撤销窗口期内刷新/崩溃，删除意图不丢，启动排水执行。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueuePendingBlobDelete,
  dequeuePendingBlobDelete,
  listPendingBlobDeletes,
  drainPendingBlobDeletes,
} from "@/lib/pendingBlobDeletes";
import { saveFileBlob, getFileBlob } from "@/lib/fileStorage";

beforeEach(() => {
  localStorage.removeItem("classflow-pending-blob-deletes");
});

describe("pendingBlobDeletes", () => {
  it("非法 key 拒绝入队；重复入队去重", () => {
    enqueuePendingBlobDelete("../../evil");
    enqueuePendingBlobDelete("");
    expect(listPendingBlobDeletes()).toEqual([]);
    enqueuePendingBlobDelete("file_abc123");
    enqueuePendingBlobDelete("file_abc123");
    expect(listPendingBlobDeletes()).toEqual(["file_abc123"]);
    dequeuePendingBlobDelete("file_abc123");
    expect(listPendingBlobDeletes()).toEqual([]);
  });

  it("崩溃场景：入队后未删除 → 排水执行删除并清空队列", async () => {
    await saveFileBlob("file_pending_1", new Blob(["data"]));
    enqueuePendingBlobDelete("file_pending_1");
    // 模拟崩溃：未调 delete，直接排水（如启动时）
    const r = await drainPendingBlobDeletes();
    expect(r).toEqual({ deleted: 1, failed: 0 });
    expect(await getFileBlob("file_pending_1")).toBeNull();
    expect(listPendingBlobDeletes()).toEqual([]);
  });

  it("空队列排水无操作", async () => {
    await expect(drainPendingBlobDeletes()).resolves.toEqual({ deleted: 0, failed: 0 });
  });
});
