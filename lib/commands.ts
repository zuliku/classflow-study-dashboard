import type { ElementType } from "react";
import {
  Plus,
  BookOpen,
  FileUp,
  FileText,
  File,
  Presentation,
  Image,
  Link as LinkIcon,
  GraduationCap,
  CalendarDays,
  Settings,
  RotateCcw,
  CalendarRange,
  ClipboardCheck,
  Bell,
  CheckCircle2,
  Play,
  Flag,
  Trash2,
} from "lucide-react";
import { NavTab, Course, Assignment, Semester, TimeSliceFilter, Priority, Material, CalendarMark } from "@/types";
import type { AssignmentActions } from "@/lib/assignmentActions";
import { openAssignmentEditor, previewMaterial } from "@/lib/uiEvents";
import {
  WORKSPACE_NAV_ITEMS,
  KIRO_ICON,
} from "@/components/layout/navItems";
import { TASK_WORKSPACE_VIEWS, TaskWorkspaceView } from "@/lib/tasks/taskViews";

/**
 * Command Registry：Command Center / Context Menu / 键盘快捷键 共用的唯一动作源。
 * 不要为三处各写一套动作实现。
 *
 * App Chrome V2（单一事实源）：
 * - Navigation Commands ← WORKSPACE_NAV_ITEMS（Sidebar / BottomNav / Command Center 共用 id/label/icon）
 * - Task View Commands ← TASK_WORKSPACE_VIEWS（ViewBar / Command Center / Kiro scope 共用）
 * - Global Action metadata（提醒 / 设置）由 navItems 的 GLOBAL_NAV_ACTIONS 派生
 * 动作实现仍通过宿主 context/store action 注入（metadata 不直接依赖 Zustand）。
 */

export type CommandGroup = "context" | "views" | "navigate" | "create" | "action" | "search";

export interface CommandContext {
  activeTab: NavTab;
  selectedCourseId: string | null;
  selectedAssignmentId: string | null;
  courses: Course[];
  assignments: Assignment[];
  /** CalendarMark 实体（Workflow UX V3）：exam/activity 进入全局搜索 */
  calendarMarks: CalendarMark[];
  semester: Semester;
  currentSemesterWeek: number;
  // Assignment Workspace 选择上下文（highlight / selection 驱动）
  highlightedAssignmentId: string | null;
  assignmentSelection: string[];
  assignmentActions: AssignmentActions;
  // 动作（由宿主注入，避免 lib 依赖 store）
  setActiveTab: (tab: NavTab) => void;
  setSettingsModalOpen: (open: boolean) => void;
  /** 任务视图命令：切工作区 + 切换视图（原子） */
  setAssignmentWorkspaceView: (view: TaskWorkspaceView) => void;
  /** 打开 Reminder Center 面板 */
  openReminderCenter: () => void;
  setSelectedCourseId: (id: string | null) => void;
  setSelectedAssignmentId: (id: string | null) => void;
  /** CalendarMark Detail 唯一 ownership（Workflow UX V2 contract） */
  setSelectedCalendarMarkId: (id: string | null) => void;
  setAddCourseModalOpen: (open: boolean) => void;
  setImportScheduleModalOpen: (open: boolean) => void;
  setFullTimetableModalOpen: (open: boolean) => void;
  setAssignmentTimeSlice: (slice: TimeSliceFilter) => void;
  resetToCurrentWeek: () => void;
  close: () => void;
}

export interface AppCommand {
  id: string;
  label: string;
  keywords?: string[];
  group: CommandGroup;
  /** 显示用快捷键（必须是真实实现过的） */
  shortcut?: string;
  icon: ElementType;
  when?: (ctx: CommandContext) => boolean;
  /** 上下文命令的来源语义：entity=选中的实体；workspace=工作区操作目标 */
  contextScope?: "entity" | "workspace";
  run: (ctx: CommandContext) => void;
}

/** 导航命令的补充关键词（label 已含工作区全名；这里保留旧版搜索习惯词） */
const NAV_KEYWORDS: Record<NavTab, string[]> = {
  overview: ["总览", "首页"],
  timetable: ["时间表", "课表"],
  assignments: ["任务", "ddl"],
  courses: ["课程"],
  analytics: ["分析", "学习洞察"],
  group: ["小组"],
  kiro: ["kiro", "ai"],
};

