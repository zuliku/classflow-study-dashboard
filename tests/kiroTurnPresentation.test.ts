import { describe, it, expect } from "vitest";
import {
  deriveKiroAssistantTurn,
  KiroAssistantTurnPresentation,
  updateLiveTurnPresentation,
  createLiveTurnCommitState,
  LiveTurnCommitState,
} from "@/lib/ai/presentation/turnPresentation";
import {
  formatKiroToolActivityDetail,
  hasMeaningfulKiroToolDetails,
} from "@/lib/ai/presentation/toolActivityDetails";
import { KIRO_FINAL_ANSWER_TOOL_NAME } from "@/lib/ai/tools/finalAnswer";

/** v7 客户端 UIMessage part 形状（与 useKiroChat 收到的真实 parts 一致） */
const text = (t: string, state?: string) => ({ type: "text", text: t, ...(state ? { state } : {}) });
const reasoning = (t: string) => ({ type: "reasoning", text: t, state: "done" });
const stepStart = () => ({ type: "step-start" });
const toolPart = (
  name: string,
  state: string,
  patch: Record<string, unknown> = {}
) => ({ type: `tool-${name}`, toolCallId: `call_${name}`, state, ...patch });

/** Final Answer Boundary 控制信号（与 useKiroChat 收到的真实 part 形状一致） */
const boundary = (state = "output-available") =>
  toolPart(KIRO_FINAL_ANSWER_TOOL_NAME, state, { input: {}, output: { ok: true, data: {} } });

/** stateful live 推导 helper（单调 commit 持久化） */
function makeLive() {
  const commit = createLiveTurnCommitState();
  const step = (parts: unknown[], turnInFlight = true) =>
    updateLiveTurnPresentation(commit, parts, turnInFlight);
  return { commit, step };
}

function commentaryTexts(p: KiroAssistantTurnPresentation): string[] {
  return p.worklog.filter((b) => b.kind === "commentary").map((b) => (b as { text: string }).text);
}

