import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getComputerToolsForMode, COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import { sandboxDelete, sandboxWriteText, sandboxListDirectory } from "@/lib/ai/computer/adapters/sandbox";
import { registerCreatedArtifact, adoptWorkspaceArtifact, getArtifact, getArtifactSource } from "@/lib/ai/computer/artifacts/service";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES } from "@/lib/ai/computer/executor";

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

/** mutation 直接执行路径（workspace-auto） */
const AUTO_SNAPSHOT: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "workspace-auto" };

/** 解包 attempt → completed output（approval-required 时测试必须显式断言） */
async function completedOutput(req: {
  toolName: string;
  toolCallId?: string;
  toolInput: unknown;
  context: ReturnType<typeof ctx>;
  counters: ReturnType<typeof counters>;
  oneShotApprovals?: ComputerOneShotApproval[];
}): Promise<Extract<ComputerExecutionAttempt, { kind: "completed" }>["output"]> {
  const attempt = await executeKiroComputerTool({
    toolName: req.toolName,
    toolCallId: req.toolCallId ?? "call_x",
    toolInput: req.toolInput,
    context: req.context,
    counters: req.counters,
    oneShotApprovals: req.oneShotApprovals,
  });
  expect(attempt.kind).toBe("completed");
  return attempt.kind === "completed" ? attempt.output : { ok: false, code: "UNEXPECTED", message: "" };
}

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

  it("不暴露 delete/shell/app/network 工具（delete/undo 只属于 runtime，不是 Model Tool）", () => {
    const names = COMPUTER_TOOLS.map((t) => t.name);
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("delete_directory");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("launch_application");
    // V2：rename_file / move_file 是 fs.move（默认 ask），不是 delete
    expect(names).toContain("rename_file");
    expect(names).toContain("move_file");
    expect(names).toContain("update_document");
    // Model schema 绝不能加入权限相关参数
    expect(names.length).toBe(14);
  });

  it("update_document 权限模式：Plan 不暴露 / Guided ask / Workspace Auto allow", () => {
    const plan = getComputerToolsForMode("plan");
    expect(plan.some((t) => t.name === "update_document")).toBe(false);
    const guided = getComputerToolsForMode("guided");
    expect(guided.some((t) => t.name === "update_document")).toBe(true);
    const auto = getComputerToolsForMode("workspace-auto");
    expect(auto.some((t) => t.name === "update_document")).toBe(true);
    // mutation guard
    const def = COMPUTER_TOOLS.find((t) => t.name === "update_document");
    expect(def?.mutation).toBe(true);
    expect(def?.capability).toBe("document.modify");
  });
});

