import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  resolveDocumentAuthoringVersion,
  CURRENT_DOCUMENT_AUTHORING_VERSION,
} from "@/lib/ai/computer/documents/authoring/protocol";
import { validateComputerTurnSnapshot } from "@/lib/ai/computer/snapshot";
import {
  parseDocumentAuthoringInput,
} from "@/lib/ai/computer/documents/authoring/compat";
import { computerToolContractForVersion } from "@/lib/ai/tools";
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
import {
  deriveDocumentFailureFuseState,
  advanceDocumentFailureFuse,
  DOCUMENT_SCHEMA_RETRY_LIMIT,
} from "@/lib/ai/computer/documents/failureFuse";
import { resolveToolOutcomeStatus } from "@/lib/ai/presentation/toolOutcome";
import { deriveKiroAssistantTurn } from "@/lib/ai/presentation/turnPresentation";
import { deriveActivity } from "@/hooks/useKiroChat";
import { createTextFileSchema, patchTextFileSchema } from "@/lib/ai/computer/tools/schemas";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { clearSandboxAdapter } from "@/lib/ai/computer/adapters/sandbox";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";

describe("Task 21: resolveDocumentAuthoringVersion", () => {
  it("missing / invalid → 1（legacy Canonical）；2 → 2", () => {
    expect(resolveDocumentAuthoringVersion(undefined)).toBe(1);
    expect(resolveDocumentAuthoringVersion(null)).toBe(1);
    expect(resolveDocumentAuthoringVersion("2")).toBe(1);
    expect(resolveDocumentAuthoringVersion(999)).toBe(1);
    expect(resolveDocumentAuthoringVersion(2)).toBe(2);
    expect(CURRENT_DOCUMENT_AUTHORING_VERSION).toBe(2);
  });
});

describe("Task 22: snapshot trust-boundary", () => {
  const base = {
    enabled: true,
    workspaceId: "ws-1",
    agentMode: "workspace-auto",
    roots: [{ id: "output", label: "输出", access: "read-write" }],
  };

  it("旧 snapshot（无 documentAuthoringVersion）→ validation success → resolves V1", () => {
    const snap = validateComputerTurnSnapshot(base);
    expect(snap).not.toBeNull();
    expect(snap?.documentAuthoringVersion).toBeUndefined();
    expect(resolveDocumentAuthoringVersion(snap?.documentAuthoringVersion)).toBe(1);
  });

  it("新 snapshot（version 2）→ validation success → V2", () => {
    const snap = validateComputerTurnSnapshot({ ...base, documentAuthoringVersion: 2 });
    expect(snap).not.toBeNull();
    expect(snap?.documentAuthoringVersion).toBe(2);
    expect(resolveDocumentAuthoringVersion(snap?.documentAuthoringVersion)).toBe(2);
  });

  it("documentAuthoringVersion: 3 → rejected（invalid snapshot）", () => {
    expect(validateComputerTurnSnapshot({ ...base, documentAuthoringVersion: 3 })).toBeNull();
    expect(validateComputerTurnSnapshot({ ...base, documentAuthoringVersion: "2" })).toBeNull();
  });
});

describe("Task 23: tool contract matrix（模型每次只能看到一个协议）", () => {
  const createDef = COMPUTER_TOOLS.find((t) => t.name === "create_document")!;
  const updateDef = COMPUTER_TOOLS.find((t) => t.name === "update_document")!;

  const canonicalDoc = { blocks: [{ type: "paragraph", content: [{ text: "x" }] }] };
  const draftDoc = { blocks: [{ type: "paragraph", text: "x" }] };

  it("version 1：create/update 暴露 Canonical schema（draft 被拒绝）", () => {
    const c1 = computerToolContractForVersion(createDef, 1);
    const u1 = computerToolContractForVersion(updateDef, undefined); // legacy → V1
    expect(c1.schema.safeParse({ path: "a.docx", document: canonicalDoc }).success).toBe(true);
    expect(c1.schema.safeParse({ path: "a.docx", document: draftDoc }).success).toBe(false);
    expect(u1.schema.safeParse({ artifactId: "a", expectedRevision: 1, document: canonicalDoc }).success).toBe(true);
    expect(u1.schema.safeParse({ artifactId: "a", expectedRevision: 1, document: draftDoc }).success).toBe(false);
  });

  it("version 2：create/update 暴露 Draft schema（canonical 被拒绝）", () => {
    const c2 = computerToolContractForVersion(createDef, 2);
    const u2 = computerToolContractForVersion(updateDef, 2);
    expect(c2.schema.safeParse({ path: "a.docx", document: draftDoc }).success).toBe(true);
    expect(c2.schema.safeParse({ path: "a.docx", document: canonicalDoc }).success).toBe(false);
    expect(u2.schema.safeParse({ artifactId: "a", expectedRevision: 1, document: draftDoc }).success).toBe(true);
    expect(u2.schema.safeParse({ artifactId: "a", expectedRevision: 1, document: canonicalDoc }).success).toBe(false);
  });

  it("V2.3: document protocol never oscillates between text and content（V2 模型永远看不到 content 路径）", () => {
    const c2 = computerToolContractForVersion(createDef, 2);
    // 任何 canonical 形状（content 数组）在 V2 协议下都失败 → server 不可能同时要求 text 与 content
    expect(c2.schema.safeParse({ path: "a.docx", document: { blocks: [{ type: "table", header: [[{ text: "a" }]], rows: [] }] } }).success).toBe(false);
  });
});

