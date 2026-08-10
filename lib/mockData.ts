import { Course, CourseSchedule, Assignment, CalendarMark, UserProfile, GroupProject } from "@/types";

// Helper functions to generate dynamic relative dates matching current local time
const pad2 = (n: number) => String(n).padStart(2, "0");

// 本地时间语义：产出无 Z 的本地 ISO 字符串（"YYYY-MM-DDTHH:mm:ss"）
const getRelativeISO = (daysOffset: number, hour = 23, minute = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(hour)}:${pad2(minute)}:00`;
};

const getRelativeDateStr = (daysOffset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const initialUserProfile: UserProfile = {
  name: "张同学",
  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  college: "经济与管理学院",
  grade: "大三 · 2022级",
  studentId: "20220819034",
  completedCredits: 64,
  totalCredits: 80,
};

export const initialCourses: Course[] = [
  {
    id: "c_1",
    name: "微观经济学",
    code: "ECON-201",
    teacher: "王教授",
    classroom: "教二 201",
    credit: 4,
    bgHex: "#E3E6E0",
    borderHex: "#D0D5CC",
    textHex: "#313032",
    description: "涵盖供求理论、消费者行为、生产成本分析与完全/不完全竞争市场结构分析。",
    materials: [
      { id: "m1", title: "第一章 供求曲线与弹性分析.pdf", type: "pdf", size: "2.4 MB", uploadDate: getRelativeDateStr(-5) },
      { id: "m2", title: "消费者均衡与无差异曲线大纲.ppt", type: "ppt", size: "8.1 MB", uploadDate: getRelativeDateStr(-2) },
    ],
  },
  {
    id: "c_2",
    name: "高等数学",
    code: "MATH-102",
    teacher: "陈教授",
    classroom: "教三 305",
    credit: 5,
    bgHex: "#F0EBE1",
    borderHex: "#E0D7C6",
    textHex: "#313032",
    description: "包含多元函数微积分、重积分、级数展开及常微分方程基础应用。",
    materials: [
      { id: "m3", title: "二重积分极坐标转换技巧讲义.pdf", type: "pdf", size: "3.5 MB", uploadDate: getRelativeDateStr(-4) },
    ],
  },
  {
    id: "c_3",
    name: "英语口语",
    code: "ENGL-301",
    teacher: "Sarah Johnson",
    classroom: "外语楼 207",
    credit: 2,
    bgHex: "#F0EBE1",
    borderHex: "#E0D7C6",
    textHex: "#313032",
    description: "商务演讲表达、跨文化学术沟通与辩论技巧实战课程。",
    materials: [
      { id: "m4", title: "Unit 4 Business Presentation Template.pptx", type: "ppt", size: "12.0 MB", uploadDate: getRelativeDateStr(-1) },
    ],
  },
  {
    id: "c_4",
    name: "数据分析",
    code: "STAT-205",
    teacher: "强教授",
    classroom: "信科 403",
    credit: 3,
    bgHex: "#CCCBC4",
    borderHex: "#B8B7B0",
    textHex: "#313032",
    description: "利用 Python/R 进行数据预处理、假设检验、线性回归模型构建与可视化。",
    materials: [
      { id: "m5", title: "Lab 3 Pandas 数据清洗与回归拟合代码.ipynb", type: "doc", size: "1.2 MB", uploadDate: getRelativeDateStr(-3) },
    ],
  },
  {
    id: "c_5",
    name: "管理学原理",
    code: "MGMT-101",
    teacher: "刘副教授",
    classroom: "教一 101",
    credit: 3,
    bgHex: "#CDB9AB",
    borderHex: "#BBA494",
    textHex: "#313032",
    description: "计划、组织、领导与控制四大基本管理职能剖析及经典案例分析。",
    materials: [
      { id: "m6", title: "组织行为与激励理论复习要点.pdf", type: "pdf", size: "4.1 MB", uploadDate: getRelativeDateStr(-7) },
    ],
  },
  {
    id: "c_6",
    name: "数据库系统",
    code: "CS-204",
    teacher: "李教授",
    classroom: "计算机楼 102",
    credit: 4,
    bgHex: "#E3E6E0",
    borderHex: "#D0D5CC",
    textHex: "#313032",
    description: "关系型数据库 ER 模型建模、SQL 复杂查询、事务 ACID 与索引优化。",
    materials: [
      { id: "m7", title: "MySQL 复杂 Join 与索引优化实战.pdf", type: "pdf", size: "5.8 MB", uploadDate: getRelativeDateStr(-2) },
    ],
  },
];

export const initialSchedules: CourseSchedule[] = [
  { id: "s1", courseId: "c_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教二 201", weeks: "1-16周" },
  { id: "s2", courseId: "c_2", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s3", courseId: "c_4", dayOfWeek: 1, startTime: "14:00", endTime: "15:40", location: "信科 403", weeks: "1-16周" },
  
  { id: "s4", courseId: "c_3", dayOfWeek: 2, startTime: "13:00", endTime: "14:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s5", courseId: "c_5", dayOfWeek: 2, startTime: "16:00", endTime: "17:40", location: "教一 101", weeks: "1-16周" },

  { id: "s6", courseId: "c_1", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "教二 201", weeks: "1-16周" },
  { id: "s7", courseId: "c_2", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s8", courseId: "c_4", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "信科 403", weeks: "1-16周" },

  { id: "s9", courseId: "c_3", dayOfWeek: 4, startTime: "10:00", endTime: "11:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s10", courseId: "c_6", dayOfWeek: 4, startTime: "14:00", endTime: "15:40", location: "计算机楼 102", weeks: "1-16周" },

  { id: "s11", courseId: "c_3", dayOfWeek: 5, startTime: "10:00", endTime: "11:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s12", courseId: "c_5", dayOfWeek: 5, startTime: "16:00", endTime: "17:40", location: "教一 101", weeks: "1-16周" },
];

export const initialAssignments: Assignment[] = [
  {
    id: "a1",
    courseId: "c_4",
    title: "计量经济学大作业（第3章）",
    description: "利用多元回归分析影响中国居民消费水平的核心因素，提交分析报告与 R/Python 代码文件。",
    ddl: getRelativeISO(1, 23, 59), // 明天 23:59 截止
    priority: "urgent",
    status: "doing",
    progress: 75,
    tags: ["实证分析", "回归模型"],
    // Task 6A：关联所属课程（数据分析）的真实资料
    materialIds: ["m5"],
    subtasks: [
      { id: "st1", title: "完成数据清洗与变量定义", completed: true },
      { id: "st2", title: "拟合回归模型并测试异方差", completed: true },
      { id: "st3", title: "撰写结论与政策建议", completed: false },
    ],
  },
  {
    id: "a2",
    courseId: "c_5",
    title: "市场营销案例汇报",
    description: "分析 DTC 品牌（如新能源汽车或咖啡品类）的市场定位、SWOT 矩阵及社群传播路径。",
    ddl: getRelativeISO(2, 18, 0), // 2天后 18:00 截止
    priority: "high",
    status: "doing",
    progress: 40,
    tags: ["小组作业", "PPT汇报"],
    subtasks: [
      { id: "st4", title: "收集竞品营销数据", completed: true },
      { id: "st5", title: "制作 PPT 汇报模板", completed: false },
    ],
  },
  {
    id: "a3",
    courseId: "c_3",
    title: "英语演讲PPT (Unit 6)",
    description: "Prepare a 5-minute presentation about 'Sustainable Business Strategies in 2025'.",
    ddl: getRelativeISO(4, 21, 0), // 4天后 21:00 截止
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: ["个人作业", "演讲"],
    // Task 6A：关联所属课程（英语口语）的演讲模板资料
    materialIds: ["m4"],
  },
  {
    id: "a4",
    courseId: "c_6",
    title: "数据库实验报告（实验四）",
    description: "设计高校选课系统的 ER 图、3NF 规范化关系表，并在 MySQL 中编写复杂嵌套 SQL 查询语句。",
    ddl: getRelativeISO(5, 23, 59), // 5天后 23:59 截止
    priority: "low",
    status: "todo",
    progress: 0,
    tags: ["实验报告", "SQL"],
    // Task 6A：关联所属课程（数据库系统）的 MySQL 实战资料
    materialIds: ["m7"],
  },
  {
    id: "a5",
    courseId: "c_1",
    title: "微观经济学课后习题（第5章）",
    description: "完成教材 P142 习题 1, 4, 7 题，涉及垄断竞争与寡头博弈模型计算。",
    ddl: getRelativeISO(7, 23, 59), // 7天后 23:59 截止
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: ["课后习题"],
  },
  {
    id: "a6",
    courseId: "c_2",
    title: "高等数学级数与重积分测试",
    description: "复习教材第 8-9 章重积分与幂级数求和公式，完成线上测试。",
    ddl: getRelativeISO(-2, 23, 59), // 2天前已完成
    priority: "high",
    status: "completed",
    progress: 100,
    tags: ["线上测试"],
  },
];

// 小组项目默认空：首次进入是正常产品 Empty State，不预置示例团队。
export const initialGroupProjects: GroupProject[] = [];

export const initialCalendarMarks: CalendarMark[] = [
  { id: "cm1", date: getRelativeDateStr(1), type: "ddl", title: "计量经济学大作业（第3章）", sourceId: "a1" },
  { id: "cm2", date: getRelativeDateStr(2), type: "ddl", title: "市场营销案例汇报", sourceId: "a2" },
  { id: "cm3", date: getRelativeDateStr(8), type: "exam", title: "微观经济学期中考试" },
  { id: "cm4", date: getRelativeDateStr(12), type: "activity", title: "学术沙龙与毕业论文动员会" },
];
