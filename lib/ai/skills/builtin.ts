import type { SkillPackage } from "@/lib/ai/skills/types";
import { SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";

/**
 * 内置 Skills（随应用打包，免配置、默认启用）：
 * - 与用户 Skills 同一协议（catalog progressive disclosure + activate_skill）；
 * - 与用户 Skill 重名时用户版本优先（见 withBuiltinSkills 去重顺序）；
 * - instructions 只描述真实存在的工具与格式能力，不承诺未实现行为。
 */

const DOCUMENT_HANDLING_INSTRUCTIONS = `\
# 文档处理（内置）

当用户提到课件、讲义、表格、文档或点名 .pdf / .docx / .xlsx / .xls / .pptx / .csv / .txt / .md 附件时，按以下流程处理。

## 1. 读取正文（按资料位置二选一）

- 课程资料：先用 read_material 读取正文（参数 courseId + materialId）。
- Kiro 项目资料：用 read_project_file 读取正文（参数 projectFileId）。
- 用户在对话中直接附加的文件：正文已随消息给出，直接使用，无需再读。

## 2. 按格式理解内容结构

- PDF：正文按 [PAGE N] 分页，引用页码；扫描件（possiblyScanned / visualRequired）没有文本层，
  不要编造页码内容，改用 read_project_visual 按页读取。
- Word（.docx）：连续正文，没有页码概念，引用时描述章节或段落。
- 表格（.xlsx / .xls）：正文按 \`## 工作表：<表名>\` 分节，单元格 Tab 分隔；
  回答数值问题时以单元格原值为准，不要脑补缺失格；需要定位时用 search_project_file。
- 幻灯片（.pptx）：正文按【幻灯片 N】分节；备注页不读取，只依据幻灯片正文回答。
- CSV / 纯文本（.csv / .txt / .md）：原文即全部内容，直接使用。
- 旧版 Office（.doc / .xls / .ppt 二进制）：工具会明确拒绝，此时请用户另存为
  .docx / .xlsx / .pptx 后重试，不要尝试其他方式解析。

## 3. 长文档

- read_project_file 返回 truncated=true 时，用 search_project_file 做关键词定位，
  再用 read_project_file 精读相关部分；不要把截断后的部分正文当作全文下结论。
- search_project_file 是词法检索：用简洁、有区分度的关键词；零命中不等于正文不存在。

## 4. 输出要求

- 引用资料内容时注明来源（课程资料名 / 项目资料名 / 附件名，PDF 注明页码，幻灯片注明第几张）。
- 只基于读到的正文回答；超出正文的问题明确说明资料中没有，不要编造。
`;

const DOCUMENT_HANDLING_DESCRIPTION =
  "读取并理解课程资料与附件正文：PDF / Word / Excel 表格 / PPT 幻灯片 / CSV / 纯文本，含长文档检索与引用规范。";

/** 内置 Skill 名称保留字：用户创建/导入同名 Skill 时拒绝（保证单一事实来源） */
export const BUILTIN_SKILL_NAMES: readonly string[] = ["document-handling"] as const;

export const BUILTIN_SKILLS: SkillPackage[] = [
  {
    name: "document-handling",
    description: DOCUMENT_HANDLING_DESCRIPTION,
    folderName: "__builtin__/document-handling",
    enabled: true,
    instructions: DOCUMENT_HANDLING_INSTRUCTIONS.trim(),
    rawContent: DOCUMENT_HANDLING_INSTRUCTIONS.trim(),
    triggers: ["课件", "讲义", "表格", "幻灯片", "ppt", "excel", "word", "csv", "pdf", "讲义整理", "数据表"],
    metadata: { builtin: true, capabilities: ["read_material", "read_project_file", "search_project_file"] },
    permissionsNote: SKILL_PERMISSIONS_NOTE,
  },
];

/**
 * 用户 Skills + 内置 Skills 合并（catalog / activation 统一入口）：
 * - 内置始终启用（产品基础能力，非用户偏好；UI 以锁定态展示，不提供开关）；
 * - 同名时用户版本优先（validator 同时拒绝新建同名，避免歧义）。
 */
export function withBuiltinSkills(userPackages: SkillPackage[]): SkillPackage[] {
  const userNames = new Set(userPackages.map((p) => p.name));
  return [...userPackages, ...BUILTIN_SKILLS.filter((b) => !userNames.has(b.name))];
}

/** 用户新建/导入时：命中内置保留名则拒绝（错误文案供 UI 直接展示） */
export function assertNotBuiltinSkillName(name: string): { ok: true } | { ok: false; message: string } {
  if ((BUILTIN_SKILL_NAMES as readonly string[]).includes(name)) {
    return { ok: false, message: `“${name}”为系统内置 Skill 名称，请换一个名称。` };
  }
  return { ok: true };
}
