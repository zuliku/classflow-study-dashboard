/**
 * Builtin Workflow Skill：course-material-analysis（S2，升级自 document-handling）。
 *
 * 定位（§21）：教 Kiro 如何分析一组学习资料（总结 / 比较 / 考试重点 / 跨文档综合），
 * 而不是解释每个文件后缀怎么解析——具体 Parser contract 仍由 Core / Tool Result 决定。
 */
import { createBuiltinWorkflowSkill } from "@/lib/ai/skills/builtin/helper";

const DESCRIPTION =
  "分析一份或多份课程资料：定位相关证据、读取必要章节、跨文档综合并保留来源归属。适用于讲义、幻灯片、教材、PDF、表格或项目资料，当任务需要综合理解而不是简单查词时使用。";

const INSTRUCTIONS = `\
# Course Material Analysis

一组学习资料的分析方法论：先定位证据，再综合，并保留来源归属。单条 metadata 查询或简单查词直接用对应读取工具，不需要本流程。

## 1. 先定义证据问题

先确定用户真正想要的结果：总结、对比、考试重点、概念解释、数据提取，还是跨文档综合。
据此决定要读哪些资料与哪些章节，不要无差别读取全部资料。

## 2. 先定位，再深读

- 资料较多或较长时：先用 search_project_file / search_course_materials 定位相关章节，再做定向读取。
- 正文读取用 read_material（课程资料）或 read_project_file（项目资料）；用户当前消息里直接附加的文件正文已随消息给出，无需重复读取。
- 只有需要完整正文（总结、按作业要求分析、跨段落综合）时才深读；只问"有哪些资料"时读 metadata 即可。

## 3. 尊重来源结构

- PDF：分页读取，引用具体页码；正文被截断时不要声称已读完整份。
- 幻灯片：按页组织要点，不要把备注页当成正文。
- 表格：以单元格原值为准，缺失单元格不要脑补。
- 连续文档：按章节或段落引用，而不是虚构页码。
- 具体解析细节以工具返回的真实结构为准，不要凭文件后缀自行推断实现。

## 4. 跨来源综合

区分并明确表达：多来源共同支持的事实、仅单一来源支持的事实、来源之间的冲突、资料完全没有覆盖的部分。
不要把多个来源混成笼统的"资料都说了"。

## 5. 证据纪律

- 只基于实际读取到的内容回答；资料没有覆盖的问题，明确说没有。
- 扫描件（无文本层 / visualRequired）走真实视觉读取路径（read_project_visual），不要编造页面内容。
- 引用使用 ClassFlow 的来源标记与真实页码；引用密度克制，相邻句来自同一页时不重复。

## 6. 回答结构

复杂资料分析优先：结论或框架 → 关键证据 → 来源归属；必要时给出复习/使用建议。
不要逐文件流水账式复述。`;

export const COURSE_MATERIAL_ANALYSIS_SKILL = createBuiltinWorkflowSkill({
  name: "course-material-analysis",
  description: DESCRIPTION,
  instructions: INSTRUCTIONS,
  requiredTools: ["read_material", "read_project_file", "search_project_file", "read_project_visual"],
});
