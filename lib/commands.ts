import type { ElementType } from "react";
import {
  Plus,
  BookOpen,
  FolderKanban,
  FileUp,
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  BarChart3,
  Users2,
  Settings,
  RotateCcw,
  CalendarRange,
  CheckCircle2,
  Play,
  Flag,
  Trash2,
} from "lucide-react";
import { NavTab, Course, Assignment, Semester, TimeSliceFilter, Priority } from "@/types";
import type { AssignmentActions } from "@/lib/assignmentActions";
import { openAssignmentEditor } from "@/lib/uiEvents";

/**
 * Command Registry：Command Center / Context Menu / 键盘快捷键 共用的唯一动作源。
 * 不要为三处各写一套动作实现。
 */

export type CommandGroup = "context" | "create" | "navigate" | "action" | "search";

export interface CommandContext {
  activeTab: NavTab;
  selectedCourseId: string | null;
  selectedAssignmentId: string | null;
  courses: Course[];
  assignments: Assignment[];
  semester: Semester;
  currentSemesterWeek: number;
  // Assignment Workspace 选择上下文（Task 2）
  highlightedAssignmentId: string | null;
  assignmentSelection: string[];
  assignmentActions: AssignmentActions;
  // 动作（由宿主注入，避免 lib 依赖 store）
  setActiveTab: (tab: NavTab) => void;
  setSelectedCourseId: (id: string | null) => void;
  setSelectedAssignmentId: (id: string | null) => void;
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
  run: (ctx: CommandContext) => void;
}

export const NAV_GROUPS: { id: NavTab; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "timetable", label: "课表" },
  { id: "assignments", label: "任务" },
  { id: "courses", label: "课程" },
  { id: "analytics", label: "分析" },
  { id: "group", label: "小组" },
  { id: "settings", label: "设置" },
];

/** 第一版命令集（顺序即空查询展示顺序：快速操作 → 导航） */
export function getCommands(): AppCommand[] {
  return [
  // ---- Create ----
  // 所有「打开任务编辑器」入口统一走 lib/uiEvents.ts 的 openAssignmentEditor
  { id: "create-task", label: "新建任务", keywords: ["任务", "todo"], group: "create", shortcut: "N", icon: Plus, run: (ctx) => { openAssignmentEditor({}); ctx.close(); } },
    { id: "create-course", label: "新建课程", keywords: ["课程", "add"], group: "create", icon: BookOpen, run: (ctx) => { ctx.setAddCourseModalOpen(true); ctx.close(); } },
    { id: "import-schedule", label: "导入课表", keywords: ["导入", "课表", "import"], group: "create", icon: FileUp, run: (ctx) => { ctx.setImportScheduleModalOpen(true); ctx.close(); } },
    // ---- Navigate ----
    ...NAV_GROUPS.map((g) => ({
      id: `nav-${g.id}`,
      label: `前往${g.label}`,
      keywords: [g.label],
      group: "navigate" as CommandGroup,
      icon: navIcon(g.id),
      run: (ctx: CommandContext) => { ctx.setActiveTab(g.id); ctx.close(); },
    })),
    // ---- Action ----
    { id: "today-assignments", label: "前往今日任务", keywords: ["今日", "任务", "today"], group: "action", icon: ClipboardCheck, run: (ctx) => { ctx.setActiveTab("assignments"); ctx.setAssignmentTimeSlice("today"); ctx.close(); } },
    { id: "reset-week", label: "回到本周", keywords: ["本周", "周次", "reset"], group: "action", icon: RotateCcw, run: (ctx) => { ctx.resetToCurrentWeek(); ctx.setActiveTab("timetable"); ctx.close(); } },
    { id: "open-full-timetable", label: "打开完整课表", keywords: ["全屏", "课表", "完整"], group: "action", icon: CalendarRange, run: (ctx) => { ctx.setActiveTab("timetable"); ctx.setFullTimetableModalOpen(true); ctx.close(); } },
  ];
}

