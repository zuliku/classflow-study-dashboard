import { describe, it, expect } from "vitest";
import {
  isChannelErrorCode,
  userMessageForChannelCode,
} from "@/lib/channels/errorContract";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useInboxStore } from "@/store/useInboxStore";

/**
 * BatchG/L 渠道与存储锁：
 * - SYNC_BUSY / GMAIL_OAUTH_CANCELLED 进共享契约（toIpcError 可透传 code，UI 可映射中文）
 * - computer merge 脏布尔归一（降级/脏库不直接生效）
 * - inbox merge 远端超长截断（跨窗 rehydrate 不直接入库）
 */
describe("channel error contract（BatchG 新增码）", () => {
  it("SYNC_BUSY / GMAIL_OAUTH_CANCELLED 为正式错误码且有中文映射", () => {
    expect(isChannelErrorCode("SYNC_BUSY")).toBe(true);
    expect(isChannelErrorCode("GMAIL_OAUTH_CANCELLED")).toBe(true);
    expect(userMessageForChannelCode("SYNC_BUSY")).toContain("同步");
    expect(userMessageForChannelCode("GMAIL_OAUTH_CANCELLED")).toContain("取消");
  });
});

describe("useKiroComputerStore merge（脏布尔归一）", () => {
  it("非 boolean 开关回落 false；合法值保留", () => {
    const merge = useKiroComputerStore.persist.getOptions().merge!;
    const merged = merge(
      {
        computerEnabled: "yes",
        terminalEnabled: 1,
        desktopControlEnabled: true,
        backgroundEnabled: null,
      },
      useKiroComputerStore.getState()
    ) as Record<string, unknown>;
    expect(merged.computerEnabled).toBe(false);
    expect(merged.terminalEnabled).toBe(false);
    expect(merged.desktopControlEnabled).toBe(true);
    expect(merged.backgroundEnabled).toBe(false);
  });

  it("非对象持久态返回当前态", () => {
    const merge = useKiroComputerStore.persist.getOptions().merge!;
    const current = useKiroComputerStore.getState();
    expect(merge(null, current)).toBe(current);
  });
});

describe("useInboxStore merge（跨窗截断归一）", () => {
  it("远端超长正文截断 2000；非法条目丢弃", () => {
    const merge = useInboxStore.persist.getOptions().merge!;
    const merged = merge(
      {
        items: [
          {
            id: "a",
            text: "x".repeat(5000),
            attachments: [1, 2, 3, 4, 5],
          },
          { id: 123 },
          null,
        ],
      },
      useInboxStore.getState()
    ) as { items: Array<{ id: string; text: string; attachments: unknown[] }> };
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].text).toHaveLength(2000);
    expect(merged.items[0].attachments).toHaveLength(3);
  });

  it("非对象持久态返回当前态", () => {
    const merge = useInboxStore.persist.getOptions().merge!;
    const current = useInboxStore.getState();
    expect(merge(undefined, current)).toBe(current);
  });
});