describe("read tools", () => {
  it("list_workspace_roots 返回逻辑 roots", async () => {
    const r = await completedOutput({ toolName: "list_workspace_roots", toolInput: {}, context: ctx(), counters: counters() });
    expect(r.ok).toBe(true);
    expect((r as { data: { roots: unknown[] } }).data.roots).toHaveLength(1);
  });

  it("create + list + read_text + get_file_metadata + search + grep", async () => {
    const c = counters();
    await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "notes.md", content: "alpha\nbeta hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const read = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "notes.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((read as { data: { text: string } }).data.text).toContain("beta hello");

    const list = await completedOutput({
      toolName: "list_directory",
      toolInput: { path: "." },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((list as { data: { items: { name: string }[] } }).data.items.map((i) => i.name)).toContain("notes.md");

    const meta = await completedOutput({
      toolName: "get_file_metadata",
      toolInput: { path: "notes.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((meta as { data: { meta: { kind: string } } }).data.meta.kind).toBe("file");

    const search = await completedOutput({
      toolName: "search_files",
      toolInput: { query: "notes" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((search as { data: { results: { path: string }[] } }).data.results.map((r) => r.path)).toContain("notes.md");

    const grep = await completedOutput({
      toolName: "grep_files",
      toolInput: { query: "hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((grep as { data: { matches: { path: string }[] } }).data.matches.length).toBeGreaterThan(0);
  });

  it("read_text maxChars 边界 + startLine", async () => {
    await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "long.md", content: "l1\nl2\nl3\nl4" },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
    });
    const r = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "long.md", startLine: 2, endLine: 3 },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
    });
    expect((r as { data: { text: string } }).data.text).toBe("l2\nl3");
  });
});

describe("mutation tools + policy（Part 2 回归 + Part 3 attempt 语义）", () => {
  it("create_text_file 写后 verify（read-back exact）+ runtime facts；重复创建拒绝", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "call_create",
      toolInput: { path: "x.md", content: "hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(attempt.runtime).toBeTruthy();
    expect(attempt.runtime?.change.resourceType).toBe("text");
    expect(attempt.runtime?.inverse?.type).toBe("remove-created");

    const r2 = await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "x.md", content: "hello" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(r2.ok).toBe(false);
    expect((r2 as { code: string }).code).toBe("RESOURCE_ALREADY_EXISTS");
  });

  it("patch_text_file：精确修改 + read-back verify + text-patch review；冲突不写", async () => {
    const c = counters();
    await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "p.md", content: "标题\n正文内容" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_patch",
      toolInput: { path: "p.md", edits: [{ oldText: "正文内容", newText: "修改后的正文" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(attempt.runtime?.inverse?.type).toBe("restore-text");
    if (attempt.runtime?.inverse?.type === "restore-text") {
      expect(attempt.runtime.inverse.beforeText).toBe("标题\n正文内容");
    }
    const review = attempt.runtime?.change.review;
    expect(review?.kind).toBe("text-patch");
    if (review?.kind === "text-patch") {
      expect(review.edits).toEqual([{ before: "正文内容", after: "修改后的正文" }]);
    }

    const conflict = await completedOutput({
      toolName: "patch_text_file",
      toolInput: { path: "p.md", edits: [{ oldText: "不存在的内容", newText: "x" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(conflict.ok).toBe(false);
    expect((conflict as { code: string }).code).toBe("PATCH_CONFLICT");
  });

  it("Guided patch → approval-required（无 mutation、无 Tool Output、文件不变）", async () => {
    const c = counters();
    await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "g.md", content: "before" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_guided_patch",
      toolInput: { path: "g.md", edits: [{ oldText: "before", newText: "after" }] },
      context: ctx(), // guided
      counters: c,
    });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.capability).toBe("fs.modify");
    expect(attempt.request.relativePath).toBe("g.md");
    expect(attempt.request.allowedDecisions).toContain("allow-once");
    expect(attempt.request.allowedDecisions).toContain("deny");
    // 文件 unchanged
    const read = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "g.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((read as { data: { text: string } }).data.text).toBe("before");
    // ask 不消耗 mutation 计数（approval 不是 error；计数只在实际执行时增加）
    expect(c.mutationCount).toBe(1); // 只有 seed create 消耗
  });

  it("allow-once exact match：resume 执行并消费；不同 path 不匹配 → 仍 approval-required", async () => {
    const c = counters();
    await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "a.md", content: "v1" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const oneShot: ComputerOneShotApproval[] = [
      {
        approvalId: "a1",
        toolCallId: "call_a",
        capability: "fs.modify",
        workspaceId: "research",
        rootId: "output",
        relativePath: "a.md",
      },
    ];
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_a",
      toolInput: { path: "a.md", edits: [{ oldText: "v1", newText: "v2" }] },
      context: ctx(),
      counters: c,
      oneShotApprovals: oneShot,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(oneShot.length).toBe(0); // 一次消费

    // 不同 path：不匹配 → 仍 ask（approval 不能匹配其它文件）
    const oneShot2: ComputerOneShotApproval[] = [
      {
        approvalId: "a2",
        toolCallId: "call_b",
        capability: "fs.modify",
        workspaceId: "research",
        rootId: "output",
        relativePath: "other.md",
      },
    ];
    const attempt2 = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_b",
      toolInput: { path: "a.md", edits: [{ oldText: "v2", newText: "v3" }] },
      context: ctx(),
      counters: c,
      oneShotApprovals: oneShot2,
    });
    expect(attempt2.kind).toBe("approval-required");
  });

  it("explicit deny rule：不能 approval（deny 永远不可覆盖）", async () => {
    const c = counters();
    const denyRule: ComputerPermissionRule = {
      id: "deny-modify-a",
      effect: "deny",
      capability: "fs.modify",
      workspaceId: "research",
      resourcePattern: "a.md",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_c",
      toolInput: { path: "a.md", edits: [{ oldText: "x", newText: "y" }] },
      context: ctx(snapshot, workspace, [denyRule]),
      counters: c,
      oneShotApprovals: [
        {
          approvalId: "a3",
          toolCallId: "call_c",
          capability: "fs.modify",
          workspaceId: "research",
          rootId: "output",
          relativePath: "a.md",
        },
      ],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("Plan 模式拒绝 mutation（deny 不能 approval）", async () => {
    const c = counters();
    const planSnap: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "plan" };
    const r = await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "plan.md", content: "x" },
      context: ctx(planSnap),
      counters: c,
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("read-only root 拒绝 mutation（不可审批绕过）", async () => {
    const c = counters();
    const snap: KiroComputerTurnSnapshot = {
      enabled: true,
      workspaceId: "research",
      agentMode: "workspace-auto",
      roots: [{ id: "raw", label: "原始数据", access: "read-only" }],
    };
    const r = await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "x.md", content: "x" },
      context: ctx(snap, readOnlyWorkspace),
      counters: c,
    });
    expect(r.ok).toBe(false);
  });

  it("create_document：Markdown 生成 + verify + document review facts", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call_doc_md",
      toolInput: {
        path: "方案.md",
        document: {
          title: "研究方案",
          blocks: [
            { type: "heading", level: 1, content: [{ text: "引言" }] },
            { type: "paragraph", content: [{ text: "正文" }] },
          ],
        },
      },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    const review = attempt.runtime?.change.review;
    expect(review?.kind).toBe("document");
    if (review?.kind === "document") {
      expect(review.headings).toEqual(["引言"]);
      expect(review.paragraphs).toBe(1);
      expect(review.title).toBe("研究方案");
    }
  });

  it("create_document：DOCX 生成 + 验证", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call_doc_docx",
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
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    if (attempt.runtime?.change.format) {
      expect(attempt.runtime.change.format).toBe("docx");
    }
  });

  it("调用限制：read > 12 / mutation > 6", async () => {
    const c = { readCount: 12, mutationCount: 0 };
    const r = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "x.md" },
      context: ctx(),
      counters: c,
    });
    expect(r.ok).toBe(false);
    const m = { readCount: 0, mutationCount: 6 };
    const r2 = await completedOutput({
      toolName: "create_text_file",
      toolInput: { path: "y.md", content: "" },
      context: ctx(),
      counters: m,
    });
    expect(r2.ok).toBe(false);
  });
});

describe("update_document（V2 Part 2）", () => {
  const IR_V1: KiroDocument = {
    title: "研究方案",
    blocks: [
      { type: "heading", level: 1, content: [{ text: "引言" }] },
      { type: "paragraph", content: [{ text: "版本一" }] },
    ],
  };
  const IR_V2: KiroDocument = {
    title: "研究方案",
    blocks: [
      { type: "heading", level: 1, content: [{ text: "引言" }] },
      { type: "paragraph", content: [{ text: "版本二" }] },
    ],
  };

  async function seedEditableDoc(c = counters()) {
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call_seed_doc",
      toolInput: { path: "plan.md", document: IR_V1 },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return null;
    return (attempt.runtime?.change.artifactId ?? null) as string | null;
  }

  it("Workspace Auto：update_document 无审批执行 + revision 2 + 文件 v2 + Source IR v2", async () => {
    const c = counters();
    const artifactId = await seedEditableDoc(c);
    expect(artifactId).toBeTruthy();
    if (!artifactId) return;

    const attempt = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_1",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect((attempt.output as { data: { revision: number } }).data.revision).toBe(2);
    expect(attempt.runtime?.change.revision).toBe(2);
    expect(attempt.runtime?.inverse?.type).toBe("restore-document-revision");
    if (attempt.runtime?.inverse?.type === "restore-document-revision") {
      expect(attempt.runtime.inverse.previousRevision).toBe(1);
      expect(attempt.runtime.inverse.expectedCurrentRevision).toBe(2);
      expect(attempt.runtime.inverse.snapshot.format).toBe("markdown");
    }
    // 文件 + registry + source 一致
    const read = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "plan.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((read as { data: { text: string } }).data.text).toContain("版本二");
    const artifact = await getArtifact(artifactId);
    expect(artifact?.revision).toBe(2);
    const source = await getArtifactSource(artifactId);
    expect(source?.revision).toBe(2);
    expect(source?.document.blocks[1]).toEqual(IR_V2.blocks[1]);
  });

  it("Guided update_document asks without quota and approved resume consumes one", async () => {
    const artifactId = await seedEditableDoc(counters());
    expect(artifactId).toBeTruthy();
    if (!artifactId) return;

    const c = counters();
    const pending = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call-doc-quota",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(),
      counters: c,
    });
    expect(pending.kind).toBe("approval-required");
    expect(c.mutationCount).toBe(0);

    const oneShots: ComputerOneShotApproval[] = [{
      approvalId: "doc-quota-a1",
      toolCallId: "call-doc-quota",
      capability: "document.modify",
      workspaceId: "research",
      rootId: "output",
      relativePath: "plan.md",
    }];
    const resumed = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call-doc-quota",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(),
      counters: c,
      oneShotApprovals: oneShots,
    });
    expect(resumed.kind).toBe("completed");
    if (resumed.kind === "completed") expect(resumed.output.ok).toBe(true);
    expect(c.mutationCount).toBe(1);
  });
  it("stale expectedRevision → ARTIFACT_REVISION_CONFLICT 且文件保持 v1", async () => {
    const c = counters();
    const artifactId = await seedEditableDoc(c);
    if (!artifactId) return;
    await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_2",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    // stale：registry 已 v2，模型仍发 expectedRevision 1（fresh counter：reject 不消耗 quota）
    const staleCounter = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_stale",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: staleCounter,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("ARTIFACT_REVISION_CONFLICT");
    expect(staleCounter.mutationCount).toBe(0);
    const read = await completedOutput({
      toolName: "read_text",
      toolInput: { path: "plan.md" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect((read as { data: { text: string } }).data.text).toContain("版本二"); // 未被覆盖
  });

  it("workspace-existing Artifact → ARTIFACT_NOT_EDITABLE", async () => {
    await sandboxWriteText(SANDBOX_REF, "existing.md", "# 已有");
    const adopted = await adoptWorkspaceArtifact({
      workspaceId: "research",
      rootId: "output",
      relativePath: "existing.md",
      type: "markdown",
    });
    const attempt = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_3",
      toolInput: { artifactId: adopted.id, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("ARTIFACT_NOT_EDITABLE");
  });

  it("generic create_text_file .md（无 Source IR）→ ARTIFACT_NOT_EDITABLE", async () => {
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "call_seed_text",
      toolInput: { path: "generic.md", content: "plain" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const { findArtifactByLocation } = await import("@/lib/ai/computer/artifacts/service");
    const artifact = await findArtifactByLocation("research", "output", "generic.md");
    expect(artifact).toBeTruthy();
    if (!artifact) return;
    const attempt = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_4",
      toolInput: { artifactId: artifact.id, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("ARTIFACT_NOT_EDITABLE");
  });

  it("structured Kiro 文档 raw patch 被拒绝（ARTIFACT_UNSUPPORTED_OPERATION，不计数不写）", async () => {
    const artifactId = await seedEditableDoc(counters());
    expect(artifactId).toBeTruthy();
    if (!artifactId) return;
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call-structured-patch",
      toolInput: { rootId: "output", path: "plan.md", edits: [{ oldText: "版本一", newText: "绕过 IR" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("ARTIFACT_UNSUPPORTED_OPERATION");
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    expect(c.mutationCount).toBe(0);
  });

  it("generic 已登记文本 patch：Artifact revision +1、id 不变、runtime facts 携带", async () => {
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "call-gen-seed",
      toolInput: { rootId: "output", path: "notes.txt", content: "v1" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const { findArtifactByLocation } = await import("@/lib/ai/computer/artifacts/service");
    const artifact = await findArtifactByLocation("research", "output", "notes.txt");
    expect(artifact).toBeTruthy();
    if (!artifact) return;

    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call-gen-patch",
      toolInput: { rootId: "output", path: "notes.txt", edits: [{ oldText: "v1", newText: "v2" }] },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    const updated = await getArtifact(artifact.id);
    expect(updated?.revision).toBe(2);
    expect(updated?.id).toBe(artifact.id);
    expect(attempt.runtime?.change.artifactId).toBe(artifact.id);
    expect(attempt.runtime?.change.revision).toBe(2);
  });

  it("inspect_document DOCX：正文可读取（Mammoth raw text）+ Source IR 结构事实 + 无 HTML/OOXML/bytes array", async () => {
    // Mammoth 首次动态加载较慢（node 环境）
    const c = counters();
    await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-docx-inspect",
      toolInput: {
        rootId: "output",
        path: "word.docx",
        document: {
          title: "Word 测试",
          blocks: [
            { type: "heading", level: 1, content: [{ text: "标题" }] },
            { type: "paragraph", content: [{ text: "Word 正文可读取" }] },
          ],
        },
      },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    const inspect = await completedOutput({
      toolName: "inspect_document",
      toolInput: { rootId: "output", path: "word.docx" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(inspect.ok).toBe(true);
    const data = (inspect as { data: Record<string, unknown> }).data;
    expect(data.format).toBe("docx");
    expect(String(data.text)).toContain("Word 正文可读取");
    // 结构事实来自 Source IR
    expect(data.headings).toBe(1);
    expect(data.paragraphs).toBe(1);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("<w:document");
    expect(serialized).not.toContain("Uint8Array");
    expect(serialized).not.toContain('"document"');
  }, 20000);
  it(">5 MiB 在写入前拒绝 FILE_TOO_LARGE", async () => {
    const c = counters();
    const artifactId = await seedEditableDoc(c);
    if (!artifactId) return;
    // 直接放大当前文件（超过 5 MiB；绕过 patch schema 的内容上限）
    await sandboxWriteText(SANDBOX_REF, "plan.md", "x".repeat(COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES + 1));
    const bigCounter = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "update_document",
      toolCallId: "call_update_big",
      toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
      context: ctx(AUTO_SNAPSHOT),
      counters: bigCounter,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("FILE_TOO_LARGE");
    expect(bigCounter.mutationCount).toBe(0);
  });
});