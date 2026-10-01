// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createGuardedStorage, subscribeCrossWindowSync } from "@/lib/persistStorage";

function quotaError(): Error {
  return new DOMException("Quota exceeded", "QuotaExceededError");
}

describe("createGuardedStorage（写满不断业务）", () => {
  it("QuotaExceeded 被吞掉并回调一次（后续不再打扰）", () => {
    const onQuotaExceeded = vi.fn();
    const storage = createGuardedStorage(onQuotaExceeded);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });
    try {
      expect(() => storage.setItem("k", { a: 1 })).not.toThrow();
      expect(() => storage.setItem("k", { a: 2 })).not.toThrow();
      expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("非配额错误原样抛出（不掩盖真实 bug）", () => {
    const storage = createGuardedStorage(vi.fn());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(() => storage.setItem("k", {})).toThrow("denied");
    } finally {
      setItem.mockRestore();
    }
  });

  it("正常读写直通", () => {
    const storage = createGuardedStorage(vi.fn());
    storage.setItem("guarded-k", { a: 1 });
    expect(storage.getItem("guarded-k")).toEqual({ a: 1 });
    storage.removeItem("guarded-k");
    expect(storage.getItem("guarded-k")).toBeNull();
  });
});

describe("subscribeCrossWindowSync（他窗写入收敛）", () => {
  it("已收敛不动作；他窗新值去抖后 rehydrate 一次；无关 key 忽略", async () => {
    vi.useFakeTimers();
    try {
      const rehydrate = vi.fn(async () => {});
      const off = subscribeCrossWindowSync({ persist: { rehydrate } }, "sync-test-key");
      try {
        localStorage.setItem("sync-test-key", JSON.stringify({ v: 1 }));
        // 已收敛（事件值与本地一致）→ 不动作
        window.dispatchEvent(
          new StorageEvent("storage", { key: "sync-test-key", newValue: localStorage.getItem("sync-test-key") })
        );
        await vi.advanceTimersByTimeAsync(600);
        expect(rehydrate).not.toHaveBeenCalled();
        // 他窗新值（连发两次合并为一次）
        window.dispatchEvent(new StorageEvent("storage", { key: "sync-test-key", newValue: JSON.stringify({ v: 2 }) }));
        window.dispatchEvent(new StorageEvent("storage", { key: "sync-test-key", newValue: JSON.stringify({ v: 3 }) }));
        await vi.advanceTimersByTimeAsync(600);
        expect(rehydrate).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "{}" }));
        await vi.advanceTimersByTimeAsync(600);
        expect(rehydrate).toHaveBeenCalledTimes(1);
      } finally {
        off();
        localStorage.removeItem("sync-test-key");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