describe("Final Answer Boundary（显式协议通道）", () => {
  it("B1. commentary → tool → commentary → tool → boundary → Answer：顺序稳定", () => {
    const p = deriveKiroAssistantTurn(
      [
        stepStart(),
        text("我先看看你的作业"),
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        stepStart(),
        text("再查一下本周课表"),
        toolPart("get_week_schedule", "output-available", { output: { ok: true, data: { items: [] } } }),
        stepStart(),
        boundary(),
        stepStart(),
        text("今天建议先完成数学作业", "streaming"),
      ],
      true
    );
    expect(p.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool", "milestone"]);
    expect(commentaryTexts(p)).toEqual(["我先看看你的作业", "再查一下本周课表"]);
    // milestone：UI-only，不携带模型文字
    const milestone = p.worklog.find((b) => b.kind === "milestone");
    expect(milestone?.kind).toBe("milestone");
    // boundary 后的 text 是 Final Answer；控制信号本身不进 worklog（只派生 milestone）
    expect(p.answer).toBe("今天建议先完成数学作业");
    expect(p.answerStreaming).toBe(true);
    expect(p.phase).toBe("answering");
    expect(p.hasTools).toBe(true);
  });

  it("B2. boundary 之前的 text 永久属于 Worklog（boundary 前有普通 text 也不进 Answer）", () => {
    const p = deriveKiroAssistantTurn(
      [
        text("好的，我先确认一下", "done"),
        boundary(),
        text("这是正式回答。", "done"),
      ],
      false
    );
    expect(p.answer).toBe("这是正式回答。");
    expect(commentaryTexts(p)).toEqual(["好的，我先确认一下"]);
    expect(p.phase).toBe("done");
  });

  it("B3. 无工具普通聊天：boundary → 流式 Answer（不依赖任何时间窗口）", () => {
    const p = deriveKiroAssistantTurn(
      [boundary(), text("机会成本是……", "streaming")],
      true
    );
    expect(p.answer).toBe("机会成本是……");
    expect(p.answerStreaming).toBe(true);
    expect(p.phase).toBe("answering");
    // V4：boundary 派生 UI-only milestone（不算 toolCount / 不进 answer）
    expect(p.worklog.map((b) => b.kind)).toEqual(["milestone"]);
    expect(p.hasTools).toBe(false);
  });

  it("B4. boundary 后再次出现业务 Tool（协议违规）：Answer lane 不被破坏，违规 Tool 进入 worklog", () => {
    const p = deriveKiroAssistantTurn(
      [
        boundary(),
        text("正式回答内容", "done"),
        toolPart("search_assignments", "output-error", { errorText: "协议违规" }),
        text("补充说明", "done"),
      ],
      false
    );
    // boundary 后的所有 text 恒为 Answer；违规 Tool 只作为 worklog 行（透明展示）
    expect(p.answer).toBe("正式回答内容补充说明");
    expect(p.worklog.map((b) => b.kind)).toEqual(["milestone", "tool"]);
    expect(p.phase).toBe("done");
  });

  it("B5. reasoning 永远不可见（含 boundary 前后）", () => {
    const p = deriveKiroAssistantTurn(
      [
        reasoning("内部思考"),
        text("我先看看"),
        toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
        reasoning("再想想"),
        boundary(),
        reasoning("写回答"),
        text("完成"),
      ],
      true
    );
    const serialized = JSON.stringify({ worklog: p.worklog, answer: p.answer });
    expect(serialized).not.toContain("内部思考");
    expect(serialized).not.toContain("再想想");
    expect(serialized).not.toContain("写回答");
  });
});

describe("V4 Progressive Worklog（pre-boundary commentary 立即展示）", () => {
  it("A1. 无 Tool 且无 boundary：live 立即作为 commentary 展示；settled 后全部恢复为 Answer", () => {
    const { step } = makeLive();
    const parts = [text("你好"), text("！", "streaming")];
    // V4 live：execution channel——立即展示为 Worklog commentary（不再隐藏等待 Tool）
    const live = step(parts);
    expect(live.answer).toBe("");
    expect(commentaryTexts(live)).toEqual(["你好", "！"]);
    expect(live.phase).toBe("working");
    // settled：legacy direct-answer fallback——整段 text 恢复为普通 Answer
    const settled = step(parts, false);
    expect(settled.answer).toBe("你好！");
    expect(settled.phase).toBe("done");
    expect(settled.answerStreaming).toBe(false);
  });

  it("A2. slow leading text（任意时长）live 阶段立即显示；Tool 到达后只作为 commentary，永不进入 Answer", () => {
    const { step } = makeLive();
    // T0：leading text 到达（无 Tool、无 boundary）→ V4：立即 commentary
    const p0 = step([text("我先检查一下工作区文件", "streaming")]);
    expect(p0.answer).toBe("");
    expect(commentaryTexts(p0)).toEqual(["我先检查一下工作区文件"]);
    // T1（无论等待多久）：Tool 到达 → leading 仍为 commentary（同一 part identity）
    const p1 = step([
      text("我先检查一下工作区文件", "done"),
      toolPart("read_text", "output-available", { output: { ok: true, data: { text: "..." } } }),
    ]);
    expect(p1.answer).toBe("");
    expect(commentaryTexts(p1)).toEqual(["我先检查一下工作区文件"]);
    // 全程没有任何 Answer → Commentary 迁移：文字从未进入 answer 通道
    expect(p0.answer).toBe("");
  });

  it("S1-S6 staged：progress → tool → done → progress → tool → done（commentary 独立 block，同一 part delta 更新）", () => {
    const { step } = makeLive();
    const progress1 = (state = "streaming") => text("我先检查相关文件", state);
    const progress2 = (state = "streaming") => text("接下来读取最相关的文件", state);
    const tool1 = (state = "input-available", patch: Record<string, unknown> = {}) =>
      toolPart("inspect_workspace", state, { input: { path: "." }, ...patch });
    const tool2 = (state = "input-available", patch: Record<string, unknown> = {}) =>
      toolPart("read_text", state, { input: { path: "notes.md" }, ...patch });

    // S1：仅 progress1 → worklog = [progress1]
    const s1 = step([stepStart(), progress1()]);
    expect(commentaryTexts(s1)).toEqual(["我先检查相关文件"]);
    // progress1 同一 part 的 delta 追加 → 同一个 block（identity 稳定，不新建）
    const s1b = step([stepStart(), progress1("done")]);
    expect(commentaryTexts(s1b)).toEqual(["我先检查相关文件"]);
    // S2：progress1 + tool1 working → [progress1, tool1]
    const s2 = step([stepStart(), progress1("done"), stepStart(), tool1()]);
    expect(commentaryTexts(s2)).toEqual(["我先检查相关文件"]);
    expect(s2.worklog.map((b) => b.kind)).toEqual(["commentary", "tool"]);
    expect((s2.worklog[1] as { status: string }).status).toBe("working");
    // S3：tool1 done
    const s3 = step([stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } })]);
    expect(s3.worklog.map((b) => b.kind)).toEqual(["commentary", "tool"]);
    expect((s3.worklog[1] as { status: string }).status).toBe("done");
    // S4：progress2 → 新 block（不合并进 progress1）
    const s4 = step([stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } }), stepStart(), progress2()]);
    expect(commentaryTexts(s4)).toEqual(["我先检查相关文件", "接下来读取最相关的文件"]);
    // S5：tool2 working
    const s5 = step([stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } }), stepStart(), progress2("done"), stepStart(), tool2()]);
    expect(s5.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool"]);
    expect((s5.worklog[3] as { status: string }).status).toBe("working");
    // S6：tool2 done → worklog 保持；S7 boundary → milestone 出现、answer 仍空
    const s6 = step([stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } }), stepStart(), progress2("done"), stepStart(), tool2("output-available", { output: { ok: true, data: {} } })]);
    expect(s6.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool"]);
    const s7 = step([
      stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } }),
      stepStart(), progress2("done"), stepStart(), tool2("output-available", { output: { ok: true, data: {} } }),
      stepStart(), boundary(),
    ]);
    expect(s7.worklog.map((b) => b.kind)).toEqual(["commentary", "tool", "commentary", "tool", "milestone"]);
    expect(s7.answer).toBe("");
    expect(s7.phase).toBe("composing");
    // S8：final text streaming → Final Answer 正常流式
    const s8 = step([
      stepStart(), progress1("done"), stepStart(), tool1("output-available", { output: { ok: true, data: {} } }),
      stepStart(), progress2("done"), stepStart(), tool2("output-available", { output: { ok: true, data: {} } }),
      stepStart(), boundary(), stepStart(), text("这是最终回答", "streaming"),
    ]);
    expect(s8.answer).toBe("这是最终回答");
    expect(s8.answerStreaming).toBe(true);
    // 任何阶段 progress1/progress2 都不出现在 answer
    expect(s8.answer).not.toContain("我先检查");
    expect(s8.answer).not.toContain("接下来读取");
  });

  it("boundary 控制信号只派生 milestone（不算 toolCount / 不进 answer / UI-only）", () => {
    const p = deriveKiroAssistantTurn(
      [boundary(), text("回答", "done")],
      false
    );
    expect(p.worklog.map((b) => b.kind)).toEqual(["milestone"]);
    expect(p.hasTools).toBe(false);
    expect(p.answer).toBe("回答");
    // milestone 不含模型文字（serialize 中无 answer 文本）
    expect(JSON.stringify(p.worklog)).not.toContain("回答");
  });
});

