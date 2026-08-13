import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getComputerToolsForMode, COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { sandboxDelete, sandboxWriteText, sandboxListDirectory } from "@/lib/ai/computer/adapters/sandbox";

const SANDBOX_REF = "sandbox-test-ref";

const snapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "research",
  agentMode: "guided",
  roots: [{ id: "output", label: "输出", access: "read-write" }],
};

const workspace: KiroWorkspaceMeta = {
  id: "research",
  name: "论文研究",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_REF }],
};

const readOnlyWorkspace: KiroWorkspaceMeta = {
  ...workspace,
  roots: [{ id: "raw", label: "原始数据", access: "read-only", adapterRef: SANDBOX_REF }],
};

const rules: ComputerPermissionRule[] = [];

function ctx(snap: KiroComputerTurnSnapshot = snapshot, ws: KiroWorkspaceMeta = workspace, rs: ComputerPermissionRule[] = rules) {
  return { turnSnapshot: snap, liveWorkspaces: [ws], livePermissionRules: rs };
}

function counters() {
  return { readCount: 0, mutationCount: 0 };
}

/** Part 2：mutation 走 workspace-auto（guided 下所有 mutation 一律 WORKSPACE_PERMISSION_REQUIRED） */
const AUTO_SNAPSHOT: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "workspace-auto" };

async function clean() {
  for (const item of await sandboxListDirectory(SANDBOX_REF, "")) {
    await sandboxDelete(SANDBOX_REF, item.name);
  }
}

beforeEach(async () => {
  await clean();
});

describe("tool exposure", () => {
  it("Computer OFF → 0 个 Computer tools", () => {
    const tools = getKiroToolsForRequest({ computerSnapshot: { enabled: false, agentMode: "guided" } });
    for (const t of COMPUTER_TOOLS) {
      expect(tools[t.name]).toBeUndefined();
    }
  });

  it("plan → 只读；guided/auto → read + mutation", () => {
    const plan = getComputerToolsForMode("plan");
    expect(plan.every((t) => !t.mutation)).toBe(true);
    for (const mode of ["guided", "workspace-auto"] as const) {
      const set = getComputerToolsForMode(mode);
      expect(set.some((t) => t.mutation)).toBe(true);
    }
  });

  it("Part 2 不暴露 delete/shell/app/network 工具", () => {
    const names = COMPUTER_TOOLS.map((t) => t.name);
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("delete_directory");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("launch_application");
    expect(names).not.toContain("move_file");
    expect(names).not.toContain("rename_file");
  });
});

describe("read tools", () => {
  it("list_workspace_roots 返回逻辑 roots", async () => {
    const r = await executeKiroComputerTool({
      toolName: "list_workspace_roots",
      toolInput: {},
      context: ctx(),
      counters: counters(),
    });
    expect(r.ok).toBe(true);
    expect((r as { data: { roots: unknown[] } }).data.roots).toHaveLength(1);
  });

  it("create + list + read_text + get_file_metadata + search + grep", async () => {
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "notes.md", content: "alpha\nbeta hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const read = await executeKiroComputerTool({
      toolName: "read_text",
      toolInput: { path: "notes.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((read as { data: { text: string } }).data.text).toContain("beta hello");

    const list = await executeKiroComputerTool({
      toolName: "list_directory",
      toolInput: { path: "." },
      context: ctx(),
      counters: c,
    });
    expect((list as { data: { items: { name: string }[] } }).data.items.map((i) => i.name)).toContain("notes.md");

    const meta = await executeKiroComputerTool({
      toolName: "get_file_metadata",
      toolInput: { path: "notes.md" },
      context: ctx(),
      counters: c,
    });
    expect((meta as { data: { meta: { kind: string } } }).data.meta.kind).toBe("file");

    const search = await executeKiroComputerTool({
      toolName: "search_files",
      toolInput: { query: "notes" },
      context: ctx(),
      counters: c,
    });
    expect((search as { data: { results: { path: string }[] } }).data.results.map((r) => r.path)).toContain("notes.md");

    const grep = await executeKiroComputerTool({
      toolName: "grep_files",
      toolInput: { query: "hello" },
      context: ctx(),
      counters: c,
    });
    expect((grep as { data: { matches: { path: string }[] } }).data.matches.length).toBeGreaterThan(0);
  });

  it("read_text maxChars 边界 + startLine", async () => {
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "long.md", content: "l1\nl2\nl3\nl4" },
      context: ctx(),
      counters: counters(),
    });
    const r = await executeKiroComputerTool({
      toolName: "read_text",
      toolInput: { path: "long.md", startLine: 2, endLine: 3 },
      context: ctx(),
      counters: counters(),
    });
    expect((r as { data: { text: string } }).data.text).toBe("l2\nl3");
  });
});

