import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Gmail ingest failure → cursor 不得推进（稳定性审计 BUG-021 回归）。
 *
 * 历史 bug：initial/incremental 同步的 per-message `catch {}` 吞掉 detail 拉取 /
 * ingest 失败，随后无条件提交 historyId —— 失败消息被 cursor 永久越过，
 * 邮件静默丢失（无日志、无计数、无重试）。
 *
 * 修复契约（对齐 qq-mail 的 hadFailure 模式）：
 * - 任一消息失败 → 本轮不建立/不推进 cursor（下轮 history 重放该消息）
 * - seenIds 回滚：失败消息不进入去重集合
 */

const { getMessageDetailMock, getHistoryMock, getProfileHistoryIdMock, setGmailStateMock } = vi.hoisted(() => ({
  getMessageDetailMock: vi.fn(),
  getHistoryMock: vi.fn(),
  getProfileHistoryIdMock: vi.fn(),
  setGmailStateMock: vi.fn(),
}));

vi.mock("@/src/main/channels/email/gmail/api", () => ({
  getMessageDetail: getMessageDetailMock,
  getHistory: getHistoryMock,
  getProfileHistoryId: getProfileHistoryIdMock,
}));

vi.mock("@/src/main/channels/email/outbound/replyContextStore", () => ({
  getReplyContextStore: () => ({
    create: async () => ({ replyContextId: "rc-test" }),
  }),
}));

import { GmailChannelAdapter } from "@/src/main/channels/email/gmail/adapter";

const CONFIG = {
  id: "gm1",
  channel: "gmail",
  enabled: true,
  displayName: "Test",
  emailAddress: "t@gmail.com",
  credentialRef: "cred_x",
  syncIntervalSeconds: 60,
} as unknown as ConstructorParameters<typeof GmailChannelAdapter>[0]["config"];

function makeDetail(id: string) {
  return {
    id,
    labelIds: ["INBOX"],
    headers: [
      { name: "From", value: "Alice <alice@example.com>" },
      { name: "Subject", value: `subj-${id}` },
      { name: "Date", value: "Mon, 24 Aug 2026 10:00:00 +0000" },
      { name: "Message-Id", value: `<${id}@gmail>` },
    ],
    payload: null,
  };
}

function makeAdapter(ingest: (m: { externalMessageId: string }) => Promise<void>, state?: { historyId: string }) {
  const syncStateStore = {
    getGmailState: () => state ?? null,
    setGmailState: setGmailStateMock,
  };
  return new GmailChannelAdapter({
    config: CONFIG,
    inboxSink: { ingest },
    tokenProvider: { getAccessToken: async () => "tok" } as never,
    syncStateStore: syncStateStore as never,
  });
}

const runIncremental = (a: GmailChannelAdapter) =>
  (a as unknown as { doIncrementalSync(): Promise<void> }).doIncrementalSync();

describe("gmail adapter — ingest failure must not advance cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProfileHistoryIdMock.mockResolvedValue("H-base");
  });

  it("incremental：ingest 抛错 → 该消息 seenIds 回滚且 historyId 不推进；下轮重放成功后推进", async () => {
    const ingested: string[] = [];
    let failFirst = true;
    getMessageDetailMock.mockImplementation(async (_tok: unknown, id: string) => {
      if (id === "bad" && failFirst) throw new Error("IMAP fetch timeout");
      return makeDetail(id);
    });
    getHistoryMock.mockResolvedValue({ historyId: "H2", messages: [{ id: "good" }, { id: "bad" }] });

    const adapter = makeAdapter(
      async (m) => {
        if (m.externalMessageId === "bad" && failFirst) throw new Error("sink boom");
        ingested.push(m.externalMessageId);
      },
      { historyId: "H1" }
    );

    await runIncremental(adapter);
    // good 已消费；bad 失败 → cursor 未推进
    // 该消息 seenIds 回滚：下轮 detail 仍会被再次拉取（重放）
    expect(setGmailStateMock).not.toHaveBeenCalledWith("gm1", expect.objectContaining({ historyId: "H2" }));

    // 下轮重放：不再失败
    failFirst = false;
    await runIncremental(adapter);
    expect(ingested).toContain("bad");
    // 全部成功 → cursor 推进到 H2
    expect(setGmailStateMock).toHaveBeenCalledWith("gm1", expect.objectContaining({ historyId: "H2" }));
  });

  it("incremental：detail 拉取失败同样不推进 cursor（seenIds 未污染）", async () => {
    const ingested: string[] = [];
    getMessageDetailMock.mockImplementation(async (_tok: unknown, id: string) => {
      if (id === "gone") throw new Error("404 not found");
      return makeDetail(id);
    });
    getHistoryMock.mockResolvedValue({ historyId: "H3", messages: [{ id: "gone" }] });

    const adapter = makeAdapter(async (m) => { ingested.push(m.externalMessageId); }, { historyId: "H1" });
    await runIncremental(adapter);
    expect(setGmailStateMock).not.toHaveBeenCalled();
    expect(ingested).toHaveLength(0);
  });

  it("全部成功 → 正常推进 cursor（原行为不回归）", async () => {
    const ingested: string[] = [];
    getMessageDetailMock.mockImplementation(async (_tok: unknown, id: string) => makeDetail(id));
    getHistoryMock.mockResolvedValue({ historyId: "H9", messages: [{ id: "ok1" }, { id: "ok2" }] });

    const adapter = makeAdapter(async (m) => { ingested.push(m.externalMessageId); }, { historyId: "H1" });
    await runIncremental(adapter);
    expect(ingested.sort()).toEqual(["ok1", "ok2"]);
    expect(setGmailStateMock).toHaveBeenCalledWith("gm1", expect.objectContaining({ historyId: "H9" }));
  });
});
