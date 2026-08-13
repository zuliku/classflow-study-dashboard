import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { z, toJSONSchema } from "zod";
import {
  kiroDocumentSchema,
  kiroInlineSchema,
  kiroDocumentBlockSchema,
} from "@/lib/ai/computer/documents/schema";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";
import { createDocumentSchema, updateDocumentSchema } from "@/lib/ai/computer/tools/schemas";
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { verifyDocxBytes } from "@/lib/ai/computer/documents/verify";
import { getArtifact, getArtifactSource, findArtifactByLocation } from "@/lib/ai/computer/artifacts/service";
import { clearSandboxAdapter } from "@/lib/ai/computer/adapters/sandbox";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";

const REF = "sandbox-doc-schema-ref";

const AUTO: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "ws-doc",
  agentMode: "workspace-auto",
  roots: [{ id: "output", label: "输出", access: "read-write" }],
};

const workspace: KiroWorkspaceMeta = {
  id: "ws-doc",
  name: "文档工作区",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: REF }],
};

const ctx = () => ({ turnSnapshot: AUTO, liveWorkspaces: [workspace], livePermissionRules: [] });
const counters = () => ({ readCount: 0, mutationCount: 0 });

const FULL_DOC = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "研究背景" }] },
    { type: "paragraph", content: [{ text: "正文" }, { text: "重点", bold: true }] },
    { type: "bullet-list", items: [[{ text: "项一" }], [{ text: "项二" }]] },
    { type: "numbered-list", items: [[{ text: "第一步" }]] },
    { type: "table", header: [[{ text: "变量" }], [{ text: "含义" }]], rows: [[[{ text: "x" }], [{ text: "值" }]]] },
    { type: "quote", content: [{ text: "引用" }] },
    { type: "code", language: "stata", text: "reg y x" },
    { type: "page-break" },
  ],
};

/** AI SDK zod → JSON Schema（实际 tool conversion path 的结构可见性验证；zod v4 toJSONSchema） */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return toJSONSchema(schema) as Record<string, unknown>;
}

beforeEach(async () => {
  await clearSandboxAdapter(REF);
});

describe("document IR schema source of truth", () => {
  it("合法完整 IR → success（heading/paragraph/lists/table/quote/code/page-break）", () => {
    expect(kiroDocumentSchema.safeParse(FULL_DOC).success).toBe(true);
  });

  it("非法 IR 全部拒绝（sections / level 5 / items 非数组 / header 非数组）", () => {
    expect(kiroDocumentSchema.safeParse({ title: "x", sections: [] }).success).toBe(false);
    expect(
      kiroDocumentSchema.safeParse({ blocks: [{ type: "heading", level: 5, content: [] }] }).success
    ).toBe(false);
    expect(
      kiroDocumentSchema.safeParse({ blocks: [{ type: "bullet-list", items: "wrong" }] }).success
    ).toBe(false);
    expect(
      kiroDocumentSchema.safeParse({ blocks: [{ type: "table", header: "wrong", rows: [] }] }).success
    ).toBe(false);
  });

  it("isKiroDocument 薄封装与 schema 一致", () => {
    expect(isKiroDocument(FULL_DOC)).toBe(true);
    expect(isKiroDocument({ blocks: [{ type: "unknown" }] })).toBe(false);
    expect(isKiroDocument({ title: "x", sections: [] })).toBe(false);
  });
});

