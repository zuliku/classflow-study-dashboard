import { describe, it, expect } from "vitest";
import { routeAttachment, kindToMaterialType } from "@/lib/ai/attachments/router";
import { extractXlsx, extractXlsxRawText } from "@/lib/ai/attachments/xlsx";
import { extractPptx, extractPptxRawText, unescapeXmlText } from "@/lib/ai/attachments/pptx";
import { extractAttachment } from "@/lib/ai/attachments";
import { resolveMaterialKind } from "@/lib/ai/tools/read/material";
import { buildMinimalXlsx, buildMinimalPptx } from "@/tests/fixtures/files";
import { BUILTIN_SKILLS, withBuiltinSkills, assertNotBuiltinSkillName } from "@/lib/ai/skills/builtin";
import { activateSkill, assertSkillCannotElevate } from "@/lib/ai/skills/activation";
import { validateSkillName } from "@/lib/ai/skills/validator";

const fileOf = (name: string, type: string, content: BlobPart[]): File => {
  const blob = new Blob(content, { type });
  Object.defineProperty(blob, "name", { value: name });
  Object.defineProperty(blob, "lastModified", { value: 1700000000000 });
  return blob as File;
};

describe("表格提取（XLSX/XLS）", () => {
  it("多工作表：节标题 + Tab 分隔 + 空行丢弃", async () => {
    const blob = await buildMinimalXlsx({
      成绩: [
        ["姓名", "分数"],
        ["张三", 95],
        ["李四", 88],
      ],
      空表: [],
    });
    const raw = await extractXlsxRawText(blob);
    expect(raw).toContain("## 工作表：成绩");
    expect(raw).toContain("姓名\t分数");
    expect(raw).toContain("张三\t95");
    expect(raw).not.toContain("## 工作表：空表");
  });

  it("bounded extraction 复用 100k 语义", async () => {
    const blob = await buildMinimalXlsx({ 数据: [["ok"]] });
    const r = await extractXlsx(blob);
    expect(r.text).toContain("ok");
    expect(r.truncated).toBe(false);
  });

  it("空工作簿抛错（走统一失败文案，不伪造内容）", async () => {
    const blob = await buildMinimalXlsx({ 空表: [] });
    await expect(extractXlsx(blob)).rejects.toThrow();
  });
});

