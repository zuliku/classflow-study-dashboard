import { describe, it, expect } from "vitest";
import {
  DURABLE_INVERSE_MAX_TEXT_CHARS,
  ComputerInverseOperation,
  ComputerTaskCheckpoint,
  DurableComputerInverse,
  deserializeCheckpoint,
  deserializeCheckpoints,
  isDurableInverse,
  serializeCheckpoint,
  serializeCheckpoints,
} from "@/lib/ai/computer/checkpoints";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";

const removeCreated = (over = {}): ComputerInverseOperation => ({
  type: "remove-created",
  workspaceId: "ws",
  rootId: "output",
  relativePath: "a.txt",
  resourceType: "file",
  ...over,
});

const restoreText = (beforeText: string): ComputerInverseOperation => ({
  type: "restore-text",
  workspaceId: "ws",
  rootId: "output",
  relativePath: "a.txt",
  beforeText,
});

const moveBack = (): ComputerInverseOperation => ({
  type: "move-back",
  workspaceId: "ws",
  fromRootId: "output",
  fromPath: "a.txt",
  toRootId: "output",
  toPath: "b.txt",
});

const genericRevision = (beforeText: string): ComputerInverseOperation => ({
  type: "restore-generic-artifact-revision",
  workspaceId: "ws",
  rootId: "output",
  relativePath: "a.md",
  artifactId: "art-1",
  previousRevision: 2,
  expectedCurrentRevision: 3,
  beforeText,
});

const docRevision = (over = {}): ComputerInverseOperation => ({
  type: "restore-document-revision",
  workspaceId: "ws",
  rootId: "output",
  relativePath: "doc.md",
  artifactId: "doc-1",
  previousRevision: 1,
  expectedCurrentRevision: 2,
  previousDocument: { blocks: [] },
  snapshot: { format: "markdown", text: "hello" },
  ...over,
});

const cp = (taskId: string, inverses: ComputerInverseOperation[], used = false): ComputerTaskCheckpoint => ({
  taskId,
  inverses,
  used,
});