function navIcon(tab: NavTab): ElementType {
  switch (tab) {
    case "overview": return LayoutDashboard;
    case "timetable": return CalendarDays;
    case "assignments": return ClipboardCheck;
    case "courses": return FolderKanban;
    case "analytics": return BarChart3;
    case "group": return Users2;
    case "settings": return Settings;
  }
}

// ---- 搜索匹配（不引入 fuzzy 库：normalize + startsWith/includes + keywords） ----

export function normalizeQuery(query: string): string {
  return (query || "").trim().toLowerCase().replace(/\s+/g, "");
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

export function courseMatches(course: Course, q: string): boolean {
  return (
    fieldMatch(course.name, q) ||
    fieldMatch(course.code, q) ||
    fieldMatch(course.teacher, q) ||
    fieldMatch(course.description, q)
  );
}

export function assignmentMatches(assignment: Assignment, q: string): boolean {
  return (
    fieldMatch(assignment.title, q) ||
    fieldMatch(assignment.description, q)
  );
}

// ---- Palette 结果模型 ----

export type PaletteItemKind = "command" | "course" | "assignment";

export interface PaletteItem {
  key: string;
  kind: PaletteItemKind;
  /** 分组标题（组内按此排序） */
  group: CommandGroup;
  label: string;
  sub?: string;
  shortcut?: string;
  icon: ElementType;
  run: () => void;
}

const GROUP_LABEL: Record<CommandGroup, string> = {
  context: "上下文操作",
  create: "创建",
  navigate: "导航",
  action: "操作",
  search: "搜索",
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
 * 课程 / 任务 Context Commands（Command System Task 2）：
 * 只在对应实体确实存在时通过 when 显示；run 内再做轻量 defensive check（不 throw）。
 * 打开任务编辑器一律复用 openAssignmentEditor，不复制 editor 状态。
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
 * 任务上下文命令（Task 2）：
 * 当前任务 highlight / selection 存在时，Command Center 与 Context Menu 共用。
 */
export function getAssignmentContextCommands(
  ctx: Pick<CommandContext, "assignmentActions" | "highlightedAssignmentId" | "close">,
  ids: string[]
): AppCommand[] {
  if (ids.length === 0) return [];
  const a = ctx.assignmentActions;
  const n = ids.length;
  const label = (base: string) => (n === 1 ? base : `${base}（${n} 项）`);
  const single = n === 1;
  const commands: AppCommand[] = [];

  if (single && ctx.highlightedAssignmentId) {
    const id = ctx.highlightedAssignmentId;
    commands.push(
      { id: "ctx-open", label: "打开任务", group: "context", icon: ClipboardCheck, run: (c) => { a.openDrawer(id); c.close(); } },
      { id: "ctx-edit", label: "编辑任务", group: "context", icon: Plus, run: (c) => { a.editDrawer(id); c.close(); } }
    );
  }

  commands.push(
    { id: "ctx-complete", label: label("标记为完成"), group: "context", icon: CheckCircle2, run: (c) => { a.markCompleted(ids); c.close(); } },
    { id: "ctx-doing", label: label("设为进行中"), group: "context", icon: Play, run: (c) => { a.markDoing(ids); c.close(); } }
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
      label: `优先级 → ${pLabel}`,
      keywords: ["优先级", pLabel],
      group: "action",
      icon: Flag,
      run: (c) => { a.setPriority(ids, p); c.close(); },
    });
  }

  commands.push({
    id: "ctx-delete",
    label: label("删除任务"),
    group: "action",
    icon: Trash2,
    run: (c) => { a.remove(ids); c.close(); },
  });

  return commands;
}

/** 查询结果分组顺序：上下文操作最前（实体匹配优先），随后导航/创建/操作/实体搜索 */
const QUERY_GROUP_ORDER: CommandGroup[] = ["context", "navigate", "create", "action", "search"];

