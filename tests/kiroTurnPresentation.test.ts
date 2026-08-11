import { describe, it, expect } from "vitest";
import { deriveKiroAssistantTurn, KiroAssistantTurnPresentation } from "@/lib/ai/presentation/turnPresentation";
import {
  formatKiroToolActivityDetail,
  hasMeaningfulKiroToolDetails,
} from "@/lib/ai/presentation/toolActivityDetails";

/** v7 客户端 UIMessage part 形状（与 useKiroChat 收到的真实 parts 一致） */
const text = (t: string, state?: string) => ({ type: "text", text: t, ...(state ? { state } : {}) });
const reasoning = (t: string) => ({ type: "reasoning", text: t, state: "done" });
const stepStart = () => ({ type: "step-start" });
const toolPart = (
  name: string,
  state: string,
  patch: Record<string, unknown> = {}
) => ({ type: `tool-${name}`, toolCallId: `call_${name}`, state, ...patch });

describe("deriveKiroAssistantTurn", () => {
  it("1. commentary → tool → commentary → tool → final answer 顺序正确", () => {
    const p = deriveKiroAssistantTurn(
      [
        stepStart(),
        text("我先看看你的作业"),
        toolPart("search_assignments", "output-available", {
          output: { ok: true, data: { items: [{ id: "a1" }] } },
        }),
        stepStart(),
        text("再查一下本周课表"),
        toolPart("get_week_schedule", "output-available", {
          output: { ok: true, data: { items: [{ id: "s1" }] } },
        }),
        stepStart(),
        text("今天建议先完成数学作业", "done"),
      ],
      true
    );

    expect(p.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool"]);
    expect(p.worklog[0]).toMatchObject({ kind: "commentary", text: "我先看看你的作业", stepIndex: 1 });
    expect(p.worklog[1]).toMatchObject({
      kind: "tool",
      toolName: "search_assignments",
      toolKind: "read",
      status: "done",
      label: "查找任务",
      stepIndex: 1,
    });
    expect(p.worklog[2]).toMatchObject({ kind: "commentary", text: "再查一下本周课表", stepIndex: 2 });
    expect(p.worklog[3]).toMatchObject({
      kind: "tool",
      toolName: "get_week_schedule",
      toolKind: "read",
      status: "done",
      stepIndex: 2,
    });
    // 最终回答只有最后一个 Tool 之后的 trailing text
    expect(p.answer).toBe("今天建议先完成数学作业");
    expect(p.answerStreaming).toBe(true);
    expect(p.phase).toBe("answering");
    expect(p.hasTools).toBe(true);
    expect(p.worklogDone).toBe(true);
  });

  it("2. 无 Tool 普通回答：全部 text 合并为 answer，无 worklog", () => {
    const p = deriveKiroAssistantTurn([text("你好"), text("！")], true);
    expect(p.answer).toBe("你好！");
    expect(p.worklog).toEqual([]);
    expect(p.hasTools).toBe(false);
    expect(p.phase).toBe("answering");
    expect(p.worklogDone).toBe(false);
  });

  it("3. final candidate 后出现新 Tool → candidate 降级 commentary，answer 为空", () => {
    const p = deriveKiroAssistantTurn(
      [
        stepStart(),
        text("我先看看"),
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        stepStart(),
        text("今天建议……"),
        toolPart("get_assignment", "output-available", {
          output: { ok: true, data: { title: "数学作业" } },
        }),
      ],
      true
    );
    expect(p.answer).toBe("");
    expect(p.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool"]);
    expect(p.worklog[2]).toMatchObject({ kind: "commentary", text: "今天建议……" });
    expect(p.phase).toBe("composing"); // 工具全部完成但尚无最终文本
  });

  it("4. Tool 全完成但 final text 未出现且 chat 仍 streaming → composing", () => {
    const p = deriveKiroAssistantTurn(
      [
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        toolPart("update_assignment", "output-available", {
          output: { ok: true, data: {}, action: { tool: "update_assignment", entityType: "assignment", operation: "update", title: "数学作业" } },
        }),
      ],
      true
    );
    expect(p.phase).toBe("composing");
    expect(p.answer).toBe("");
    expect(p.worklogDone).toBe(false);
    expect(p.worklog[1]).toMatchObject({ toolName: "update_assignment", toolKind: "write", status: "done" });
  });

  it("5. chat ready（turnInFlight=false）→ done；answerStreaming=false", () => {
    const p = deriveKiroAssistantTurn(
      [
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        text("最终答案"),
      ],
      false
    );
    expect(p.phase).toBe("done");
    expect(p.answer).toBe("最终答案");
    expect(p.answerStreaming).toBe(false);
    expect(p.worklogDone).toBe(true);
  });

  it("6. reasoning 不出现在任何用户可见结构", () => {
    const p = deriveKiroAssistantTurn(
      [
        reasoning("内部思考：先查作业"),
        text("我先看看"),
        reasoning("再想想……"),
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        reasoning("现在写回答"),
        text("完成"),
      ],
      true
    );
    const serialized = JSON.stringify({ worklog: p.worklog, answer: p.answer });
    expect(serialized).not.toContain("内部思考");
    expect(serialized).not.toContain("再想想");
    expect(p.worklog.filter((b) => b.kind === "commentary").map((b) => (b as { text: string }).text)).toEqual([
      "我先看看",
    ]);
  });

  it("7. 安全 Tool details：只输出白名单事实，不泄漏 raw id / JSON", () => {
    expect(
      formatKiroToolActivityDetail("search_assignments", "done", { ok: true, data: { items: [{ id: "a1" }, { id: "a2" }] } })
    ).toEqual(["找到 2 个任务"]);
    expect(
      formatKiroToolActivityDetail("get_upcoming_assignments", "done", {
        ok: true,
        data: { assignments: [{ id: "x" }] },
      })
    ).toEqual(["找到 1 个任务"]);
    expect(
      formatKiroToolActivityDetail("get_week_schedule", "done", { ok: true, data: { items: [{ id: "s1" }, { id: "s2" }] } })
    ).toEqual(["读取 2 条课表安排"]);
    expect(
      formatKiroToolActivityDetail("get_assignment", "done", { ok: true, data: { title: "数学作业" } })
    ).toEqual(["已读取「数学作业」"]);
    expect(
      formatKiroToolActivityDetail("apply_change_set", "done", { ok: true, data: { count: 3 }, action: { changeSet: { count: 3 } } })
    ).toEqual(["完成 3 项修改"]);
    expect(
      formatKiroToolActivityDetail("update_assignment", "done", {
        ok: true,
        data: {},
        action: { tool: "update_assignment", entityType: "assignment", operation: "update", title: "数学作业" },
      })
    ).toEqual(["已处理「数学作业」"]);
    // 未知结构只显示默认状态；error / working 恒默认
    expect(formatKiroToolActivityDetail("search_assignments", "done", { ok: true, data: { weird: "x" } })).toEqual(["已完成"]);
    expect(formatKiroToolActivityDetail("search_assignments", "done", { ok: false, code: "X", message: "err" })).toEqual(["已完成"]);
    expect(formatKiroToolActivityDetail("search_assignments", "working", {})).toEqual(["正在处理…"]);
    expect(formatKiroToolActivityDetail("search_assignments", "error", { errorText: "boom sk-secret" })).toEqual(["执行未完成"]);
  });

  it("8. unknown tool 使用安全 fallback（label + 默认 details，toolKind=read）", () => {
    const p = deriveKiroAssistantTurn(
      [toolPart("some_unknown_tool", "input-available", { input: { raw: "x" } })],
      true
    );
    expect(p.worklog).toHaveLength(1);
    const b = p.worklog[0] as Extract<typeof p.worklog[0], { kind: "tool" }>;
    expect(b.toolName).toBe("some_unknown_tool");
    expect(b.label).toBe("执行操作");
    expect(b.status).toBe("working");
    expect(b.toolKind).toBe("read");
    expect(b.safeDetails).toEqual(["正在处理…"]);
    expect(JSON.stringify(b.safeDetails)).not.toContain("raw");
  });

  it("tool 状态映射：output-error → error；input-available/streaming → working", () => {
    const p = deriveKiroAssistantTurn(
      [
        toolPart("get_assignment", "output-error", { errorText: "boom" }),
        toolPart("search_assignments", "input-available", { input: {} }),
        toolPart("search_assignments", "streaming", { input: {} }),
      ],
      true
    );
    expect(p.worklog.map((b) => (b as { status: string }).status)).toEqual(["error", "working", "working"]);
    expect(p.phase).toBe("working"); // 仍有未完成 tool
    expect(p.answer).toBe("");
  });

  it("Task 2：completed tool + working tool 并存 → [done, working]，且不存在虚构 pending step", () => {
    const p = deriveKiroAssistantTurn(
      [
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        toolPart("get_week_schedule", "streaming", { input: {} }),
      ],
      true
    );
    const statuses = p.worklog.map((b) => (b as { status: string }).status);
    expect(statuses).toEqual(["done", "working"]);
    // 只有真实出现的 tool 进入 worklog：不得虚构 pending 步骤
    expect(p.worklog).toHaveLength(2);
    expect(p.hasTools).toBe(true);
    expect(p.phase).toBe("working");
  });
});

describe("hasMeaningfulKiroToolDetails", () => {
  it("generic fallback details are not expandable", () => {
    expect(hasMeaningfulKiroToolDetails([])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["正在处理…"])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["已完成"])).toBe(false);
    expect(hasMeaningfulKiroToolDetails(["执行未完成"])).toBe(false);
  });

  it("deterministic factual details are expandable", () => {
    expect(hasMeaningfulKiroToolDetails(["找到 3 个任务"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["读取 5 条课表安排"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["已读取「TCP 三次握手抓包分析」"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["完成 4 项修改"])).toBe(true);
    expect(hasMeaningfulKiroToolDetails(["已处理「高等数学作业」"])).toBe(true);
  });
});

describe("Provisional Commentary Lookahead", () => {
  const settledSearch = () =>
    toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } });

  it("CASE 1: settled Tool + 第一段仍在 streaming → provisional（answer 空、不入 commentary、composing）", () => {
    const p = deriveKiroAssistantTurn(
      [settledSearch(), text("我先整理一下今天的安排。", "streaming")],
      true
    );
    expect(p.answer).toBe("");
    expect(p.phase).toBe("composing");
    expect(p.worklog.filter((b) => b.kind === "commentary")).toHaveLength(0);
  });

  it("CASE 2: 第一段已形成稳定块但第二段未开始（只有空行）→ 仍 provisional", () => {
    const p = deriveKiroAssistantTurn(
      [settledSearch(), text("第一段已经完整。\n\n", "streaming")],
      true
    );
    expect(p.answer).toBe("");
    expect(p.phase).toBe("composing");
    expect(p.worklog.filter((b) => b.kind === "commentary")).toHaveLength(0);
  });

  it("CASE 3: 第二段已开始 → lookahead 成立，整体 commit Final Answer", () => {
    const trailing = "第一段已经完整。\n\n第二段正在生成";
    const p = deriveKiroAssistantTurn([settledSearch(), text(trailing, "streaming")], true);
    expect(p.answer).toBe(trailing);
    expect(p.phase).toBe("answering");
    expect(p.answerStreaming).toBe(true);
  });

  it("CASE 4: Tool 后单段且 state=done → 立即 commit（不卡在正在整理结果）", () => {
    const p = deriveKiroAssistantTurn([settledSearch(), text("最终只有这一段。", "done")], true);
    expect(p.answer).toBe("最终只有这一段。");
    expect(p.phase).toBe("answering");
  });

  it("CASE 5: provisional text 后出现新 Tool → 整段只作为 commentary 出现一次", () => {
    const p = deriveKiroAssistantTurn(
      [
        settledSearch(),
        text("让我再确认一下今天可用的时间。", "streaming"),
        toolPart("get_available_time", "streaming", { input: {} }),
      ],
      true
    );
    expect(p.answer).toBe("");
    const commentary = p.worklog.filter((b) => b.kind === "commentary").map((b) => (b as { text: string }).text);
    expect(commentary).toEqual(["让我再确认一下今天可用的时间。"]);
  });

  it("CASE 6: 无 Tool → 首 token 立即流式显示", () => {
    const p = deriveKiroAssistantTurn([text("你好，正在回答", "streaming")], true);
    expect(p.answer).toBe("你好，正在回答");
    expect(p.phase).toBe("answering");
  });

  it("CASE 7: Tool 后仍只有一段 provisional 但 turnInFlight=false → flush 成 Final Answer", () => {
    const p = deriveKiroAssistantTurn([settledSearch(), text("这是最终回答。", "streaming")], false);
    expect(p.answer).toBe("这是最终回答。");
    expect(p.phase).toBe("done");
  });
});

