/**
 * Dev Demo fixture：完整模块演示数据（开发模式自动注入 + 设置 → 数据 → 重新载入共用）。
 * V2（2026-08）：重新设计的完整数据集——
 * - 10 门课程（计算机/数学/英语/经管/物理），材料 pdf/ppt/doc/link 全覆盖
 * - 16 个排课时段（部分一周两节；weeks 模式多样化：1-16周 / 1-8周 / 3-12周 / 单周）
 * - 30 项任务：过去已归档 6、逾期 2、今天 2、未来 3 周内 ~16、无 DDL 4
 *   （预计耗时混合、子任务、关联课程资料、1 项关闭自动提醒）
 * - 日历：DDL mark 全覆盖 + 考试 4 场 + 活动 3 场（含历史月份内容）
 * - 13 个 StudyBlock（过去 4 + 今天 2 + 未来 7；manual/kiro 混合；
 *   未来块固定落在「下一周」内（+12/+13 天 = 下周六/周日），避免与课程重叠被 Timeline 抑制）
 * - 26 个 FocusSession（25 已完成 + 1 暂停，覆盖过去 3 周，跨 8 门课程与四时段）
 *   → 注入后 Focus backfill 生成完整学习历史，学习洞察呈现趋势/节奏/课程投入/执行质量
 * - 3 个小组项目（成员/任务/DDL/进度）
 * - 5 条提醒（assignment relative / studyBlock relative / standalone absolute / 已触发）
 * - 3 个排课例外（本周：停课 1、调课 1、补课 1）
 * 仅开发构建可用；生产 First Run 仍是空工作区。E2E 通过 window.__CLASSFLOW_E2E__ 禁用自动注入。
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
} from "@/types";
import { createDefaultSemester } from "@/lib/semester";

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

// ==================== 课程（10 门）====================

const courses: Course[] = [
  {
    id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼 102", credit: 4,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "线性表、树与图、排序与动态规划核心算法，每周配 2 次上机。",
    materials: [
      mat("m1", "第3章 树与二叉树讲义.pdf", "pdf", 5, "2.4 MB"),
      mat("m2", "算法可视化（Visualgo）", "link", 2, undefined, "https://visualgo.net/zh"),
      mat("m3", "期中复习要点（图论篇）.ppt", "ppt", 3, "6.2 MB"),
    ],
  },
  {
    id: "c2", name: "概率论与数理统计", code: "MATH-207", teacher: "陈教授", classroom: "教三 305", credit: 4,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "随机变量、参数估计与假设检验，作业以课后习题为主。",
    materials: [
      mat("m4", "第5章 大数定律与中心极限定理.pdf", "pdf", 4, "3.5 MB"),
      mat("m5", "常见分布速查表.pdf", "pdf", 6, "0.6 MB"),
    ],
  },
  {
    id: "c3", name: "操作系统", code: "CS-305", teacher: "赵教授", classroom: "计算机楼 208", credit: 3,
    bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032",
    description: "进程调度、内存管理与文件系统，含 3 次实验。",
    materials: [
      mat("m6", "进程调度课件.pptx", "ppt", 3, "8.1 MB"),
      mat("m7", "实验二：进程调度实验指导.doc", "doc", 2, "0.9 MB"),
      mat("m8", "虚拟内存专题复习.pdf", "pdf", 1, "2.8 MB"),
    ],
  },
  {
    id: "c4", name: "学术英语写作", code: "ENGL-302", teacher: "Sarah Johnson", classroom: "外语楼 207", credit: 2,
    bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032",
    description: "学术论文结构与引用规范（APA/MLA），每两周一篇 draft。",
    materials: [
      mat("m9", "APA 引用规范速查.pdf", "pdf", 7, "1.2 MB"),
      mat("m10", "Purdue OWL 写作指南", "link", 6, undefined, "https://owl.purdue.edu/owl/"),
    ],
  },
  {
    id: "c5", name: "计算机网络", code: "CS-310", teacher: "王教授", classroom: "计算机楼 305", credit: 3,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "TCP/IP 协议栈、网络编程与抓包实验。",
    materials: [
      mat("m11", "第4章 传输层协议.pdf", "pdf", 3, "5.8 MB"),
      mat("m12", "Wireshark 实验课件.pptx", "ppt", 1, "12.0 MB"),
    ],
  },
  {
    id: "c6", name: "数据库系统", code: "CS-204", teacher: "周教授", classroom: "计算机楼 104", credit: 4,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "关系模型、SQL 复杂查询、事务 ACID 与索引优化。",
    materials: [
      mat("m13", "MySQL 复杂 Join 与索引优化实战.pdf", "pdf", 2, "5.8 MB"),
      mat("m14", "实验四：嵌套查询实验指导.doc", "doc", 1, "1.1 MB"),
    ],
  },
  {
    id: "c7", name: "高等数学（下）", code: "MATH-112", teacher: "刘教授", classroom: "教三 201", credit: 5,
    bgHex: "#DCE3D5", borderHex: "#C6D2BC", textHex: "#313032",
    description: "多元函数微积分、重积分与级数。",
    materials: [
      mat("m15", "二重积分极坐标转换讲义.pdf", "pdf", 4, "3.1 MB"),
      mat("m16", "级数收敛判定速查表.pdf", "pdf", 5, "0.8 MB"),
    ],
  },
  {
    id: "c8", name: "管理学原理", code: "MGMT-101", teacher: "孙副教授", classroom: "教一 101", credit: 3,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "计划、组织、领导与控制四大职能与经典案例。",
    materials: [
      mat("m17", "组织行为与激励理论复习要点.pdf", "pdf", 7, "4.1 MB"),
      mat("m18", "经典管理案例集（第 2 章）", "link", 3, undefined, "https://hbr.org/"),
    ],
  },
  {
    id: "c9", name: "大学物理实验", code: "PHYS-120", teacher: "吴老师", classroom: "物理楼 301", credit: 2,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "示波器、迈克尔逊干涉仪等基础实验与数据处理。",
    materials: [
      mat("m19", "实验一：基本测量与误差分析.pdf", "pdf", 8, "2.0 MB"),
      mat("m20", "实验报告模板.doc", "doc", 5, "0.4 MB"),
    ],
  },
  {
    id: "c10", name: "人工智能导论", code: "CS-220", teacher: "郑教授", classroom: "计算机楼 401", credit: 3,
    bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032",
    description: "搜索、知识表示、机器学习基础与 AI 伦理讨论。",
    materials: [
      mat("m21", "第2章 搜索算法课件.pptx", "ppt", 2, "9.6 MB"),
      mat("m22", "感知机与线性模型讲义.pdf", "pdf", 1, "3.4 MB"),
      mat("m23", "AI 伦理案例研讨材料", "link", 6, undefined, "https://ai-ethics-lab.org/"),
    ],
  },
];

// ==================== 排课（16 节，覆盖周一到周六）====================

const schedules: CourseSchedule[] = [
  { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼 102", weeks: "1-16周" },
  { id: "s2", courseId: "c6", dayOfWeek: 1, startTime: "14:00", endTime: "15:40", location: "计算机楼 104", weeks: "1-16周" },
  { id: "s3", courseId: "c9", dayOfWeek: 1, startTime: "16:00", endTime: "17:40", location: "物理楼 301", weeks: "单周" },
  { id: "s4", courseId: "c7", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", location: "教三 201", weeks: "1-16周" },
  { id: "s5", courseId: "c2", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s6", courseId: "c8", dayOfWeek: 2, startTime: "14:00", endTime: "15:40", location: "教一 101", weeks: "1-16周" },
  { id: "s7", courseId: "c1", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "计算机楼 102", weeks: "1-16周" },
  { id: "s8", courseId: "c10", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "计算机楼 401", weeks: "1-16周", excludedWeeks: [5] },
  { id: "s9", courseId: "c3", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "计算机楼 208", weeks: "1-16周" },
  { id: "s10", courseId: "c8", dayOfWeek: 3, startTime: "16:00", endTime: "17:40", location: "教一 101", weeks: "1-16周" },
  { id: "s11", courseId: "c5", dayOfWeek: 4, startTime: "10:00", endTime: "11:40", location: "计算机楼 305", weeks: "1-16周" },
  { id: "s12", courseId: "c4", dayOfWeek: 4, startTime: "13:00", endTime: "14:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s13", courseId: "c7", dayOfWeek: 4, startTime: "16:00", endTime: "17:40", location: "教三 201", weeks: "1-16周" },
  { id: "s14", courseId: "c4", dayOfWeek: 5, startTime: "10:00", endTime: "11:40", location: "外语楼 207", weeks: "1-8周" },
  { id: "s15", courseId: "c2", dayOfWeek: 5, startTime: "14:00", endTime: "15:40", location: "教三 305", weeks: "1-16周" },
  { id: "s16", courseId: "c6", dayOfWeek: 5, startTime: "16:00", endTime: "17:40", location: "计算机楼 104", weeks: "1-16周" },
];

// ==================== 排课例外（本周：停课 1 / 调课 1 / 补课 1）====================

const scheduleOccurrenceOverrides: ScheduleOccurrenceOverride[] = [
  { id: "o1", kind: "cancel", courseId: "c1", baseScheduleId: "s7", week: 1, source: "manual" },
  { id: "o2", kind: "move", courseId: "c5", baseScheduleId: "s11", week: 1, dayOfWeek: 3, startTime: "18:00", endTime: "19:40", location: "计算机楼 305", source: "manual" },
  { id: "o3", kind: "extra", courseId: "c10", week: 1, dayOfWeek: 6, startTime: "09:00", endTime: "10:40", location: "计算机楼 401", source: "kiro" },
];

// ==================== 任务（30 项）====================

const assignments: Assignment[] = [
  // ---- 逾期（Focus 第一优先）----
  {
    id: "a1", courseId: "c3", title: "进程调度实验报告",
    description: "实现 SJF / RR 两种调度算法并对比周转时间，提交代码与实验报告。",
    ddl: iso(-1, 23, 59), priority: "urgent", status: "doing", progress: 60, estimatedMinutes: 180,
    tags: ["实验报告", "C语言"],
    materialIds: ["m7", "m6"],
    subtasks: [
      { id: "st1", title: "完成 RR 时间片轮转实现", completed: true },
      { id: "st2", title: "撰写调度对比分析", completed: false },
    ],
  },
  {
    id: "a2", courseId: "c2", title: "概率论线上小测（第 2 章）",
    description: "线上小测，覆盖条件概率与全概率公式。",
    ddl: iso(-1, 20, 0), priority: "medium", status: "doing", progress: 40,
    tags: ["线上测试"],
  },
  // ---- 今天截止 ----
  {
    id: "a3", courseId: "c2", title: "贝叶斯公式课后练习",
    description: "教材 P96 习题 3, 5, 8，重点练习全概率公式。",
    ddl: iso(0, 23, 59), priority: "high", status: "doing", progress: 70, estimatedMinutes: 90,
    tags: ["课后习题"],
  },
  {
    id: "a4", courseId: "c4", title: "Essay Draft: Renewable Energy",
    description: "完成 800 词学术写作初稿，引用至少 5 篇文献。",
    ddl: iso(0, 18, 0), priority: "high", status: "todo", progress: 20, estimatedMinutes: 150,
    tags: ["论文", "英文"],
    materialIds: ["m9"],
    subtasks: [
      { id: "st3", title: "文献检索与提纲", completed: true },
      { id: "st4", title: "撰写正文初稿", completed: false },
      { id: "st5", title: "格式与引用检查", completed: false },
    ],
  },
  // ---- 未来 1–14 天 ----
  {
    id: "a5", courseId: "c5", title: "TCP 三次握手抓包分析",
    description: "用 Wireshark 抓取 TCP 连接建立过程并标注各标志位。",
    ddl: iso(1, 21, 0), priority: "low", status: "doing", progress: 45, estimatedMinutes: 120,
    tags: ["实验", "Wireshark"],
    materialIds: ["m12"],
  },
  {
    id: "a6", courseId: "c2", title: "置信区间与假设检验小测",
    description: "线上小测，覆盖区间估计与 t 检验。",
    ddl: iso(2, 20, 0), priority: "medium", status: "todo", progress: 0,
    tags: ["线上测试"],
  },
  {
    id: "a7", courseId: "c1", title: "红黑树删除算法整理",
    description: "结合讲义推导删除的四种修正情形，整理成笔记。",
    ddl: iso(3, 23, 59), priority: "high", status: "todo", progress: 10, estimatedMinutes: 90,
    tags: ["复习笔记"],
    materialIds: ["m1"],
  },
  {
    id: "a8", courseId: "c6", title: "数据库实验四：复杂嵌套查询",
    description: "编写含 EXISTS / NOT EXISTS 与聚合子查询的 SQL，提交实验报告。",
    ddl: iso(4, 23, 59), priority: "low", status: "todo", progress: 0, estimatedMinutes: 120,
    tags: ["实验报告", "SQL"],
    materialIds: ["m14", "m13"],
  },
  {
    id: "a9", courseId: "c10", title: "期中复习提纲整理",
    description: "按章节整理考点清单与典型例题，供考前集中复习。",
    ddl: iso(5, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 90,
    tags: ["复习", "期中"],
  },
  {
    id: "a10", courseId: "c3", title: "虚拟内存期末项目设计",
    description: "设计并模拟页面置换算法（FIFO/LRU/CLOCK），产出设计文档。",
    ddl: iso(7, 23, 59), priority: "high", status: "todo", progress: 10, estimatedMinutes: 300,
    tags: ["课程设计"],
    materialIds: ["m8"],
    subtasks: [
      { id: "st6", title: "置换算法实现", completed: true },
      { id: "st7", title: "实验对比与设计文档", completed: false },
    ],
  },
  {
    id: "a11", courseId: "c4", title: "学术词汇表 Unit 7",
    description: "整理 Unit 7 高频学术词汇与例句。",
    ddl: iso(6, 21, 0), priority: "medium", status: "doing", progress: 50,
    tags: ["单词"],
  },
  {
    id: "a12", courseId: "c8", title: "管理案例分析：DTC 品牌",
    description: "分析 DTC 品牌的市场定位、SWOT 矩阵及社群传播路径，准备小组展示。",
    ddl: iso(8, 18, 0), priority: "high", status: "todo", progress: 0, estimatedMinutes: 180,
    tags: ["小组作业", "PPT汇报"],
  },
  {
    id: "a13", courseId: "c5", title: "TCP/IP 协议分析读书笔记",
    description: "阅读第 4 章并整理三次握手与拥塞控制笔记。",
    ddl: iso(9, 23, 59), priority: "low", status: "todo", progress: 0,
    tags: ["读书笔记"],
  },
  {
    id: "a14", courseId: "c7", title: "重积分专项训练",
    description: "教材 8.3–8.5 课后习题，重点练极坐标换序。",
    ddl: iso(10, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 60,
    tags: ["课后习题"],
  },
  {
    id: "a15", courseId: "c10", title: "感知机实现小项目",
    description: "用 Python 实现单层感知机并可视化决策边界。",
    ddl: iso(12, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 240,
    tags: ["编程实践"],
  },
  {
    id: "a16", courseId: "c7", title: "期中考试复习（第 6–9 章）",
    description: "重积分、级数与多元函数微分综合复习。",
    ddl: iso(14, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 240,
    tags: ["复习", "期中"],
  },
  {
    id: "a17", courseId: "c9", title: "实验三：示波器使用报告",
    description: "记录波形测量数据并完成误差分析。",
    ddl: iso(15, 23, 59), priority: "low", status: "todo", progress: 0, estimatedMinutes: 60,
    tags: ["实验报告"],
    materialIds: ["m19", "m20"],
  },
  {
    id: "a18", courseId: "c4", title: "Final Paper Outline",
    description: "确定论文题目与结构，产出大纲并接受同伴反馈。",
    ddl: iso(20, 23, 59), priority: "medium", status: "todo", progress: 0, estimatedMinutes: 120,
    tags: ["论文", "英文"],
  },
  {
    id: "a19", courseId: "c6", title: "数据库期末课程设计文档",
    description: "选课系统 ER 设计、3NF 规范化与实现说明。",
    ddl: iso(28, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 360,
    tags: ["课程设计", "期末"],
    autoReminderDisabled: true, // 演示：该任务关闭默认自动 DDL 提醒
  },
  // ---- 无 DDL ----
  {
    id: "a20", courseId: "c1", title: "LeetCode 每日一题（本周 5 题）",
    description: "按专题补 DP 与回溯的弱项。",
    priority: "medium", status: "todo", progress: 20, estimatedMinutes: 45,
    tags: ["算法练习"],
  },
  {
    id: "a21", courseId: "c1", title: "整理本周算法笔记",
    description: "把本周课上的图论内容整理成结构化笔记。",
    priority: "low", status: "doing", progress: 60,
    tags: ["复习笔记"],
  },
  {
    id: "a22", courseId: "c3", title: "编译原理公开课笔记补全",
    description: "补全上次公开课遗漏的语法分析部分。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 50,
    tags: ["笔记"],
  },
  {
    id: "a23", courseId: "c2", title: "大数定律专题精读",
    description: "精读教材 5.2–5.4 并完成思维导图。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 75,
    tags: ["复习笔记"],
  },
  {
    id: "a24", courseId: "c8", title: "企业沙盘小组分工表",
    description: "与组员确认沙盘模拟的角色分工与决策流程。",
    priority: "low", status: "todo", progress: 0,
    tags: ["小组作业"],
  },
  // ---- 已归档（过去 2 周内完成/提交）----
  {
    id: "a25", courseId: "c1", title: "栈与队列专项练习",
    description: "",
    ddl: iso(-14, 23, 59), priority: "low", status: "completed", progress: 100,
    tags: ["课后习题"],
  },
  {
    id: "a26", courseId: "c5", title: "局域网组网实验（实验二）",
    description: "交换机 VLAN 划分与静态路由配置。",
    ddl: iso(-9, 18, 0), priority: "medium", status: "submitted", progress: 100, estimatedMinutes: 90,
    tags: ["实验"],
  },
  {
    id: "a27", courseId: "c7", title: "高等数学级数与重积分测试",
    description: "线上测试，覆盖第 8–9 章。",
    ddl: iso(-6, 23, 59), priority: "high", status: "completed", progress: 100,
    tags: ["线上测试"],
  },
  {
    id: "a28", courseId: "c4", title: "英语演讲展示（Unit 5）",
    description: "5 分钟关于可持续商业策略的演讲。",
    ddl: iso(-4, 21, 0), priority: "medium", status: "completed", progress: 100, estimatedMinutes: 120,
    tags: ["演讲", "英文"],
  },
  {
    id: "a29", courseId: "c2", title: "概率论小测一",
    description: "第一章与第二章基础概念测试。",
    ddl: iso(-10, 23, 59), priority: "medium", status: "completed", progress: 100,
    tags: ["线上测试"],
  },
  {
    id: "a30", courseId: "c6", title: "数据库实验三：索引优化",
    description: "对比不同索引策略下的查询计划。",
    ddl: iso(-12, 18, 0), priority: "low", status: "completed", progress: 100, estimatedMinutes: 90,
    tags: ["实验报告"],
  },
];

// ==================== 学习计划 StudyBlock（过去 4 + 今天 2 + 未来 7）====================

const studyBlocks: StudyBlock[] = [
  { id: "b1", title: "数据库实验三：索引优化", date: dateStr(-10), startTime: "19:00", endTime: "20:30", assignmentId: "a30", courseId: "c6", source: "manual" },
  { id: "b2", title: "英语演讲展示（Unit 5）", date: dateStr(-5), startTime: "09:30", endTime: "11:00", assignmentId: "a28", courseId: "c4", source: "kiro" },
  { id: "b3", title: "局域网组网实验（实验二）", date: dateStr(-7), startTime: "15:00", endTime: "16:30", assignmentId: "a26", courseId: "c5", source: "kiro" },
  { id: "b4", title: "栈与队列专项练习", date: dateStr(-2), startTime: "19:00", endTime: "20:00", assignmentId: "a25", courseId: "c1", source: "manual" },
  { id: "b5", title: "Essay Draft: Renewable Energy", date: dateStr(0), startTime: "16:00", endTime: "17:30", assignmentId: "a4", courseId: "c4", source: "manual" },
  { id: "b6", title: "贝叶斯公式课后练习", date: dateStr(0), startTime: "19:30", endTime: "20:30", assignmentId: "a3", courseId: "c2", source: "kiro" },
  { id: "b7", title: "TCP 三次握手抓包分析", date: dateStr(1), startTime: "18:00", endTime: "20:00", assignmentId: "a5", courseId: "c5", source: "manual" },
  { id: "b8", title: "置信区间与假设检验小测", date: dateStr(2), startTime: "15:00", endTime: "16:30", assignmentId: "a6", courseId: "c2", source: "kiro" },
  { id: "b9", title: "红黑树删除算法整理", date: dateStr(3), startTime: "14:00", endTime: "15:30", assignmentId: "a7", courseId: "c1", source: "manual" },
  { id: "b10", title: "数据库实验四：复杂嵌套查询", date: dateStr(4), startTime: "19:00", endTime: "20:30", assignmentId: "a8", courseId: "c6", source: "manual" },
  { id: "b11", title: "大数定律专题精读", date: dateStr(13), startTime: "09:00", endTime: "10:15", assignmentId: "a23", courseId: "c2", source: "manual" },
  { id: "b12", title: "虚拟内存期末项目设计", date: dateStr(13), startTime: "15:00", endTime: "17:30", assignmentId: "a10", courseId: "c3", source: "manual" },
  { id: "b13", title: "虚拟内存期末项目设计（继续）", date: dateStr(12), startTime: "19:00", endTime: "20:30", assignmentId: "a10", courseId: "c3", source: "kiro" },
];

// ==================== 日历（DDL 全覆盖 + 考试 4 + 活动 3，含历史）====================

const calendarMarks: CalendarMark[] = [
  { id: "cm1", date: dateStr(-14), type: "ddl", title: "栈与队列专项练习", sourceId: "a25" },
  { id: "cm2", date: dateStr(-12), type: "ddl", title: "数据库实验三：索引优化", sourceId: "a30" },
  { id: "cm3", date: dateStr(-10), type: "ddl", title: "概率论小测一", sourceId: "a29" },
  { id: "cm4", date: dateStr(-10), type: "exam", title: "高等数学期中考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm5", date: dateStr(-9), type: "ddl", title: "局域网组网实验（实验二）", sourceId: "a26" },
  { id: "cm6", date: dateStr(-6), type: "ddl", title: "高等数学级数与重积分测试", sourceId: "a27" },
  { id: "cm7", date: dateStr(-4), type: "ddl", title: "英语演讲展示（Unit 5）", sourceId: "a28" },
  { id: "cm8", date: dateStr(-1), type: "ddl", title: "进程调度实验报告", sourceId: "a1" },
  { id: "cm9", date: dateStr(-1), type: "ddl", title: "概率论线上小测（第 2 章）", sourceId: "a2" },
  { id: "cm10", date: dateStr(0), type: "ddl", title: "贝叶斯公式课后练习", sourceId: "a3" },
  { id: "cm11", date: dateStr(0), type: "ddl", title: "Essay Draft: Renewable Energy", sourceId: "a4" },
  { id: "cm12", date: dateStr(1), type: "ddl", title: "TCP 三次握手抓包分析", sourceId: "a5" },
  { id: "cm13", date: dateStr(2), type: "ddl", title: "置信区间与假设检验小测", sourceId: "a6" },
  { id: "cm14", date: dateStr(3), type: "ddl", title: "红黑树删除算法整理", sourceId: "a7" },
  { id: "cm15", date: dateStr(7), type: "exam", title: "概率论小测验", startTime: "14:00", endTime: "16:00" },
  { id: "cm16", date: dateStr(4), type: "activity", title: "实验室开放日", startTime: "10:00", endTime: "12:00" },
  { id: "cm17", date: dateStr(5), type: "ddl", title: "期中复习提纲整理", sourceId: "a9" },
  { id: "cm18", date: dateStr(6), type: "ddl", title: "学术词汇表 Unit 7", sourceId: "a11" },
  { id: "cm19", date: dateStr(7), type: "ddl", title: "虚拟内存期末项目设计", sourceId: "a10" },
  { id: "cm20", date: dateStr(8), type: "activity", title: "学术沙龙与保研经验分享会", startTime: "15:00", endTime: "17:30" },
  { id: "cm21", date: dateStr(8), type: "ddl", title: "管理案例分析：DTC 品牌", sourceId: "a12" },
  { id: "cm22", date: dateStr(9), type: "ddl", title: "TCP/IP 协议分析读书笔记", sourceId: "a13" },
  { id: "cm23", date: dateStr(10), type: "ddl", title: "重积分专项训练", sourceId: "a14" },
  { id: "cm24", date: dateStr(12), type: "exam", title: "数据库期中考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm25", date: dateStr(14), type: "ddl", title: "期中考试复习（第 6–9 章）", sourceId: "a16" },
  { id: "cm26", date: dateStr(16), type: "activity", title: "保研经验分享会（第二场）", startTime: "14:00", endTime: "16:00" },
  { id: "cm27", date: dateStr(20), type: "ddl", title: "Final Paper Outline", sourceId: "a18" },
  { id: "cm28", date: dateStr(28), type: "ddl", title: "数据库期末课程设计文档", sourceId: "a19" },
  { id: "cm29", date: dateStr(30), type: "exam", title: "数据结构与算法期末考试", startTime: "09:00", endTime: "11:00" },
];

// ==================== 专注会话（25 已完成 + 1 暂停，覆盖过去 3 周）====================
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

const focusSeeds: FocusSeed[] = [
  // ---- 第 3 周（21–15 天前）----
  { id: "f1", days: -21, hour: 9, planned: 45, actualPct: 0.95, courseId: "c1", courseName: "数据结构与算法", assignmentId: "a25", assignmentTitle: "栈与队列专项练习", source: "manual" },
  { id: "f2", days: -20, hour: 20, planned: 60, actualPct: 1, courseId: "c2", courseName: "概率论与数理统计", assignmentId: "a29", assignmentTitle: "概率论小测一", source: "kiro" },
  { id: "f3", days: -19, hour: 14, planned: 30, actualPct: 1, courseId: "c3", courseName: "操作系统", source: "manual" },
  { id: "f4", days: -18, hour: 19, planned: 90, actualPct: 0.98, courseId: "c4", courseName: "学术英语写作", assignmentId: "a28", assignmentTitle: "英语演讲展示（Unit 5）", source: "kiro" },
  { id: "f5", days: -17, hour: 10, planned: 50, actualPct: 1, courseId: "c5", courseName: "计算机网络", assignmentId: "a26", assignmentTitle: "局域网组网实验（实验二）", note: "抓包实验数据整理", source: "manual" },
  { id: "f6", days: -16, hour: 9, planned: 60, actualPct: 1, courseId: "c6", courseName: "数据库系统", assignmentId: "a30", assignmentTitle: "数据库实验三：索引优化", source: "manual" },
  { id: "f7", days: -16, hour: 15, planned: 45, actualPct: 0.9, courseId: "c7", courseName: "高等数学（下）", source: "kiro" },
  { id: "f8", days: -15, hour: 20, planned: 30, actualPct: 0.65, courseId: "c8", courseName: "管理学原理", note: "临时有事提前结束", source: "manual" },
  // ---- 第 2 周（14–8 天前）----
  { id: "f9", days: -14, hour: 19, planned: 75, actualPct: 1, courseId: "c1", courseName: "数据结构与算法", source: "manual" },
  { id: "f10", days: -13, hour: 10, planned: 60, actualPct: 0.95, courseId: "c2", courseName: "概率论与数理统计", source: "kiro" },
  { id: "f11", days: -12, hour: 20, planned: 90, actualPct: 1, courseId: "c3", courseName: "操作系统", source: "manual" },
  { id: "f12", days: -11, hour: 14, planned: 50, actualPct: 0.9, courseId: "c4", courseName: "学术英语写作", source: "kiro" },
  { id: "f13", days: -10, hour: 19, planned: 60, actualPct: 1, courseId: "c5", courseName: "计算机网络", source: "manual" },
  { id: "f14", days: -9, hour: 9, planned: 120, actualPct: 1, courseId: "c6", courseName: "数据库系统", source: "manual" },
  { id: "f15", days: -9, hour: 15, planned: 60, actualPct: 0.95, courseId: "c7", courseName: "高等数学（下）", assignmentId: "a27", assignmentTitle: "高等数学级数与重积分测试", source: "kiro" },
  { id: "f16", days: -8, hour: 20, planned: 45, actualPct: 1, courseId: "c8", courseName: "管理学原理", source: "manual" },
  // ---- 第 1 周（7–1 天前）----
  { id: "f17", days: -7, hour: 19, planned: 90, actualPct: 0.98, courseId: "c1", courseName: "数据结构与算法", source: "manual" },
  { id: "f18", days: -6, hour: 14, planned: 60, actualPct: 0.75, courseId: "c2", courseName: "概率论与数理统计", note: "中途被打断", source: "manual" },
  { id: "f19", days: -5, hour: 20, planned: 45, actualPct: 1, courseId: "c3", courseName: "操作系统", source: "kiro" },
  { id: "f20", days: -4, hour: 9, planned: 50, actualPct: 1, courseId: "c4", courseName: "学术英语写作", source: "manual" },
  { id: "f21", days: -4, hour: 21, planned: 30, actualPct: 0.85, courseId: "c5", courseName: "计算机网络", source: "kiro" },
  { id: "f22", days: -3, hour: 15, planned: 60, actualPct: 1, courseId: "c6", courseName: "数据库系统", source: "manual" },
  { id: "f23", days: -2, hour: 9, planned: 90, actualPct: 0.98, courseId: "c7", courseName: "高等数学（下）", source: "manual" },
  { id: "f24", days: -2, hour: 15, planned: 45, actualPct: 0.9, courseId: "c8", courseName: "管理学原理", source: "kiro" },
  { id: "f25", days: -1, hour: 19, planned: 60, actualPct: 1, courseId: "c1", courseName: "数据结构与算法", assignmentId: "a7", assignmentTitle: "红黑树删除算法整理", source: "manual" },
  { id: "f26", days: -1, hour: 15, planned: 30, actualPct: 1, courseId: "c2", courseName: "概率论与数理统计", assignmentId: "a3", assignmentTitle: "贝叶斯公式课后练习", source: "kiro" },
  // ---- 今天：已完成 + 暂停各 1 ----
  { id: "f27", days: 0, hour: 9, planned: 45, actualPct: 1, courseId: "c3", courseName: "操作系统", assignmentId: "a1", assignmentTitle: "进程调度实验报告", source: "manual" },
];

const focusSessions: FocusSession[] = focusSeeds.map((s) => {
  const startedAt = ts(s.days, s.hour, s.minute ?? 0);
  const actualMs = Math.round(s.planned * s.actualPct * 60_000);
  const plannedMs = s.planned * 60_000;
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
  id: "f28",
  plannedMinutes: 50,
  startedAt: ts(0, 15, 30),
  accumulatedActiveMs: 20 * 60_000,
  status: "paused",
  courseId: "c4",
  courseNameSnapshot: "学术英语写作",
  assignmentId: "a4",
  assignmentTitleSnapshot: "Essay Draft: Renewable Energy",
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
    progress: 50,
    updatedAt: dateStr(0),
    members: [
      { id: "gm1", name: "张同学", role: "leader", major: "计算机科学与技术" },
      { id: "gm2", name: "李晨", role: "member", major: "软件工程" },
      { id: "gm3", name: "王雨桐", role: "member", major: "人工智能" },
      { id: "gm4", name: "陈昊", role: "member", major: "计算机科学与技术" },
    ],
    tasks: [
      { id: "gt1", title: "需求分析与图建模", assigneeId: "gm1", ddl: iso(-2, 23, 59), completed: true },
      { id: "gt2", title: "Dijkstra 算法实现", assigneeId: "gm2", ddl: iso(3, 23, 59), completed: true },
      { id: "gt3", title: "UI 原型与地图渲染", assigneeId: "gm3", ddl: iso(7, 23, 59), completed: false },
      { id: "gt4", title: "测试与报告撰写", assigneeId: "gm4", ddl: iso(12, 23, 59), completed: false },
    ],
  },
  {
    id: "g2",
    courseId: "c4",
    title: "AI Ethics 小组论文",
    description: "围绕生成式 AI 的学术伦理争议完成 1500 词英文论文，两人一组互评。",
    progress: 50,
    updatedAt: dateStr(-1),
    members: [
      { id: "gm5", name: "张同学", role: "leader" },
      { id: "gm6", name: "赵一鸣", role: "member", major: "翻译" },
    ],
    tasks: [
      { id: "gt5", title: "文献综述与论点梳理", assigneeId: "gm5", ddl: iso(5, 23, 59), completed: true },
      { id: "gt6", title: "正文撰写与 Peer Review", assigneeId: "gm6", ddl: iso(15, 23, 59), completed: false },
    ],
  },
  {
    id: "g3",
    courseId: "c8",
    title: "企业运营模拟沙盘",
    description: "四人小组完成 6 期企业运营决策模拟，期末提交复盘报告。",
    progress: 33,
    updatedAt: dateStr(0),
    members: [
      { id: "gm7", name: "张同学", role: "leader", major: "信息管理" },
      { id: "gm8", name: "刘思远", role: "member", major: "工商管理" },
      { id: "gm9", name: "陈昊", role: "member", major: "市场营销" },
      { id: "gm10", name: "王雨桐", role: "member", major: "会计学" },
    ],
    tasks: [
      { id: "gt7", title: "市场调研与战略初稿", assigneeId: "gm7", ddl: iso(1, 18, 0), completed: true },
      { id: "gt8", title: "前两期运营决策", assigneeId: "gm8", ddl: iso(4, 23, 59), completed: false },
      { id: "gt9", title: "中期复盘与财务分析", assigneeId: "gm9", ddl: iso(9, 23, 59), completed: false },
    ],
  },
];

// ==================== 提醒（5 条）====================

const reminders: Reminder[] = [
  {
    id: "r1", title: "置信区间小测前 1 小时提醒", targetType: "assignment", targetId: "a6",
    timingMode: "relative", offsetMinutes: -60, triggerAt: iso(2, 19, 0), status: "scheduled",
    source: "manual", createdAt: iso(-1, 10, 0), updatedAt: iso(-1, 10, 0),
  },
  {
    id: "r2", title: "抓包分析开始前提醒", targetType: "studyBlock", targetId: "b7",
    timingMode: "relative", offsetMinutes: -30, triggerAt: iso(1, 17, 30), status: "scheduled",
    source: "kiro", createdAt: iso(-2, 12, 0), updatedAt: iso(-2, 12, 0),
  },
  {
    id: "r3", title: "记得带实验报告打印件", targetType: "standalone",
    timingMode: "absolute", triggerAt: iso(1, 19, 0), status: "scheduled",
    source: "manual", createdAt: iso(-3, 9, 0), updatedAt: iso(-3, 9, 0),
  },
  {
    id: "r4", title: "栈与队列专项练习开始提醒", targetType: "assignment", targetId: "a25",
    timingMode: "relative", offsetMinutes: -30, triggerAt: iso(-2, 18, 30), status: "fired",
    firedAt: iso(-2, 18, 30), source: "auto", createdAt: iso(-5, 8, 0), updatedAt: iso(-2, 18, 30),
  },
  {
    id: "r5", title: "虚拟内存项目提交前 1 天提醒", targetType: "assignment", targetId: "a10",
    timingMode: "relative", offsetMinutes: -1440, triggerAt: iso(6, 23, 59), status: "scheduled",
    source: "manual", createdAt: iso(-1, 21, 0), updatedAt: iso(-1, 21, 0),
  },
];

// ==================== 组装 ====================

export function buildFullDemoData(): ClassFlowBackupData {
  return {
    userProfile: {
      name: "张同学",
      avatarUrl: "",
      college: "信息科学与技术学院",
      grade: "大二 · 2024级",
      studentId: "20240819034",
      completedCredits: 34,
      totalCredits: 52,
    },
    semester: createDefaultSemester(),
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    studyBlocks,
    reminders,
    focusSessions,
    scheduleOccurrenceOverrides,
  };
}

/** ?preview=task-v2 兼容别名（与自动注入同一份全模块数据） */
export function buildTaskV2PreviewData(): ClassFlowBackupData {
  return buildFullDemoData();
}
