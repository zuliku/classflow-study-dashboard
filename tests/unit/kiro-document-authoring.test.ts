import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  kiroDocumentDraftSchema,
  KiroDocumentDraft,
} from "@/lib/ai/computer/documents/authoring/schema";
import {
  normalizeDocumentDraft,
  normalizeDraftStyleHints,
} from "@/lib/ai/computer/documents/authoring/normalize";
import { shouldRepairToolCall, KIRO_TOOL_CALL_REPAIR_MAX_INPUT_BYTES } from "@/lib/ai/computer/tools/repair";
import { InvalidToolInputError } from "ai";
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";

const simpleDraft: KiroDocumentDraft = {
  title: "研究总结",
  stylePreset: "academic-cn",
  blocks: [
    { type: "heading", level: 1, text: "研究背景" },
    { type: "paragraph", text: "这里是研究背景。" },
    { type: "bullet-list", items: ["复习第一章", "完成课程作业"] },
    { type: "numbered-list", items: ["准备数据", "运行模型"] },
    { type: "quote", text: "引用内容" },
    { type: "code", language: "stata", text: "reg y x1 x2" },
    { type: "page-break" },
  ],
};

describe("Draft schema（model-facing 扁平 DSL）", () => {
  it("simple paragraph Draft parses once", () => {
    const parsed = kiroDocumentDraftSchema.safeParse(simpleDraft);
    expect(parsed.success).toBe(true);
  });

  it("table: header string[] / rows string[][] parses once", () => {
    const parsed = kiroDocumentDraftSchema.safeParse({
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
    });
    expect(parsed.success).toBe(true);
  });

  it("invalid 3-level model table（cell 嵌套 [{text}]）被 Draft schema 拒绝", () => {
    const parsed = kiroDocumentDraftSchema.safeParse({
      blocks: [
        {
          type: "table",
          header: [[{ text: "星期" }], [{ text: "课程" }]],
          rows: [[[{ text: "周一" }], [{ text: "数据结构" }]]],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("cell 写成 object（row 内不是字符串）被拒绝", () => {
    const parsed = kiroDocumentDraftSchema.safeParse({
      blocks: [{ type: "table", header: ["a"], rows: [[{ text: "x" }]] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("styleHints 扁平字段合法；非法枚举拒绝", () => {
    const ok = kiroDocumentDraftSchema.safeParse({
      blocks: [],
      styleHints: { marginLeftCm: 3, heading1FontSizePt: 18, tableStyle: "three-line" },
    });
    expect(ok.success).toBe(true);
    const bad = kiroDocumentDraftSchema.safeParse({
      blocks: [],
      styleHints: { tableStyle: "fancy" },
    });
    expect(bad.success).toBe(false);
  });
});

describe("normalizeDocumentDraft（Draft → canonical KiroDocument）", () => {
  it("simple paragraph Draft → canonical inline exact", () => {
    const doc = normalizeDocumentDraft(simpleDraft);
    expect(doc.title).toBe("研究总结");
    expect(doc.stylePreset).toBe("academic-cn");
    expect(doc.blocks[0]).toEqual({ type: "heading", level: 1, content: [{ text: "研究背景" }] });
    expect(doc.blocks[1]).toEqual({ type: "paragraph", content: [{ text: "这里是研究背景。" }] });
    expect(doc.blocks[2]).toEqual({
      type: "bullet-list",
      items: [[{ text: "复习第一章" }], [{ text: "完成课程作业" }]],
    });
    expect(doc.blocks[3]).toEqual({
      type: "numbered-list",
      items: [[{ text: "准备数据" }], [{ text: "运行模型" }]],
    });
    expect(doc.blocks[4]).toEqual({ type: "quote", content: [{ text: "引用内容" }] });
    expect(doc.blocks[5]).toEqual({ type: "code", language: "stata", text: "reg y x1 x2" });
    expect(doc.blocks[6]).toEqual({ type: "page-break" });
  });

  it("table string Draft → canonical inline table exact", () => {
    const doc = normalizeDocumentDraft({
      blocks: [
        {
          type: "table",
          header: ["星期", "课程"],
          rows: [["周一", "数据结构"]],
        },
      ],
    });
    expect(doc.blocks[0]).toEqual({
      type: "table",
      header: [[{ text: "星期" }], [{ text: "课程" }]],
      rows: [[[{ text: "周一" }], [{ text: "数据结构" }]]],
    });
  });

  it("扁平 styleHints → canonical 嵌套 exact", () => {
    const hints = normalizeDraftStyleHints({
      density: "compact",
      heading1FontSizePt: 18,
      heading2FontSizePt: 14,
      marginTopCm: 2.5,
      marginLeftCm: 3,
      tableStyle: "grid",
    });
    expect(hints).toEqual({
      density: "compact",
      headingSizesPt: { h1: 18, h2: 14 },
      pageMarginsCm: { top: 2.5, left: 3 },
      tableStyle: "grid",
    });
  });

  it("normalize 结果通过 canonical schema（isKiroDocument）", () => {
    const doc = normalizeDocumentDraft(simpleDraft);
    expect(isKiroDocument(doc)).toBe(true);
  });
});

describe("bounded Tool Call Repair guard", () => {
  function invalidInputError(): InvalidToolInputError {
    return new InvalidToolInputError({ toolName: "create_document", toolInput: "{}", cause: new Error("bad") });
  }
  const noSuchError = new (class extends Error {})("no such tool") as unknown as Error;

  it("create/update + InvalidToolInputError → repair；一个 call 只修一次", () => {
    const already = new Set<string>();
    expect(
      shouldRepairToolCall({ error: invalidInputError(), toolName: "create_document", toolCallId: "c1", inputSizeBytes: 10, alreadyRepaired: already })
    ).toBe(true);
    already.add("c1");
    expect(
      shouldRepairToolCall({ error: invalidInputError(), toolName: "create_document", toolCallId: "c1", inputSizeBytes: 10, alreadyRepaired: already })
    ).toBe(false);
    expect(
      shouldRepairToolCall({ error: invalidInputError(), toolName: "update_document", toolCallId: "c2", inputSizeBytes: 10, alreadyRepaired: already })
    ).toBe(true);
  });

  it("NoSuchToolError / 其它 Tool / 超大 input → 不 repair", () => {
    const already = new Set<string>();
    expect(
      shouldRepairToolCall({ error: noSuchError, toolName: "create_document", toolCallId: "c1", inputSizeBytes: 10, alreadyRepaired: already })
    ).toBe(false);
    expect(
      shouldRepairToolCall({ error: invalidInputError(), toolName: "read_text", toolCallId: "c1", inputSizeBytes: 10, alreadyRepaired: already })
    ).toBe(false);
    expect(
      shouldRepairToolCall({
        error: invalidInputError(),
        toolName: "create_document",
        toolCallId: "c1",
        inputSizeBytes: KIRO_TOOL_CALL_REPAIR_MAX_INPUT_BYTES + 1,
        alreadyRepaired: already,
      })
    ).toBe(false);
  });
});

describe("Tool contract：inputExamples", () => {
  it("create_document 有两个合法 example；update_document 有一个；全部 safeParse 成功", () => {
    const create = COMPUTER_TOOLS.find((t) => t.name === "create_document");
    const update = COMPUTER_TOOLS.find((t) => t.name === "update_document");
    expect(create?.inputExamples?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(update?.inputExamples?.length ?? 0).toBeGreaterThanOrEqual(1);
    for (const example of create?.inputExamples ?? []) {
      const parsed = create!.schema.safeParse(example.input);
      expect(parsed.success).toBe(true);
    }
    for (const example of update?.inputExamples ?? []) {
      const parsed = update!.schema.safeParse(example.input);
      expect(parsed.success).toBe(true);
    }
  });

  it("create_document 的 table example 是真实课表结构（header string[] / rows string[][]）", () => {
    const create = COMPUTER_TOOLS.find((t) => t.name === "create_document");
    const tableExample = create?.inputExamples?.find((e) =>
      ((e.input.document as { blocks?: { type?: string }[] })?.blocks ?? []).some((b) => b.type === "table")
    );
    expect(tableExample).toBeDefined();
    const doc = tableExample!.input.document as { blocks: { type: string; header?: unknown; rows?: unknown }[] };
    const table = doc.blocks.find((b) => b.type === "table")!;
    expect(Array.isArray(table.header)).toBe(true);
    expect((table.header as unknown[]).every((h) => typeof h === "string")).toBe(true);
    expect(Array.isArray(table.rows)).toBe(true);
    expect(
      (table.rows as unknown[][]).every(
        (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")
      )
    ).toBe(true);
  });
});