describe("Legacy fallback（模型不遵守协议）", () => {
  it("B1. 有 Tool 且无 boundary：live 不误显示 Answer；settled 后 trailing fallback 正确", () => {
    const { step } = makeLive();
    const parts = [
      stepStart(),
      text("我先看看"),
      toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } }),
      stepStart(),
      text("今天建议先完成数学作业", "streaming"),
    ];
    const live = step(parts);
    // V4：pre-boundary trailing 立即作为 commentary 展示（不再 provisional 隐藏）
    expect(live.answer).toBe("");
    expect(commentaryTexts(live)).toEqual(["我先看看", "今天建议先完成数学作业"]);
    expect(live.phase).toBe("composing");
    // settled → trailing 全部视为 Final Answer fallback
    const settled = step(parts, false);
    expect(settled.answer).toBe("今天建议先完成数学作业");
    expect(settled.phase).toBe("done");
  });

  it("B2. settled trailing fallback：多段 text 全部并入 answer（保持原始顺序）", () => {
    const p = deriveKiroAssistantTurn(
      [
        toolPart("get_assignment", "output-available", { output: { ok: true, data: { title: "数学作业" } } }),
        text("结论一。", "done"),
        text("结论二。", "done"),
      ],
      false
    );
    expect(p.answer).toBe("结论一。结论二。");
    expect(p.worklog.map((b) => b.kind)).toEqual(["tool"]);
    expect(p.worklogDone).toBe(true);
  });
});