describe("KiroAssistantTurnPresentation 类型完整性", () => {
  it("返回结构字段齐备（worklog/answer/answerStreaming/hasTools/worklogDone/phase）", () => {
    const p: KiroAssistantTurnPresentation = deriveKiroAssistantTurn([], true);
    expect(typeof p.answer).toBe("string");
    expect(typeof p.answerStreaming).toBe("boolean");
    expect(typeof p.hasTools).toBe("boolean");
    expect(typeof p.worklogDone).toBe("boolean");
    expect(["working", "composing", "answering", "done"]).toContain(p.phase);
  });
});

describe("Task 17B：Tool Row headline（流式 web 流程）", () => {
  const searchPart = () =>
    toolPart("web_search", "output-available", {
      input: { query: "新学期 选课" },
      output: {
        ok: true,
        data: {
          results: [{ sourceId: "web-1", title: "新学期选课通知", domain: "example.com" }],
        },
      },
    });

  it("HEADLINE 1: web_search headline 展示 sanitized query + 来源数", () => {
    const p = deriveKiroAssistantTurn([searchPart()], true);
    const block = p.worklog.find((b) => b.kind === "tool" && b.toolName === "web_search");
    expect(block?.kind === "tool" && block.headline).toBe("已搜索网页：新学期 选课 · 1 个来源");
  });

  it("HEADLINE 2: read_web_source 用同 Turn 真实 search result 解析 title", () => {
    const readPart = toolPart("read_web_source", "working", {
      input: { sourceIds: ["web-1"] },
    });
    const p = deriveKiroAssistantTurn([searchPart(), readPart], true);
    const block = p.worklog.find((b) => b.kind === "tool" && b.toolName === "read_web_source");
    expect(block?.kind === "tool" && block.headline).toBe("正在阅读网页：新学期选课通知");
  });

  it("HEADLINE 3: lookup 之外的 sourceId → 通用文案（不暴露内部 ID）", () => {
    const readPart = toolPart("read_web_source", "working", {
      input: { sourceIds: ["internal-secret-id"] },
    });
    const p = deriveKiroAssistantTurn([searchPart(), readPart], true);
    const block = p.worklog.find((b) => b.kind === "tool" && b.toolName === "read_web_source");
    expect(block?.kind === "tool" && block.headline).toBe("正在阅读网页…");
  });

  it("HEADLINE 4: 非 web Tool → headline 为 null（UI 回退 block.label）", () => {
    const p = deriveKiroAssistantTurn(
      [toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } })],
      true
    );
    const block = p.worklog.find((b) => b.kind === "tool" && b.toolName === "search_assignments");
    expect(block?.kind === "tool" && block.headline).toBeNull();
    expect(block?.kind === "tool" && block.label).toBeTruthy();
  });
});
