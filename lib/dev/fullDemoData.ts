/**
 * 全新预览数据集 Showcase V1（一学期纵深，取代 2026-08 V2）：
 * - 学期：第 11 周 / 共 18 周（开学 10 周前；历史 10 周 + 未来 7 周，含期中与期末）
 * - 10 门课程（计科/数学/英语/物理/AI），资料 pdf/ppt/doc/link 全覆盖（23 个）
 * - 17 个排课时段（weeks 模式多样：1-16周 / 1-8周 / 11-18周 / 单周 / 双周；1 个停课周）
 * - 作息方案 2 套（标准 + 夏令时，标准为激活）
 * - 30 项任务：归档 9（含每周重复系列 3 代同堂）、逾期 2、今天 3、未来 12、无 DDL 4
 *   （预计耗时混合、子任务、关联课程资料、1 项关闭自动提醒）
 * - 日历：DDL 全覆盖 + 考试 5 场 + 活动 4 场（含历史月份）
 * - 18 个 StudyBlock（过去 8 + 今天 2 + 未来 8；manual/kiro 混合；
 *   归档任务关联的历史块在 restore 后自动 released）
 * - ~38 个 FocusSession（过去 10 周 3 个/周 + 近期加密 + 今天完成/暂停各 1，跨 10 门课程与多时段）
 *   → 注入后 Focus backfill 生成完整学习历史，学习洞察呈现趋势/节奏/课程投入/执行质量
 * - 3 个小组项目（成员/任务/DDL/进度，含逾期与已完成混合）
 * - 7 条提醒（assignment / studyBlock / standalone / calendarMark 四 target 全覆盖；
 *   scheduled / fired / skipped；manual / kiro / auto）
 * - 3 个排课例外（本周：停课 1、调课 1、补课 1）
 * 生产 First Run 仍是空工作区；设置 → 数据手动载入（带确认覆盖）。E2E 通过 window.__CLASSFLOW_E2E__ 禁用自动注入。
 */

import {
  ClassFlowBackupData,
  Course,
  CourseSchedule,
  Assignment,
  CalendarMark,
  StudyBlock,
  GroupProject,
  Material,
  FocusSession,
  Reminder,
  ScheduleOccurrenceOverride,
  Semester,
  BellScheduleTemplate,
} from "@/types";
import { getSemesterWeek } from "@/lib/semester";

const pad2 = (n: number) => String(n).padStart(2, "0");

