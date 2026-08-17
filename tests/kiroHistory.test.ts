import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeConversation, buildAutoTitle, filterValidContextRefs, formatHistoryTime } from "@/lib/ai/history/sanitize";
import {
  saveConversation,
  listConversations,
  getConversation,
  deleteConversationRecord,
  renameConversationRecord,
  clearConversationHistory,
} from "@/lib/ai/history/db";
import { messageHasWriteToolCalls, lastTurnCanRegenerate } from "@/hooks/useKiroChat";
import { KiroChatMessageView } from "@/hooks/useKiroChat";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { resetKiroDbForTests } from "@/lib/ai/history/db";

const KIRO_HISTORY_DB_NAME = "classflow-kiro";

function viewMessage(partial: Partial<KiroChatMessageView> & { role: "user" | "assistant"; content: string }): KiroChatMessageView {
  return { id: "m1", streaming: false, canRegenerate: true, ...partial };
}

function makeRecord(over: Partial<KiroConversationRecord> = {}): KiroConversationRecord {
  return {
    id: "conv-1",
    title: "帮我分析这周任务",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    messages: [
      { id: "u1", role: "user", content: "帮我分析这周任务" },
      { id: "a1", role: "assistant", content: "本周共 5 项任务。" },
    ],
    manualRefs: [],
    entryRefs: [],
    ...over,
  };
}

beforeEach(async () => {
  resetKiroDbForTests();
  await clearConversationHistory().catch(() => {});
});

describe("buildAutoTitle", () => {
  it("正常短消息直接作为标题", () => {
    expect(buildAutoTitle("帮我把这周的任务重新安排一下")).toBe("帮我把这周的任务重新安排一下");
  });
  it("压缩空白 / 移除换行", () => {
    expect(buildAutoTitle("  帮我分析\n\n这周 任务  ")).toBe("帮我分析 这周 任务");
  });
  it("超长截断到 30 字 + ……", () => {
    const long = "帮我根据计量经济学第三章资料整理一下需求函数和弹性分析的全部重点内容";
    const t = buildAutoTitle(long);
    expect(t.length).toBeLessThanOrEqual(33);
    expect(t.endsWith("……")).toBe(true);
  });
});

describe("sanitizeConversation", () => {
  it("不包含 API Key / Blob / File / storageKey；provider/model 记录", () => {
    const messages: KiroChatMessageView[] = [
      viewMessage({ id: "u1", role: "user", content: "看看这个文件" }),
      viewMessage({ id: "a1", role: "assistant", content: "好的。", canRegenerate: false }),
    ];
    const rec = sanitizeConversation({
      id: "c1",
      title: "标题",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages,
      manualRefs: [],
      entryRefs: [],
    });
    const raw = JSON.stringify(rec);
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("sk-");
    expect(raw).not.toContain("storageKey");
    expect(raw).not.toContain("blob");
    expect(rec.provider).toBe("deepseek");
    expect(rec.model).toBe("deepseek-v4-flash");
    expect(rec.messages.length).toBe(2);
  });

  it("临时附件 → tempNotRetained；课程资料 → 保留安全引用", () => {
    const rec = sanitizeConversation({
      id: "c1",
      title: "t",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "p",
      model: "m",
      messages: [
        viewMessage({
          id: "u1",
          role: "user",
          content: "分析附件",
          attachments: [
            { id: "att1", source: "local", kind: "pdf", name: "第三章.pdf", size: 2048, status: "ready", tempNotRetained: true },
            { id: "att2", source: "material", kind: "pdf", name: "讲义.pdf", status: "ready", courseId: "c9", materialId: "m9", courseName: "统计学" },
          ],
        }),
      ],
      manualRefs: [],
      entryRefs: [],
    });
    const atts = rec.messages[0].attachments!;
    expect(atts[0].tempNotRetained).toBe(true);
    expect(atts[0]).not.toHaveProperty("file");
    expect(atts[1].courseId).toBe("c9");
    expect(atts[1].materialId).toBe("m9");
  });

  it("超长内容截断（宽上限）", () => {
    const rec = sanitizeConversation({
      id: "c1",
      title: "t",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "p",
      model: "m",
      messages: [viewMessage({ id: "u1", role: "user", content: "x".repeat(150000) })],
      manualRefs: [],
      entryRefs: [],
    });
    expect(rec.messages[0].content.length).toBe(100000);
  });

  it("Kiro Projects V1：projectId 经 sanitize → save → load 全程保留（不因重写被抹掉）", async () => {
    const rec = sanitizeConversation({
      id: "c-proj",
      title: "项目对话",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "opencode-go",
      model: "kimi-k3",
      messages: [viewMessage({ id: "u1", role: "user", content: "你好" })],
      manualRefs: [],
      entryRefs: [],
      projectId: "proj_1",
    });
    expect(rec.projectId).toBe("proj_1");
    await saveConversation(rec);
    const loaded = await getConversation("c-proj");
    expect(loaded?.projectId).toBe("proj_1");
  });

  it("Kiro Projects V1：projectId 为空时不写入字段（旧记录/未归类兼容）", async () => {
    const rec = sanitizeConversation({
      id: "c-plain",
      title: "未归类",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "p",
      model: "m",
      messages: [viewMessage({ id: "u1", role: "user", content: "hi" })],
      manualRefs: [],
      entryRefs: [],
    });
    expect("projectId" in rec).toBe(false);
  });

  it("Kiro Projects V1：旧 record 无 projectId → save/load 不崩溃且保持无字段", async () => {
    const rec = makeRecord({ id: "c-legacy" });
    expect("projectId" in rec).toBe(false);
    await saveConversation(rec);
    const loaded = await getConversation("c-legacy");
    expect(loaded?.id).toBe("c-legacy");
    expect(loaded?.projectId).toBeUndefined();
  });

  it("live action → 最小事实数据（heading/title/change，无工具参数）", () => {
    const rec = sanitizeConversation({
      id: "c1",
      title: "t",
      createdAt: "2026-08-01T00:00:00.000Z",
      provider: "p",
      model: "m",
      messages: [
        viewMessage({
          id: "a1",
          role: "assistant",
          content: "已调整。",
          actions: [
            {
              toolCallId: "call_1",
              action: {
                tool: "set_assignment_ddl",
                operation: "update",
                canUndo: true,
                title: "统计学作业",
                before: { ddl: "2026-08-10T23:59:00" },
                after: { ddl: "2026-08-11T22:00:00" },
              } as never,
            },
          ],
        }),
      ],
      manualRefs: [],
      entryRefs: [],
    });
    const a = rec.messages[0].actions![0];
    expect(a.heading).toBe("已调整任务");
    expect(a.title).toBe("统计学作业");
    expect(a.change).toBeTruthy();
    expect(JSON.stringify(a)).not.toContain('"tool"');
    expect(JSON.stringify(a)).not.toContain('"before"');
    expect(JSON.stringify(a)).not.toContain('"after"');
  });
});