describe("Trailing Lookahead（legacy：有 Tool、无 boundary、live）", () => {
  const settledSearch = () =>
    toolPart("search_assignments", "output-available", { output: { ok: true, data: { items: [] } } });

  it("CASE 1: settled Tool + 第一段仍在 streaming → V4：立即作为 commentary 展示（composing、answer 空）", () => {
    const p = deriveKiroAssistantTurn(
      [settledSearch(), text("我先整理一下今天的安排。", "streaming")],
      true
    );
    expect(p.answer).toBe("");
    expect(p.phase).toBe("composing");
    expect(commentaryTexts(p)).toEqual(["我先整理一下今天的安排。"]);
  });

  it("CASE 2: 第一段已形成稳定块但第二段未开始（只有空行）→ V4：仍立即作为 commentary 展示", () => {
    const p = deriveKiroAssistantTurn(
      [settledSearch(), text("第一段已经完整。\n\n", "streaming")],
      true
    );
    expect(p.answer).toBe("");
    expect(p.phase).toBe("composing");
    expect(commentaryTexts(p)).toEqual(["第一段已经完整。\n\n"]);
  });

  it("CASE 3: 第二段已开始 → V4：live 期间 trailing 恒为 commentary；settled 后恢复 Final Answer", () => {
    const trailing = "第一段已经完整。\n\n第二段正在生成";
    const { step } = makeLive();
    const live = step([settledSearch(), text(trailing, "streaming")]);
    expect(live.answer).toBe("");
    expect(commentaryTexts(live)).toEqual([trailing]);
    expect(live.phase).toBe("composing");
    const settled = step([settledSearch(), text(trailing, "done")], false);
    expect(settled.answer).toBe(trailing);
    expect(settled.phase).toBe("done");
  });

  it("CASE 4: Tool 后单段且 state=done → V4：live 期间 commentary；settled 后恢复 Answer", () => {
    const { step } = makeLive();
    const live = step([settledSearch(), text("最终只有这一段。", "done")]);
    expect(live.answer).toBe("");
    expect(commentaryTexts(live)).toEqual(["最终只有这一段。"]);
    expect(live.phase).toBe("composing");
    const settled = step([settledSearch(), text("最终只有这一段。", "done")], false);
    expect(settled.answer).toBe("最终只有这一段。");
    expect(settled.phase).toBe("done");
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
    expect(commentaryTexts(p)).toEqual(["让我再确认一下今天可用的时间。"]);
  });

  it("CASE 6: V4：live 期间 trailing 恒为 commentary（单调）；settled 后恢复 Answer", () => {
    const { step } = makeLive();
    // live：trailing 始终作为 commentary 展示（不 commit 为 answer）
    const live = step([settledSearch(), text("第一段。\n\n第二段", "streaming")]);
    expect(live.answer).toBe("");
    expect(commentaryTexts(live)).toEqual(["第一段。\n\n第二段"]);
    // 新 Tool 到达：trailing 变 intermediate → 无论 live/settled 恒为 commentary（progress 语义）
    const withNewTool = step([
      settledSearch(),
      text("第一段。\n\n第二段", "done"),
      toolPart("get_assignment", "output-available", { output: { ok: true, data: { title: "数学作业" } } }),
    ]);
    expect(withNewTool.answer).toBe("");
    expect(commentaryTexts(withNewTool)).toEqual(["第一段。\n\n第二段"]);
    expect(withNewTool.worklog.map((b) => b.kind)).toEqual(["tool", "commentary", "tool"]);
    const settled = step(
      [
        settledSearch(),
        text("第一段。\n\n第二段", "done"),
        toolPart("get_assignment", "output-available", { output: { ok: true, data: { title: "数学作业" } } }),
      ],
      false
    );
    expect(settled.answer).toBe("");
    expect(commentaryTexts(settled)).toEqual(["第一段。\n\n第二段"]);
    expect(settled.worklog.map((b) => b.kind)).toEqual(["tool", "commentary", "tool"]);
  });

  it("CASE 7: Tool 后仍只有一段 provisional 但 turnInFlight=false → flush 成 Final Answer", () => {
    const p = deriveKiroAssistantTurn([settledSearch(), text("这是最终回答。", "streaming")], false);
    expect(p.answer).toBe("这是最终回答。");
    expect(p.phase).toBe("done");
  });
});

