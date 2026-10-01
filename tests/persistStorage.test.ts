// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createGuardedStorage } from "@/lib/persistStorage";

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
