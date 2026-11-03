import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { getComputerToolsForMode } from "@/lib/ai/computer/tools/registry";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { sandboxListDirectory, sandboxDelete } from "@/lib/ai/computer/adapters/sandbox";
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { KiroWorkspaceMeta } from "@/lib/ai/computer/types";

/**
 * Kiro Agent 文件工具 live smoke（gated）：真实模型 + 真实 sandbox 文件系统。
 * 只在 OPENCODE_GO_TEST_API_KEY 存在时运行；默认 deepseek-v4.1-flash。
 * 覆盖 create_directory → create_text_file → read_text 的最小闭环。
 */
const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const MODEL = process.env.OPENCODE_GO_SMOKE_MODEL ?? "deepseek-v4.1-flash";
const describeGo = KEY ? describe : describe.skip;
const SANDBOX_REF = "sandbox-agent-live";
const SNAP: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "agent-live",
  agentMode: "workspace-auto",
  roots: [{ id: "output", label: "输出", access: "read-write" }],
};
const WORKSPACE: KiroWorkspaceMeta = {
  id: "agent-live",
  name: "Agent Live",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_REF }],
};
const FILE_TOOLS = new Set(["list_workspace_roots", "list_directory", "read_text", "create_directory", "create_text_file", "get_file_metadata"]);

async function clean() {
  for (const item of await sandboxListDirectory(SANDBOX_REF, "")) await sandboxDelete(SANDBOX_REF, item.name);
}

describeGo("agent file tools live", () => {
  beforeEach(clean);
  afterEach(clean);

  it("model creates + reads a markdown file in the workspace", async () => {
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { model } = await resolveLanguageModel({ provider: "opencode-go", model: MODEL, apiKey: KEY });
    const tools: Record<string, unknown> = {};
    for (const def of getComputerToolsForMode("workspace-auto")) {
      if (!FILE_TOOLS.has(def.name)) continue;
      tools[def.name] = tool({
        description: def.description,
        inputSchema: def.schema,
        execute: async (input: unknown) =>
          executeKiroComputerTool({
            toolName: def.name,
            toolCallId: `live-file-${def.name}-${Math.random().toString(36).slice(2, 8)}`,
            toolInput: input,
            context: { turnSnapshot: SNAP, liveWorkspaces: [WORKSPACE], livePermissionRules: [] },
            counters: { readCount: 0, mutationCount: 0 },
          }),
      });
    }

    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content:
            "在已授权工作区创建目录 notes，并在其中创建文件 agent-smoke.md，内容严格为：hello agent。" +
            "创建后读取该文件确认内容，然后只回复「done」。",
        },
      ],
      tools: tools as never,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 1024,
    });

    const calls = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    const toolResults = result.steps.flatMap((s) => s.toolResults);
    console.log("[LIVE:file] tools=", calls.join(","), "text=", result.text.slice(0, 120));

    // 以 read_text 的真实工具输出为准（创建成功才可能读到内容）；避免 fake-indexeddb 提交时序干扰
    const readResult = toolResults.find((r) => r.toolName === "read_text");
    const readOutput = (readResult?.output as { output?: { ok?: boolean; data?: { text?: string } } } | undefined)?.output;
    if (readOutput?.ok !== true) {
      console.log("[LIVE:file] root=", JSON.stringify(await sandboxListDirectory(SANDBOX_REF, "")).slice(0, 600));
    }
    expect(readOutput?.ok).toBe(true);
    expect(readOutput?.data?.text).toBe("hello agent");
    expect(calls).toContain("create_directory");
    expect(calls).toContain("create_text_file");
    expect(calls).toContain("read_text");
  }, 120_000);
});
