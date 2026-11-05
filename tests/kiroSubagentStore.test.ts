import { beforeEach, describe, expect, it } from "vitest";
import { useKiroSubagentStore } from "@/store/useKiroSubagentStore";

describe("useKiroSubagentStore", () => {
  beforeEach(() => {
    useKiroSubagentStore.getState().reset();
  });

  it("start → appendText → step → complete", () => {
    const store = useKiroSubagentStore.getState();
    store.start({
      id: "t1",
      conversationId: "c1",
      role: "researcher",
      task: "研究 A",
      webUsed: true,
    });
    useKiroSubagentStore.getState().appendText("t1", "结论");
    useKiroSubagentStore.getState().appendText("t1", "：A 更好");
    useKiroSubagentStore.getState().upsertStep("t1", {
      id: "s1",
      toolName: "web_search",
      label: "搜索网络",
      status: "done",
      detail: "3 个来源",
    });
    useKiroSubagentStore.getState().complete("t1", "最终摘要", true);

    const run = useKiroSubagentStore.getState().runs.t1;
    expect(run.status).toBe("completed");
    expect(run.text).toBe("最终摘要");
    expect(run.steps[0].detail).toBe("3 个来源");
    expect(run.completedAt).toBeTypeOf("number");
  });

  it("fail / cancelRunning 只影响对应 conversation 的 running run", () => {
    const store = useKiroSubagentStore.getState();
    store.start({ id: "a", conversationId: "c1", role: "planner", task: "A", webUsed: false });
    store.start({ id: "b", conversationId: "c2", role: "reviewer", task: "B", webUsed: false });
    useKiroSubagentStore.getState().fail("a", "失败");
    expect(useKiroSubagentStore.getState().runs.a.status).toBe("failed");
    expect(useKiroSubagentStore.getState().runs.a.error).toBe("失败");

    useKiroSubagentStore.getState().cancelRunning("c2");
    expect(useKiroSubagentStore.getState().runs.b.status).toBe("cancelled");
    expect(useKiroSubagentStore.getState().runs.a.status).toBe("failed");
  });
});
