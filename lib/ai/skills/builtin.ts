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

const TIMETABLE_ANALYSIS_INSTRUCTIONS = `\
# 课表解读（内置）

当用户问课表、有没有空、时间冲突、第几周、某节课在几点时，按以下流程处理。

## 1. 先锚定学期与时间

- 用 get_semester_config 确认当前教学周与本周起始日；不要猜测周数。
- 节次换算（如“第三节是几点”）用 get_bell_schedules 读取当前激活模板。

## 2. 读取课表事实

- 用 get_week_schedule 查看目标教学周的生效课表（默认当前周；正确处理单双周）。
- 课程简称（如“计网”）先用 search_courses / get_course 做唯一匹配，歧义先询问用户，不要猜。
- 跨天或带截止的安排用 get_calendar_range 补全（课程/DDL/考试/活动）。

## 3. 回答空闲与冲突

- 找空闲时段一律用 get_available_time（自动排除课程、考试与已有学习计划），不要自己推算。
- 判断哪天最挤用 get_calendar_density；只陈述工具返回的事实，不要编造课程。
`;

const TIMETABLE_ANALYSIS_DESCRIPTION =
  "解读课表与时间安排：教学周锚点、节次换算、空闲时段查询与日期密度分析。";

const TASK_TRIAGE_INSTRUCTIONS = `\
# 任务梳理（内置）

当用户问 DDL、任务优先级、来不及、梳理任务时，按以下流程处理。

## 1. 拉取真实任务

- 用 get_upcoming_assignments 查看临近截止任务（默认 7 天），逾期单独标记。
- 需要详情用 get_assignment 读取完整信息；任务可能没有截止时间（合法状态），不要催促不存在的 DDL。
- 任务名模糊时用 search_assignments 匹配，多个候选先询问用户，不要猜。

## 2. 判断轻重缓急

- 用 get_assignment_health 做确定性判断（safe / attention / at-risk / overdue / unscheduled）；
  这是规则计算结果，不是 AI 估计，原样转述，不要夸大。
- 复杂任务用 propose_task_breakdown 拆成 2–8 个可执行阶段（调用前必须先 get_assignment；
  这是建议，需用户确认后才生效，绝不直接写入）。

## 3. 落定

- 改优先级/状态/截止用 set_assignment_priority / set_assignment_status / set_assignment_ddl。
- 需要提醒用 create_reminder；只做用户明确要求的操作，不要顺手多做。
`;

const TASK_TRIAGE_DESCRIPTION =
  "梳理任务与 DDL：临近截止盘点、健康度判断、任务拆解与优先级调整。";

const STUDY_PLAN_INSTRUCTIONS = `\
# 学习计划（内置）

当用户要制定复习/备考/学习计划时，按以下流程处理。

## 1. 先问清目标（缺信息就问，不要假设）

- 覆盖哪几门课程或哪几个任务、截止时间、每天可投入时长。

## 2. 用工具生成建议，不要手编时间

- 用 propose_study_plan 为任务生成排程建议（只补预计耗时缺口；overdue 任务不安排）。
- 空闲核对用 get_available_time；已有安排用 query_study_blocks 查看，避免重复排块。
- propose_* 只是建议：向用户展示后经确认才生效，绝不声称已写入课表。

## 3. 调整与复盘

- 计划跟不上时用 propose_study_rebalance 重新平衡，而不是推倒重来。
- 引用具体日期与时间段；已过日期绝不安排。
`;

const STUDY_PLAN_DESCRIPTION =
  "制定学习计划：按目标与空闲生成排程建议、复盘再平衡（建议经确认后生效）。";

const FOCUS_COACH_INSTRUCTIONS = `\
# 专注陪伴（内置）

当用户要专注、番茄计时、学习打卡时，按以下流程处理。

## 1. 先看状态再行动

- 用 get_focus_status 查看当前是否有进行中的专注会话；有则先说明剩余/已专注时间，不要重复开始。
- 开始前确认时长与关联任务/课程（缺信息就问一句，不要假设 25 分钟）。

## 2. 计时控制

- 用 start_focus_session 开始、pause_focus_session 暂停、resume_focus_session 恢复、
  finish_focus_session 结束；一次只进行一个会话。
- 用户说“休息一下”且有关联会话时用暂停而不是结束；结束后再用 get_focus_analytics 或
  list_focus_sessions 做简短复盘（专注时长、完成情况），不要长篇说教。
`;

const FOCUS_COACH_DESCRIPTION =
  "专注计时陪伴：番茄会话的开始/暂停/恢复/结束与简短复盘。";

/** 内置 Skill 名称保留字：用户创建/导入同名 Skill 时拒绝（保证单一事实来源） */
export const BUILTIN_SKILL_NAMES: readonly string[] = [
  "document-handling",
  "timetable-analysis",
  "task-triage",
  "study-plan",
  "focus-coach",
] as const;

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
  {
    name: "timetable-analysis",
    description: TIMETABLE_ANALYSIS_DESCRIPTION,
    folderName: "__builtin__/timetable-analysis",
    enabled: true,
    instructions: TIMETABLE_ANALYSIS_INSTRUCTIONS.trim(),
    rawContent: TIMETABLE_ANALYSIS_INSTRUCTIONS.trim(),
    triggers: ["课表", "空闲", "有空", "第几周", "时间冲突", "哪天有空", "节次", "几点上课"],
    metadata: {
      builtin: true,
      capabilities: ["get_week_schedule", "get_semester_config", "get_bell_schedules", "get_calendar_range", "get_calendar_density", "get_available_time"],
    },
    permissionsNote: SKILL_PERMISSIONS_NOTE,
  },
  {
    name: "task-triage",
    description: TASK_TRIAGE_DESCRIPTION,
    folderName: "__builtin__/task-triage",
    enabled: true,
    instructions: TASK_TRIAGE_INSTRUCTIONS.trim(),
    rawContent: TASK_TRIAGE_INSTRUCTIONS.trim(),
    triggers: ["DDL", "ddl", "任务", "优先级", "来不及", "梳理", "逾期", "拆解"],
    metadata: {
      builtin: true,
      capabilities: ["get_upcoming_assignments", "search_assignments", "get_assignment", "get_assignment_health", "propose_task_breakdown", "set_assignment_priority", "create_reminder"],
    },
    permissionsNote: SKILL_PERMISSIONS_NOTE,
  },
  {
    name: "study-plan",
    description: STUDY_PLAN_DESCRIPTION,
    folderName: "__builtin__/study-plan",
    enabled: true,
    instructions: STUDY_PLAN_INSTRUCTIONS.trim(),
    rawContent: STUDY_PLAN_INSTRUCTIONS.trim(),
    triggers: ["学习计划", "备考", "复习计划", "怎么学", "复习", "计划表"],
    metadata: {
      builtin: true,
      capabilities: ["propose_study_plan", "query_study_blocks", "get_available_time", "propose_study_rebalance"],
    },
    permissionsNote: SKILL_PERMISSIONS_NOTE,
  },
  {
    name: "focus-coach",
    description: FOCUS_COACH_DESCRIPTION,
    folderName: "__builtin__/focus-coach",
    enabled: true,
    instructions: FOCUS_COACH_INSTRUCTIONS.trim(),
    rawContent: FOCUS_COACH_INSTRUCTIONS.trim(),
    triggers: ["专注", "番茄", "计时", "学习打卡", "休息一下", "集中注意力"],
    metadata: {
      builtin: true,
      capabilities: ["get_focus_status", "start_focus_session", "pause_focus_session", "resume_focus_session", "finish_focus_session", "get_focus_analytics", "list_focus_sessions"],
    },
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