/**
 * 构建 Command Center 结果列表：
 * - 空查询：上下文操作（存在时）→ 快速操作（create + action）→ 导航（全部可浏览，非空白）
 * - 有查询：命令 + 课程 + 任务 合一
 */
export function buildPalette(query: string, ctx: CommandContext): PaletteItem[] {
  const q = normalizeQuery(query);
  const items: PaletteItem[] = [];

  // 任务选择上下文：workspace 的 highlight / selection 存在时注入「当前任务」命令
  const contextIds =
    ctx.assignmentSelection.length > 0
      ? ctx.assignmentSelection
      : ctx.highlightedAssignmentId
      ? [ctx.highlightedAssignmentId]
      : [];

  if (!q) {
    // 1. 上下文操作（选中课程/任务；无对应上下文则不渲染该标题）
    for (const cmd of getContextCommands(ctx)) {
      items.push({
        key: `cmd-${cmd.id}`,
        kind: "command",
        group: cmd.group,
        label: cmd.label,
        icon: cmd.icon,
        run: () => cmd.run(ctx),
      });
    }
    for (const cmd of getAssignmentContextCommands(ctx, contextIds)) {
      items.push({
        key: `ctx-${cmd.id}`,
        kind: "command",
        group: "context",
        label: cmd.label,
        icon: cmd.icon,
        run: () => cmd.run(ctx),
      });
    }
    // 2. 快速操作（create + action）
    for (const cmd of getCommands()) {
      if (cmd.when && !cmd.when(ctx)) continue;
      if (cmd.group === "navigate") continue;
      items.push({
        key: `cmd-${cmd.id}`,
        kind: "command",
        group: cmd.group,
        label: cmd.label,
        shortcut: cmd.shortcut,
        icon: cmd.icon,
        run: () => cmd.run(ctx),
      });
    }
    // 3. 导航
    for (const cmd of getCommands()) {
      if (cmd.when && !cmd.when(ctx)) continue;
      if (cmd.group !== "navigate") continue;
      items.push({
        key: `cmd-${cmd.id}`,
        kind: "command",
        group: cmd.group,
        label: cmd.label,
        shortcut: cmd.shortcut,
        icon: cmd.icon,
        run: () => cmd.run(ctx),
      });
    }
    return items;
  }

  const groupRank = (g: CommandGroup) => {
    const idx = QUERY_GROUP_ORDER.indexOf(g);
    return idx === -1 ? 99 : idx;
  };

  const allCommands = [
    ...getCommands().filter((c) => {
      if (c.when && !c.when(ctx)) return false;
      return commandMatches(c, q);
    }),
    ...getContextCommands(ctx).filter((c) => commandMatches(c, q)),
  ].sort((a, b) => groupRank(a.group) - groupRank(b.group));

  for (const cmd of allCommands) {
    items.push({
      key: `cmd-${cmd.id}`,
      kind: "command",
      group: cmd.group,
      label: cmd.label,
      shortcut: cmd.shortcut,
      icon: cmd.icon,
      run: () => cmd.run(ctx),
    });
  }

  for (const c of ctx.courses) {
    if (!courseMatches(c, q)) continue;
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
    if (!assignmentMatches(a, q)) continue;
    items.push({
      key: `assignment-${a.id}`,
      kind: "assignment",
      group: "search",
      label: a.title,
      sub: `进度 ${a.progress}%`,
      icon: ClipboardCheck,
      run: () => { ctx.setSelectedAssignmentId(a.id); ctx.close(); },
    });
  }

  return items;
}

// ---- 快捷键指南（只列真实实现的快捷键） ----

export const SHORTCUT_GUIDE: { group: string; items: { keys: string; label: string }[] }[] = [
  {
    group: "全局",
    items: [
      { keys: "⌘K", label: "打开命令中心" },
      { keys: "/", label: "快速搜索" },
      { keys: "?", label: "快捷键指南" },
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
    items: [{ keys: "N", label: "新建任务（无输入焦点时）" }],
  },
];