describe("Task 24: runtime dual compatibility parser", () => {
  const scheduleCanonical = {
    title: "本周课表",
    blocks: [
      {
        type: "table",
        header: [[{ text: "星期" }], [{ text: "课程" }], [{ text: "时间" }], [{ text: "地点" }]],
        rows: [[[{ text: "周一" }], [{ text: "数据结构与算法" }], [{ text: "08:00–09:40" }], [{ text: "计算机楼 102" }]]],
      },
    ],
  };
  const scheduleDraft = {
    title: "本周课表",
    blocks: [
      {
        type: "table",
        header: ["星期", "课程", "时间", "地点"],
        rows: [["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"]],
      },
    ],
  };

  it("V1 canonical → ok format canonical-v1（passthrough）", () => {
    const r = parseDocumentAuthoringInput(scheduleCanonical);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe("canonical-v1");
    expect(r.value.document.blocks[0]).toEqual(scheduleCanonical.blocks[0]);
  });

  it("V2 draft → ok format draft-v2（normalize 为 canonical）", () => {
    const r = parseDocumentAuthoringInput(scheduleDraft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe("draft-v2");
    expect(r.value.document.blocks[0]).toEqual(scheduleCanonical.blocks[0]);
  });

  it("两种输入 → 同一 canonical KiroDocument（语义一致）", () => {
    const a = parseDocumentAuthoringInput(scheduleCanonical);
    const b = parseDocumentAuthoringInput(scheduleDraft);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.document).toEqual(b.value.document);
  });

  it("都失败 → bounded issues（path + message，不 throw、不 echo 正文）", () => {
    const r = parseDocumentAuthoringInput({ blocks: [{ type: "table", header: 42 }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(r.issues)).not.toContain("神秘正文内容");
  });
});

describe("Task 25: 真实课表一次成功（safeParse → normalize → renderDocx → verifyRenderedDocx）", () => {
  it("V2 draft 课表全链路一次成功", async () => {
    const draft = {
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
    const parsed = parseDocumentAuthoringInput(draft);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const bytes = await renderDocx(parsed.value.document);
    expect(await verifyRenderedDocx(bytes, parsed.value.document)).toBe(true);
  });
});

describe("Task 26: tool outcome（Worklog 与 Activity 同一 helper）", () => {
  const okTrue = { ok: true, data: {} };
  const okFalse = { ok: false, code: "INVALID_INPUT" };

  it("resolveToolOutcomeStatus：output-available + ok:true → done；ok:false → error", () => {
    expect(resolveToolOutcomeStatus({ state: "output-available", output: okTrue })).toBe("done");
    expect(resolveToolOutcomeStatus({ state: "output-available", output: okFalse })).toBe("error");
    expect(resolveToolOutcomeStatus({ state: "output-error", output: undefined })).toBe("error");
    expect(resolveToolOutcomeStatus({ state: "streaming" })).toBe("working");
    expect(resolveToolOutcomeStatus({ state: undefined })).toBe("working");
  });

  it("liveTurnPresentation：output-available + ok:false → worklog tool block status error", () => {
    const p = deriveKiroAssistantTurn(
      [
        { type: "tool-create_document", toolCallId: "c1", state: "output-available", output: okFalse },
      ],
      false
    );
    const block = p.worklog[0];
    expect(block?.kind === "tool" && block.status).toBe("error");
  });

  it("deriveActivity：output-available + ok:false → step status error（与 Worklog 一致）", () => {
    const activity = deriveActivity(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "生成文档" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "tool-create_document", toolCallId: "c1", state: "output-available", output: okFalse }],
        },
      ],
      "ready"
    );
    expect(activity.steps[0].status).toBe("error");
    // 对照：ok:true → done
    const okActivity = deriveActivity(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "生成文档" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "tool-create_document", toolCallId: "c1", state: "output-available", output: okTrue }],
        },
      ],
      "ready"
    );
    expect(okActivity.steps[0].status).toBe("done");
  });
});