describe("mutation tools + policy", () => {
  it("create_text_file 写后 verify（read-back exact）；重复创建拒绝", async () => {
    const c = counters();
    const r1 = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "x.md", content: "hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(r1.ok).toBe(true);
    expect((r1 as { actionFact?: unknown }).actionFact).toBeTruthy();
    const r2 = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "x.md", content: "hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(r2.ok).toBe(false);
    expect((r2 as { code: string }).code).toBe("RESOURCE_ALREADY_EXISTS");
  });

  it("patch_text_file：精确修改 + read-back verify；冲突不写", async () => {
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "p.md", content: "标题\n正文内容" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const r = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolInput: { path: "p.md", edits: [{ oldText: "正文内容", newText: "修改后的正文" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(r.ok).toBe(true);
    expect((r as { actionFact: { changeCount: number } }).actionFact.changeCount).toBe(1);
    const conflict = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolInput: { path: "p.md", edits: [{ oldText: "不存在的内容", newText: "x" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(conflict.ok).toBe(false);
    expect((conflict as { code: string }).code).toBe("PATCH_CONFLICT");
  });

  it("Guided modify → WORKSPACE_PERMISSION_REQUIRED（不执行）", async () => {
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "g.md", content: "before" },
      context: ctx(),
      counters: c,
    });
    const r = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolInput: { path: "g.md", edits: [{ oldText: "before", newText: "after" }] },
      context: ctx(),
      counters: c,
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("WORKSPACE_PERMISSION_REQUIRED");
  });

  it("Workspace Auto modify 正常执行", async () => {
    const c = counters();
    const autoSnap: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "workspace-auto" };
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "a.md", content: "v1" },
      context: ctx(autoSnap),
      counters: c,
    });
    const r = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolInput: { path: "a.md", edits: [{ oldText: "v1", newText: "v2" }] },
      context: ctx(autoSnap),
      counters: c,
    });
    expect(r.ok).toBe(true);
  });

  it("Plan 模式拒绝 mutation", async () => {
    const c = counters();
    const planSnap: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "plan" };
    const r = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "plan.md", content: "x" },
      context: ctx(planSnap),
      counters: c,
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("read-only root 拒绝 mutation", async () => {
    const c = counters();
    const snap: KiroComputerTurnSnapshot = {
      enabled: true,
      workspaceId: "research",
      agentMode: "workspace-auto",
      roots: [{ id: "raw", label: "原始数据", access: "read-only" }],
    };
    const r = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "x.md", content: "x" },
      context: ctx(snap, readOnlyWorkspace),
      counters: c,
    });
    expect(r.ok).toBe(false);
  });

  it("create_document：Markdown 生成 + verify + ActionFact", async () => {
    const c = counters();
    const r = await executeKiroComputerTool({
      toolName: "create_document",
      toolInput: {
        path: "方案.md",
        document: {
          title: "研究方案",
          blocks: [{ type: "paragraph", content: [{ text: "正文" }] }],
        },
      },
      context: ctx(),
      counters: c,
    });
    expect(r.ok).toBe(true);
    const fact = (r as { actionFact: { format: string; verification: string } }).actionFact;
    expect(fact.format).toBe("markdown");
    expect(fact.verification).toBe("passed");
  });

  it("create_document：DOCX 生成 + 验证", async () => {
    const c = counters();
    const r = await executeKiroComputerTool({
      toolName: "create_document",
      toolInput: {
        path: "方案.docx",
        document: {
          title: "研究方案",
          blocks: [
            { type: "heading", level: 1, content: [{ text: "章节" }] },
            { type: "paragraph", content: [{ text: "内容" }] },
          ],
        },
      },
      context: ctx(),
      counters: c,
    });
    expect(r.ok).toBe(true);
    expect((r as { actionFact: { format: string } }).actionFact.format).toBe("docx");
  });

  it("调用限制：read > 12 / mutation > 6", async () => {
    const c = { readCount: 12, mutationCount: 0 };
    const r = await executeKiroComputerTool({
      toolName: "read_text",
      toolInput: { path: "x.md" },
      context: ctx(),
      counters: c,
    });
    expect(r.ok).toBe(false);
    const m = { readCount: 0, mutationCount: 6 };
    const r2 = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolInput: { path: "y.md", content: "" },
      context: ctx(),
      counters: m,
    });
    expect(r2.ok).toBe(false);
  });
});
