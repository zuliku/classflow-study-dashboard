/**
 * Dev Preview fixture：?preview=task-v2
 * 注入 Task V2 Workspace 完整演示数据，覆盖开发验证矩阵：
 * - 六视图全覆盖：focus（逾期/今日截止/今日安排/doing/urgent-high 3 天内 五组全有）、
 *   today（Do Date ≠ Due Date）、upcoming（明天/2/5/9 天升序）、unscheduled、all、archive
 * - 无 DDL 任务（行「无截止日期」+ Peek「未设置」+ 编辑回填关闭）
 * - estimatedMinutes 覆盖：<60 / 整小时 / 混合 / 缺失
 * - StudyBlock：单段 / 多段累计（a7 = 240min）/ 今日已排（a3、a5）/ 未来已排（a4、a7、a11）
 * - 状态：todo / doing / submitted / completed；优先级：urgent / high / medium / low
 * - 子任务（部分完成）、标签、逾期徽章、5 门课程筛选、exam/activity CalendarMark
 * 仅开发构建 + 用户确认后注入；与生产 First Run（空工作区）无冲突。
 * 注意：本文件被 page.tsx dynamic import，永不参与生产 bundle。
 */

import { ClassFlowBackupData, Course, CourseSchedule, Assignment, CalendarMark, StudyBlock } from "@/types";
import { createDefaultSemester } from "@/lib/semester";

const pad2 = (n: number) => String(n).padStart(2, "0");