describe("Task 27: text-file binary guard", () => {
  it("schema 层：create_text_file / patch_text_file 拒绝结构化二进制扩展名", () => {
    for (const p of ["report.docx", "report.DOCX", "slides.pptx", "paper.pdf", "data.xlsx"]) {
      expect(createTextFileSchema.safeParse({ path: p, content: "x" }).success).toBe(false);
      expect(patchTextFileSchema.safeParse({ path: p, edits: [{ oldText: "a", newText: "b" }] }).success).toBe(false);
    }
    expect(createTextFileSchema.safeParse({ path: "notes.md", content: "x" }).success).toBe(true);
    expect(createTextFileSchema.safeParse({ path: "data.csv", content: "x" }).success).toBe(true);
    expect(patchTextFileSchema.safeParse({ path: "notes.md", edits: [{ oldText: "a", newText: "b" }] }).success).toBe(true);
  });

  it("runtime 层：executor 返回 UNSUPPORTED_FILE_TYPE（不执行 IO）", async () => {
    const REF = "sandbox-fuse-ref";
    await clearSandboxAdapter(REF);
    const snap: KiroComputerTurnSnapshot = { enabled: true, workspaceId: "ws", agentMode: "workspace-auto", roots: [{ id: "output", label: "输出", access: "read-write" }] };
    const ws: KiroWorkspaceMeta = { id: "ws", name: "w", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: REF }] };
    const attempt = await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "c1",
      toolInput: { path: "report.docx", content: "fake word" },
      context: { turnSnapshot: snap, liveWorkspaces: [ws], livePermissionRules: [] },
      counters: { readCount: 0, mutationCount: 0 },
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code?: string }).code).toBe("UNSUPPORTED_FILE_TYPE");
    // 未产生文件
    const adapter = (await import("@/lib/ai/computer/executor")).getComputerAdapterForAdapterRef(REF);
    expect(await adapter.stat("report.docx")).toBeNull();
  });
});

describe("Task 28: failure fuse", () => {
  const fail = (code: string) => ({ ok: false, code });
  const ok = { ok: true };

  it("derive：1st INVALID_INPUT → not blocked；2nd → blocked", () => {
    const mk = (codes: string[]) => [
      { role: "user", parts: [] },
      {
        role: "assistant",
        parts: codes.map((c, i) => ({ type: "tool-create_document", state: "output-available", output: fail(c) })),
      },
    ];
    expect(deriveDocumentFailureFuseState(mk(["INVALID_INPUT"]) as unknown[])).toMatchObject({ schemaFailures: 1, blocked: false });
    expect(deriveDocumentFailureFuseState(mk(["INVALID_INPUT", "INVALID_INPUT"]) as unknown[])).toMatchObject({ schemaFailures: 2, blocked: true });
    // schemaFailures > DOCUMENT_SCHEMA_RETRY_LIMIT 才 blocked（初始调用 + 最多 1 次修正）
    expect(DOCUMENT_SCHEMA_RETRY_LIMIT).toBe(1);
  });

  it("derive：1st VERIFICATION_FAILED → blocked immediately", () => {
    const s = deriveDocumentFailureFuseState([
      { role: "user", parts: [] },
      { role: "assistant", parts: [{ type: "tool-create_document", state: "output-available", output: fail("VERIFICATION_FAILED") }] },
    ] as never[]);
    expect(s.hardFailure).toBe(true);
    expect(s.blocked).toBe(true);
  });

  it("derive：USER_CANCELLED / RESOURCE_ALREADY_EXISTS 不计入", () => {
    const s = deriveDocumentFailureFuseState([
      { role: "user", parts: [] },
      {
        role: "assistant",
        parts: [
          { type: "tool-create_document", state: "output-available", output: fail("USER_CANCELLED") },
          { type: "tool-create_document", state: "output-available", output: fail("RESOURCE_ALREADY_EXISTS") },
        ],
      },
    ] as never[]);
    expect(s.schemaFailures).toBe(0);
    expect(s.blocked).toBe(false);
  });

  it("advance：schema 失败 1 次可 retry；第 2 次 blocked；硬失败首次 blocked", () => {
    const s = { schemaFailures: 0, hardFailure: false, blocked: false };
    expect(advanceDocumentFailureFuse(s, fail("INVALID_INPUT"))).toBe(false);
    expect(advanceDocumentFailureFuse(s, fail("INVALID_INPUT"))).toBe(true);
    expect(s.blocked).toBe(true);

    const s2 = { schemaFailures: 0, hardFailure: false, blocked: false };
    expect(advanceDocumentFailureFuse(s2, fail("VERIFICATION_FAILED"))).toBe(true);

    const s3 = { schemaFailures: 0, hardFailure: false, blocked: false };
    expect(advanceDocumentFailureFuse(s3, fail("USER_CANCELLED"))).toBe(false);
    expect(s3.schemaFailures).toBe(0);
    expect(advanceDocumentFailureFuse(s3, ok)).toBe(false);
  });
});