describe("幻灯片提取（PPTX）", () => {
  it("多页：页序 + 文本 + XML 反转义", async () => {
    const blob = await buildMinimalPptx([
      ["第一章 绪论", "本章目标"],
      ["a < b & c"],
    ]);
    const raw = await extractPptxRawText(blob);
    expect(raw).toContain("【幻灯片 1】");
    expect(raw).toContain("第一章 绪论");
    expect(raw).toContain("【幻灯片 2】");
    expect(raw).toContain("a < b & c");
  });

  it("bounded extraction 输出 pages[] + pageCount（与 PDF 同形状）", async () => {
    const blob = await buildMinimalPptx([["标题"], ["第二页正文"]]);
    const r = await extractPptx(blob);
    expect(r.pages?.length).toBe(2);
    expect(r.pages?.[0]).toEqual({ page: 1, text: "标题" });
    expect(r.pageCount).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it("无幻灯片 part / 全空页抛错", async () => {
    const notZip = fileOf("a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", ["not a zip"]);
    await expect(extractPptx(notZip)).rejects.toThrow();
    const empty = await buildMinimalPptx([[]]);
    await expect(extractPptx(empty)).rejects.toThrow();
  });

  it("unescapeXmlText：五种实体 + 数字引用", () => {
    expect(unescapeXmlText("a&lt;b&gt;c&amp;d&quot;e&apos;f")).toBe(`a<b>c&d"e'f`);
    expect(unescapeXmlText("&#20013;&#x6587;")).toBe("中文");
  });
});

describe("路由：新格式 + legacy 明确拒绝", () => {
  it("xlsx/xls/pptx/csv 按扩展名与 MIME 路由", () => {
    expect(routeAttachment({ name: "a.xlsx", type: "", size: 10 })).toEqual({ ok: true, kind: "spreadsheet" });
    expect(routeAttachment({ name: "a.xls", type: "", size: 10 })).toEqual({ ok: true, kind: "spreadsheet" });
    expect(routeAttachment({ name: "a.pptx", type: "", size: 10 })).toEqual({ ok: true, kind: "slides" });
    expect(routeAttachment({ name: "a.csv", type: "", size: 10 })).toEqual({ ok: true, kind: "text" });
    expect(
      routeAttachment({
        name: "a",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 10,
      })
    ).toEqual({ ok: true, kind: "spreadsheet" });
    expect(
      routeAttachment({
        name: "a",
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: 10,
      })
    ).toEqual({ ok: true, kind: "slides" });
  });

  it("旧版二进制（.doc/.ppt）→ legacy（扩展名优先于 MIME）；.xls 走 SheetJS", () => {
    for (const name of ["a.doc", "c.ppt"]) {
      const r = routeAttachment({ name, type: "", size: 10 });
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason, name).toBe("legacy");
    }
    // .ppt 即使 MIME 与 pptx 同族也被拦截
    const r = routeAttachment({ name: "c.ppt", type: "application/vnd.ms-powerpoint", size: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("legacy");
    // .xls 为 OLE 但 SheetJS 可读 → spreadsheet
    expect(routeAttachment({ name: "b.xls", type: "", size: 10 })).toEqual({ ok: true, kind: "spreadsheet" });
  });

  it("新 kind 大小限制 20MB", () => {
    expect(routeAttachment({ name: "a.xlsx", type: "", size: 20 * 1024 * 1024 }).ok).toBe(true);
    expect(routeAttachment({ name: "a.xlsx", type: "", size: 21 * 1024 * 1024 }).ok).toBe(false);
    expect(routeAttachment({ name: "a.pptx", type: "", size: 20 * 1024 * 1024 }).ok).toBe(true);
    expect(routeAttachment({ name: "a.pptx", type: "", size: 21 * 1024 * 1024 }).ok).toBe(false);
  });

  it("kind → Material.type：spreadsheet→doc，slides→ppt", () => {
    expect(kindToMaterialType("spreadsheet")).toBe("doc");
    expect(kindToMaterialType("slides")).toBe("ppt");
  });
});

describe("extractAttachment 一体化：新 kind + legacy 文案", () => {
  it("xlsx/pptx 端到端提取", async () => {
    const xlsx = await buildMinimalXlsx({ 表: [["姓名", "分数"], ["王五", 100]] });
    Object.defineProperty(xlsx, "name", { value: "成绩.xlsx" });
    const r1 = await extractAttachment(xlsx as File, { kind: "spreadsheet" });
    expect(r1.ok && r1.extracted.text).toContain("王五\t100");

    const pptx = await buildMinimalPptx([["课程介绍"]]);
    Object.defineProperty(pptx, "name", { value: "介绍.pptx" });
    const r2 = await extractAttachment(pptx as File, { kind: "slides" });
    expect(r2.ok && r2.extracted.text).toContain("课程介绍");
  });

  it("legacy 走明确指引文案", async () => {
    const file = fileOf("旧课件.ppt", "", ["x"]);
    const r = await extractAttachment(file, { kind: "slides" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("legacy");
      expect(r.message).toContain(".pptx");
    }
  });
});

describe("材料 kind 消歧（type + 标题扩展名 + MIME）", () => {
  it("ppt 类型：pptx 可读，ppt 明确拒绝", () => {
    expect(resolveMaterialKind("ppt", "课件.pptx", "")).toBe("slides");
    expect(resolveMaterialKind("ppt", "旧课件.ppt", "")).toBeNull();
  });

  it("doc 类型：xlsx/pptx/txt 按扩展名分流", () => {
    expect(resolveMaterialKind("doc", "成绩.xlsx", "")).toBe("spreadsheet");
    expect(resolveMaterialKind("doc", "旧表.xls", "")).toBe("spreadsheet");
    expect(resolveMaterialKind("doc", "讲义.pptx", "")).toBe("slides");
    expect(resolveMaterialKind("doc", "笔记.txt", "")).toBe("text");
    expect(resolveMaterialKind("doc", "数据.csv", "")).toBe("text");
    expect(resolveMaterialKind("doc", "旧文档.doc", "")).toBeNull();
    expect(resolveMaterialKind("doc", "正文.docx", "")).toBe("docx");
    // 无扩展名时 MIME 兜底
    expect(resolveMaterialKind("doc", "无名", "text/plain")).toBe("text");
    expect(resolveMaterialKind("doc", "无名", "")).toBe("docx");
  });

  it("pdf/image 原样", () => {
    expect(resolveMaterialKind("pdf", "a.pdf", "")).toBe("pdf");
    expect(resolveMaterialKind("image", "a.png", "")).toBe("image");
    expect(resolveMaterialKind("link", "a", "")).toBeNull();
  });
});

describe("内置 document-handling Skill", () => {
  it("包形状合法：命名规范 + 有描述与正文", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(1);
    const doc = BUILTIN_SKILLS.find((s) => s.name === "document-handling")!;
    expect(doc).toBeDefined();
    expect(doc.enabled).toBe(true);
    expect(doc.description.length).toBeGreaterThan(10);
    expect(doc.instructions).toContain("read_material");
    expect(doc.instructions).toContain("read_project_file");
    expect(doc.instructions).toContain("search_project_file");
    expect(doc.instructions).toContain(".pptx");
    expect(doc.instructions).toContain(".xlsx");
  });

  it("instructions 无提权表述（与 Skill 安全红线一致）", () => {
    for (const s of BUILTIN_SKILLS) {
      expect(assertSkillCannotElevate(s.instructions).ok, s.name).toBe(true);
    }
  });

  it("withBuiltinSkills：追加内置 + 同名用户版优先 + 用户 enabled 保留", () => {
    const user = [
      { name: "a", description: "d", instructions: "i", rawContent: "r", folderName: "a", enabled: false },
    ];
    const merged = withBuiltinSkills(user as never);
    expect(merged.map((m) => m.name)).toContain("document-handling");
    expect(merged.find((m) => m.name === "a")!.enabled).toBe(false);
    // 同名用户版优先
    const clash = withBuiltinSkills([
      { name: "document-handling", description: "mine", instructions: "i", rawContent: "r", folderName: "document-handling", enabled: true },
    ] as never);
    expect(clash.filter((m) => m.name === "document-handling")).toHaveLength(1);
    expect(clash[0].description).toBe("mine");
  });

  it("activateSkill 可激活内置 skill", () => {
    const merged = withBuiltinSkills([]);
    const r = activateSkill(merged, { skillName: "document-handling" });
    expect(r.ok).toBe(true);
    expect(r.instructions).toContain("read_material");
  });

  it("validator 拒绝新建/导入同名（保留名）", () => {
    expect(validateSkillName("document-handling").ok).toBe(false);
    expect(validateSkillName("document-handling").reason).toContain("RESERVED_NAME");
    expect(validateSkillName("course-notification").ok).toBe(true);
  });

  it("assertNotBuiltinSkillName 中英文案", () => {
    expect(assertNotBuiltinSkillName("document-handling").ok).toBe(false);
    expect(assertNotBuiltinSkillName("other").ok).toBe(true);
  });
});
