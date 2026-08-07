import { Course, CourseSchedule, Assignment, CalendarMark, UserProfile } from "@/types";

export const initialUserProfile: UserProfile = {
  name: "张同学",
  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  college: "经济与管理学院",
  grade: "大三 · 2022级",
  studentId: "20220819024",
  completedCredits: 64,
  totalCredits: 80,
};

export const initialCourses: Course[] = [
  {
    id: "c1",
    name: "微观经济学",
    code: "ECON-201",
    teacher: "王教授",
    classroom: "教二 201",
    credit: 4,
    bgHex: "#E3E6E0",      // Pastel Mint tint
    borderHex: "#D0D5CC",
    textHex: "#313032",
    description: "本课程涵盖供求理论、消费者行为理论、生产与成本理论、市场结构以及博弈论基础。",
    materials: [
      { id: "m1", title: "微观经济学第5章-市场均衡与弹性.pdf", type: "pdf", size: "3.4 MB", uploadDate: "2026-08-01" },
      { id: "m2", title: "博弈论与纳什均衡讲义.ppt", type: "ppt", size: "8.1 MB", uploadDate: "2026-08-04" },
    ],
  },
  {
    id: "c2",
    name: "高等数学",
    code: "MATH-102",
    teacher: "陈教授",
    classroom: "教三 305",
    credit: 5,
    bgHex: "#F0EBE1",      // Alabaster tint
    borderHex: "#E0D7C6",
    textHex: "#313032",
    description: "多元函数微积分、无穷级数、常微分方程以及空间解析几何。",
    materials: [
      { id: "m3", title: "偏导数与全微分精讲.pdf", type: "pdf", size: "4.2 MB", uploadDate: "2026-07-28" },
      { id: "m4", title: "重积分计算技巧与习题解答.pdf", type: "pdf", size: "5.6 MB", uploadDate: "2026-08-02" },
    ],
  },
  {
    id: "c3",
    name: "英语口语",
    code: "ENGL-301",
    teacher: "Sarah Johnson",
    classroom: "外语楼 207",
    credit: 2,
    bgHex: "#E3DDD2",      // Alba soft tint
    borderHex: "#D5CBC0",
    textHex: "#313032",
    description: "Focuses on academic presentation, spontaneous discourse, debate skills, and cross-cultural communication.",
    materials: [
      { id: "m5", title: "Unit 6 Presentation Guidelines.pdf", type: "pdf", size: "1.8 MB", uploadDate: "2026-08-03" },
      { id: "m6", title: "Academic Vocabulary & Phrasebank.doc", type: "doc", size: "650 KB", uploadDate: "2026-07-25" },
    ],
  },
  {
    id: "c4",
    name: "数据分析",
    code: "DATA-204",
    teacher: "强教授",
    classroom: "信科 403",
    credit: 3,
    bgHex: "#CCCBC4",      // Ashy Beige tint
    borderHex: "#B8B7B0",
    textHex: "#313032",
    description: "数据清洗、探索性数据分析(EDA)、Python/Pandas实战以及统计推断基础。",
    materials: [
      { id: "m7", title: "Python数据处理与Pandas核心用法.ipynb", type: "doc", size: "2.1 MB", uploadDate: "2026-08-02" },
      { id: "m8", title: "期末项目数据集 (Financial_Data.csv)", type: "doc", size: "12.4 MB", uploadDate: "2026-08-05" },
    ],
  },
  {
    id: "c5",
    name: "管理学原理",
    code: "MGMT-101",
    teacher: "刘副教授",
    classroom: "教一 101",
    credit: 3,
    bgHex: "#CDB9AB",      // Stone Beige tint
    borderHex: "#BBA494",
    textHex: "#313032",
    description: "探讨计划、组织、领导与控制四大核心管理职能，结合现代企业案例分析。",
    materials: [
      { id: "m9", title: "经典管理学案例集解析.pdf", type: "pdf", size: "6.8 MB", uploadDate: "2026-07-30" },
    ],
  },
  {
    id: "c6",
    name: "计量经济学",
    code: "ECON-401",
    teacher: "张教授",
    classroom: "经管楼 502",
    credit: 4,
    bgHex: "#A48F82",      // Sandrift tint
    borderHex: "#8D786B",
    textHex: "#FFFFFF",
    description: "经典多元线性回归模型、异方差性、自相关性以及Stata/R实证应用。",
    materials: [
      { id: "m10", title: "Stata回归分析与假设检验操作手册.pdf", type: "pdf", size: "7.9 MB", uploadDate: "2026-08-04" },
    ],
  },
  {
    id: "c7",
    name: "市场营销学",
    code: "MKT-202",
    teacher: "赵教授",
    classroom: "商学院 302",
    credit: 3,
    bgHex: "#F0EBE1",
    borderHex: "#DCD4C7",
    textHex: "#313032",
    description: "STP战略、4P营销组合、消费者心理分析及数字营销前沿趋势。",
    materials: [
      { id: "m11", title: "品牌传播与社群营销案例库.ppt", type: "ppt", size: "9.3 MB", uploadDate: "2026-08-01" },
    ],
  },
  {
    id: "c8",
    name: "数据库系统",
    code: "CS-302",
    teacher: "李教授",
    classroom: "计算机楼 102",
    credit: 3,
    bgHex: "#E3E6E0",
    borderHex: "#CFD4CB",
    textHex: "#313032",
    description: "关系数据库理论、SQL进阶查询、数据库设计范式与事务处理机制。",
    materials: [
      { id: "m12", title: "SQL复杂查询与索引优化导图.pdf", type: "pdf", size: "3.1 MB", uploadDate: "2026-08-03" },
    ],
  },
];