const iso = (daysOffset: number, hour = 23, minute = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(hour)}:${pad2(minute)}:00`;
};

const dateStr = (daysOffset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const courses: Course[] = [
  { id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼 102", credit: 4, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "线性表、树与图、排序与动态规划核心算法。", materials: [] },
  { id: "c2", name: "概率论与数理统计", code: "MATH-207", teacher: "陈教授", classroom: "教三 305", credit: 4, bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032", description: "随机变量、参数估计与假设检验。", materials: [] },
  { id: "c3", name: "操作系统", code: "CS-305", teacher: "赵教授", classroom: "计算机楼 208", credit: 3, bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032", description: "进程调度、内存管理与文件系统。", materials: [] },
  { id: "c4", name: "学术英语写作", code: "ENGL-302", teacher: "Sarah Johnson", classroom: "外语楼 207", credit: 2, bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032", description: "学术论文结构与引用规范。", materials: [] },
  { id: "c5", name: "计算机网络", code: "CS-310", teacher: "王教授", classroom: "计算机楼 305", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "TCP/IP 协议栈与网络编程基础。", materials: [] },
];

const schedules: CourseSchedule[] = [
  { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼 102", weeks: "1-16周" },
  { id: "s2", courseId: "c2", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s3", courseId: "c3", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "计算机楼 208", weeks: "1-16周" },
  { id: "s4", courseId: "c4", dayOfWeek: 4, startTime: "13:00", endTime: "14:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s5", courseId: "c5", dayOfWeek: 5, startTime: "10:00", endTime: "11:40", location: "计算机楼 305", weeks: "1-16周" },
];

const assignments: Assignment[] = [
  // 逾期（Focus 第一优先）
  {
    id: "a1", courseId: "c3", title: "进程调度实验报告",
    description: "实现 SJF / RR 两种调度算法并对比周转时间，提交代码与实验报告。",
    ddl: iso(-1, 23, 59), priority: "urgent", status: "doing", progress: 60,
    tags: ["实验报告", "C语言"],
    subtasks: [
      { id: "st1", title: "完成 RR 时间片轮转实现", completed: true },
      { id: "st2", title: "撰写调度对比分析", completed: false },
    ],
  },
  // 今天截止
  {
    id: "a2", courseId: "c2", title: "贝叶斯公式课后练习",
    description: "教材 P96 习题 3, 5, 8，重点练习全概率公式。",
    ddl: iso(0, 23, 59), priority: "high", status: "doing", progress: 30, estimatedMinutes: 90,
    tags: ["课后习题"],
  },
  // 今天有 StudyBlock（无 DDL 但安排了学习）
  {
    id: "a3", courseId: "c1", title: "红黑树删除算法整理",
    description: "结合讲义推导删除的四种修正情形，整理成笔记。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 60,
    tags: ["复习笔记"],
  },
  // doing + 明天截止（upcoming 首项，同时是 Focus 的 doing 组）
  {
    id: "a4", courseId: "c5", title: "TCP 三次握手抓包分析",
    description: "用 Wireshark 抓取 TCP 连接建立过程并标注各标志位。",
    ddl: iso(1, 21, 0), priority: "low", status: "doing", progress: 45, estimatedMinutes: 120,
    tags: ["实验", "Wireshark"],
  },
  // 今天截止 + 今天有 block
  {
    id: "a5", courseId: "c4", title: "Essay Draft: Renewable Energy",
    description: "完成 800 词学术写作初稿，引用至少 5 篇文献。",
    ddl: iso(0, 18, 0), priority: "high", status: "todo", progress: 0, estimatedMinutes: 150,
    tags: ["论文", "英文"],
    subtasks: [
      { id: "st3", title: "文献检索与提纲", completed: true },
      { id: "st4", title: "撰写正文初稿", completed: false },
      { id: "st5", title: "格式与引用检查", completed: false },
    ],
  },
  // 后天截止（upcoming 中部）
  {
    id: "a6", courseId: "c2", title: "置信区间与检验小测",
    description: "线上小测，覆盖区间估计与 t 检验。",
    ddl: iso(2, 20, 0), priority: "medium", status: "todo", progress: 0,
    tags: ["线上测试"],
  },
  // high + 2 天后截止、无安排（Focus 第四组：urgent/high 3 天内，非 overdue/today/doing）
  {
    id: "a15", courseId: "c1", title: "期中复习提纲整理",
    description: "按章节整理考点清单与典型例题，供考前集中复习。",
    ddl: iso(2, 23, 59), priority: "high", status: "todo", progress: 0, estimatedMinutes: 90,
    tags: ["复习", "期中"],
  },
  // 5 天后 + 两段 StudyBlock（upcoming；scheduledMinutes 多 block 累计 = 2.5h + 1.5h）
  {
    id: "a7", courseId: "c3", title: "虚拟内存期末项目设计",
    description: "设计并模拟页面置换算法（FIFO/LRU/CLOCK），产出设计文档。",
    ddl: iso(5, 23, 59), priority: "high", status: "todo", progress: 10, estimatedMinutes: 300,
    tags: ["课程设计"],
  },
  // 9 天后（upcoming 尾部）
  {
    id: "a8", courseId: "c5", title: "TCP/IP 协议分析读书笔记",
    description: "阅读第 4 章并整理三次握手与拥塞控制笔记。",
    ddl: iso(9, 23, 59), priority: "low", status: "todo", progress: 0,
    tags: ["读书笔记"],
  },
  // 无 DDL 无 block（unscheduled）
  {
    id: "a9", courseId: "c1", title: "刷 LeetCode 每日一题（本周 5 题）",
    description: "按专题补 DP 与回溯的弱项。",
    priority: "medium", status: "todo", progress: 20, estimatedMinutes: 45,
    tags: ["算法练习"],
  },
  {
    id: "a10", courseId: "c4", title: "整理本周学术词汇表",
    description: "整理 Unit 7 高频学术词汇与例句。",
    priority: "low", status: "doing", progress: 50,
    tags: ["单词"],
  },
  // 无 DDL 但有下周 block（all 可见；不属于 unscheduled）
  {
    id: "a11", courseId: "c2", title: "大数定律专题精读",
    description: "精读教材 5.2-5.4 并完成思维导图。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 75,
    tags: ["复习笔记"],
  },
  // 已提交（archive）
  {
    id: "a12", courseId: "c5", title: "局域网组网实验（实验二）",
    description: "交换机 VLAN 划分与静态路由配置。",
    ddl: iso(-3, 18, 0), priority: "medium", status: "submitted", progress: 100,
    tags: ["实验"],
  },
  // 已完成 无 DDL（archive）
  {
    id: "a13", courseId: "c1", title: "栈与队列专项练习",
    description: "",
    priority: "low", status: "completed", progress: 100,
    tags: ["课后习题"],
  },
  // 无 DDL 无 block（unscheduled 第二）
  {
    id: "a14", courseId: "c3", title: "编译原理公开课笔记补全",
    description: "补全上次公开课遗漏的语法分析部分。",
    priority: "medium", status: "todo", progress: 0, estimatedMinutes: 50,
    tags: ["笔记"],
  },
];

const studyBlocks: StudyBlock[] = [
  { id: "b1", title: "红黑树删除算法整理", date: dateStr(0), startTime: "19:00", endTime: "20:00", assignmentId: "a3", courseId: "c1", source: "manual" },
  { id: "b2", title: "Essay Draft: Renewable Energy", date: dateStr(0), startTime: "20:30", endTime: "21:30", assignmentId: "a5", courseId: "c4", source: "kiro" },
  { id: "b3", title: "TCP 三次握手抓包分析", date: dateStr(1), startTime: "18:00", endTime: "20:00", assignmentId: "a4", courseId: "c5", source: "manual" },
  { id: "b4", title: "虚拟内存期末项目设计", date: dateStr(2), startTime: "15:00", endTime: "17:30", assignmentId: "a7", courseId: "c3", source: "manual" },
  { id: "b6", title: "虚拟内存期末项目设计（继续）", date: dateStr(3), startTime: "14:00", endTime: "15:30", assignmentId: "a7", courseId: "c3", source: "kiro" },
  { id: "b5", title: "大数定律专题精读", date: dateStr(6), startTime: "09:00", endTime: "10:15", assignmentId: "a11", courseId: "c2", source: "manual" },
];

const calendarMarks: CalendarMark[] = [
  { id: "cm1", date: dateStr(-1), type: "ddl", title: "进程调度实验报告", sourceId: "a1" },
  { id: "cm2", date: dateStr(0), type: "ddl", title: "贝叶斯公式课后练习", sourceId: "a2" },
  { id: "cm3", date: dateStr(0), type: "ddl", title: "Essay Draft: Renewable Energy", sourceId: "a5" },
  { id: "cm4", date: dateStr(2), type: "ddl", title: "TCP 三次握手抓包分析", sourceId: "a4" },
  { id: "cm5", date: dateStr(2), type: "ddl", title: "置信区间与检验小测", sourceId: "a6" },
  { id: "cm6", date: dateStr(5), type: "ddl", title: "虚拟内存期末项目设计", sourceId: "a7" },
  { id: "cm7", date: dateStr(9), type: "ddl", title: "TCP/IP 协议分析读书笔记", sourceId: "a8" },
  { id: "cm8", date: dateStr(-3), type: "ddl", title: "局域网组网实验（实验二）", sourceId: "a12" },
  { id: "cm9", date: dateStr(14), type: "exam", title: "数据结构期中考试" },
  { id: "cm10", date: dateStr(10), type: "activity", title: "学术沙龙与保研经验分享会" },
];

export function buildTaskV2PreviewData(): ClassFlowBackupData {
  return {
    userProfile: {
      name: "张同学",
      avatarUrl: "",
      college: "信息科学与技术学院",
      grade: "大二 · 2024级",
      studentId: "20240819034",
      completedCredits: 30,
      totalCredits: 48,
    },
    semester: createDefaultSemester(),
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects: [],
    studyBlocks,
  };
}