/**
 * 第一版命令集（顺序即空查询展示顺序：创建 → 前往 → 视图 → 操作）。
 * 事实源：WORKSPACE_NAV_ITEMS（导航）+ TASK_WORKSPACE_VIEWS（任务视图）。
 */
export function getCommands(): AppCommand[] {
  return [
  // ---- Create ----
  // 所有「打开任务编辑器」入口统一走 lib/uiEvents.ts 的 openAssignmentEditor
  { id: "create-task", label: "新建任务", keywords: ["任务", "todo"], group: "create", shortcut: "N", icon: Plus, run: (ctx) => { openAssignmentEditor({}); ctx.close(); } },
    { id: "create-course", label: "新建课程", keywords: ["课程", "add"], group: "create", icon: BookOpen, run: (ctx) => { ctx.setAddCourseModalOpen(true); ctx.close(); } },
    { id: "import-schedule", label: "导入课表", keywords: ["导入", "课表", "import"], group: "create", icon: FileUp, run: (ctx) => { ctx.setImportScheduleModalOpen(true); ctx.close(); } },
    // ---- Navigate（工作区 Tab：与 Sidebar / BottomNav 共享同一 metadata） ----
    ...WORKSPACE_NAV_ITEMS.map((item) => ({
      id: `nav-${item.id}`,
      label: `前往${item.label}`,
      keywords: [item.label, ...(NAV_KEYWORDS[item.id] ?? [])],
      group: "navigate" as CommandGroup,
      icon: item.icon,
      run: (ctx: CommandContext) => {
        ctx.setActiveTab(item.id);
        ctx.close();
      },
    })),
    // ---- Views（任务工作区视图：与 ViewBar / Kiro scope 共享同一事实源） ----
    ...TASK_WORKSPACE_VIEWS.map((view) => ({
      id: `view-${view.id}`,
      label: `任务与 DDL → ${view.label}`,
      keywords: [view.label, "任务", "视图", "ddl"],
      group: "views" as CommandGroup,
      icon: ClipboardCheck,
      run: (ctx: CommandContext) => {
        // 原子：切工作区 + 切换视图 + 关闭
        ctx.setActiveTab("assignments");
        ctx.setAssignmentWorkspaceView(view.id);
        ctx.close();
      },
    })),
    // ---- Global Action ----
    { id: "open-settings", label: "打开设置", keywords: ["设置", "settings", "偏好"], group: "action", icon: Settings, run: (ctx) => { ctx.setSettingsModalOpen(true); ctx.close(); } },
    { id: "open-reminders", label: "打开提醒", keywords: ["提醒", "通知", "reminder", "bell"], group: "action", icon: Bell, run: (ctx) => { ctx.openReminderCenter(); ctx.close(); } },
    // ---- Action ----
    { id: "today-assignments", label: "前往今日任务", keywords: ["今日", "任务", "today"], group: "action", icon: ClipboardCheck, run: (ctx) => { ctx.setActiveTab("assignments"); ctx.setAssignmentTimeSlice("today"); ctx.close(); } },
    { id: "reset-week", label: "回到本周", keywords: ["本周", "周次", "reset"], group: "action", icon: RotateCcw, run: (ctx) => { ctx.resetToCurrentWeek(); ctx.setActiveTab("timetable"); ctx.close(); } },
    { id: "open-full-timetable", label: "打开完整课表", keywords: ["全屏", "课表", "完整"], group: "action", icon: CalendarRange, run: (ctx) => { ctx.setActiveTab("timetable"); ctx.setFullTimetableModalOpen(true); ctx.close(); } },
  ];
}

// ---- 搜索匹配（不引入 fuzzy 库：normalize + terms×fields 包含匹配 + keywords） ----

