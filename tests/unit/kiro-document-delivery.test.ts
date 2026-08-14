import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/adapters/factory";
import { clearSandboxAdapter, sandboxWriteText } from "@/lib/ai/computer/adapters/sandbox";
import {
  getArtifact,
  getArtifactSource,
  findArtifactByLocation,
} from "@/lib/ai/computer/artifacts/service";
import { listRecentArtifactEntries } from "@/lib/ai/computer/artifacts/access";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";

const SANDBOX_REF = "sandbox-delivery-ref";

const snapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "delivery",
  agentMode: "workspace-auto",
  roots: [{ id: "root-sandbox", label: "Sandbox", access: "read-write" }],
};

const workspace: KiroWorkspaceMeta = {
  id: "delivery",
  name: "Kiro Sandbox",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "root-sandbox", label: "Sandbox", access: "read-write", adapterRef: SANDBOX_REF }],
};

function ctx() {
  return { turnSnapshot: snapshot, liveWorkspaces: [workspace], livePermissionRules: [] };
}
function counters() {
  return { readCount: 0, mutationCount: 0 };
}

const WEEKLY_DRAFT = {
  title: "本周课表",
  stylePreset: "business-report",
  blocks: [
    {
      type: "table",
      header: ["星期", "课程", "时间", "地点"],
      rows: [
        ["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"],
        ["周二", "概率论与数理统计", "10:00–11:40", "教三 305"],
      ],
    },
  ],
};

beforeEach(async () => {
  await clearSandboxAdapter(SANDBOX_REF);
  vi.restoreAllMocks();
});