const iso = (daysOffset: number, hour = 23, minute = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(hour)}:${pad2(minute)}:00`;
};

const dateStr = (daysOffset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** 本地时间 epoch ms（FocusSession 用） */
const ts = (daysOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const mat = (id: string, title: string, type: Material["type"], daysAgo: number, size?: string, url?: string): Material => ({
  id,
  title,
  type,
  size,
  uploadDate: dateStr(-daysAgo),
  url,
});

/** 学期起点：10 周前的周一；当前为第 11 周 */
function semesterStartMonday(): Date {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow - 10 * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function seasonLabel(month: number): string {
  if (month >= 2 && month <= 7) return "春季学期";
  if (month >= 8 && month <= 12) return "秋季学期";
  return "冬季学期";
}

const semStart = semesterStartMonday();
const semester: Semester = {
  id: "sem_demo",
  name: `${semStart.getFullYear()}年${seasonLabel(semStart.getMonth() + 1)}`,
  startDate: `${semStart.getFullYear()}-${pad2(semStart.getMonth() + 1)}-${pad2(semStart.getDate())}`,
  totalWeeks: 18,
};

/** 当前教学周（排课例外落在本周） */
const CURRENT_WEEK = getSemesterWeek(new Date(), semester);

// ==================== 课程（10 门）====================

const courses: Course[] = [
  {
    id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼 102", credit: 4,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "线性表、树与图、排序与动态规划核心算法，每周配 2 次上机。",
    materials: [
      mat("m1", "第4章 图的遍历与最短路径.pdf", "pdf", 12, "2.4 MB"),
      mat("m2", "算法可视化（Visualgo）", "link", 9, undefined, "https://visualgo.net/zh"),
      mat("m3", "动态规划专题串讲.ppt", "ppt", 4, "6.2 MB"),
    ],
  },
  {
    id: "c2", name: "概率论与数理统计", code: "MATH-207", teacher: "陈教授", classroom: "教三 305", credit: 4,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "随机变量、参数估计与假设检验，作业以课后习题为主。",
    materials: [
      mat("m4", "第7章 参数估计讲义.pdf", "pdf", 11, "3.5 MB"),
      mat("m5", "假设检验流程图.pdf", "pdf", 15, "0.6 MB"),
    ],
  },
  {
    id: "c3", name: "操作系统", code: "CS-305", teacher: "赵教授", classroom: "计算机楼 208", credit: 3,
    bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032",
    description: "进程调度、内存管理与文件系统，含 3 次实验。",
    materials: [
      mat("m6", "死锁检测与银行家算法.pptx", "ppt", 8, "8.1 MB"),
      mat("m7", "实验三：虚拟内存实验指导.doc", "doc", 6, "0.9 MB"),
      mat("m8", "文件系统专题复习.pdf", "pdf", 3, "2.8 MB"),
    ],
  },
  {
    id: "c4", name: "学术英语写作", code: "ENGL-302", teacher: "Sarah Johnson", classroom: "外语楼 207", credit: 2,
    bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032",
    description: "学术论文结构与引用规范（APA/MLA），每两周一篇 draft。",
    materials: [
      mat("m9", "文献综述写作框架.pdf", "pdf", 13, "1.2 MB"),
      mat("m10", "Purdue OWL 写作指南", "link", 10, undefined, "https://owl.purdue.edu/owl/"),
    ],
  },
  {
    id: "c5", name: "计算机网络", code: "CS-310", teacher: "王教授", classroom: "计算机楼 305", credit: 3,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "TCP/IP 协议栈、网络编程与抓包实验。",
    materials: [
      mat("m11", "第6章 应用层协议.pdf", "pdf", 7, "5.8 MB"),
      mat("m12", "Socket 编程实验课件.pptx", "ppt", 2, "12.0 MB"),
    ],
  },
  {
    id: "c6", name: "数据库系统", code: "CS-204", teacher: "周教授", classroom: "计算机楼 104", credit: 4,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "关系模型、SQL 复杂查询、事务 ACID 与索引优化。",
    materials: [
      mat("m13", "事务隔离级别与锁机制.pdf", "pdf", 5, "5.8 MB"),
      mat("m14", "实验五：存储过程实验指导.doc", "doc", 2, "1.1 MB"),
    ],
  },
  {
    id: "c7", name: "高等数学（下）", code: "MATH-112", teacher: "刘教授", classroom: "教三 201", credit: 5,
    bgHex: "#DCE3D5", borderHex: "#C6D2BC", textHex: "#313032",
    description: "多元函数微积分、重积分与级数。",
    materials: [
      mat("m15", "格林公式与斯托克斯公式.pdf", "pdf", 9, "3.1 MB"),
      mat("m16", "傅里叶级数速查表.pdf", "pdf", 14, "0.8 MB"),
    ],
  },
  {
    id: "c8", name: "机器学习", code: "CS-330", teacher: "郑教授", classroom: "计算机楼 401", credit: 3,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "回归与分类、决策树、神经网络基础与模型评估。",
    materials: [
      mat("m17", "梯度下降与过拟合讲义.pdf", "pdf", 6, "4.1 MB"),
      mat("m18", "Kaggle 入门赛题合集", "link", 4, undefined, "https://www.kaggle.com/competitions"),
    ],
  },
  {
    id: "c9", name: "大学物理实验", code: "PHYS-120", teacher: "吴老师", classroom: "物理楼 301", credit: 2,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "示波器、迈克尔逊干涉仪等基础实验与数据处理。",
    materials: [
      mat("m19", "实验四：迈克尔逊干涉仪.pdf", "pdf", 16, "2.0 MB"),
      mat("m20", "实验报告模板.doc", "doc", 12, "0.4 MB"),
    ],
  },
  {
    id: "c10", name: "编译原理", code: "CS-320", teacher: "何教授", classroom: "计算机楼 208", credit: 3,
    bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032",
    description: "词法分析、语法分析与中间代码生成，配три次大作业。",
    materials: [
      mat("m21", "LL(1) 文法分析课件.pptx", "ppt", 5, "9.6 MB"),
      mat("m22", "Flex/Bison 实验手册.pdf", "pdf", 3, "3.4 MB"),
      mat("m23", "龙书章节导读", "link", 11, undefined, "https://suif.stanford.edu/dragonbook/"),
    ],
  },
];

// ==================== 排课（17 节，周一到周六）====================

const schedules: CourseSchedule[] = [
  { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼 102", weeks: "1-16周" },
  { id: "s2", courseId: "c6", dayOfWeek: 1, startTime: "14:00", endTime: "15:40", location: "计算机楼 104", weeks: "1-16周" },
  { id: "s3", courseId: "c9", dayOfWeek: 1, startTime: "16:00", endTime: "17:40", location: "物理楼 301", weeks: "单周" },
  { id: "s4", courseId: "c7", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", location: "教三 201", weeks: "1-16周" },
  { id: "s5", courseId: "c2", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s6", courseId: "c8", dayOfWeek: 2, startTime: "14:00", endTime: "15:40", location: "计算机楼 401", weeks: "11-18周" },
  { id: "s7", courseId: "c1", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "计算机楼 102", weeks: "1-16周" },
  { id: "s8", courseId: "c10", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "计算机楼 208", weeks: "1-16周", excludedWeeks: [5] },
  { id: "s9", courseId: "c3", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "计算机楼 208", weeks: "1-16周" },
  { id: "s10", courseId: "c8", dayOfWeek: 3, startTime: "16:00", endTime: "17:40", location: "计算机楼 401", weeks: "11-18周" },
  { id: "s11", courseId: "c5", dayOfWeek: 4, startTime: "10:00", endTime: "11:40", location: "计算机楼 305", weeks: "1-16周" },
  { id: "s12", courseId: "c4", dayOfWeek: 4, startTime: "13:00", endTime: "14:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s13", courseId: "c7", dayOfWeek: 4, startTime: "16:00", endTime: "17:40", location: "教三 201", weeks: "1-16周" },
  { id: "s14", courseId: "c4", dayOfWeek: 5, startTime: "10:00", endTime: "11:40", location: "外语楼 207", weeks: "1-8周" },
  { id: "s15", courseId: "c2", dayOfWeek: 5, startTime: "14:00", endTime: "15:40", location: "教三 305", weeks: "双周" },
  { id: "s16", courseId: "c6", dayOfWeek: 5, startTime: "16:00", endTime: "17:40", location: "计算机楼 104", weeks: "1-16周" },
  { id: "s17", courseId: "c10", dayOfWeek: 6, startTime: "09:00", endTime: "10:40", location: "计算机楼 208", weeks: "3-12周" },
];

// ==================== 作息方案（2 套，标准为激活）====================

const bellSchedules: BellScheduleTemplate[] = [
  {
    id: "bell-1",
    name: "标准作息",
    periods: [
      { period: 1, startTime: "08:00", endTime: "08:45" },
      { period: 2, startTime: "08:55", endTime: "09:40" },
      { period: 3, startTime: "10:00", endTime: "10:45" },
      { period: 4, startTime: "10:55", endTime: "11:40" },
      { period: 5, startTime: "14:00", endTime: "14:45" },
      { period: 6, startTime: "14:55", endTime: "15:40" },
      { period: 7, startTime: "16:00", endTime: "16:45" },
      { period: 8, startTime: "16:55", endTime: "17:40" },
    ],
  },
  {
    id: "bell-2",
    name: "夏令时作息",
    periods: [
      { period: 1, startTime: "07:40", endTime: "08:25" },
      { period: 2, startTime: "08:35", endTime: "09:20" },
      { period: 3, startTime: "09:40", endTime: "10:25" },
      { period: 4, startTime: "10:35", endTime: "11:20" },
      { period: 5, startTime: "14:30", endTime: "15:15" },
      { period: 6, startTime: "15:25", endTime: "16:10" },
    ],
  },
];
const activeBellScheduleId = "bell-1";

// ==================== 排课例外（本周：停课 1 / 调课 1 / 补课 1）====================

const scheduleOccurrenceOverrides: ScheduleOccurrenceOverride[] = [
  { id: "o1", kind: "cancel", courseId: "c1", baseScheduleId: "s7", week: CURRENT_WEEK, source: "manual" },
  { id: "o2", kind: "move", courseId: "c5", baseScheduleId: "s11", week: CURRENT_WEEK, dayOfWeek: 3, startTime: "18:00", endTime: "19:40", location: "计算机楼 305", source: "manual" },
  { id: "o3", kind: "extra", courseId: "c10", week: CURRENT_WEEK, dayOfWeek: 7, startTime: "19:00", endTime: "20:40", location: "计算机楼 208", source: "kiro" },
];

// ==================== 任务（30 项，一学期纵深）====================

const assignments: Assignment[] = [
  // ---- 归档：开学第 1–2 周 ----
  {
    id: "a1", courseId: "c1", title: "复杂度分析入门练习",
    description: "教材 1.1–1.3 课后习题，掌握大 O 渐进分析。",
    ddl: iso(-68, 23, 59), priority: "low", status: "completed", progress: 100,
    tags: ["课后习题"],
  },
  {
    id: "a2", courseId: "c7", title: "多元函数偏导数测试",
    description: "线上测试，覆盖偏导数与全微分。",
    ddl: iso(-63, 23, 59), priority: "medium", status: "completed", progress: 100, estimatedMinutes: 60,
    tags: ["线上测试"],
  },
  // ---- 每周重复系列：三代同堂 ----
  {
    id: "a3", courseId: "c2", title: "概率论每周习题（第 3 周）",
    description: "每周固定习题打卡，完成后自动生成下一周。",
    ddl: iso(-56, 23, 59), priority: "medium", status: "completed", progress: 100, estimatedMinutes: 90,
    tags: ["每周打卡"], recurrence: "weekly", recurrenceSeriesId: "rs_demo_1",
  },
  {
    id: "a4", courseId: "c2", title: "概率论每周习题（第 4 周）",
    description: "每周固定习题打卡，完成后自动生成下一周。",
    ddl: iso(-49, 23, 59), priority: "medium", status: "completed", progress: 100, estimatedMinutes: 90,
    tags: ["每周打卡"], recurrence: "weekly", recurrenceSeriesId: "rs_demo_1", recurrenceParentId: "a3",
  },
  // ---- 归档：第 4–8 周 ----
  {
    id: "a5", courseId: "c6", title: "数据库实验二：视图与索引",
    description: "创建视图并对比索引建立前后的查询计划。",
    ddl: iso(-44, 18, 0), priority: "medium", status: "submitted", progress: 100, estimatedMinutes: 120,
    tags: ["实验"],
  },
  {
    id: "a6", courseId: "c5", title: "子网划分与 supernetting 练习",
    description: "教材 3.4 课后习题，含 CIDR 聚合计算。",
    ddl: iso(-37, 23, 59), priority: "low", status: "completed", progress: 100,
    tags: ["课后习题"],
  },
  {
    id: "a7", courseId: "c4", title: "Argumentative Essay: Campus AI Policy",
    description: "1200 词议论文，引用至少 8 篇文献并通过查重。",
    ddl: iso(-30, 21, 0), priority: "high", status: "submitted", progress: 100, estimatedMinutes: 300,
    tags: ["论文", "英文"],
    materialIds: ["m9"],
    subtasks: [
      { id: "st1", title: "文献检索与提纲", completed: true },
      { id: "st2", title: "正文撰写与修改", completed: true },
    ],
  },
  {
    id: "a8", courseId: "c3", title: "进程间通信实验报告",
    description: "实现管道与共享内存两种 IPC 并对比开销。",
    ddl: iso(-23, 23, 59), priority: "high", status: "completed", progress: 100, estimatedMinutes: 180,
    tags: ["实验报告", "C语言"],
    materialIds: ["m7", "m6"],
  },
  {
    id: "a9", courseId: "c10", title: "词法分析器大作业一",
    description: "用 Flex 实现 C 子集的词法分析器，通过全部测试用例。",
    ddl: iso(-16, 23, 59), priority: "high", status: "completed", progress: 100, estimatedMinutes: 240,
    tags: ["大作业"],
    materialIds: ["m21", "m22"],
  },
  {
    id: "a10", courseId: "c8", title: "决策树调参与交叉验证",
    description: "在鸢尾花数据集上对比剪枝策略与验证方式。",
    ddl: iso(-9, 18, 0), priority: "medium", status: "completed", progress: 100, estimatedMinutes: 150,
    tags: ["编程实践"],
    materialIds: ["m17"],
  },
  // ---- 逾期 ----
  {
    id: "a11", courseId: "c3", title: "页面置换算法模拟",
    description: "实现 FIFO / LRU / CLOCK 并输出缺页率对比曲线。",
    ddl: iso(-1, 23, 59), priority: "urgent", status: "doing", progress: 60, estimatedMinutes: 180,
    tags: ["课程设计"],
    materialIds: ["m8"],
    subtasks: [
      { id: "st3", title: "三种算法实现", completed: true },
      { id: "st4", title: "对比实验与文档", completed: false },
    ],
  },
  {
    id: "a12", courseId: "c2", title: "贝叶斯决策线上小测",
    description: "线上小测，覆盖贝叶斯公式与后验计算。",
    ddl: iso(-2, 20, 0), priority: "medium", status: "todo", progress: 0,
    tags: ["线上测试"],
  },
  // ---- 今天截止 ----
  {
    id: "a13", courseId: "c6", title: "存储过程与触发器练习",
    description: "教材 6.2 课后习题，编写带异常处理的存储过程。",
    ddl: iso(0, 23, 59), priority: "high", status: "doing", progress: 70, estimatedMinutes: 90,
    tags: ["课后习题", "SQL"],
  },
  {
    id: "a14", courseId: "c4", title: "Literature Review Draft",
    description: "完成 1000 词文献综述初稿，引用至少 6 篇文献。",
    ddl: iso(0, 18, 0), priority: "high", status: "todo", progress: 20, estimatedMinutes: 150,
    tags: ["论文", "英文"],
    materialIds: ["m9"],
    subtasks: [
      { id: "st5", title: "文献检索与提纲", completed: true },
      { id: "st6", title: "撰写正文初稿", completed: false },
      { id: "st7", title: "格式与引用检查", completed: false },
    ],
  },
  {
    id: "a15", courseId: "c9", title: "迈克尔逊干涉仪预习报告",
    description: "预习光路调节步骤并完成思考题。",
    ddl: iso(0, 12, 0), priority: "low", status: "todo", progress: 0, estimatedMinutes: 45,
    tags: ["预习"],
    materialIds: ["m19"],
  },
  // ---- 未来 ----
  {
    id: "a16", courseId: "c2", title: "概率论每周习题（本周）",
    description: "每周固定习题打卡，完成后自动生成下一周。",
    ddl: iso(4, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 90,
    tags: ["每周打卡"], recurrence: "weekly", recurrenceSeriesId: "rs_demo_1", recurrenceParentId: "a4",
  },
  {
    id: "a17", courseId: "c5", title: "Socket 聊天室实验",
    description: "实现多线程 TCP 聊天室服务端与客户端。",
    ddl: iso(1, 21, 0), priority: "low", status: "doing", progress: 45, estimatedMinutes: 120,
    tags: ["实验"],
    materialIds: ["m12"],
  },
  {
    id: "a18", courseId: "c1", title: "最小生成树算法整理",
    description: "对比 Prim 与 Kruskal 并整理模板代码。",
    ddl: iso(2, 23, 59), priority: "high", status: "todo", progress: 10, estimatedMinutes: 90,
    tags: ["复习笔记"],
    materialIds: ["m1"],
  },
  {
    id: "a19", courseId: "c7", title: "傅里叶级数专项训练",
    description: "教材 11.1–11.3 课后习题，重点练展开与收敛判定。",
    ddl: iso(3, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 60,
    tags: ["课后习题"],
    materialIds: ["m16"],
  },
  {
    id: "a20", courseId: "c10", title: "语法分析器大作业二",
    description: "用 Bison 实现表达式文法的语法制导翻译。",
    ddl: iso(5, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 240,
    tags: ["大作业"],
  },
  {
    id: "a21", courseId: "c6", title: "数据库期中复习",
    description: "SQL 查询、范式与事务三章综合复习。",
    ddl: iso(7, 23, 59), priority: "high", status: "todo", progress: 10, estimatedMinutes: 180,
    tags: ["复习", "期中"],
    materialIds: ["m13"],
  },
  {
    id: "a22", courseId: "c8", title: "Kaggle 房价预测入门赛",
    description: "完成数据清洗、特征工程与基线模型提交。",
    ddl: iso(9, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 240,
    tags: ["编程实践"],
    materialIds: ["m18"],
  },
  {
    id: "a23", courseId: "c4", title: "学术词汇表 Unit 9",
    description: "整理 Unit 9 高频学术词汇与例句。",
    ddl: iso(6, 21, 0), priority: "low", status: "doing", progress: 50,
    tags: ["单词"],
  },
  {
    id: "a24", courseId: "c3", title: "操作系统期末课程设计",
    description: "自选方向完成系统级编程项目并答辩。",
    ddl: iso(16, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 360,
    tags: ["课程设计", "期末"],
  },
  {
    id: "a25", courseId: "c1", title: "期末算法综合复习",
    description: "按专题整理考点清单与模板题，供考前集中复习。",
    ddl: iso(30, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 300,
    tags: ["复习", "期末"],
  },
  {
    id: "a27", courseId: "c6", title: "数据库期末课程设计文档",
    description: "选课系统 ER 设计、3NF 规范化与实现说明。",
    ddl: iso(38, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 360,
    tags: ["课程设计", "期末"],
    autoReminderDisabled: true, // 演示：该任务关闭默认自动 DDL 提醒
  },
  // ---- 无 DDL ----
  {
    id: "a28", courseId: "c1", title: "LeetCode 每日一题（本周 5 题）",
    description: "按专题补动态规划与回溯的弱项。",
    priority: "medium", status: "todo", progress: 20, estimatedMinutes: 45,
    tags: ["算法练习"],
  },
  {
    id: "a29", courseId: "c8", title: "精读 Attention Is All You Need",
    description: "通读原文并整理 Transformer 结构笔记。",
    priority: "low", status: "doing", progress: 60,
    tags: ["论文精读"],
  },
  {
    id: "a30", courseId: "c10", title: "龙书第 4 章复习笔记",
    description: "整理自顶向下语法分析要点。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 50,
    tags: ["复习笔记"],
  },
  {
    id: "a31", courseId: "c2", title: "中心极限定理可视化小实验",
    description: "用 Python 模拟验证中心极限定理。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 75,
    tags: ["编程实践"],
  },
];

// 计数：归档 10（a1–a10）+ 逾期 2（a11,a12）+ 今天 3（a13–a15）
//      + 未来 11（a16–a25,a27）+ 无 DDL 4（a28–a31）= 30（测试锁定）

// ==================== 学习计划 StudyBlock（过去 8 + 今天 2 + 未来 8）====================

const studyBlocks: StudyBlock[] = [
  { id: "b1", title: "数据库实验二复盘", date: dateStr(-42), startTime: "19:00", endTime: "20:30", assignmentId: "a5", courseId: "c6", source: "manual" },
  { id: "b2", title: "议论文修改与润色", date: dateStr(-29), startTime: "09:30", endTime: "11:00", assignmentId: "a7", courseId: "c4", source: "kiro" },
  { id: "b3", title: "IPC 实验联调", date: dateStr(-22), startTime: "15:00", endTime: "16:30", assignmentId: "a8", courseId: "c3", source: "kiro" },
  { id: "b4", title: "词法分析器自测", date: dateStr(-15), startTime: "19:00", endTime: "20:00", assignmentId: "a9", courseId: "c10", source: "manual" },
  { id: "b5", title: "决策树实验收尾", date: dateStr(-8), startTime: "14:00", endTime: "15:30", assignmentId: "a10", courseId: "c8", source: "manual" },
  { id: "b6", title: "每周习题打卡", date: dateStr(-6), startTime: "20:00", endTime: "21:00", assignmentId: "a4", courseId: "c2", source: "kiro" },
  { id: "b7", title: "复杂度练习回顾", date: dateStr(-4), startTime: "19:30", endTime: "20:30", assignmentId: "a1", courseId: "c1", source: "manual" },
  { id: "b8", title: "贝叶斯小测冲刺", date: dateStr(-1), startTime: "21:00", endTime: "22:00", assignmentId: "a12", courseId: "c2", source: "kiro" },
  { id: "b9", title: "Literature Review Draft", date: dateStr(0), startTime: "16:00", endTime: "17:30", assignmentId: "a14", courseId: "c4", source: "manual" },
  { id: "b10", title: "存储过程练习", date: dateStr(0), startTime: "19:30", endTime: "20:30", assignmentId: "a13", courseId: "c6", source: "kiro" },
  { id: "b11", title: "Socket 聊天室实验", date: dateStr(1), startTime: "18:00", endTime: "20:00", assignmentId: "a17", courseId: "c5", source: "manual" },
  { id: "b12", title: "最小生成树整理", date: dateStr(2), startTime: "15:00", endTime: "16:30", assignmentId: "a18", courseId: "c1", source: "kiro" },
  { id: "b13", title: "傅里叶级数训练", date: dateStr(3), startTime: "14:00", endTime: "15:30", assignmentId: "a19", courseId: "c7", source: "manual" },
  { id: "b14", title: "语法分析器大作业", date: dateStr(4), startTime: "19:00", endTime: "20:30", assignmentId: "a20", courseId: "c10", source: "manual" },
  { id: "b15", title: "中心极限定理小实验", date: dateStr(12), startTime: "09:00", endTime: "10:15", assignmentId: "a31", courseId: "c2", source: "manual" },
  { id: "b16", title: "操作系统期末课设", date: dateStr(12), startTime: "15:00", endTime: "17:30", assignmentId: "a24", courseId: "c3", source: "manual" },
  { id: "b17", title: "操作系统期末课设（继续）", date: dateStr(13), startTime: "19:00", endTime: "20:30", assignmentId: "a24", courseId: "c3", source: "kiro" },
  { id: "b18", title: "期末算法综合复习", date: dateStr(16), startTime: "10:00", endTime: "12:00", assignmentId: "a25", courseId: "c1", source: "manual" },
];

// ==================== 日历（DDL 全覆盖 + 考试 5 + 活动 4，含历史月份）====================

const calendarMarks: CalendarMark[] = [
  { id: "cm1", date: dateStr(-68), type: "ddl", title: "复杂度分析入门练习", sourceId: "a1" },
  { id: "cm2", date: dateStr(-63), type: "ddl", title: "多元函数偏导数测试", sourceId: "a2" },
  { id: "cm3", date: dateStr(-56), type: "ddl", title: "概率论每周习题（第 3 周）", sourceId: "a3" },
  { id: "cm4", date: dateStr(-60), type: "exam", title: "高等数学期中考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm5", date: dateStr(-49), type: "ddl", title: "概率论每周习题（第 4 周）", sourceId: "a4" },
  { id: "cm6", date: dateStr(-44), type: "ddl", title: "数据库实验二：视图与索引", sourceId: "a5" },
  { id: "cm7", date: dateStr(-37), type: "ddl", title: "子网划分与 supernetting 练习", sourceId: "a6" },
  { id: "cm8", date: dateStr(-35), type: "activity", title: "程序设计竞赛校内选拔", startTime: "13:30", endTime: "17:30" },
  { id: "cm9", date: dateStr(-30), type: "ddl", title: "Argumentative Essay: Campus AI Policy", sourceId: "a7" },
  { id: "cm10", date: dateStr(-23), type: "ddl", title: "进程间通信实验报告", sourceId: "a8" },
  { id: "cm11", date: dateStr(-21), type: "exam", title: "大学物理期中考试", startTime: "14:00", endTime: "16:00" },
  { id: "cm12", date: dateStr(-16), type: "ddl", title: "词法分析器大作业一", sourceId: "a9" },
  { id: "cm13", date: dateStr(-9), type: "ddl", title: "决策树调参与交叉验证", sourceId: "a10" },
  { id: "cm14", date: dateStr(-2), type: "ddl", title: "贝叶斯决策线上小测", sourceId: "a12" },
  { id: "cm15", date: dateStr(-1), type: "ddl", title: "页面置换算法模拟", sourceId: "a11" },
  { id: "cm16", date: dateStr(0), type: "ddl", title: "存储过程与触发器练习", sourceId: "a13" },
  { id: "cm17", date: dateStr(0), type: "ddl", title: "Literature Review Draft", sourceId: "a14" },
  { id: "cm18", date: dateStr(0), type: "ddl", title: "迈克尔逊干涉仪预习报告", sourceId: "a15" },
  { id: "cm19", date: dateStr(1), type: "ddl", title: "Socket 聊天室实验", sourceId: "a17" },
  { id: "cm20", date: dateStr(2), type: "ddl", title: "最小生成树算法整理", sourceId: "a18" },
  { id: "cm21", date: dateStr(3), type: "ddl", title: "傅里叶级数专项训练", sourceId: "a19" },
  { id: "cm22", date: dateStr(4), type: "ddl", title: "语法分析器大作业二", sourceId: "a20" },
  { id: "cm23", date: dateStr(4), type: "ddl", title: "概率论每周习题（本周）", sourceId: "a16" },
  { id: "cm24", date: dateStr(5), type: "activity", title: "实验室开放日", startTime: "10:00", endTime: "12:00" },
  { id: "cm25", date: dateStr(6), type: "ddl", title: "学术词汇表 Unit 9", sourceId: "a23" },
  { id: "cm26", date: dateStr(7), type: "ddl", title: "数据库期中复习", sourceId: "a21" },
  { id: "cm27", date: dateStr(7), type: "exam", title: "操作系统期中考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm28", date: dateStr(9), type: "ddl", title: "Kaggle 房价预测入门赛", sourceId: "a22" },
  { id: "cm29", date: dateStr(12), type: "activity", title: "学术沙龙与保研经验分享会", startTime: "15:00", endTime: "17:30" },
  { id: "cm30", date: dateStr(16), type: "ddl", title: "操作系统期末课程设计", sourceId: "a24" },
  { id: "cm31", date: dateStr(21), type: "activity", title: "保研经验分享会（第二场）", startTime: "14:00", endTime: "16:00" },
  { id: "cm32", date: dateStr(30), type: "ddl", title: "期末算法综合复习", sourceId: "a25" },
  { id: "cm33", date: dateStr(30), type: "exam", title: "数据结构与算法期末考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm35", date: dateStr(35), type: "exam", title: "数据库期末考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm36", date: dateStr(38), type: "ddl", title: "数据库期末课程设计文档", sourceId: "a27" },
];

// ==================== 专注会话（一学期纵深，过去 10 周 + 今天）====================
// 注入后 Focus backfill 生成学习历史 → 学习洞察（趋势/节奏/课程投入/执行质量）有完整内容

interface FocusSeed {
  id: string;
  days: number;
  hour: number;
  minute?: number;
  planned: number;
  /** 实际完成占比（0-1，≤1：Domain 契约 actualActiveMs ≤ plannedMs） */
  actualPct: number;
  courseId: string;
  courseName: string;
  assignmentId?: string;
  assignmentTitle?: string;
  note?: string;
  source?: "manual" | "kiro";
}

const COURSE_NAMES: Record<string, string> = {
  c1: "数据结构与算法",
  c2: "概率论与数理统计",
  c3: "操作系统",
  c4: "学术英语写作",
  c5: "计算机网络",
  c6: "数据库系统",
  c7: "高等数学（下）",
  c8: "机器学习",
  c9: "大学物理实验",
  c10: "编译原理",
};

const focusSeeds: FocusSeed[] = [
  // ---- 开学第 1–2 周（约 70–57 天前）：每周 3 次 ----
  { id: "f1", days: -70, hour: 9, planned: 45, actualPct: 1, courseId: "c1", courseName: COURSE_NAMES.c1, assignmentId: "a1", assignmentTitle: "复杂度分析入门练习", source: "manual" },
  { id: "f2", days: -68, hour: 20, planned: 60, actualPct: 1, courseId: "c2", courseName: COURSE_NAMES.c2, source: "kiro" },
  { id: "f3", days: -66, hour: 14, planned: 30, actualPct: 0.9, courseId: "c7", courseName: COURSE_NAMES.c7, assignmentId: "a2", assignmentTitle: "多元函数偏导数测试", source: "manual" },
  { id: "f4", days: -63, hour: 19, planned: 60, actualPct: 1, courseId: "c3", courseName: COURSE_NAMES.c3, source: "manual" },
  { id: "f5", days: -61, hour: 10, planned: 50, actualPct: 0.95, courseId: "c5", courseName: COURSE_NAMES.c5, source: "kiro" },
  { id: "f6", days: -59, hour: 15, planned: 45, actualPct: 1, courseId: "c4", courseName: COURSE_NAMES.c4, source: "manual" },
  // ---- 第 3–4 周 ----
  { id: "f7", days: -56, hour: 19, planned: 60, actualPct: 1, courseId: "c2", courseName: COURSE_NAMES.c2, assignmentId: "a3", assignmentTitle: "概率论每周习题（第 3 周）", source: "manual" },
  { id: "f8", days: -54, hour: 9, planned: 90, actualPct: 0.98, courseId: "c6", courseName: COURSE_NAMES.c6, source: "kiro" },
  { id: "f9", days: -52, hour: 20, planned: 45, actualPct: 1, courseId: "c8", courseName: COURSE_NAMES.c8, source: "manual" },
  { id: "f10", days: -49, hour: 14, planned: 60, actualPct: 1, courseId: "c2", courseName: COURSE_NAMES.c2, assignmentId: "a4", assignmentTitle: "概率论每周习题（第 4 周）", source: "kiro" },
  { id: "f11", days: -47, hour: 19, planned: 75, actualPct: 0.9, courseId: "c10", courseName: COURSE_NAMES.c10, source: "manual" },
  { id: "f12", days: -45, hour: 10, planned: 50, actualPct: 1, courseId: "c9", courseName: COURSE_NAMES.c9, source: "manual" },
  // ---- 第 5–6 周 ----
  { id: "f13", days: -42, hour: 20, planned: 60, actualPct: 1, courseId: "c6", courseName: COURSE_NAMES.c6, assignmentId: "a5", assignmentTitle: "数据库实验二：视图与索引", source: "manual" },
  { id: "f14", days: -40, hour: 9, planned: 45, actualPct: 0.65, courseId: "c7", courseName: COURSE_NAMES.c7, note: "临时有事提前结束", source: "manual" },
  { id: "f15", days: -38, hour: 15, planned: 60, actualPct: 1, courseId: "c5", courseName: COURSE_NAMES.c5, source: "kiro" },
  { id: "f16", days: -35, hour: 19, planned: 90, actualPct: 1, courseId: "c4", courseName: COURSE_NAMES.c4, source: "manual" },
  { id: "f17", days: -33, hour: 14, planned: 50, actualPct: 0.95, courseId: "c3", courseName: COURSE_NAMES.c3, source: "kiro" },
  { id: "f18", days: -31, hour: 20, planned: 60, actualPct: 1, courseId: "c1", courseName: COURSE_NAMES.c1, source: "manual" },
  // ---- 第 7–8 周（期中季，强度上升）----
  { id: "f19", days: -28, hour: 19, planned: 90, actualPct: 1, courseId: "c4", courseName: COURSE_NAMES.c4, assignmentId: "a7", assignmentTitle: "Argumentative Essay: Campus AI Policy", source: "kiro" },
  { id: "f20", days: -26, hour: 9, planned: 60, actualPct: 1, courseId: "c7", courseName: COURSE_NAMES.c7, source: "manual" },
  { id: "f21", days: -24, hour: 20, planned: 75, actualPct: 0.98, courseId: "c3", courseName: COURSE_NAMES.c3, assignmentId: "a8", assignmentTitle: "进程间通信实验报告", source: "manual" },
  { id: "f22", days: -21, hour: 14, planned: 60, actualPct: 1, courseId: "c9", courseName: COURSE_NAMES.c9, source: "kiro" },
  { id: "f23", days: -19, hour: 19, planned: 90, actualPct: 1, courseId: "c10", courseName: COURSE_NAMES.c10, assignmentId: "a9", assignmentTitle: "词法分析器大作业一", source: "manual" },
  { id: "f24", days: -17, hour: 10, planned: 50, actualPct: 0.85, courseId: "c2", courseName: COURSE_NAMES.c2, note: "中途被打断", source: "manual" },
  // ---- 第 9–10 周 ----
  { id: "f25", days: -14, hour: 20, planned: 60, actualPct: 1, courseId: "c8", courseName: COURSE_NAMES.c8, assignmentId: "a10", assignmentTitle: "决策树调参与交叉验证", source: "kiro" },
  { id: "f26", days: -12, hour: 9, planned: 45, actualPct: 1, courseId: "c1", courseName: COURSE_NAMES.c1, source: "manual" },
  { id: "f27", days: -10, hour: 19, planned: 60, actualPct: 0.95, courseId: "c6", courseName: COURSE_NAMES.c6, source: "manual" },
  { id: "f28", days: -8, hour: 15, planned: 45, actualPct: 1, courseId: "c5", courseName: COURSE_NAMES.c5, source: "kiro" },
  { id: "f29", days: -6, hour: 20, planned: 60, actualPct: 1, courseId: "c2", courseName: COURSE_NAMES.c2, assignmentId: "a16", assignmentTitle: "概率论每周习题（本周）", source: "manual" },
  { id: "f30", days: -4, hour: 14, planned: 50, actualPct: 1, courseId: "c4", courseName: COURSE_NAMES.c4, source: "kiro" },
  // ---- 本周 ----
  { id: "f31", days: -2, hour: 19, planned: 60, actualPct: 1, courseId: "c1", courseName: COURSE_NAMES.c1, assignmentId: "a18", assignmentTitle: "最小生成树算法整理", source: "manual" },
  { id: "f32", days: -1, hour: 20, planned: 45, actualPct: 1, courseId: "c6", courseName: COURSE_NAMES.c6, assignmentId: "a13", assignmentTitle: "存储过程与触发器练习", source: "kiro" },
  { id: "f33", days: -1, hour: 15, planned: 30, actualPct: 0.9, courseId: "c7", courseName: COURSE_NAMES.c7, source: "manual" },
  // ---- 今天：已完成 1 ----
  { id: "f34", days: 0, hour: 9, planned: 45, actualPct: 1, courseId: "c3", courseName: COURSE_NAMES.c3, assignmentId: "a11", assignmentTitle: "页面置换算法模拟", source: "manual" },
];

const focusSessions: FocusSession[] = focusSeeds.map((s) => {
  const startedAt = ts(s.days, s.hour, s.minute ?? 0);
  const actualMs = Math.round(s.planned * s.actualPct * 60_000);
  const endedAt = startedAt + actualMs;
  return {
    id: s.id,
    plannedMinutes: s.planned,
    startedAt,
    accumulatedActiveMs: actualMs,
    status: "completed" as const,
    endedAt,
    endReason: s.actualPct < 0.95 ? ("manual" as const) : ("timer" as const),
    actualActiveMs: actualMs,
    assignmentId: s.assignmentId,
    courseId: s.courseId,
    assignmentTitleSnapshot: s.assignmentTitle,
    courseNameSnapshot: s.courseName,
    note: s.note,
    source: s.source ?? "manual",
    createdAt: startedAt,
    updatedAt: endedAt,
  };
});

// 今天下午：1 个暂停中的会话（Focus 列表可见，不参与 backfill）
focusSessions.push({
  id: "f35",
  plannedMinutes: 50,
  startedAt: ts(0, 15, 30),
  accumulatedActiveMs: 20 * 60_000,
  status: "paused",
  courseId: "c4",
  courseNameSnapshot: "学术英语写作",
  assignmentId: "a14",
  assignmentTitleSnapshot: "Literature Review Draft",
  source: "manual",
  createdAt: ts(0, 15, 30),
  updatedAt: ts(0, 15, 50),
});

// ==================== 小组项目（3 个）====================

const groupProjects: GroupProject[] = [
  {
    id: "g1",
    courseId: "c1",
    title: "校园导航系统课程设计",
    description: "基于图的建模实现校园最短路径查询，展示 Dijkstra / Floyd 与数据结构选型分析。",
    progress: 62,
    updatedAt: dateStr(0),
    members: [
      { id: "gm1", name: "林晓阳", role: "leader", major: "计算机科学与技术" },
      { id: "gm2", name: "李晨", role: "member", major: "软件工程" },
      { id: "gm3", name: "王雨桐", role: "member", major: "人工智能" },
      { id: "gm4", name: "陈昊", role: "member", major: "计算机科学与技术" },
    ],
    tasks: [
      { id: "gt1", title: "需求分析与图建模", assigneeId: "gm1", ddl: iso(-20, 23, 59), completed: true },
      { id: "gt2", title: "Dijkstra 算法实现", assigneeId: "gm2", ddl: iso(-6, 23, 59), completed: true },
      { id: "gt3", title: "UI 原型与地图渲染", assigneeId: "gm3", ddl: iso(7, 23, 59), completed: false },
      { id: "gt4", title: "测试与报告撰写", assigneeId: "gm4", ddl: iso(14, 23, 59), completed: false },
    ],
  },
  {
    id: "g2",
    courseId: "c4",
    title: "Academic Drama 小组展演",
    description: "改编经典短剧并完成 15 分钟英文展演，含剧本互评与发音打磨。",
    progress: 45,
    updatedAt: dateStr(-1),
    members: [
      { id: "gm5", name: "林晓阳", role: "leader" },
      { id: "gm6", name: "赵一鸣", role: "member", major: "翻译" },
    ],
    tasks: [
      { id: "gt5", title: "剧本改编与角色分配", assigneeId: "gm5", ddl: iso(-3, 23, 59), completed: true },
      { id: "gt6", title: "排练与正式展演", assigneeId: "gm6", ddl: iso(10, 23, 59), completed: false },
    ],
  },
  {
    id: "g3",
    courseId: "c8",
    title: "Kaggle 房价预测组队赛",
    description: "三人小队完成特征工程与模型融合，目标进入前 30%。",
    progress: 30,
    updatedAt: dateStr(0),
    members: [
      { id: "gm7", name: "林晓阳", role: "leader", major: "计算机科学与技术" },
      { id: "gm8", name: "刘思远", role: "member", major: "数据科学" },
      { id: "gm9", name: "陈昊", role: "member", major: "人工智能" },
    ],
    tasks: [
      { id: "gt7", title: "数据清洗与探索性分析", assigneeId: "gm7", ddl: iso(2, 18, 0), completed: true },
      { id: "gt8", title: "基线模型与特征工程", assigneeId: "gm8", ddl: iso(9, 23, 59), completed: false },
      { id: "gt9", title: "模型融合与提交", assigneeId: "gm9", ddl: iso(16, 23, 59), completed: false },
    ],
  },
];

// ==================== 提醒（7 条，四 target 全覆盖）====================

const reminders: Reminder[] = [
  {
    id: "r1", title: "Socket 实验前 1 小时提醒", targetType: "assignment", targetId: "a17",
    timingMode: "relative", offsetMinutes: -60, triggerAt: iso(1, 20, 0), status: "scheduled",
    source: "manual", createdAt: iso(-1, 10, 0), updatedAt: iso(-1, 10, 0),
  },
  {
    id: "r2", title: "最小生成树复习开始前提醒", targetType: "studyBlock", targetId: "b12",
    timingMode: "relative", offsetMinutes: -30, triggerAt: iso(2, 14, 30), status: "scheduled",
    source: "kiro", createdAt: iso(-2, 12, 0), updatedAt: iso(-2, 12, 0),
  },
  {
    id: "r3", title: "记得带实验报告打印件", note: "物理实验课前打印两份", targetType: "standalone",
    timingMode: "absolute", triggerAt: iso(1, 19, 0), status: "scheduled",
    source: "manual", createdAt: iso(-3, 9, 0), updatedAt: iso(-3, 9, 0),
  },
  {
    id: "r4", title: "决策树实验开始前提醒", targetType: "assignment", targetId: "a10",
    timingMode: "relative", offsetMinutes: -30, triggerAt: iso(-9, 17, 30), status: "fired",
    firedAt: iso(-9, 17, 30), source: "manual", createdAt: iso(-12, 8, 0), updatedAt: iso(-9, 17, 30),
  },
  {
    id: "r5", title: "期中复习启动提醒", targetType: "standalone",
    timingMode: "absolute", triggerAt: iso(-12, 9, 0), status: "skipped",
    source: "manual", createdAt: iso(-15, 9, 0), updatedAt: iso(-12, 9, 0),
  },
  {
    id: "r6", title: "数据库期中复习前 1 天提醒", targetType: "assignment", targetId: "a21",
    timingMode: "relative", offsetMinutes: -1440, triggerAt: iso(6, 23, 59), status: "scheduled",
    source: "auto", createdAt: iso(-1, 21, 0), updatedAt: iso(-1, 21, 0),
  },
  {
    id: "r7", title: "操作系统期中考试前 1 小时提醒", targetType: "calendarMark", targetId: "cm27",
    timingMode: "relative", offsetMinutes: -60, triggerAt: iso(7, 8, 0), status: "scheduled",
    source: "manual", createdAt: iso(-1, 15, 0), updatedAt: iso(-1, 15, 0),
  },
];

// ==================== 组装 ====================

export function buildFullDemoData(): ClassFlowBackupData {
  return {
    userProfile: {
      name: "林晓阳",
      avatarUrl: "",
      college: "信息科学与技术学院",
      grade: "大二 · 2024级",
      studentId: "20240817012",
      completedCredits: 68,
      totalCredits: 150,
    },
    semester,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    studyBlocks,
    reminders,
    focusSessions,
    scheduleOccurrenceOverrides,
    bellSchedules,
    activeBellScheduleId,
  };
}

/** ?preview=task-v2 兼容别名（与自动注入同一份全模块数据） */
export function buildTaskV2PreviewData(): ClassFlowBackupData {
  return buildFullDemoData();
}