/** 旧版单串归一化：trim + lowercase + 去除全部空白（命令 keywords 匹配保持原行为） */
export function normalizeQuery(query: string): string {
  return (query || "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Search V2 归一化（Global Search V2）：
 * NFKC（全角→半角等兼容折叠）+ lowercase + trim + 连续空白折叠为单空格。
 * 供 queryTerms 分词使用；不做语言学处理。
 */
export function normalizeSearchText(text: string): string {
  return (text || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

/** 查询分词："  计量   讲义 " → ["计量", "讲义"]；空串 → [] */
export function queryTerms(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

/** 多 Term × 多字段匹配：每个 term 至少被某个字段包含（字段经 normalizeSearchText） */
export function matchesFields(
  fields: Array<string | undefined | null>,
  terms: string[]
): boolean {
  if (terms.length === 0) return false;
  const normalized = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .map((f) => normalizeSearchText(f));
  return terms.every((term) => normalized.some((f) => f.includes(term)));
}

function fieldMatch(field: string, q: string): boolean {
  const f = (field || "").toLowerCase();
  return f.includes(q) || f.startsWith(q);
}

export function commandMatches(cmd: AppCommand, q: string): boolean {
  if (!q) return false;
  if (fieldMatch(cmd.label, q)) return true;
  return (cmd.keywords ?? []).some((k) => fieldMatch(k, q));
}

// ---- 实体搜索投影（Search V2）：字段集合 + 多 term 匹配 ----

const PRIORITY_ALIASES: Record<Priority, string[]> = {
  urgent: ["urgent", "紧急"],
  high: ["high", "高", "高优先级"],
  medium: ["medium", "中"],
  low: ["low", "低"],
};

const STATUS_ALIASES: Record<string, string[]> = {
  todo: ["todo", "待办", "未开始"],
  doing: ["doing", "进行中"],
  submitted: ["submitted", "已提交"],
  completed: ["completed", "已完成"],
};

/** Material type 的中英文常用检索词（只作搜索 alias，不改 Domain type） */
export const MATERIAL_TYPE_ALIASES: Record<Material["type"], string[]> = {
  pdf: ["pdf"],
  ppt: ["ppt", "pptx", "演示文稿", "课件"],
  doc: ["doc", "docx", "文档"],
  image: ["image", "png", "jpg", "jpeg", "图片"],
  link: ["link", "链接", "url"],
};

export const MATERIAL_TYPE_LABELS: Record<Material["type"], string> = {
  pdf: "PDF",
  ppt: "PPT",
  doc: "DOC",
  image: "图片",
  link: "链接",
};

/** 合法本地日期 "YYYY-MM-DD" → 可搜索表现（原始 + M月D日）；非法输入返回空集。
 *  Assignment DDL 与 CalendarMark date 共用（不复制两份日期解析）。 */
function dateSearchFields(datePart: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return [];
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return [];
  return [datePart, `${month}月${day}日`];
}

/** DDL "YYYY-MM-DDTHH:mm..." → 日期可搜索字段 */
function ddlDateFields(ddl: string | undefined): string[] {
  if (!ddl) return [];
  return dateSearchFields(ddl.slice(0, 10));
}

/** Course 可搜索字段：name / code / teacher / classroom / description */
export function courseSearchFields(course: Course): string[] {
  return [course.name, course.code, course.teacher, course.classroom, course.description];
}

export function courseMatches(course: Course, terms: string[]): boolean {
  return matchesFields(courseSearchFields(course), terms);
}

/**
 * Assignment 可搜索字段（Search projection，不复制 Course object 进 domain）：
 * title / description / tags / priority aliases / status aliases / DDL 日期 + course.name/code。
 * courseLookup 由调用方构建一次（避免逐项 .find()）。
 */
export function assignmentSearchFields(
  assignment: Assignment,
  courseLookup: Map<string, Course>
): string[] {
  const fields: string[] = [
    assignment.title,
    assignment.description,
    ...(assignment.tags ?? []),
    ...(PRIORITY_ALIASES[assignment.priority] ?? []),
    ...(STATUS_ALIASES[assignment.status] ?? []),
    ...ddlDateFields(assignment.ddl),
  ];
  const course = assignment.courseId ? courseLookup.get(assignment.courseId) : undefined;
  if (course) {
    fields.push(course.name, course.code);
  }
  return fields;
}

export function assignmentMatches(
  assignment: Assignment,
  terms: string[],
  courseLookup: Map<string, Course>
): boolean {
  return matchesFields(assignmentSearchFields(assignment, courseLookup), terms);
}

/**
 * Material 可搜索字段：title / type aliases / 所属课程 name+code（上下文 term）。
 * Flood 防护规则：至少一个 term 必须命中 material 自身（title/type），
 * 课程字段只能补足其余 term——仅搜课程名不会倾倒该课全部资料。
 */
export function materialSearchFields(
  material: Material,
  course: Course | undefined
): { selfFields: string[]; contextFields: string[] } {
  const selfFields = [
    material.title,
    ...(MATERIAL_TYPE_ALIASES[material.type] ?? []),
  ];
  const contextFields = course ? [course.name, course.code] : [];
  return { selfFields, contextFields };
}

export function materialMatches(
  material: Material,
  terms: string[],
  course: Course | undefined
): boolean {
  const { selfFields, contextFields } = materialSearchFields(material, course);
  const norm = (arr: string[]) => arr.map((f) => normalizeSearchText(f));
  const self = norm(selfFields);
  const context = norm(contextFields);
  // 至少一个 term 命中资料自身字段（title/type）
  const selfHit = terms.some((t) => self.some((f) => f.includes(t)));
  if (!selfHit) return false;
  // 其余 term 允许由所属课程补足
  return terms.every((t) => self.some((f) => f.includes(t)) || context.some((f) => f.includes(t)));
}

// ---- CalendarMark 搜索（Workflow UX V3）：仅 exam / activity ----

const CALENDAR_TYPE_ALIASES: Record<"exam" | "activity", string[]> = {
  exam: ["exam", "考试", "测验"],
  activity: ["activity", "活动", "日程", "event"],
};

/**
 * CalendarMark 可搜索字段（真实 Domain 字段，不发明关系）：
 * title / type aliases / date（YYYY-MM-DD + M月D日）/ startTime / endTime。
 * CalendarMark 无 courseId——禁止凭空推导课程关系（如「计量 考试」不会命中）。
 */
export function calendarMarkSearchFields(mark: CalendarMark): string[] {
  return [
    mark.title,
    ...(CALENDAR_TYPE_ALIASES[mark.type as "exam" | "activity"] ?? []),
    ...dateSearchFields(mark.date),
    ...(mark.startTime ? [mark.startTime] : []),
    ...(mark.endTime ? [mark.endTime] : []),
  ];
}

// ---- Palette 结果模型 ----

export type PaletteItemKind = "command" | "course" | "assignment" | "material" | "calendar";

/** Material 结果图标：复用 lucide 既有视觉，不为此重构 PaletteItem.icon 接口 */
const MATERIAL_ICONS: Record<Material["type"], ElementType> = {
  pdf: FileText,
  ppt: Presentation,
  doc: File,
  image: Image,
  link: LinkIcon,
};

export interface PaletteItem {
  key: string;
  kind: PaletteItemKind;
  /** 分组标题（组内按此排序） */
  group: CommandGroup;
  /** 上下文命令的来源语义（entity/workspace），用于 palette 内轻量分段 */
  contextScope?: "entity" | "workspace";
  label: string;
  sub?: string;
  shortcut?: string;
  icon: ElementType;
  run: () => void;
}

const GROUP_LABEL: Record<CommandGroup, string> = {
  context: "当前",
  views: "视图",
  navigate: "前往",
  create: "创建",
  action: "操作",
  search: "搜索结果",
};

export const GROUP_LABELS = GROUP_LABEL;

// ---- 选中实体 helpers（when 校验与 run 防 stale 共用） ----

export function getSelectedCourse(ctx: CommandContext): Course | null {
  if (!ctx.selectedCourseId) return null;
  return ctx.courses.find((c) => c.id === ctx.selectedCourseId) ?? null;
}

export function getSelectedAssignment(ctx: CommandContext): Assignment | null {
  if (!ctx.selectedAssignmentId) return null;
  return ctx.assignments.find((a) => a.id === ctx.selectedAssignmentId) ?? null;
}

/**
 * 课程 / 任务 Context Commands（entity scope）：
 * 只在对应实体确实存在时通过 when 显示；run 内再做轻量 defensive check（不 throw）。
 * 打开任务编辑器一律复用 openAssignmentEditor，不复制 editor 状态。
 * contextScope = "entity"：表达「当前打开/选中的实体」。
 */
export function getContextCommands(ctx: CommandContext): AppCommand[] {
  const commands: AppCommand[] = [];
  const course = getSelectedCourse(ctx);
  if (course) {
    commands.push({
      id: "ctx-course-new-task",
      label: `为《${course.name}》新建任务`,
      keywords: [course.name, "任务", "新建", "课程"],
      group: "context",
      contextScope: "entity",
      icon: Plus,
      when: (c) => !!getSelectedCourse(c),
      run: (c) => {
        const cur = getSelectedCourse(c);
        if (!cur) return; // stale：课程已删除，静默退出
        openAssignmentEditor({ courseId: cur.id });
        c.close();
      },
    });
  }

  const assignment = getSelectedAssignment(ctx);
  if (assignment) {
    commands.push({
      id: "ctx-assignment-edit",
      label: `编辑「${assignment.title}」`,
      keywords: [assignment.title, "编辑", "任务"],
      group: "context",
      contextScope: "entity",
      icon: Plus,
      when: (c) => !!getSelectedAssignment(c),
      run: (c) => {
        const cur = getSelectedAssignment(c);
        if (!cur) return; // stale：任务已删除，静默退出
        openAssignmentEditor({ assignmentId: cur.id });
        c.close();
      },
    });
  }

  return commands;
}

/**
 * 任务工作区上下文命令（contextScope = "workspace"）：
 * 操作目标遵循统一优先级：selection.length > 0 → selection；否则 highlightedAssignmentId。
 * Command Center 与 Context Menu 共用。
 *
 * Dedupe（仅针对 Assignment 场景的轻量规则，不做通用 engine）：
 * 当 workspace 目标恰为 entity 上下文选中的同一任务（selectedAssignmentId === 目标 id）时，
 * entity 的「编辑『任务名』」已提供编辑动作，因此跳过重复的 打开任务 / 编辑任务，
 * 避免「编辑『论文』」与「编辑当前任务」并列。完成/优先级/删除等不同动作正常保留。
 * Context Menu 场景不传 selectedAssignmentId，dedupe 不触发，菜单仍显示完整动作。
 */
export function getAssignmentContextCommands(
  ctx: Pick<
    CommandContext,
    "assignmentActions" | "highlightedAssignmentId" | "selectedAssignmentId" | "close"
  >,
  ids: string[]
): AppCommand[] {
  if (ids.length === 0) return [];
  const a = ctx.assignmentActions;
  const n = ids.length;
  const single = n === 1;
  // 目标直接进入 label：单项「当前任务」/ 多项「已选 N 项」，不重复追加计数
  const targetLabel = single ? "当前任务" : `已选 ${n} 项`;
  const commands: AppCommand[] = [];
  // entity 上下文已覆盖同一任务的编辑 → 跳过重复的 打开/编辑
  const dedupeEdit =
    single && ids[0] === ctx.selectedAssignmentId;

  if (single && ctx.highlightedAssignmentId && !dedupeEdit) {
    const id = ctx.highlightedAssignmentId;
    commands.push(
      { id: "ctx-open", label: "打开当前任务", group: "context", contextScope: "workspace", icon: ClipboardCheck, run: (c) => { a.openDrawer(id); c.close(); } },
      { id: "ctx-edit", label: "编辑当前任务", group: "context", contextScope: "workspace", icon: Plus, run: (c) => { a.editDrawer(id); c.close(); } }
    );
  }

  commands.push(
    { id: "ctx-complete", label: `标记${targetLabel}完成`, group: "context", contextScope: "workspace", icon: CheckCircle2, run: (c) => { a.markCompleted(ids); c.close(); } },
    { id: "ctx-doing", label: `将${targetLabel}设为进行中`, group: "context", contextScope: "workspace", icon: Play, run: (c) => { a.markDoing(ids); c.close(); } }
  );

  const PRIORITIES: { p: Priority; label: string }[] = [
    { p: "urgent", label: "紧急" },
    { p: "high", label: "高" },
    { p: "medium", label: "中" },
    { p: "low", label: "低" },
  ];
  for (const { p, label: pLabel } of PRIORITIES) {
    commands.push({
      id: `ctx-priority-${p}`,
      label: `将${targetLabel}设为${pLabel}优先级`,
      keywords: ["优先级", pLabel],
      group: "context",
      contextScope: "workspace",
      icon: Flag,
      run: (c) => { a.setPriority(ids, p); c.close(); },
    });
  }

  commands.push({
    id: "ctx-delete",
    label: `删除${targetLabel}`,
    group: "context",
    contextScope: "workspace",
    icon: Trash2,
    run: (c) => { a.remove(ids); c.close(); },
  });

  return commands;
}

/** 查询结果分组顺序：上下文操作最前（实体匹配优先），随后前往/视图/创建/操作/实体搜索 */
const QUERY_GROUP_ORDER: CommandGroup[] = ["context", "navigate", "views", "create", "action", "search"];

/** 空查询视图命令：只展示高频主视图（低频 at-risk/archive 由查询命中） */
const EMPTY_QUERY_VIEW_IDS = new Set(
  TASK_WORKSPACE_VIEWS.filter((v) => v.id !== "at-risk" && v.id !== "archive").map(
    (v) => `view-${v.id}`
  )
);

/**
 * 构建 Command Center 结果列表：
 * - 空查询：上下文操作 → 创建 → 前往 → 高频视图 → 全局操作（不展示大量低价值结果）
 * - 有查询：命令 + 课程 + 任务 合一（视图命令全部可命中）
 */
export function buildPalette(query: string, ctx: CommandContext): PaletteItem[] {
  const q = normalizeQuery(query);
  const terms = queryTerms(query);
  const items: PaletteItem[] = [];

  // course lookup 一次构建（assignment/material 投影共用，避免逐项 .find()）
  const courseLookup = new Map(ctx.courses.map((c) => [c.id, c]));

  // 任务选择上下文：workspace 的 highlight / selection 存在时注入「当前任务」命令。
  // 只保留仍存在的实体 id（stale highlight / 已删除的 selection 项不产生命令）。
  const liveIds = (ids: string[]) => ids.filter((id) => ctx.assignments.some((a) => a.id === id));
  const contextIds = liveIds(
    ctx.assignmentSelection.length > 0
      ? ctx.assignmentSelection
      : ctx.highlightedAssignmentId
      ? [ctx.highlightedAssignmentId]
      : []
  );

  const pushCommand = (cmd: AppCommand) => {
    if (cmd.when && !cmd.when(ctx)) return;
    items.push({
      key: `cmd-${cmd.id}`,
      kind: "command",
      group: cmd.group,
      contextScope: cmd.contextScope,
      label: cmd.label,
      shortcut: cmd.shortcut,
      icon: cmd.icon,
      run: () => cmd.run(ctx),
    });
  };

  if (!q) {
    // 1. 上下文操作（选中课程/任务；无对应上下文则不渲染该标题）
    for (const cmd of getContextCommands(ctx)) pushCommand(cmd);
    for (const cmd of getAssignmentContextCommands(ctx, contextIds)) pushCommand(cmd);
    // 2-5. 创建 → 前往 → 高频视图 → 全局操作
    const EMPTY_GROUP_ORDER: CommandGroup[] = ["create", "navigate", "views", "action"];
    for (const group of EMPTY_GROUP_ORDER) {
      for (const cmd of getCommands()) {
        if (cmd.group !== group) continue;
        if (group === "views" && !EMPTY_QUERY_VIEW_IDS.has(cmd.id)) continue;
        pushCommand(cmd);
      }
    }
    return items;
  }

  const groupRank = (g: CommandGroup) => {
    const idx = QUERY_GROUP_ORDER.indexOf(g);
    return idx === -1 ? 99 : idx;
  };

  const allCommands = [
    ...getCommands().filter((c) => commandMatches(c, q)),
    ...getContextCommands(ctx).filter((c) => commandMatches(c, q)),
  ].sort((a, b) => groupRank(a.group) - groupRank(b.group));

  for (const cmd of allCommands) {
    pushCommand(cmd);
  }

  // ---- 实体搜索（Search V2：多 term × 字段集合；顺序 command → course → assignment → material） ----

  for (const c of ctx.courses) {
    if (!courseMatches(c, terms)) continue;
    items.push({
      key: `course-${c.id}`,
      kind: "course",
      group: "search",
      label: c.name,
      sub: `${c.code} · ${c.teacher}`,
      icon: BookOpen,
      run: () => { ctx.setSelectedCourseId(c.id); ctx.close(); },
    });
  }

  for (const a of ctx.assignments) {
    if (!assignmentMatches(a, terms, courseLookup)) continue;
    const course = a.courseId ? courseLookup.get(a.courseId) : undefined;
    const ddlDate = ddlDateFields(a.ddl)[0];
    items.push({
      key: `assignment-${a.id}`,
      kind: "assignment",
      group: "search",
      label: a.title,
      sub: `${course ? `${course.name} · ` : ""}${ddlDate ? `${ddlDate} · ` : ""}进度 ${a.progress}%`,
      icon: ClipboardCheck,
      run: () => { ctx.setSelectedAssignmentId(a.id); ctx.close(); },
    });
  }

  // ---- CalendarMark（Workflow UX V3）：仅 exam / activity；open contract =
  // setSelectedCalendarMarkId → CalendarMarkDetailDrawer。course/ddl 不进入
  //（ddl 由 Assignment Search 覆盖，避免结果重复）。高时效实体排在 Material 前。
  for (const m of ctx.calendarMarks) {
    if (m.type !== "exam" && m.type !== "activity") continue;
    if (!matchesFields(calendarMarkSearchFields(m), terms)) continue;
    const typeLabel = m.type === "exam" ? "考试" : "活动";
    const timeText = m.startTime && m.endTime ? `${m.startTime}–${m.endTime}` : "全天";
    items.push({
      key: `calendar-${m.id}`,
      kind: "calendar",
      group: "search",
      label: m.title,
      sub: `${typeLabel} · ${dateSearchFields(m.date)[1] ?? ""} · ${timeText}`,
      icon: m.type === "exam" ? GraduationCap : CalendarDays,
      run: () => { ctx.setSelectedCalendarMarkId(m.id); ctx.close(); },
    });
  }

  for (const c of ctx.courses) {
    for (const m of c.materials ?? []) {
      if (!materialMatches(m, terms, c)) continue;
      const typeLabel = MATERIAL_TYPE_LABELS[m.type];
      items.push({
        key: `material-${m.id}`,
        kind: "material",
        group: "search",
        label: m.title,
        sub: [c.name, typeLabel, m.size].filter(Boolean).join(" · "),
        icon: MATERIAL_ICONS[m.type],
        run: () => {
          previewMaterial(m);
          ctx.close();
        },
      });
    }
  }

  return items;
}

// ---- 快捷键指南（只列真实实现的快捷键） ----

export interface ShortcutGuideItem {
  keys: string;
  label: string;
  /** 受「单键快捷键」开关控制（关闭时置灰并提示） */
  singleKey?: boolean;
}

export const SHORTCUT_GUIDE: { group: string; items: ShortcutGuideItem[] }[] = [
  {
    group: "全局",
    items: [
      { keys: "⌘K", label: "打开命令中心" },
      { keys: "⌘,", label: "打开设置" },
      { keys: "/", label: "快速搜索", singleKey: true },
      { keys: "?", label: "快捷键指南", singleKey: true },
    ],
  },
  {
    group: "导航",
    items: [
      { keys: "↑ ↓", label: "选择结果" },
      { keys: "Enter", label: "执行所选" },
      { keys: "Esc", label: "关闭" },
    ],
  },
  {
    group: "任务",
    items: [
      { keys: "N", label: "新建任务（无输入焦点时）", singleKey: true },
      { keys: "J / K", label: "在任务列表中移动（任务工作区）", singleKey: true },
      { keys: "Space", label: "预览任务（任务工作区，桌面端）", singleKey: true },
      { keys: "X", label: "选择 / 取消选择任务（任务工作区）", singleKey: true },
      { keys: "↑ ↓", label: "任务列表移动（标准键盘操作）" },
      { keys: "Enter", label: "打开所选任务" },
    ],
  },
];