describe("V2.9 create_document Delivery Integrity", () => {
  it("atomic success：render + write + verify + Artifact metadata + Source IR + Recent Files 全链路", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-del-succ",
      toolInput: { rootId: "root-sandbox", path: "本周课表.docx", document: WEEKLY_DRAFT },
      context: ctx(),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(c.mutationCount).toBe(1);
    // filesystem verified
    const io = getComputerAdapterForAdapterRef(SANDBOX_REF);
    const stat = await io.stat("本周课表.docx");
    expect(stat).not.toBeNull();
    expect(stat!.kind).toBe("file");
    // Artifact metadata + Source IR（revision 1）
    const artifact = await findArtifactByLocation("delivery", "root-sandbox", "本周课表.docx");
    expect(artifact).not.toBeNull();
    expect(artifact!.revision).toBe(1);
    expect(artifact!.source).toBe("kiro-created");
    const source = await getArtifactSource(artifact!.id);
    expect(source).not.toBeNull();
    expect(source!.revision).toBe(1);
    // Recent Files 可见且 available
    const entries = await listRecentArtifactEntries({ workspaceId: "delivery", workspaces: [workspace] });
    const entry = entries.find((e) => e.artifact.relativePath === "本周课表.docx");
    expect(entry).toBeDefined();
    expect(entry!.availability).toBe("available");
  });

  it("Artifact 登记失败 → 回滚文件（stat null）+ ok:false + Recent Files 无 ghost", async () => {
    const service = await import("@/lib/ai/computer/artifacts/service");
    const spy = vi.spyOn(service, "registerCreatedArtifact").mockRejectedValue(new Error("registry down"));
    try {
      const c = counters();
      const attempt = await executeKiroComputerTool({
        toolName: "create_document",
        toolCallId: "call-del-rollback",
        toolInput: { rootId: "root-sandbox", path: "rollback.docx", document: WEEKLY_DRAFT },
        context: ctx(),
        counters: c,
      });
      expect(attempt.kind).toBe("completed");
      if (attempt.kind !== "completed") return;
      expect(attempt.output.ok).toBe(false);
      expect((attempt.output as { code: string }).code).toBe("VERIFICATION_FAILED");
      // filesystem 已回滚：无 invisible file
      expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("rollback.docx")).toBeNull();
      // Recent Files 无 ghost
      const entries = await listRecentArtifactEntries({ workspaceId: "delivery", workspaces: [workspace] });
      expect(entries.find((e) => e.artifact.relativePath === "rollback.docx")).toBeUndefined();
      // mutation 语义：写操作已计数（进入 mutation 后失败）
      expect(c.mutationCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("Source IR 原子失败 → 不产生半注册 Artifact（metadata 也不存在）+ 文件回滚", async () => {
    const db = await import("@/lib/ai/computer/artifacts/db");
    const spy = vi.spyOn(db, "artifactDbCreateStructuredArtifact").mockRejectedValue(new Error("source tx failed"));
    try {
      const attempt = await executeKiroComputerTool({
        toolName: "create_document",
        toolCallId: "call-del-atomic",
        toolInput: { rootId: "root-sandbox", path: "atomic.docx", document: WEEKLY_DRAFT },
        context: ctx(),
        counters: counters(),
      });
      expect(attempt.kind).toBe("completed");
      if (attempt.kind !== "completed") return;
      expect(attempt.output.ok).toBe(false);
      expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("atomic.docx")).toBeNull();
      // 无半注册：metadata 与 source 都不存在（原子事务整体失败）
      const all = await import("@/lib/ai/computer/artifacts/db");
      const artifacts = await all.artifactDbAll();
      expect(artifacts.find((a) => a.relativePath === "atomic.docx")).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("existing orphan file：不覆盖 + adopt 为 workspace-existing + Recent Files 恢复可见", async () => {
    await sandboxWriteText(SANDBOX_REF, "本周课表.docx", "已有内容（非 Kiro 生成）");
    expect(await findArtifactByLocation("delivery", "root-sandbox", "本周课表.docx")).toBeNull();
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-del-orphan",
      toolInput: { rootId: "root-sandbox", path: "本周课表.docx", document: WEEKLY_DRAFT },
      context: ctx(),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("RESOURCE_ALREADY_EXISTS");
    // 不覆盖已有文件
    const io = getComputerAdapterForAdapterRef(SANDBOX_REF);
    expect(await io.stat("本周课表.docx")).not.toBeNull();
    // adopt 为 workspace-existing（无 Source IR）
    const artifact = await findArtifactByLocation("delivery", "root-sandbox", "本周课表.docx");
    expect(artifact).not.toBeNull();
    expect(artifact!.source).toBe("workspace-existing");
    expect(await getArtifactSource(artifact!.id)).toBeNull();
    // Recent Files 恢复可见（available）
    const entries = await listRecentArtifactEntries({ workspaceId: "delivery", workspaces: [workspace] });
    const entry = entries.find((e) => e.artifact.relativePath === "本周课表.docx");
    expect(entry).toBeDefined();
    expect(entry!.availability).toBe("available");
    // 不消耗 mutation quota（preflight 失败）
    expect(c.mutationCount).toBe(0);
  });

  it("render 失败 → 稳定 DOCUMENT_RENDER_FAILED + 文件未写 + mutation 不增", async () => {
    const docx = await import("@/lib/ai/computer/documents/docx");
    const spy = vi.spyOn(docx, "renderDocx").mockRejectedValue(new Error("packer boom"));
    try {
      const c = counters();
      const attempt = await executeKiroComputerTool({
        toolName: "create_document",
        toolCallId: "call-del-render",
        toolInput: { rootId: "root-sandbox", path: "render-fail.docx", document: WEEKLY_DRAFT },
        context: ctx(),
        counters: c,
      });
      expect(attempt.kind).toBe("completed");
      if (attempt.kind !== "completed") return;
      expect(attempt.output.ok).toBe(false);
      expect((attempt.output as { code: string }).code).toBe("DOCUMENT_RENDER_FAILED");
      expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("render-fail.docx")).toBeNull();
      expect(c.mutationCount).toBe(0);
      // failureFuse：硬失败首次即 blocked
      const { advanceDocumentFailureFuse } = await import("@/lib/ai/computer/documents/failureFuse");
      const fuse = { schemaFailures: 0, hardFailure: false, blocked: false };
      expect(advanceDocumentFailureFuse(fuse, attempt.output as { ok?: boolean; code?: string })).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("invalid document schema → INVALID_INPUT + mutation 不增", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-del-invalid",
      toolInput: { rootId: "root-sandbox", path: "bad.docx", document: { title: "x", blocks: [{ type: "unknown" }] } },
      context: ctx(),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("INVALID_INPUT");
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("bad.docx")).toBeNull();
    expect(c.mutationCount).toBe(0);
  });
});
