import { SettingsSection } from "@/types";

/**
 * Settings Registry：搜索 metadata 的唯一来源（不做 DOM 文本抓取）。
 * Preferences 的值仍来自 Zustand；这里只描述「有哪些设置、属于哪个 section」。
 */

export interface SettingDefinition {
  id: string;
  section: SettingsSection;
  title: string;
  description: string;
  keywords?: string[];
}

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  // ---- 通用（全局产品行为）----
  {
    id: "startup-view",
    section: "general",
    title: "默认打开位置",
    description: "启动后进入的默认工作区",
    keywords: ["启动", "默认页面", "首页", "进入", "startup", "last"],
  },
  {
    id: "content-density",
    section: "general",
    title: "界面密度",
    description: "任务工作区、课程列表与命令中心的行高与间距",
    keywords: ["密度", "紧凑", "舒适", "行高", "density", "compact"],
  },
  {
    id: "motion-preference",
    section: "general",
    title: "动效偏好",
    description: "界面动画强度；跟随系统时尊重系统减弱动效设置",
    keywords: ["动效", "动画", "motion", "reduced", "减少"],
  },
  // ---- 个人资料 ----
  {
    id: "avatar-url",
    section: "profile",
    title: "头像地址",
    description: "头像图片 URL，留空使用首字占位",
    keywords: ["头像", "avatar", "图片", "照片"],
  },
  {
    id: "profile-name",
    section: "profile",
    title: "姓名",
    description: "你的姓名，用于学习卡片与课表展示",
    keywords: ["姓名", "名字", "name", "profile"],
  },
  {
    id: "profile-student-id",
    section: "profile",
    title: "学号",
    description: "学生学号（仅本地展示，不参与 AI 请求）",
    keywords: ["学号", "student id", "studentId"],
  },
  {
    id: "profile-college",
    section: "profile",
    title: "学院 / 专业",
    description: "学院与专业信息",
    keywords: ["学院", "专业", "college", "major"],
  },
  {
    id: "profile-grade",
    section: "profile",
    title: "年级",
    description: "当前年级",
    keywords: ["年级", "grade"],
  },
  {
    id: "profile-credits",
    section: "profile",
    title: "学分进度",
    description: "已完成学分与目标总学分",
    keywords: ["学分", "进度", "credits", "完成"],
  },
  // ---- 学期与课表 ----
  {
    id: "show-weekends",
    section: "semester",
    title: "显示周末",
    description: "在课表中显示周六与周日",
    keywords: ["课表", "星期", "周六", "周日", "weekend"],
  },
  {
    id: "semester-overview",
    section: "semester",
    title: "当前学期",
    description: "开学日期、教学周数与当前进度",
    keywords: ["学期", "校历", "周数", "开学", "结束日期"],
  },
  // ---- 任务 ----
  {
    id: "ddl-warning-days",
    section: "tasks",
    title: "临近截止提醒",
    description: "未来多少天内显示截止任务",
    keywords: ["截止", "提醒", "warning", "ddl", "ddl 提醒"],
  },
  {
    id: "default-ddl-time",
    section: "tasks",
    title: "默认截止时间",
    description: "新建任务的默认截止时刻",
    keywords: ["截止", "时间", "ddl", "新建任务", "预填"],
  },
  {
    id: "default-task-priority",
    section: "tasks",
    title: "默认优先级",
    description: "新建任务的默认优先级",
    keywords: ["优先级", "priority", "新建任务"],
  },
  {
    id: "default-task-status",
    section: "tasks",
    title: "默认状态",
    description: "新建任务的默认状态（待完成 / 进行中）",
    keywords: ["任务状态", "状态", "status", "新建任务"],
  },
  {
    id: "default-task-workspace-view",
    section: "tasks",
    title: "默认任务视图",
    description: "每次打开 ClassFlow 时任务工作区的默认视图",
    keywords: ["任务", "视图", "聚焦", "今天", "即将截止", "待安排", "workspace", "view", "默认"],
  },
  {
    id: "browser-notifications",
    section: "tasks",
    title: "浏览器系统通知",
    description: "提醒到期时同时发送浏览器系统通知",
    keywords: ["通知", "提醒", "浏览器通知", "notification", "browser"],
  },
  {
    id: "missed-reminder-policy",
    section: "tasks",
    title: "错过提醒处理",
    description: "ClassFlow 未打开期间错过提醒时的处理方式",
    keywords: ["错过", "补发", "提醒", "missed", "notification"],
  },
  {
    id: "missed-reminder-window",
    section: "tasks",
    title: "补发时间范围",
    description: "只补发距离当前时间不超过该范围的提醒",
    keywords: ["补发", "1小时", "6小时", "24小时", "window", "reminder"],
  },
  // ---- 交互与快捷键 ----
  {
    id: "schedule-direct-manipulation",
    section: "interaction",
    title: "课表直接操作",
    description: "在完整课表中启用拖动调整与缩放排课",
    keywords: ["拖拽", "拖动", "课表", "drag", "resize", "直接操作"],
  },
  {
    id: "ddl-direct-manipulation",
    section: "interaction",
    title: "DDL 直接操作",
    description: "在日历中启用拖动调整截止日期",
    keywords: ["拖拽", "拖动", "日历", "ddl", "drag", "直接操作"],
  },
  {
    id: "single-key-shortcuts",
    section: "interaction",
    title: "启用单键快捷键",
    description: "N、J/K、X 等单键快速操作",
    keywords: ["快捷键", "键盘", "按键", "single key", "shortcut"],
  },
  // ---- Kiro / AI 服务 ----
  {
    id: "ai-enabled",
    section: "kiro",
    title: "启用 Kiro",
    description: "Kiro 是否可发起 AI 请求",
    keywords: ["kiro", "ai", "启用", "开关"],
  },
  {
    id: "ai-provider",
    section: "kiro",
    title: "AI 服务",
    description: "OpenCode Go / DeepSeek / 自定义服务",
    keywords: ["provider", "服务", "模型来源", "deepseek", "opencode"],
  },
  {
    id: "ai-model",
    section: "kiro",
    title: "模型",
    description: "选择当前使用的对话模型",
    keywords: ["模型", "model", "v4", "grok", "kimi", "glm"],
  },
  {
    id: "ai-api-key",
    section: "kiro",
    title: "API Key",
    description: "各服务的 API Key（仅保存在当前浏览器会话）",
    keywords: ["api key", "密钥", "key", "token"],
  },
  {
    id: "ai-custom-url",
    section: "kiro",
    title: "自定义服务地址",
    description: "自定义 OpenAI 兼容服务的 Base URL 与模型",
    keywords: ["自定义", "base url", "兼容", "openai"],
  },
  {
    id: "ai-custom-name",
    section: "kiro",
    title: "自定义服务名称",
    description: "自定义 Provider 的显示名称",
    keywords: ["自定义", "provider", "名称", "name"],
  },
  {
    id: "ai-custom-model",
    section: "kiro",
    title: "自定义模型 ID",
    description: "自定义服务的模型 ID",
    keywords: ["自定义", "模型", "model", "id"],
  },
  {
    id: "ai-custom-capabilities",
    section: "kiro",
    title: "自定义模型能力",
    description: "自定义服务是否支持图片 / 文件输入 / 思考程度",
    keywords: ["自定义", "能力", "图片", "文件", "vision", "file", "capability", "思考"],
  },
  {
    id: "ai-reasoning-effort",
    section: "kiro",
    title: "思考程度",
    description: "控制支持该能力的模型在回答前投入的推理计算",
    keywords: ["思考", "推理", "reasoning", "effort", "深度思考", "推理程度"],
  },
  {
    id: "ai-connection-status",
    section: "kiro",
    title: "连接状态",
    description: "测试当前 AI 服务连接与 API Key 可用性",
    keywords: ["测试", "连接", "状态", "test", "connection", "连通"],
  },
  {
    id: "kiro-output-text-size",
    section: "kiro",
    title: "输出字号",
    description: "调整 Kiro 回复内容的显示大小",
    keywords: ["kiro", "字号", "字体", "文字大小", "显示", "阅读", "输出", "font", "size"],
  },
  {
    id: "kiro-response-preference",
    section: "kiro",
    title: "回答偏好",
    description: "调整 Kiro 最终回答的信息密度与解释深度",
    keywords: ["kiro", "回答", "偏好", "高密度", "平衡", "深入", "response", "density"],
  },
  {
    id: "kiro-auto-context",
    section: "kiro",
    title: "自动环境上下文",
    description: "根据当前页面和时间范围自动为 Kiro 带入上下文",
    keywords: ["kiro", "上下文", "自动上下文", "环境", "context", "auto context", "@"],
  },
  {
    id: "kiro-memory-enabled",
    section: "kiro",
    title: "启用 Kiro 记忆",
    description: "Kiro 记住你的学习偏好并持续运用",
    keywords: ["记忆", "记住", "偏好", "memory", "preference", "学习习惯"],
  },
  {
    id: "kiro-memory-manager",
    section: "kiro",
    title: "Kiro 记忆条目",
    description: "查看 / 编辑 / 删除 / 清空已记住的偏好",
    keywords: ["记忆", "记忆管理", "条目", "清空", "memory", "preference"],
  },
  {
    id: "kiro-web-search-enabled",
    section: "kiro",
    title: "联网搜索",
    description: "Kiro Search：Kiro 需要最新信息时自动联网搜索",
    keywords: ["联网", "搜索", "网络", "web search", "kiro search", "tavily", "实时"],
  },
  {
    id: "kiro-web-search-credential",
    section: "kiro",
    title: "Kiro Search 凭据",
    description: "搜索凭据来源：ClassFlow 提供或自己的 API Key",
    keywords: ["凭据", "api key", "byok", "搜索 key", "credential"],
  },
  // ---- 数据与存储 ----
  {
    id: "backup-full",
    section: "data",
    title: "完整备份",
    description: "导出包含课程资料文件的完整备份",
    keywords: ["备份", "导出", "zip", "附件"],
  },
  {
    id: "backup-json",
    section: "data",
    title: "仅数据备份",
    description: "导出不含课程资料的 JSON 备份",
    keywords: ["备份", "导出", "json", "仅数据"],
  },
  {
    id: "restore-data",
    section: "data",
    title: "恢复数据",
    description: "从 ClassFlow 备份恢复课程、任务与设置",
    keywords: ["备份", "恢复", "导入", "restore"],
  },
  // ---- Kiro Agent（Computer Agent 控制平面） ----
  {
    id: "kiro-computer-enabled",
    section: "kiro-agent",
    title: "Computer Agent",
    description: "开启后在授权工作区内执行受限操作",
    keywords: ["agent", "computer", "工作区", "授权", "开关", "启用"],
  },
  {
    id: "kiro-agent-mode",
    section: "kiro-agent",
    title: "默认权限模式",
    description: "计划 / 受控 / 工作区自动",
    keywords: ["权限", "模式", "计划", "受控", "自动", "permission", "mode"],
  },
  {
    id: "kiro-agent-workspace",
    section: "kiro-agent",
    title: "当前 Workspace",
    description: "当前工作区与授权位置",
    keywords: ["workspace", "工作区", "位置", "root", "sandbox", "本地"],
  },
  {
    id: "kiro-agent-permissions",
    section: "kiro-agent",
    title: "活动与安全",
    description: "V1 安全边界：无 shell / 删除 / 应用启动 / MCP / Full Access",
    keywords: ["安全", "权限", "shell", "删除", "终端", "full access", "sandbox", "沙箱"],
  },
];

export function normalizeQuery(query: string): string {
  return (query || "").trim().toLowerCase().replace(/\s+/g, "");
}

/** 简单匹配：normalize + includes + keywords（不引入 fuzzy 依赖） */
export function searchSettings(query: string): SettingDefinition[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return SETTINGS_REGISTRY.filter((s) => {
    if (s.title.toLowerCase().includes(q)) return true;
    if (s.description.toLowerCase().includes(q)) return true;
    return (s.keywords ?? []).some((k) => normalizeQuery(k).includes(q));
  });
}
