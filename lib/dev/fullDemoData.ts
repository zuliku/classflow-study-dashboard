/**
 * Dev Demo fixture：完整模块演示数据（开发模式自动注入 + ?preview=task-v2 强制注入共用）。
 * 覆盖全模块验证矩阵：
 * - 总览：课程/排课/任务/DDL 逾期徽章/日历 mark/学期
 * - 任务工作区 V2：六视图全覆盖（focus 五组全有：逾期/今日截止/今日已排/doing/urgent-high 3 天内）、
 *   无 DDL 任务、estimatedMinutes（<60/整时/混合/缺失）、多段 StudyBlock 累计、submitted/completed 归档
 * - 时间表：StudyBlock（manual/kiro）+ exam/activity interval + 课程排课硬约束
 * - 课程资料：5 门课各带材料（pdf/ppt/doc/link 四类）
 * - 学习统计：任务状态分布/优先级分布/课程负荷实算
 * - 小组协作：2 个项目（成员/任务/DDL/进度派生）
 * - Kiro：全部业务数据可查（任务/课程/安排/健康）
 * 仅开发构建可用；生产 First Run 仍是空工作区。E2E 通过 window.__CLASSFLOW_E2E__ 禁用自动注入。
 * 注意：本文件被 page.tsx dynamic import，永不参与生产 bundle。
 */

import { ClassFlowBackupData, Course, CourseSchedule, Assignment, CalendarMark, StudyBlock, GroupProject, Material } from "@/types";
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

const mat = (id: string, title: string, type: Material["type"], daysAgo: number, size?: string, url?: string): Material => ({
  id,
  title,
  type,
  size,
  uploadDate: dateStr(-daysAgo),
  url,
});

const courses: Course[] = [
  {
    id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼 102", credit: 4,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "线性表、树与图、排序与动态规划核心算法，每周配 2 次上机。",
    materials: [
      mat("m1", "第3章 树与二叉树讲义.pdf", "pdf", 5, "2.4 MB"),
      mat("m2", "算法可视化（Visualgo）", "link", 2, undefined, "https://visualgo.net/zh"),
    ],
  },
  {
    id: "c2", name: "概率论与数理统计", code: "MATH-207", teacher: "陈教授", classroom: "教三 305", credit: 4,
    bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032",
    description: "随机变量、参数估计与假设检验，作业以课后习题为主。",
    materials: [
      mat("m3", "第5章 大数定律与中心极限定理.pdf", "pdf", 4, "3.5 MB"),
    ],
  },
  {
    id: "c3", name: "操作系统", code: "CS-305", teacher: "赵教授", classroom: "计算机楼 208", credit: 3,
    bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032",
    description: "进程调度、内存管理与文件系统，含 3 次实验。",
    materials: [
      mat("m4", "进程调度课件.pptx", "ppt", 3, "8.1 MB"),
      mat("m5", "实验二：进程调度实验指导.doc", "doc", 2, "0.9 MB"),
    ],
  },
  {
    id: "c4", name: "学术英语写作", code: "ENGL-302", teacher: "Sarah Johnson", classroom: "外语楼 207", credit: 2,
    bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032",
    description: "学术论文结构与引用规范（APA/MLA），每两周一篇 draft。",
    materials: [
      mat("m6", "APA 引用规范速查.pdf", "pdf", 7, "1.2 MB"),
      mat("m7", "Purdue OWL 写作指南", "link", 6, undefined, "https://owl.purdue.edu/owl/"),
    ],
  },
  {
    id: "c5", name: "计算机网络", code: "CS-310", teacher: "王教授", classroom: "计算机楼 305", credit: 3,
    bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032",
    description: "TCP/IP 协议栈、网络编程与抓包实验。",
    materials: [
      mat("m8", "第4章 传输层协议.pdf", "pdf", 3, "5.8 MB"),
      mat("m9", "Wireshark 实验课件.pptx", "ppt", 1, "12.0 MB"),
    ],
  },
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
    // Task 6A：关联本课程实验指导与课件（真实存在的 c3.materials）
    materialIds: ["m5", "m4"],
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
    // Task 6A：关联本课程 Wireshark 实验课件
    materialIds: ["m9"],
  },
  // 今天截止 + 今天有 block
  {
    id: "a5", courseId: "c4", title: "Essay Draft: Renewable Energy",
    description: "完成 800 词学术写作初稿，引用至少 5 篇文献。",
    ddl: iso(0, 18, 0), priority: "high", status: "todo", progress: 0, estimatedMinutes: 150,
    tags: ["论文", "英文"],
    // Task 6A：关联本课程 APA 引用规范速查
    materialIds: ["m6"],
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
  { id: "cm4", date: dateStr(1), type: "ddl", title: "TCP 三次握手抓包分析", sourceId: "a4" },
  { id: "cm5", date: dateStr(2), type: "ddl", title: "置信区间与检验小测", sourceId: "a6" },
  { id: "cm6", date: dateStr(2), type: "ddl", title: "期中复习提纲整理", sourceId: "a15" },
  { id: "cm7", date: dateStr(5), type: "ddl", title: "虚拟内存期末项目设计", sourceId: "a7" },
  { id: "cm8", date: dateStr(9), type: "ddl", title: "TCP/IP 协议分析读书笔记", sourceId: "a8" },
  { id: "cm9", date: dateStr(-3), type: "ddl", title: "局域网组网实验（实验二）", sourceId: "a12" },
  { id: "cm10", date: dateStr(6), type: "exam", title: "概率论小测验", startTime: "14:00", endTime: "16:00" },
  { id: "cm11", date: dateStr(14), type: "exam", title: "数据结构期中考试", startTime: "09:00", endTime: "11:00" },
  { id: "cm12", date: dateStr(10), type: "activity", title: "学术沙龙与保研经验分享会", startTime: "15:00", endTime: "17:30" },
];

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
      { id: "gm6", name: "赵一鸣", role: "member" },
    ],
    tasks: [
      { id: "gt5", title: "文献综述与论点梳理", assigneeId: "gm5", ddl: iso(5, 23, 59), completed: true },
      { id: "gt6", title: "正文撰写与 Peer Review", assigneeId: "gm6", ddl: iso(15, 23, 59), completed: false },
    ],
  },
];

export function buildFullDemoData(): ClassFlowBackupData {
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
    groupProjects,
    studyBlocks,
  };
}

/** ?preview=task-v2 兼容别名（与自动注入同一份全模块数据） */
export function buildTaskV2PreviewData(): ClassFlowBackupData {
  return buildFullDemoData();
}
