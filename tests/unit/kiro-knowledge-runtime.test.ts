import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  replaceKnowledgeFile,
  removeKnowledgeFile,
  clearWorkspaceKnowledge,
  listKnowledgeFiles,
  listKnowledgeChunks,
  getKnowledgeWorkspaceState,
} from "@/lib/ai/computer/knowledge/db";
import {
  refreshWorkspaceKnowledge,
  getWorkspaceKnowledgeStatus,
  markWorkspaceKnowledgeDirty,
} from "@/lib/ai/computer/knowledge/service";
import {
  KIRO_KNOWLEDGE_MAX_DEPTH,
  KIRO_KNOWLEDGE_MAX_FILES,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  knowledgeFileKey,
} from "@/lib/ai/computer/knowledge/types";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { clearSandboxAdapter, sandboxWriteText, sandboxCreateDirectory } from "@/lib/ai/computer/adapters/sandbox";
import { queryWorkspaceKnowledge } from "@/lib/ai/computer/knowledge/service";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";

const REF = "sandbox-knowledge-ref";

const workspace: KiroWorkspaceMeta = {
  id: "ws-k",
  name: "知识工作区",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "root-out", label: "输出", access: "read-write", adapterRef: REF }],
};

function file(path: string, overrides: Partial<KiroKnowledgeFileRecord> = {}): KiroKnowledgeFileRecord {
  return {
    key: knowledgeFileKey("ws-1", "root-out", path),
    workspaceId: "ws-1",
    rootId: "root-out",
    relativePath: path,
    extension: "md",
    type: "text",
    size: 10,
    fingerprint: `root-out\u0000${path}\u000010\u0000md`,
    contentStatus: "indexed",
    indexedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function chunk(path: string, ordinal: number, text: string): KiroKnowledgeChunkRecord {
  return {
    key: `${file(path).key}\u0000${String(ordinal).padStart(4, "0")}`,
    fileKey: file(path).key,
    workspaceId: "ws-1",
    rootId: "root-out",
    relativePath: path,
    ordinal,
    text,
    tokenCounts: {},
  };
}

async function seedWorkspace(wsId: string, path: string) {
  const f = file(path, { workspaceId: wsId, key: knowledgeFileKey(wsId, "root-out", path) });
  await replaceKnowledgeFile(f, [
    { ...chunk(path, 0, "content"), workspaceId: wsId, fileKey: f.key, key: `${f.key}\u00000000` },
  ]);
}

async function clearAll() {
  await clearWorkspaceKnowledge("ws-1");
  await clearWorkspaceKnowledge("ws-a");
  await clearWorkspaceKnowledge("ws-b");
  await clearWorkspaceKnowledge("ws-k");
  await clearSandboxAdapter(REF);
}

beforeEach(async () => {
  await clearAll();
});

describe("knowledge db", () => {
  it("replaceKnowledgeFile atomically replaces prior chunks", async () => {
    await replaceKnowledgeFile(file("notes.md"), [chunk("notes.md", 0, "alpha")]);
    await replaceKnowledgeFile(file("notes.md"), [chunk("notes.md", 0, "beta")]);
    expect((await listKnowledgeChunks("ws-1")).map((c) => c.text)).toEqual(["beta"]);
  });

  it("removeKnowledgeFile removes file + its chunks", async () => {
    await replaceKnowledgeFile(file("a.md"), [chunk("a.md", 0, "x")]);
    await removeKnowledgeFile(file("a.md").key);
    expect(await listKnowledgeFiles("ws-1")).toEqual([]);
    expect(await listKnowledgeChunks("ws-1")).toEqual([]);
  });

  it("clearWorkspaceKnowledge never touches another workspace", async () => {
    await seedWorkspace("ws-a", "a.md");
    await seedWorkspace("ws-b", "b.md");
    await clearWorkspaceKnowledge("ws-a");
    expect(await listKnowledgeFiles("ws-a")).toEqual([]);
    expect((await listKnowledgeFiles("ws-b")).map((f) => f.relativePath)).toEqual(["b.md"]);
  });
});

describe("knowledge refresh", () => {
  const refresh = (mode: "incremental" | "force" = "incremental", agentMode: KiroAgentMode = "workspace-auto") =>
    refreshWorkspaceKnowledge({
      workspace,
      mode,
      agentMode,
      permissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });

  it("initial refresh indexes text files and chunks; KIRO.md excluded", async () => {
    await sandboxWriteText(REF, "KIRO.md", "方法论问题优先参考 research/method.md。");
    await sandboxWriteText(REF, "research/method.md", "研究方法采用事件研究，并进行平行趋势检验。");
    await sandboxWriteText(REF, "data/README.txt", "数据目录说明。");
    const state = await refresh();
    expect(state.partial).toBe(false);
    expect(state.fileCount).toBe(2); // KIRO.md 不作为普通记录
    expect(state.chunkCount).toBeGreaterThan(0);
    const files = await listKnowledgeFiles("ws-k");
    expect(files.map((f) => f.relativePath)).not.toContain("KIRO.md");
    const chunkTexts = (await listKnowledgeChunks("ws-k")).map((c) => c.text).join("");
    expect(chunkTexts).not.toContain("方法论问题优先参考");
    expect(chunkTexts).toContain("事件研究");
  });

  it("dirty: markWorkspaceKnowledgeDirty 只更新已存在 state；未建立索引不创建", async () => {
    await markWorkspaceKnowledgeDirty("ws-k");
    expect(await getWorkspaceKnowledgeStatus("ws-k")).toBeNull();
    await refresh();
    await markWorkspaceKnowledgeDirty("ws-k");
    expect((await getWorkspaceKnowledgeStatus("ws-k"))?.dirty).toBe(true);
  });

  it("incremental clean refresh reuses same-fingerprint content; force re-extracts same-size changed file", async () => {
    await sandboxWriteText(REF, "notes.md", "版本一内容");
    const first = await refresh();
    expect(first.fileCount).toBe(1);
    // 同尺寸外部变更（clean incremental 可能保持 stale）
    await sandboxWriteText(REF, "notes.md", "版本二内容");
    const incr = await refresh("incremental");
    const incrText = (await listKnowledgeChunks("ws-k")).map((c) => c.text).join("");
    expect(incrText).toContain("版本一内容"); // fingerprint 相同 → 复用旧内容
    void incr;
    // force 重新提取
    await refresh("force");
    const forceText = (await listKnowledgeChunks("ws-k")).map((c) => c.text).join("");
    expect(forceText).toContain("版本二内容");
  });

  it("stale file removal: refresh 后未再观察到的旧文件被删除", async () => {
    await sandboxWriteText(REF, "old.md", "old");
    await refresh();
    // 文件从 filesystem 移除后 force 刷新 → 旧记录删除
    const { sandboxDelete } = await import("@/lib/ai/computer/adapters/sandbox");
    await sandboxDelete(REF, "old.md");
    await sandboxWriteText(REF, "new.md", "new");
    await refresh("force");
    const files = (await listKnowledgeFiles("ws-k")).map((f) => f.relativePath);
    expect(files).not.toContain("old.md");
    expect(files).toContain("new.md");
  });

  it("PDF / 不支持扩展名 → metadata-only；>2 MiB → metadata-only", async () => {
    const { sandboxWriteBytes } = await import("@/lib/ai/computer/adapters/sandbox");
    await sandboxWriteBytes(REF, "paper.pdf", new TextEncoder().encode("pdf-body"), "application/pdf");
    await sandboxWriteBytes(REF, "big.txt", new TextEncoder().encode("x".repeat(2 * 1024 * 1024 + 1)), "text/plain");
    await refresh();
    const files = await listKnowledgeFiles("ws-k");
    const pdf = files.find((f) => f.relativePath === "paper.pdf");
    expect(pdf?.contentStatus).toBe("metadata-only");
    const big = files.find((f) => f.relativePath === "big.txt");
    expect(big?.contentStatus).toBe("metadata-only");
  });

  it("depth > 12 → partial；files >= 2000 → partial", async () => {
    // 深度限制
    let deep = "";
    for (let i = 0; i < KIRO_KNOWLEDGE_MAX_DEPTH + 2; i++) deep += `d${i}/`;
    await sandboxWriteText(REF, `${deep}deep.md`, "deep");
    const state = await refresh();
    expect(state.partial).toBe(true);
    // 文件数限制
    for (let i = 0; i < KIRO_KNOWLEDGE_MAX_FILES + 5; i++) {
      await sandboxWriteText(REF, `f${i}.md`, `f${i}`);
    }
    await clearWorkspaceKnowledge("ws-k");
    const state2 = await refresh();
    expect(state2.fileCount).toBeLessThanOrEqual(KIRO_KNOWLEDGE_MAX_FILES);
    expect(state2.partial).toBe(true);
  });

  it("fs.read deny → metadata-only（不读取正文，不弹审批）", async () => {
    await sandboxWriteText(REF, "secret.md", "机密正文内容");
    const denyRule = {
      id: "deny-read",
      effect: "deny" as const,
      capability: "fs.read" as const,
      workspaceId: "ws-k",
      scope: "persistent" as const,
    };
    const state = await refreshWorkspaceKnowledge({
      workspace,
      mode: "force",
      agentMode: "guided",
      permissionRules: [denyRule],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    expect(state.partial).toBe(false);
    const files = await listKnowledgeFiles("ws-k");
    expect(files.find((f) => f.relativePath === "secret.md")?.contentStatus).toBe("metadata-only");
    const text = (await listKnowledgeChunks("ws-k")).map((c) => c.text).join("");
    expect(text).not.toContain("机密正文内容");
  });
});

describe("V3 Part 2.1 stabilization", () => {
  it("dirty -> successful incremental refresh -> dirty=false（生命周期消费）", async () => {
    await sandboxWriteText(REF, "a.md", "内容");
    await refreshWorkspaceKnowledge({
      workspace,
      mode: "force",
      agentMode: "workspace-auto",
      permissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    await markWorkspaceKnowledgeDirty("ws-k");
    expect((await getWorkspaceKnowledgeStatus("ws-k"))?.dirty).toBe(true);
    await refreshWorkspaceKnowledge({
      workspace,
      mode: "incremental",
      agentMode: "workspace-auto",
      permissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    const after = await getWorkspaceKnowledgeStatus("ws-k");
    expect(after?.dirty).toBe(false);
    // 下一次普通 retrieval 不再因旧 dirty 标记重复 refresh（dirty 已消费）
    expect(after?.partial).toBe(false);
  });

  it("queryWorkspaceKnowledge 在 service 层落实 maxResults（先 slice 再 build snippet）", async () => {
    for (let i = 0; i < 10; i++) {
      await sandboxWriteText(REF, `m${i}.md`, `研究方法说明内容 ${i}`);
    }
    await refreshWorkspaceKnowledge({
      workspace,
      mode: "force",
      agentMode: "workspace-auto",
      permissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    const limited = await queryWorkspaceKnowledge({ workspaceId: "ws-k", query: "研究方法", maxResults: 3 });
    expect(limited.length).toBe(3);
    const defaulted = await queryWorkspaceKnowledge({ workspaceId: "ws-k", query: "研究方法" });
    expect(defaulted.length).toBeLessThanOrEqual(20);
  });
});