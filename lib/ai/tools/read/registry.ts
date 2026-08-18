import { tool } from "ai";
import { KIRO_READ_TOOL_SCHEMAS } from "@/lib/ai/tools/read/schemas";

/**
 * Read Tool 唯一注册表（Server 提供 schema / Client 按同名执行）。
 * Read Tools 没有 server execute：只向 Browser 发 Tool Call，由 Client Executor 执行。
 * 后续 Write Tools 复用同一注册机制。
 */
export const KIRO_READ_TOOLS = {
  get_current_context: tool({
    description: "了解当前 ClassFlow 页面与选中对象（当前教学周、当前课程、当前任务、当前时间）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_current_context,
  }),
  get_user_study_profile: tool({
    description: "读取用户的学习档案（姓名、学院、年级、学分进度）。不包含学号等敏感信息。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_user_study_profile,
  }),
  search_courses: tool({
    description: "按名称/代码/教师搜索课程。多个匹配时全部返回候选，不得猜测唯一对象。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_courses,
  }),
  get_course: tool({
    description: "读取指定课程的详细信息（基本信息、排课摘要、资料 metadata）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_course,
  }),
  get_week_schedule: tool({
    description: "查看某教学周的生效课表（默认当前周；正确处理单双周/excludedWeeks）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_week_schedule,
  }),
  search_assignments: tool({
    description:
      "按关键词/课程/状态/截止范围搜索任务，也支持 Task V2 action scope（focus/today/upcoming/at-risk/unscheduled/all/archive）。" +
      "today = 今天截止 或 今天安排了学习计划（Do Date ≠ Due Date）；at-risk = Deadline Health 判定为可能来不及或已逾期的任务；unscheduled = 未完成且无任何学习计划的任务（可能没有截止时间）。多个匹配时全部返回候选。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_assignments,
  }),
  get_assignment: tool({
    description:
      "读取指定任务的完整学习信息（描述、截止时间、预计耗时、状态、子任务、已安排的 StudyBlock 与计划分钟数）。" +
      "任务可能没有截止时间（deadline 为 null，这是合法状态）。只读，不修改。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_assignment,
  }),
  get_assignment_schedule: tool({
    description:
      "查看某任务已经安排的 StudyBlock 学习计划（计划日期/时间段/来源）与累计计划分钟数（scheduledMinutes）。" +
      "不要让模型遍历整个日历推算；本工具直接返回确定性结果。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_assignment_schedule,
  }),
  get_assignment_health: tool({
    description:
      "判断某任务的 Deadline Health（确定性规则，非 AI 估计）：safe / attention / at-risk / overdue / unscheduled / unknown。" +
      "任务没有截止时间或没有预计耗时会返回 unknown（合法状态）。返回截止前已安排分钟数、缺口分钟数与截止前可用空闲分钟数。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_assignment_health,
  }),
  get_available_time: tool({
    description:
      "查询日期范围内的可用学习时间（自动排除生效课程、考试/固定活动、已有学习计划；08:00–21:00 窗口；不返回过去时间）。" +
      "可选 beforeDeadlineOfAssignmentId：终点自动不超过该任务 Deadline（Deadline 当天最多到 Deadline 时刻）。" +
      "不要让模型自己推算空闲时段，一律使用本工具。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_available_time,
  }),
  propose_study_plan: tool({
    description:
      "为任务生成学习计划建议（确定性：Deadline 越早越优先，其次优先级；只补预计耗时缺口；通常生成 30–90 分钟学习块，为精确匹配短任务或不可避免的尾段，最终块可能短于 30 分钟；overdue 任务不安排）。" +
      "这是 READ / PROPOSAL 工具，绝不写入 Store、绝不创建 StudyBlock；结果只是建议，用户确认后未来才会真正写入。" +
      "生成排程建议必须优先使用本工具，不要让模型自己编造时间。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.propose_study_plan,
  }),
  get_upcoming_assignments: tool({
    description: "查看未来 N 天内截止的任务（默认 7 天），按 DDL 升序，默认排除已完成，逾期单独标记。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_upcoming_assignments,
  }),
  search_group_projects: tool({
    description: "按关键词/课程搜索小组项目。多个匹配时全部返回候选。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_group_projects,
  }),
  get_group_project: tool({
    description: "读取小组项目详情（成员与任务；不包含头像，未分配成员为 null，不得猜成员）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_group_project,
  }),
  get_group_tasks: tool({
    description: "按条件查看小组项目中的任务（可指定成员/完成状态）。DDL 为本地时间，不做时区转换。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_group_tasks,
  }),
  get_calendar_range: tool({
    description: "查看日期范围内（最长 90 天）的日历标记（课程/DDL/考试/活动）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_calendar_range,
  }),
  get_material_metadata: tool({
    description: "查看课程资料的 metadata（标题/类型/大小/日期）。不能读取文件正文。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_material_metadata,
  }),
  read_material: tool({
    description:
      "读取课程资料的正文内容（PDF/DOCX/TXT 本地提取；图片无文本）。扫描 PDF 会明确说明。只读取明确指定的资料，不要无差别读取全部附件。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.read_material,
  }),
  read_project_file: tool({
    description:
      "读取当前 Kiro 项目中明确指定资料的正文。只能读取当前 Turn 的项目资料索引中存在的 projectFileId。PDF/DOCX/TXT/Markdown 使用本地提取；扫描型 PDF 会明确说明暂不读取图像正文。PDF 可带 pages 精确读取指定页正文（长文档后半部分使用）。不要无差别遍历全部项目资料；需要正文时按需读取。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.read_project_file,
  }),
  search_project_file: tool({
    description:
      "在当前 Kiro Project 的指定资料全文中进行本地关键词检索。适用于长文档、read_project_file 返回 truncated=true，或需要定位某个概念/章节/数据所在位置时。PDF 返回匹配页码与片段；TXT/DOCX 返回匹配片段。这是词法检索而非语义搜索，优先使用简洁、具有区分度的关键词。扫描型或没有可用文本层的 PDF 无法进行关键词检索，工具会明确返回 NOT_SEARCHABLE；此时应使用 read_project_visual，而不能把零命中解释为正文不存在。不要无差别搜索所有 Project Files。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_project_file,
  }),
  read_project_visual: tool({
    description:
      "读取当前 Kiro 项目中的图片或 PDF 页面视觉内容。图片可直接读取。扫描 PDF 可用于读取图像正文。普通 PDF 应优先使用 read_project_file 读取文本；仅在需要理解图表、图片、示意图或页面布局时使用本工具，并指定明确页码。不要用 Vision 替代普通 PDF 文本读取。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.read_project_visual,
  }),
  propose_task_breakdown: tool({
    description:
      "提交任务拆解 + 估时建议（结构化 Proposal，AI 推理 + 严格 schema；不是 Markdown 列表）。" +
      "调用前必须先 get_assignment 获取任务完整信息（标题/说明/课程/截止/已有子任务/预计耗时）；用户明确要求根据课程资料拆解时才先 read_material。" +
      "subtasks 拆成 2–8 个有意义的可执行阶段，不做微动作；每步可带 estimatedMinutes。" +
      "suggestedEstimatedMinutes 是 AI 估计（source=ai-estimate），不是已写入数据。" +
      "本工具是 READ / PROPOSAL：绝不写入 Store，绝不修改 Subtasks 或 estimatedMinutes；只有用户确认 Apply 后才会写入。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.propose_task_breakdown,
  }),
  list_reminders: tool({
    description:
      "查询 ClassFlow 提醒。默认返回尚未触发的 scheduled reminders（triggerAt 升序，最早的在前），可按目标、状态与时间范围筛选。" +
      "修改或删除提醒前应先使用本工具获取真实 reminderId；不要读取整个 Store 后自行筛选 Reminder。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.list_reminders,
  }),
  get_focus_status: tool({
    description:
      "查看当前 Focus 专注会话状态。无进行中的会话 → active:false；有 → 返回剩余/已专注时间（由 ClassFlow 计算，不要自己推算时间）、关联任务或课程与备注。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_focus_status,
  }),
  query_learning_history: tool({
    description:
      "查询本地学习历史原始事件（任务创建/完成/重开/DDL 变更、学习计划、专注完成、课程/课表变更等），支持按时间/事件类型/课程/任务/来源筛选。只读本地历史，不读取当前状态。" +
      "优先：具体问题（我上周完成了哪些任务？什么时候改过某课的 DDL？）使用本工具。默认最近 30 天，最长 90 天；更长范围请用 summarize_learning_history。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.query_learning_history,
  }),
  summarize_learning_history: tool({
    description:
      "汇总本地学习历史（专注完成分钟数、任务创建/完成/重开、学习计划、课程/课表变化），支持按天/教学周/课程分组。返回确定性汇总，不要自己遍历事件计算。" +
      "优先：宽泛问题（我最近学习怎么样？这周学了多久？哪门课投入最多？）。默认最近 28 天，最长 366 天。注意 coverage.fullCoverage=false 时说明历史不完整。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.summarize_learning_history,
  }),
  get_learning_analytics: tool({
    description:
      "返回与 ClassFlow 学习洞察页面同源的确定性 Analytics Snapshot，包括实际专注、完成任务、计划与实际、按时完成、课程投入、专注节奏、period comparison 与 Learning Signals。需要解释学习趋势或基于学习洞察做建议时优先使用，不要自行从原始历史重新计算。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_learning_analytics,
  }),
  get_learning_outlook: tool({
    description:
      "返回未来 7/14 天的确定性学习前瞻（与学习洞察页同源）：截止任务与 Deadline Health（safe/attention/at-risk/overdue/unscheduled/unknown）、已安排/缺口分钟、截止前可用空闲、缺少估时任务、每日瓶颈与估时校准参考。规划下周/查看未来负荷优先使用本工具，不要自己推算空闲时间或缺口。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_learning_outlook,
  }),
  propose_study_rebalance: tool({
    description:
      "对已有 Kiro-generated StudyBlock 生成只移动、不新增/删除的学习计划重排建议。用于修复 Deadline 后安排、课程/活动冲突或通过移动较晚截止任务释放早期稀缺容量。本工具只是 Proposal，绝不修改 Store；manual StudyBlock 不会被移动。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.propose_study_rebalance,
  }),
  propose_visual_actions: tool({
    description:
      "当当前用户回合包含截图（图片附件）且用户希望根据截图更新 ClassFlow 时，把截图中的通知整理为可预览的修改方案（Visual Action Intake）。" +
      "调用前必须先用 Read Tools 解析真实数据：查找课程（课程简称如「计网」先用 search_courses/get_course 做唯一匹配，歧义先询问用户，不要猜）、读取任务、排课与临时变更（get_week_schedule 的 source/overrideId）。" +
      "输入只接受真实 entity ID（courseId/scheduleId/assignmentId），不接受名称猜测；所有日期必须是绝对本地时间（如 2026-08-20T22:00、week=3、dayOfWeek=6），禁止把「明天/下周三」写进 action。" +
      "支持动作白名单：create_assignment / update_assignment / set_assignment_ddl / set_assignment_priority / cancel_schedule_occurrence / move_schedule_occurrence / create_extra_schedule_occurrence；" +
      "仅当截图明确「以后/从下周起/统一」才允许 move_schedule / update_schedule 永久修改；" +
      "一次性调整（本周/这周/明天/第 N 周）必须用 occurrence override 类动作。" +
      "禁止：delete_*、create_course、小组/提醒/专注相关动作。" +
      "actions 与 pendingItems 可以同时存在：actions = 已具备完整真实 entity ID / 绝对时间 / 完整 mutation 信息、可以安全进入 Preflight 的事项；" +
      "pendingItems = 已从图片识别到、但因实体歧义（ambiguous-entity）、关键信息缺失（missing-information）或当前不支持（unsupported-action）而不能写入的事项。" +
      "如果某个可执行动作依赖某个 pending 事实，则整个依赖链都必须作为 pendingItems；不要把真实冲突/事务失败/stale 写成 pending。" +
      "截图只有模糊内容时允许 actions 为空（pending-only），但 actions 与 pendingItems 不能同时为空。" +
      "这是 READ / PROPOSAL 工具：绝不写 Store；结果只是方案，用户一次确认后才会原子执行。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.propose_visual_actions,
  }),
  propose_timetable_import: tool({
    description:
      "当当前用户回合包含【完整新学期课程表截图】（图片附件）且用户希望把整张课表初始化导入 ClassFlow（如「把这学期课表导入」「帮我录入全部课程」「初始化课表」）时，把截图中的课程整理为课表导入草稿（Visual Timetable Import）。" +
      "与 propose_visual_actions 的边界：propose_visual_actions 用于「根据截图修改已有 ClassFlow 实体」（作业/DDL/停课/调课/补课）；本工具用于「批量初始化全新课程与排课」。" +
      "调用前用 Read Tools 了解当前课程库（search_courses/get_week_schedule），判断是初始化新课表还是修改已有数据；已有课程对应的截图课程应通过 duplicate 语义处理，不要重复创建。" +
      "输出要求：" +
      "- 同一课程多个上课时间必须聚合到一个 course 的 slots 下（draftKey 仅本次内部关联，绝不使用真实 courseId）；" +
      "- 上课时间只输出节次（periodStart/periodEnd，如第1-2节 → 1 和 2），绝不输出 startTime/endTime 猜测值（具体时间由用户配置的作息时间表解析）；" +
      "- 周次用表达式原样（如 1-5,7-17 / 1-4,6-7,9-17 / 3-7,9 / 单周 / 双周），不猜测、不展开；" +
      "- 图片顶部姓名/学号等个人信息绝不进入课程数据；" +
      "- 识别不确定的课程放入 pendingItems（reason: ambiguous-cell 或 missing-information），不要静默丢弃或猜测。" +
      "这是 READ / PROPOSAL 工具：绝不写 Store；结果只是课表导入预览，用户核对并确认后才会一次性原子导入。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.propose_timetable_import,
  }),
};

export const KIRO_READ_TOOL_NAMES = Object.keys(KIRO_READ_TOOLS) as (keyof typeof KIRO_READ_TOOLS)[];