export const initialSchedules: CourseSchedule[] = [
  // Monday
  { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教二 201", weeks: "1-16周" },
  { id: "s2", courseId: "c2", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s3", courseId: "c4", dayOfWeek: 1, startTime: "14:00", endTime: "15:40", location: "信科 403", weeks: "1-16周" },

  // Tuesday
  { id: "s4", courseId: "c3", dayOfWeek: 2, startTime: "13:00", endTime: "14:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s5", courseId: "c5", dayOfWeek: 2, startTime: "16:00", endTime: "17:40", location: "教一 101", weeks: "1-16周" },

  // Wednesday
  { id: "s6", courseId: "c1", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "教二 201", weeks: "1-16周" },
  { id: "s7", courseId: "c2", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教三 305", weeks: "1-16周" },
  { id: "s8", courseId: "c4", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "信科 403", weeks: "1-16周" },

  // Thursday
  { id: "s9", courseId: "c7", dayOfWeek: 4, startTime: "09:00", endTime: "10:40", location: "商学院 302", weeks: "1-16周" },
  { id: "s10", courseId: "c8", dayOfWeek: 4, startTime: "14:00", endTime: "15:40", location: "计算机楼 102", weeks: "1-16周" },

  // Friday
  { id: "s11", courseId: "c3", dayOfWeek: 5, startTime: "10:00", endTime: "11:40", location: "外语楼 207", weeks: "1-16周" },
  { id: "s12", courseId: "c5", dayOfWeek: 5, startTime: "16:00", endTime: "17:40", location: "教一 101", weeks: "1-16周" },
];

export const initialAssignments: Assignment[] = [
  {
    id: "a1",
    courseId: "c6", // 计量经济学
    title: "计量经济学作业（第3章）",
    description: "使用 Stata 对面板数据进行多元线性回归分析，检验异方差性并输出标准化系数表格与拟合曲线。",
    ddl: "2026-08-09T23:59:00.000Z",
    priority: "urgent",
    status: "doing",
    progress: 60,
    tags: ["作业", "实证分析"],
    subtasks: [
      { id: "st1", title: "清理面板数据并对变量取对数", completed: true },
      { id: "st2", title: "运行OLS回归与异方差 White 检验", completed: true },
      { id: "st3", title: "撰写实证结果分析与结论段落", completed: false },
    ],
  },
  {
    id: "a2",
    courseId: "c7", // 市场营销学
    title: "市场营销案例汇报",
    description: "选择一家新兴DTC品牌，分析其4P策略与社交媒体引流路径，制作10分钟演讲Slides。",
    ddl: "2026-08-10T23:59:00.000Z",
    priority: "high",
    status: "doing",
    progress: 45,
    tags: ["小组作业", "PPT汇报"],
    subtasks: [
      { id: "st4", title: "确定分析品牌（完美日记 / 瑞幸）", completed: true },
      { id: "st5", title: "收集财务与社群营销数据", completed: false },
      { id: "st6", title: "排版与美化幻灯片", completed: false },
    ],
  },
  {
    id: "a3",
    courseId: "c3", // 英语口语
    title: "英语演讲PPT (Unit 6)",
    description: "Prepare a 3-minute oral presentation topic on 'AI in Modern Higher Education'. Include 4 key slides.",
    ddl: "2026-08-11T18:00:00.000Z",
    priority: "medium",
    status: "todo",
    progress: 20,
    tags: ["个人作业", "Presentation"],
    subtasks: [
      { id: "st7", title: "Write speech script", completed: true },
      { id: "st8", title: "Practice pronunciation and timing", completed: false },
    ],
  },
  {
    id: "a4",
    courseId: "c8", // 数据库系统
    title: "数据库实验报告（实验四）",
    description: "编写 SQL 复杂嵌套查询语句，建立视图与存储过程，测试事务隔离级别效果。",
    ddl: "2026-08-12T23:59:00.000Z",
    priority: "low",
    status: "todo",
    progress: 0,
    tags: ["实验报告", "SQL"],
    subtasks: [
      { id: "st9", title: "完成实验四SQL题目解答", completed: false },
      { id: "st10", title: "截屏数据库运行日志并导出PDF", completed: false },
    ],
  },
  {
    id: "a5",
    courseId: "c1", // 微观经济学
    title: "课后习题（第5章）",
    description: "完成教材第124页 5-1 至 5-8 题计算题，要求手写拍照或LaTeX排版导出。",
    ddl: "2026-08-14T23:59:00.000Z",
    priority: "medium",
    status: "todo",
    progress: 10,
    tags: ["课后习题"],
  },
  {
    id: "a6",
    courseId: "c2", // 高等数学
    title: "高等数学期中练习题集",
    description: "复习一元与多元微积分极值问题，完成在线测试系统第三套模拟卷。",
    ddl: "2026-08-06T23:59:00.000Z",
    priority: "high",
    status: "completed",
    progress: 100,
    tags: ["复习测试"],
  },
];

export const initialCalendarMarks: CalendarMark[] = [
  // Courses
  { id: "cm1", date: "2026-08-03", type: "course", title: "微观经济学 & 高等数学" },
  { id: "cm2", date: "2026-08-04", type: "course", title: "英语口语 & 管理学原理" },
  { id: "cm3", date: "2026-08-05", type: "course", title: "微观经济学 & 数据分析" },
  { id: "cm4", date: "2026-08-06", type: "course", title: "市场营销 & 数据库系统" },
  { id: "cm5", date: "2026-08-07", type: "course", title: "英语口语 & 管理学原理" },

  // DDLs
  { id: "cm6", date: "2026-08-09", type: "ddl", title: "计量经济学作业截止" },
  { id: "cm7", date: "2026-08-10", type: "ddl", title: "市场营销案例汇报截止" },
  { id: "cm8", date: "2026-08-11", type: "ddl", title: "英语演讲PPT截止" },
  { id: "cm9", date: "2026-08-12", type: "ddl", title: "数据库实验报告截止" },
  { id: "cm10", date: "2026-08-14", type: "ddl", title: "微观经济学习题截止" },

  // Exam & Activity
  { id: "cm11", date: "2026-08-21", type: "exam", title: "高等数学期中测试" },
  { id: "cm12", date: "2026-08-28", type: "activity", title: "学术讲座：AI与经济学应用" },
];

export const mockStudyLoadData = [
  { day: "周一", hours: 3.5, courseHours: 2.5, taskHours: 1.0 },
  { day: "周二", hours: 4.2, courseHours: 2.0, taskHours: 2.2 },
  { day: "周三", hours: 5.0, courseHours: 3.0, taskHours: 2.0 },
  { day: "周四", hours: 3.8, courseHours: 1.8, taskHours: 2.0 },
  { day: "周五", hours: 3.0, courseHours: 2.0, taskHours: 1.0 },
  { day: "周六", hours: 1.5, courseHours: 0.0, taskHours: 1.5 },
  { day: "周日", hours: 3.5, courseHours: 0.5, taskHours: 3.0 },
];
