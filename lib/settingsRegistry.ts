import { SettingsSection } from "@/types";

/**
 * Settings Registry：搜索 metadata 的唯一来源（不做 DOM 文本抓取）。
 * Preferences 的值仍来自 Zustand；这里只描述「有哪些设置、属于哪个 section」。
 *
 * 开发期自动校验（settingsRegistryValidation.ts）：
 *  - Registry ID 唯一、section 有效（纯函数，模块加载即校验）
 *  - 非 conditional 设置必须在真实 DOM 中存在 data-setting-id 目标
 */

export interface SettingDefinition {
  id: string;
  section: SettingsSection;
  title: string;
  description: string;
  keywords?: string[];
  /**
   * 条件渲染设置：只有满足特定状态（如 Provider = custom-openai、
   * missed reminder policy = recent-only、联网搜索开启）才出现在 DOM。
   * 校验器跳过此类条目，不会把合法的条件渲染误判为 Registry 漂移。
   */
  conditional?: boolean;
}

/** 设置 ID 常量：Registry 与 DOM data-setting-id 的共享事实来源 */
export const SETTING_IDS = {
  general: {
    startupView: "startup-view",
    contentDensity: "content-density",
    motionPreference: "motion-preference",
    scheduleDirectManipulation: "schedule-direct-manipulation",
    ddlDirectManipulation: "ddl-direct-manipulation",
    singleKeyShortcuts: "single-key-shortcuts",
  },
  profile: {
    avatar: "profile-avatar",
    name: "profile-name",
    studentId: "profile-student-id",
    college: "profile-college",
    grade: "profile-grade",
    credits: "profile-credits",
  },
  semester: {
    showWeekends: "show-weekends",
    overview: "semester-overview",
  },
  tasks: {
    ddlWarningDays: "ddl-warning-days",
    defaultDDLTime: "default-ddl-time",
    defaultTaskPriority: "default-task-priority",
    defaultTaskStatus: "default-task-status",
    defaultTaskWorkspaceView: "default-task-workspace-view",
    deadlineDefaultReminder: "deadline-default-reminder",
    inAppReminders: "in-app-reminders",
    browserNotifications: "browser-notifications",
    missedReminderPolicy: "missed-reminder-policy",
    missedReminderWindow: "missed-reminder-window",
  },
  focus: {
    tracking: "focus-tracking",
    completionNotification: "focus-completion-notification",
    kiroDuration: "focus-kiro-duration",
  },
  kiro: {
    enabled: "ai-enabled",
    provider: "ai-provider",
    model: "ai-model",
    customName: "ai-custom-name",
    customUrl: "ai-custom-url",
    customModel: "ai-custom-model",
    customCapabilities: "ai-custom-capabilities",
    reasoningEffort: "ai-reasoning-effort",
    apiKey: "ai-api-key",
    connectionStatus: "ai-connection-status",
    outputTextSize: "kiro-output-text-size",
    responsePreference: "kiro-response-preference",
    autoContext: "kiro-auto-context",
    webSearchEnabled: "kiro-web-search-enabled",
    webSearchService: "kiro-web-search-service",
    webSearchCredential: "kiro-web-search-credential",
    webSearchByokKey: "kiro-web-search-byok-key",
    webSearchTest: "kiro-web-search-test",
    webSearchPrivacy: "kiro-web-search-privacy",
    webPdfVisionEnabled: "kiro-web-pdf-vision-enabled",
    webPdfVisionModel: "kiro-web-pdf-vision-model",
    webPdfVisionKey: "kiro-web-pdf-vision-key",
    memoryEnabled: "kiro-memory-enabled",
    memoryManager: "kiro-memory-manager",
  },
  "kiro-agent": {
    computerEnabled: "kiro-computer-enabled",
    agentMode: "kiro-agent-mode",
    workspace: "kiro-agent-workspace",
    permissions: "kiro-agent-permissions",
    workspaceKnowledge: "kiro-workspace-knowledge",
  },
  data: {
    backupFull: "backup-full",
    backupJson: "backup-json",
    restoreData: "restore-data",
    privacyLocal: "kiro-privacy-local",
    privacyApiKey: "kiro-privacy-api-key",
    privacyContext: "kiro-privacy-context",
  },
} as const;

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  // ---- 通用（全局产品行为 + 操作与快捷键）----
  {
    id: SETTING_IDS.general.startupView,
    section: "general",
    title: "默认打开位置",
    description: "启动后进入的默认工作区",
    keywords: ["启动", "默认页面", "首页", "进入", "startup", "last"],
  },
  {
    id: SETTING_IDS.general.contentDensity,
    section: "general",
    title: "界面密度",
    description: "任务工作区、课程列表与命令中心的行高与间距",
    keywords: ["密度", "紧凑", "舒适", "行高", "density", "compact"],
  },
  {
    id: SETTING_IDS.general.motionPreference,
    section: "general",
    title: "动效偏好",
    description: "界面动画强度；跟随系统时尊重系统减弱动效设置",
    keywords: ["动效", "动画", "motion", "reduced", "减少"],
  },
  {
    id: SETTING_IDS.general.scheduleDirectManipulation,
    section: "general",
    title: "课表直接操作",
    description: "在完整课表中启用拖动调整与缩放排课",
    keywords: ["拖拽", "拖动", "课表", "drag", "resize", "直接操作", "快捷键"],
  },
  {
    id: SETTING_IDS.general.ddlDirectManipulation,
    section: "general",
    title: "DDL 直接操作",
    description: "在日历中启用拖动调整截止日期",
    keywords: ["拖拽", "拖动", "日历", "ddl", "drag", "直接操作", "快捷键"],
  },
  {
    id: SETTING_IDS.general.singleKeyShortcuts,
    section: "general",
    title: "启用单键快捷键",
    description: "N、J/K、X 等单键快速操作",
    keywords: ["快捷键", "键盘", "按键", "single key", "shortcut"],
  },
  // ---- 个人资料 ----
  {
    id: SETTING_IDS.profile.avatar,
    section: "profile",
    title: "头像",
    description: "从本机选择图片作为头像，保存在当前设备",
    keywords: ["头像", "avatar", "图片", "照片", "更换头像"],
  },
  {
    id: SETTING_IDS.profile.name,
    section: "profile",
    title: "姓名",
    description: "你的姓名，用于学习卡片与课表展示",
    keywords: ["姓名", "名字", "name", "profile"],
  },
  {
    id: SETTING_IDS.profile.studentId,
    section: "profile",
    title: "学号",
    description: "学生学号（仅本地展示，不参与 AI 请求）",
    keywords: ["学号", "student id", "studentId"],
  },
  {
    id: SETTING_IDS.profile.college,
    section: "profile",
    title: "学院 / 专业",
    description: "学院与专业信息",
    keywords: ["学院", "专业", "college", "major"],
  },
  {
    id: SETTING_IDS.profile.grade,
    section: "profile",
    title: "年级",
    description: "当前年级",
    keywords: ["年级", "grade"],
  },
  {
    id: SETTING_IDS.profile.credits,
    section: "profile",
    title: "学分进度",
    description: "已完成学分与目标总学分",
    keywords: ["学分", "进度", "credits", "完成"],
  },
  // ---- 学期与课表 ----
  {
    id: SETTING_IDS.semester.showWeekends,
    section: "semester",
    title: "显示周末",
    description: "在课表中显示周六与周日",
    keywords: ["课表", "星期", "周六", "周日", "weekend"],
  },
  {
    id: SETTING_IDS.semester.overview,
    section: "semester",
    title: "当前学期",
    description: "开学日期、教学周数与当前进度",
    keywords: ["学期", "校历", "周数", "开学", "结束日期"],
  },
  // ---- 任务与提醒 ----
  {
    id: SETTING_IDS.tasks.ddlWarningDays,
    section: "tasks",
    title: "临近截止提醒",
    description: "未来多少天内显示截止任务",
    keywords: ["截止", "提醒", "warning", "ddl", "ddl 提醒"],
  },
  {
    id: SETTING_IDS.tasks.defaultDDLTime,
    section: "tasks",
    title: "默认截止时间",
    description: "新建任务的默认截止时刻",
    keywords: ["截止", "时间", "ddl", "新建任务", "预填"],
  },
  {
    id: SETTING_IDS.tasks.defaultTaskPriority,
    section: "tasks",
    title: "默认优先级",
    description: "新建任务的默认优先级",
    keywords: ["优先级", "priority", "新建任务"],
  },
  {
    id: SETTING_IDS.tasks.defaultTaskStatus,
    section: "tasks",
    title: "默认状态",
    description: "新建任务的默认状态（待完成 / 进行中）",
    keywords: ["任务状态", "状态", "status", "新建任务"],
  },
  {
    id: SETTING_IDS.tasks.defaultTaskWorkspaceView,
    section: "tasks",
    title: "默认任务视图",
    description: "每次打开 ClassFlow 时任务工作区的默认视图",
    keywords: ["任务", "视图", "聚焦", "今天", "即将截止", "待安排", "workspace", "view", "默认"],
  },
  {
    id: SETTING_IDS.tasks.deadlineDefaultReminder,
    section: "tasks",
    title: "任务与 DDL 默认提醒",
    description: "为新建和现有的截止事项自动创建提醒",
    keywords: ["提醒", "ddl", "自动提醒", "截止", "提前"],
  },
  {
    id: SETTING_IDS.tasks.inAppReminders,
    section: "tasks",
    title: "应用内提醒",
    description: "提醒到期时在 ClassFlow 内展示提醒中心与角标",
    keywords: ["提醒", "应用内", "通知中心", "角标"],
  },
  {
    id: SETTING_IDS.tasks.browserNotifications,
    section: "tasks",
    title: "浏览器系统通知",
    description: "提醒到期时同时发送浏览器系统通知",
    keywords: ["通知", "提醒", "浏览器通知", "notification", "browser"],
  },
  {
    id: SETTING_IDS.tasks.missedReminderPolicy,
    section: "tasks",
    title: "错过提醒处理",
    description: "ClassFlow 未打开期间错过提醒时的处理方式",
    keywords: ["错过", "补发", "提醒", "missed", "notification"],
  },
  {
    id: SETTING_IDS.tasks.missedReminderWindow,
    section: "tasks",
    title: "补发时间范围",
    description: "只补发距离当前时间不超过该范围的提醒",
    keywords: ["补发", "1小时", "6小时", "24小时", "window", "reminder"],
    conditional: true, // 仅 missedReminderPolicy = recent-only 时渲染
  },
  // ---- 专注与学习 ----
  {
    id: SETTING_IDS.focus.tracking,
    section: "focus",
    title: "实时专注计时",
    description: "专注会话记录真实的专注时间",
    keywords: ["专注", "计时", "会话", "focus", "番茄"],
  },
  {
    id: SETTING_IDS.focus.completionNotification,
    section: "focus",
    title: "完成提示",
    description: "专注结束时的提示方式",
    keywords: ["专注", "提示", "通知", "完成"],
  },
  {
    id: SETTING_IDS.focus.kiroDuration,
    section: "focus",
    title: "Kiro 启动专注",
    description: "Kiro 开始专注会话时的时长处理",
    keywords: ["专注", "kiro", "时长", "开始专注"],
  },
  // ---- Kiro ----
  {
    id: SETTING_IDS.kiro.enabled,
    section: "kiro",
    title: "启用 Kiro",
    description: "Kiro 是否可发起 AI 请求",
    keywords: ["kiro", "ai", "启用", "开关"],
  },
  {
    id: SETTING_IDS.kiro.provider,
    section: "kiro",
    title: "AI 服务",
    description: "选择 Kiro 使用的模型服务",
    keywords: ["provider", "服务", "模型来源", "deepseek", "opencode", "api key", "密钥"],
  },
  {
    id: SETTING_IDS.kiro.model,
    section: "kiro",
    title: "模型",
    description: "选择当前使用的对话模型",
    keywords: ["模型", "model", "v4", "grok", "kimi", "glm"],
  },
  {
    id: SETTING_IDS.kiro.customName,
    section: "kiro",
    title: "服务名称",
    description: "自定义服务的显示名称",
    keywords: ["自定义", "provider", "名称", "name", "服务名称"],
    conditional: true, // 仅 Provider = custom-openai
  },
  {
    id: SETTING_IDS.kiro.customUrl,
    section: "kiro",
    title: "服务地址",
    description: "OpenAI 兼容接口的 Base URL",
    keywords: ["自定义", "base url", "兼容", "openai", "服务地址", "地址"],
    conditional: true, // 仅 Provider = custom-openai
  },
  {
    id: SETTING_IDS.kiro.customModel,
    section: "kiro",
    title: "模型 ID",
    description: "该服务实际使用的模型名称",
    keywords: ["自定义", "模型", "model", "id", "模型 id"],
    conditional: true, // 仅 Provider = custom-openai
  },
  {
    id: SETTING_IDS.kiro.customCapabilities,
    section: "kiro",
    title: "自定义模型能力",
    description: "自定义服务是否支持图片 / 文件输入 / 思考程度",
    keywords: ["自定义", "能力", "图片", "文件", "vision", "file", "capability", "思考"],
    conditional: true, // 仅 Provider = custom-openai 且展开高级设置
  },
  {
    id: SETTING_IDS.kiro.reasoningEffort,
    section: "kiro",
    title: "思考程度",
    description: "控制支持该能力的模型在回答前投入的推理计算",
    keywords: ["思考", "推理", "reasoning", "effort", "深度思考", "推理程度"],
  },
  {
    id: SETTING_IDS.kiro.apiKey,
    section: "kiro",
    title: "API Key",
    description: "各服务的 API Key（仅保存在当前浏览器会话）",
    keywords: ["api key", "密钥", "key", "token"],
  },
  {
    id: SETTING_IDS.kiro.connectionStatus,
    section: "kiro",
    title: "连接状态",
    description: "测试当前 AI 服务连接与 API Key 可用性",
    keywords: ["测试", "连接", "状态", "test", "connection", "连通"],
  },
  {
    id: SETTING_IDS.kiro.outputTextSize,
    section: "kiro",
    title: "输出字号",
    description: "调整 Kiro 回复内容的显示大小",
    keywords: ["kiro", "字号", "字体", "文字大小", "显示", "阅读", "输出", "font", "size"],
  },
  {
    id: SETTING_IDS.kiro.responsePreference,
    section: "kiro",
    title: "回答偏好",
    description: "调整 Kiro 最终回答的信息密度与解释深度",
    keywords: ["kiro", "回答", "偏好", "高密度", "平衡", "深入", "response", "density"],
  },
  {
    id: SETTING_IDS.kiro.autoContext,
    section: "kiro",
    title: "自动环境上下文",
    description: "根据当前页面和时间范围自动为 Kiro 带入上下文",
    keywords: ["kiro", "上下文", "自动上下文", "环境", "context", "auto context", "@"],
  },
  {
    id: SETTING_IDS.kiro.memoryEnabled,
    section: "kiro",
    title: "启用 Kiro 记忆",
    description: "Kiro 记住你的学习偏好并持续运用",
    keywords: ["记忆", "记住", "偏好", "memory", "preference", "学习习惯"],
  },
  {
    id: SETTING_IDS.kiro.memoryManager,
    section: "kiro",
    title: "Kiro 记忆条目",
    description: "查看 / 编辑 / 删除 / 清空已记住的偏好",
    keywords: ["记忆", "记忆管理", "条目", "清空", "memory", "preference"],
  },
  {
    id: SETTING_IDS.kiro.webSearchEnabled,
    section: "kiro",
    title: "联网搜索",
    description: "Kiro 需要最新信息时自动联网搜索",
    keywords: ["联网", "搜索", "网络", "web search", "kiro search", "tavily", "实时"],
  },
  {
    id: SETTING_IDS.kiro.webSearchService,
    section: "kiro",
    title: "搜索服务",
    description: "Kiro Search 提供实时网页检索能力",
    keywords: ["搜索", "服务", "kiro search", "web search"],
    conditional: true, // 仅联网搜索开启
  },
  {
    id: SETTING_IDS.kiro.webSearchCredential,
    section: "kiro",
    title: "凭据",
    description: "选择搜索凭据来源；使用自己的 API Key 时，Key 仅保存在当前浏览器会话中",
    keywords: ["凭据", "api key", "byok", "搜索 key", "credential"],
    conditional: true, // 仅联网搜索开启
  },
  {
    id: SETTING_IDS.kiro.webSearchByokKey,
    section: "kiro",
    title: "Tavily API Key",
    description: "仅保存在当前浏览器会话中（调用时发送到 ClassFlow 服务端转发）",
    keywords: ["tavily", "api key", "搜索", "密钥"],
    conditional: true, // 仅联网搜索开启且凭据 = 自己的 API Key
  },
  {
    id: SETTING_IDS.kiro.webSearchTest,
    section: "kiro",
    title: "测试搜索连接",
    description: "只发送最小搜索请求验证凭据，不发送对话或 ClassFlow 数据",
    keywords: ["搜索", "测试", "连接", "凭据"],
    conditional: true, // 仅联网搜索开启
  },
  {
    id: SETTING_IDS.kiro.webSearchPrivacy,
    section: "kiro",
    title: "隐私",
    description: "联网搜索开启时，Kiro 可能将当前搜索查询发送给搜索服务",
    keywords: ["搜索", "隐私", "发送", "查询"],
    conditional: true, // 仅联网搜索开启
  },
  {
    id: SETTING_IDS.kiro.webPdfVisionEnabled,
    section: "kiro",
    title: "扫描 PDF 识别",
    description: "仅用于读取联网搜索发现的扫描型 PDF（无文本层页面）",
    keywords: ["扫描", "pdf", "vision", "识别", "图片"],
    conditional: true, // 仅联网搜索开启且展开高级设置
  },
  {
    id: SETTING_IDS.kiro.webPdfVisionModel,
    section: "kiro",
    title: "Vision 模型",
    description: "用于识别扫描 PDF 页面的 OpenCode Go 视觉模型",
    keywords: ["vision", "pdf", "模型", "扫描"],
    conditional: true, // 仅联网搜索开启且展开高级设置
  },
  {
    id: SETTING_IDS.kiro.webPdfVisionKey,
    section: "kiro",
    title: "OpenCode Go Vision API Key",
    description: "仅用于读取联网搜索发现的扫描型 PDF。密钥仅保存在当前浏览器会话中",
    keywords: ["vision", "api key", "pdf", "密钥"],
    conditional: true, // 仅联网搜索开启且展开高级设置
  },
  // ---- Agent 与权限 ----
  {
    id: SETTING_IDS["kiro-agent"].computerEnabled,
    section: "kiro-agent",
    title: "允许 Kiro 操作文件",
    description: "开启后 Kiro 可在授权的工作区内读取、创建和受控修改文件",
    keywords: ["agent", "computer", "文件", "授权", "开关", "启用", "操作"],
  },
  {
    id: SETTING_IDS["kiro-agent"].agentMode,
    section: "kiro-agent",
    title: "自动执行级别",
    description: "仅规划 / 每次确认 / 授权范围内自动",
    keywords: ["权限", "模式", "计划", "受控", "自动", "permission", "mode", "自动执行"],
  },
  {
    id: SETTING_IDS["kiro-agent"].workspace,
    section: "kiro-agent",
    title: "当前工作区",
    description: "当前工作区与可访问的位置",
    keywords: ["workspace", "工作区", "位置", "root", "sandbox", "本地"],
  },
  {
    id: SETTING_IDS["kiro-agent"].workspaceKnowledge,
    section: "kiro-agent",
    title: "工作区知识",
    description: "本地文件索引用于查找相关文件候选",
    keywords: ["索引", "知识", "文件", "片段", "index", "knowledge"],
    conditional: true, // 仅存在当前工作区时渲染
  },
  {
    id: SETTING_IDS["kiro-agent"].permissions,
    section: "kiro-agent",
    title: "权限与安全",
    description: "V1 安全边界：无 shell / 删除 / 应用启动 / MCP / Full Access",
    keywords: ["安全", "权限", "shell", "删除", "终端", "full access", "sandbox", "沙箱"],
  },
  // ---- 数据与隐私 ----
  {
    id: SETTING_IDS.data.backupFull,
    section: "data",
    title: "完整备份",
    description: "导出包含课程资料文件的完整备份",
    keywords: ["备份", "导出", "zip", "附件"],
  },
  {
    id: SETTING_IDS.data.backupJson,
    section: "data",
    title: "仅数据备份",
    description: "导出不含课程资料的 JSON 备份",
    keywords: ["备份", "导出", "json", "仅数据"],
  },
  {
    id: SETTING_IDS.data.restoreData,
    section: "data",
    title: "恢复数据",
    description: "从 ClassFlow 备份恢复课程、任务与设置",
    keywords: ["备份", "恢复", "导入", "restore"],
  },
  {
    id: SETTING_IDS.data.privacyLocal,
    section: "data",
    title: "本地优先",
    description: "课程、任务、记忆与聊天历史保存在当前浏览器；附件正文存入浏览器本地存储",
    keywords: ["本地", "隐私", "存储", "设备", "隐私说明"],
  },
  {
    id: SETTING_IDS.data.privacyApiKey,
    section: "data",
    title: "API Key",
    description: "仅保存在当前浏览器会话（sessionStorage），不写入本地存储、备份或日志",
    keywords: ["api key", "隐私", "会话", "密钥"],
  },
  {
    id: SETTING_IDS.data.privacyContext,
    section: "data",
    title: "上下文发送",
    description: "发送给 AI 服务的仅包括当前对话、必要的 ClassFlow 上下文与你选择的资料内容",
    keywords: ["隐私", "上下文", "发送", "ai"],
  },
];

/** Registry 结构完整性校验（duplicate ID / invalid section）。纯函数，可在任意环境运行。 */
export function validateRegistryIntegrity(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of SETTINGS_REGISTRY) {
    if (seen.has(entry.id)) {
      errors.push(`duplicate registry id: ${entry.id}`);
    }
    seen.add(entry.id);
    if (!entry.section || !SETTINGS_REGISTRY_SECTIONS.has(entry.section)) {
      errors.push(`invalid section "${entry.section}" for registry id: ${entry.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

const SETTINGS_REGISTRY_SECTIONS = new Set<SettingsSection>([
  "general",
  "profile",
  "semester",
  "tasks",
  "focus",
  "kiro",
  "kiro-agent",
  "data",
  "about",
]);

// 开发模式：Registry 结构校验（ID 唯一 / section 有效）——模块加载即执行，不依赖 DOM
if (process.env.NODE_ENV === "development") {
  const result = validateRegistryIntegrity();
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn("[SettingsRegistry] integrity errors:", result.errors);
  }
}

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