describe("IndexedDB CRUD", () => {
  it("save / list（updatedAt DESC）/ get / rename / delete / clear", async () => {
    await saveConversation(makeRecord({ id: "c1", title: "旧对话", updatedAt: "2026-08-01T00:00:00.000Z" }));
    await saveConversation(makeRecord({ id: "c2", title: "新对话", updatedAt: "2026-08-09T00:00:00.000Z" }));

    const list = await listConversations();
    expect(list.map((r) => r.id)).toEqual(["c2", "c1"]); // DESC

    const got = await getConversation("c1");
    expect(got?.title).toBe("旧对话");
    expect(await getConversation("nope")).toBeNull();

    await renameConversationRecord("c1", "本周学习规划");
    expect((await getConversation("c1"))?.title).toBe("本周学习规划");

    await deleteConversationRecord("c2");
    expect((await listConversations()).map((r) => r.id)).toEqual(["c1"]);

    await clearConversationHistory();
    expect(await listConversations()).toEqual([]);
  });

  it("损坏记录被跳过（不崩溃）", async () => {
    await saveConversation(makeRecord({ id: "c1" }));
    // 直接写入一条损坏数据（DB 现为 v4：用缓存连接而非固定旧版本号）
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(KIRO_HISTORY_DB_NAME, 4);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve) => {
      const t = db.transaction("conversations", "readwrite");
      t.objectStore("conversations").put({ id: "bad" });
      t.oncomplete = () => resolve();
    });
    db.close();
    const list = await listConversations();
    expect(list.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("stale context removal", () => {
  it("已删除实体的 ref 被丢弃；week 保留", () => {
    const refs = [
      { kind: "course" as const, entityId: "c1", label: "统计学" },
      { kind: "course" as const, entityId: "gone", label: "已删除课程" },
      { kind: "assignment" as const, entityId: "gone", label: "已删除任务" },
      { kind: "week" as const, entityId: "current", label: "本周" },
    ];
    const valid = filterValidContextRefs(refs, {
      courses: [{ id: "c1", materials: [] } as never],
      assignments: [],
      groupProjects: [],
    });
    expect(valid.map((r) => r.label)).toEqual(["统计学", "本周"]);
  });
});

describe("regenerate safety", () => {
  const part = (type: string, name?: string) => ({ type, toolName: name });

  it("Write Tool 轮次：messageHasWriteToolCalls=true，不能重新生成", () => {
    expect(messageHasWriteToolCalls({ parts: [part("tool-create_assignment")] as never[] })).toBe(true);
    expect(messageHasWriteToolCalls({ parts: [part("tool-get_upcoming_assignments")] as never[] })).toBe(false);
  });

  it("read-only 轮次可重新生成；restored 轮次不可", () => {
    const readTurn = [{ role: "user", parts: [part("text")] }, { role: "assistant", parts: [part("tool-get_upcoming_assignments")] }] as never[];
    expect(lastTurnCanRegenerate(readTurn)).toBe(true);
    const writeTurn = [{ role: "assistant", parts: [part("tool-create_assignment")] }] as never[];
    expect(lastTurnCanRegenerate(writeTurn)).toBe(false);
    const restoredTurn = [{ role: "assistant", parts: [part("tool-get_upcoming_assignments")], metadata: { restored: "1" } }] as never[];
    expect(lastTurnCanRegenerate(restoredTurn)).toBe(false);
  });
});

describe("formatHistoryTime", () => {
  it("今天 / 昨天 / 更早", () => {
    const now = new Date("2026-08-09T15:00:00");
    expect(formatHistoryTime("2026-08-09T12:42:00", now)).toMatch(/^今天 \d{2}:\d{2}$/);
    expect(formatHistoryTime("2026-08-08T12:00:00", now)).toBe("昨天");
    expect(formatHistoryTime("2026-08-01T12:00:00", now)).toBe("8 月 1 日");
  });
});