describe("answerStreaming（只由真实 Final text state 决定）", () => {
  it("S1. boundary 后 text part streaming → true；同 Turn 仍 in-flight 但 part done → false", () => {
    const { step } = makeLive();
    const p0 = step([boundary(), text("第一段。\n\n第二段", "streaming")]);
    expect(p0.answer).toBe("第一段。\n\n第二段");
    expect(p0.answerStreaming).toBe(true);
    expect(p0.phase).toBe("answering");

    const p1 = step([boundary(), text("第一段。\n\n第二段", "done")]);
    expect(p1.answer).toBe("第一段。\n\n第二段");
    expect(p1.answerStreaming).toBe(false);
    expect(p1.phase).toBe("answering");
  });

  it("S2. settled → answerStreaming 恒 false", () => {
    const p = deriveKiroAssistantTurn([boundary(), text("完成。", "done")], false);
    expect(p.answer).toBe("完成。");
    expect(p.answerStreaming).toBe(false);
  });
});

describe("deriveKiroAssistantTurn（静态：fresh commit）基础行为", () => {
  it("无 content 时返回齐备字段（working）", () => {
    const p: KiroAssistantTurnPresentation = deriveKiroAssistantTurn([], true);
    expect(typeof p.answer).toBe("string");
    expect(typeof p.answerStreaming).toBe("boolean");
    expect(typeof p.hasTools).toBe("boolean");
    expect(typeof p.worklogDone).toBe("boolean");
    expect(["working", "composing", "answering", "done"]).toContain(p.phase);
  });

  it("Tool 全完成但 final text 未出现且 chat 仍 streaming → composing", () => {
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

  it("chat ready（turnInFlight=false）→ done；answerStreaming=false", () => {
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
    expect(p.phase).toBe("working");
    expect(p.answer).toBe("");
  });

  it("boundary 控制信号不进入 worklog / 不算 hasTools（只派生 UI-only milestone）", () => {
    const p = deriveKiroAssistantTurn([boundary(), text("回答", "done")], false);
    expect(p.worklog.map((b) => b.kind)).toEqual(["milestone"]);
    expect(p.hasTools).toBe(false);
    expect(p.answer).toBe("回答");
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