describe("model-facing schema visibility", () => {
  it("create_document 暴露 document.title/blocks/type（discriminated blocks）而非 opaque unknown", () => {
    const json = toJsonSchema(createDocumentSchema);
    const props = (json.properties ?? {}) as Record<string, { properties?: Record<string, unknown>; description?: string }>;
    expect(props.document).toBeDefined();
    expect(props.document.description ?? "").toContain("KiroDocument");
    const docProps = props.document.properties ?? {};
    expect(docProps.blocks).toBeDefined();
    expect(docProps.title).toBeDefined();
    // block type 必须对模型可见
    const serialized = JSON.stringify(json);
    for (const blockType of ["heading", "paragraph", "bullet-list", "numbered-list", "table", "quote", "code", "page-break"]) {
      expect(serialized).toContain(blockType);
    }
    expect(serialized).not.toContain('"sections"');
  });

  it("update_document 与 create_document 使用同一 KiroDocument schema", () => {
    const upd = toJsonSchema(updateDocumentSchema);
    const cre = toJsonSchema(createDocumentSchema);
    expect((upd.properties as Record<string, unknown>).document).toEqual(
      (cre.properties as Record<string, unknown>).document
    );
  });

  it("inline schema 结构正确（text 必填；bold/italic 可选）", () => {
    expect(kiroInlineSchema.safeParse({ text: "a" }).success).toBe(true);
    expect(kiroInlineSchema.safeParse({ text: "a", bold: true }).success).toBe(true);
    expect(kiroInlineSchema.safeParse({ bold: true }).success).toBe(false);
  });

  it("block schema 是 discriminated union", () => {
    const json = toJsonSchema(kiroDocumentBlockSchema) as { discriminator?: unknown; oneOf?: unknown };
    expect(json.discriminator ?? json.oneOf).toBeTruthy();
  });
});

describe("executor INVALID_INPUT 可纠正摘要", () => {
  it("create_document 非法 IR → INVALID_INPUT 且 message 含字段路径（有界、无全文）", async () => {
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-doc-bad",
      toolInput: {
        rootId: "output",
        path: "bad.docx",
        document: { title: "x", sections: [] },
      },
      context: ctx(),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("INVALID_INPUT");
    const message = (attempt.output as { message: string }).message;
    expect(message).toContain("document");
    expect(message).not.toContain("sections"); // 不 echo 用户多余字段/正文
    expect(message.length).toBeLessThan(600);
  });
});

describe("create_document DOCX end-to-end runtime", () => {
  it("schema → executor → renderer → adapter → verifier → artifact（.docx）", async () => {
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-doc-docx",
      toolInput: { rootId: "output", path: "test.docx", document: FULL_DOC },
      context: ctx(),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    const output = attempt as { output: { data?: { path: string; format: string; verified: boolean } } };
    const data = output.output.data!;
    expect(data.format).toBe("docx");
    expect(data.verified).toBe(true);

    // adapter 层验证
    const { getComputerAdapterForAdapterRef } = await import("@/lib/ai/computer/executor");
    const io = getComputerAdapterForAdapterRef(REF);
    const stat = await io.stat("test.docx");
    expect(stat?.kind).toBe("file");
    const bytes = await io.readBytes("test.docx");
    expect(await verifyDocxBytes(bytes)).toBe(true);

    // Artifact + Source IR
    const artifact = await findArtifactByLocation("ws-doc", "output", "test.docx");
    expect(artifact?.type).toBe("docx");
    const source = await getArtifactSource(artifact?.id ?? "");
    expect(source?.revision).toBe(1);
    expect(source?.document.title).toBe("研究方案");
    const loaded = await getArtifact(artifact?.id ?? "");
    expect(loaded?.revision).toBe(1);
  });

  it("create_document 非法 block（items 非数组）在 renderer 前被拒绝", async () => {
    const attempt = await executeKiroComputerTool({
      toolName: "create_document",
      toolCallId: "call-doc-bad2",
      toolInput: {
        rootId: "output",
        path: "bad.md",
        document: { blocks: [{ type: "bullet-list", items: "wrong" }] },
      },
      context: ctx(),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("INVALID_INPUT");
  });
});

describe("registry tool schema wiring", () => {
  it("create_document / update_document 注册的 schema 就是真实 KiroDocument schema", () => {
    const createDef = COMPUTER_TOOLS.find((t) => t.name === "create_document");
    const updateDef = COMPUTER_TOOLS.find((t) => t.name === "update_document");
    expect(createDef?.schema).toBe(createDocumentSchema);
    expect(updateDef?.schema).toBe(updateDocumentSchema);
    expect(createDef?.description).toContain("KiroDocument");
    expect(updateDef?.description).toContain("与 create_document 完全相同");
  });
});