describe("isDurableInverse", () => {
  it("remove-created / move-back 纯数据 → durable", () => {
    expect(isDurableInverse(removeCreated())).toBe(true);
    expect(isDurableInverse(moveBack())).toBe(true);
  });
  it("restore-text 上限内 → durable，超限 → 非 durable", () => {
    expect(isDurableInverse(restoreText("abc"))).toBe(true);
    expect(isDurableInverse(restoreText("x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1)))).toBe(false);
  });
  it("generic revision 上限内 → durable，超限 → 非 durable", () => {
    expect(isDurableInverse(genericRevision("abc"))).toBe(true);
    expect(isDurableInverse(genericRevision("x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1)))).toBe(false);
  });
  it("document revision 仅 markdown 小快照 + JSON 安全 → durable", () => {
    expect(isDurableInverse(docRevision())).toBe(true);
    expect(isDurableInverse(docRevision({ snapshot: { format: "docx", bytes: new Uint8Array([1]) } }))).toBe(false);
    expect(
      isDurableInverse(docRevision({ snapshot: { format: "markdown", text: "x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1) } }))
    ).toBe(false);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      isDurableInverse(docRevision({ previousDocument: circular }))
    ).toBe(false);
  });
  it("未知类型 → 非 durable", () => {
    expect(isDurableInverse({ type: "no-op" } as unknown as ComputerInverseOperation)).toBe(false);
  });
});

describe("serializeCheckpoint（all-or-nothing）", () => {
  it("全 durable → 保留 taskId/used/inverses", () => {
    const out = serializeCheckpoint(cp("t1", [removeCreated(), restoreText("a")], true));
    expect(out).not.toBeNull();
    expect(out?.taskId).toBe("t1");
    expect(out?.used).toBe(true);
    expect(out?.inverses).toHaveLength(2);
  });
  it("混入一条非 durable → 整个 checkpoint 丢弃（null）", () => {
    expect(
      serializeCheckpoint(cp("t1", [removeCreated(), restoreText("x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1))]))
    ).toBeNull();
  });
  it("空 inverses → 可持久（空数组）", () => {
    const out = serializeCheckpoint(cp("t1", []));
    expect(out).not.toBeNull();
    expect(out?.inverses).toEqual([]);
  });
});

describe("deserializeCheckpoint（严格校验）", () => {
  it("合法持久形态 → 还原 runtime checkpoint", () => {
    const persisted = serializeCheckpoint(cp("t1", [moveBack(), restoreText("a")], true));
    const back = deserializeCheckpoint(JSON.parse(JSON.stringify(persisted)));
    expect(back?.taskId).toBe("t1");
    expect(back?.used).toBe(true);
    expect(back?.inverses).toHaveLength(2);
  });
  it("非法输入一律 null（绝不构造半吊子）", () => {
    expect(deserializeCheckpoint(null)).toBeNull();
    expect(deserializeCheckpoint("x")).toBeNull();
    expect(deserializeCheckpoint({})).toBeNull();
    expect(deserializeCheckpoint({ taskId: "", used: false, inverses: [] })).toBeNull();
    expect(deserializeCheckpoint({ taskId: "t", used: "no", inverses: [] })).toBeNull();
    expect(deserializeCheckpoint({ taskId: "t", used: false, inverses: {} })).toBeNull();
    expect(deserializeCheckpoint({ taskId: "t", used: false, inverses: [null] })).toBeNull();
    expect(deserializeCheckpoint({ taskId: "t", used: false, inverses: [{ type: "no-op" }] })).toBeNull();
    // 内容超限（被篡改或旧上限写入）→ 拒绝
    expect(
      deserializeCheckpoint({
        taskId: "t",
        used: false,
        inverses: [{ type: "restore-text", workspaceId: "ws", rootId: "o", relativePath: "a", beforeText: "x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1) }],
      })
    ).toBeNull();
  });
});

describe("serializeCheckpoints / deserializeCheckpoints（批量）", () => {
  it("序列化 drop 不可落盘项、保持顺序；反序列化丢弃非法项", () => {
    const out = serializeCheckpoints([
      cp("t1", [removeCreated()]),
      cp("t2", [restoreText("x".repeat(DURABLE_INVERSE_MAX_TEXT_CHARS + 1))]),
      cp("t3", [moveBack()], true),
    ]);
    expect(out.map((p) => p.taskId)).toEqual(["t1", "t3"]);
    const back = deserializeCheckpoints([...out, { taskId: "bad", used: false, inverses: [{ type: "no-op" }] }]);
    expect(back.map((c) => c.taskId)).toEqual(["t1", "t3"]);
    expect(back[1].used).toBe(true);
  });
  it("非数组输入 → 空数组", () => {
    expect(deserializeCheckpoints(undefined)).toEqual([]);
    expect(deserializeCheckpoints(null)).toEqual([]);
  });
});

describe("sanitizeConversation — checkpoints 字段", () => {
  const base = {
    id: "c1",
    title: "t",
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "p",
    model: "m",
    messages: [{ id: "u1", role: "user" as const, content: "hi", streaming: false, canRegenerate: true }],
    manualRefs: [],
    entryRefs: [],
  };
  it("非空 checkpoints → 写入记录", () => {
    const rec = sanitizeConversation({
      ...base,
      checkpoints: [{ taskId: "t1", used: false, inverses: [removeCreated() as DurableComputerInverse] }],
    });
    expect(rec.checkpoints).toHaveLength(1);
    expect(rec.checkpoints?.[0].taskId).toBe("t1");
  });
  it("缺省/空数组 → 不写字段（旧记录兼容）", () => {
    expect(sanitizeConversation(base)).not.toHaveProperty("checkpoints");
    expect(sanitizeConversation({ ...base, checkpoints: [] })).not.toHaveProperty("checkpoints");
  });
});
