/**
 * Computer Use V2.4 — 应用画像（App Profiles）。
 *
 * 目的：把「应用事实」集中成 Main 侧数据，供三处复用：
 * - Observation / Session：向模型与 UI 说明当前应用类型（label）与是否受保护（blocked）
 * - Risk：应用级 blocked（密码管理器 / 银行支付 / 系统安全界面）与高风险控件模式（发送 / 转账 / 红包…）
 * - 时序：readyWaitMs（启动后等待窗口）/ settleMs（动作后固定 settle）
 *
 * 安全契约：
 * - 匹配只使用 Main 侧 native 事实（进程名 / 窗口标题），模型无法伪造
 * - blocked 应用的动作永不执行（审批也不放行）
 * - 只回传 { id, label, blocked }，不包含进程路径 / 命令行
 */

/** 对外（模型 / renderer）可见的画像事实（已脱敏） */
export interface DesktopAppProfileInfo {
  id: string;
  label: string;
  blocked: boolean;
}

export interface DesktopAppProfile extends DesktopAppProfileInfo {
  /** 进程名精确匹配（小写；可带或不带 .exe） */
  processNames: string[];
  /** 窗口标题匹配（正则源；仅内置常量，编译失败即忽略） */
  titlePatterns: string[];
  /** 启动后等待窗口就绪（ms） */
  readyWaitMs: number;
  /** 动作后固定 settle（ms；有 expect 时使用自适应 settle） */
  settleMs: number;
  /** 应用内高风险控件名（正则源）→ 强制审批（external） */
  riskyNamePatterns: string[];
  /** blocked 原因（blocked=true 时展示） */
  reason: string | null;
}

/** 传给 classifyGuiAction 的画像提示（纯数据，Main 解析后下发） */
export interface DesktopAppProfileRiskHint {
  id: string;
  label: string;
  blocked: boolean;
  reason: string | null;
  riskyNamePatterns: string[];
}

export const DEFAULT_APP_READY_WAIT_MS = 400;
/** 与 GUI_ACTION_SETTLE_MS 一致（未知应用保持既有节奏） */
export const DEFAULT_APP_SETTLE_MS = 350;

const BLOCKED_REASON_PASSWORD_MANAGER = "该应用属于密码 / 凭据管理器，Kiro 不会操作";
const BLOCKED_REASON_BANKING = "该应用属于银行 / 支付客户端，Kiro 不会操作";
const BLOCKED_REASON_SECURITY = "该窗口属于系统安全 / 凭据界面，Kiro 不会操作";

/** 内置画像（顺序即匹配优先级；进程名匹配优先于标题匹配） */
export const DESKTOP_APP_PROFILES: DesktopAppProfile[] = [
  {
    id: "security-ui",
    label: "系统安全界面",
    processNames: [
      "consent",
      "logonui",
      "credentialui",
      "lsass",
      "winlogon",
      "useraccountcontrol",
    ],
    titlePatterns: ["用户账户控制", "Windows 安全", "凭据"],
    readyWaitMs: 400,
    settleMs: 300,
    riskyNamePatterns: [],
    blocked: true,
    reason: BLOCKED_REASON_SECURITY,
  },
  {
    id: "password-manager",
    label: "密码管理器",
    processNames: [
      "1password",
      "onepassword",
      "bitwarden",
      "lastpass",
      "keepass",
      "keepassxc",
      "dashlane",
      "nordpass",
      "enpass",
      "roboform",
    ],
    titlePatterns: ["密码库", "密码管理器"],
    readyWaitMs: 400,
    settleMs: 300,
    riskyNamePatterns: [],
    blocked: true,
    reason: BLOCKED_REASON_PASSWORD_MANAGER,
  },
  {
    id: "banking",
    label: "银行 / 支付",
    processNames: [
      "icbc",
      "ccb",
      "abchina",
      "boc",
      "psbc",
      "cmb",
      "bankofchina",
      "unionpay",
      "alipay",
      "alipaybsm",
      "cloudquickpass",
      "95588",
    ],
    titlePatterns: ["网上银行", "手机银行", "个人网银", "收银台", "微信支付", "支付宝"],
    readyWaitMs: 600,
    settleMs: 350,
    riskyNamePatterns: [],
    blocked: true,
    reason: BLOCKED_REASON_BANKING,
  },
  {
    id: "im",
    label: "即时通讯",
    processNames: ["wechat", "weixin", "wxwork", "wecom", "qq", "tim", "dingtalk", "feishu", "lark"],
    titlePatterns: [],
    readyWaitMs: 700,
    settleMs: 350,
    riskyNamePatterns: [
      "发送",
      "转发",
      "撤回",
      "转账",
      "红包",
      "支付",
      "付款",
      "打赏",
      "删除",
      "退出群聊",
      "解散群",
      "移除成员",
      "撤回消息",
      "发送文件",
      "send",
      "transfer",
      "pay",
    ],
    blocked: false,
    reason: null,
  },
  {
    id: "browser",
    label: "浏览器",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc"],
    titlePatterns: [],
    readyWaitMs: 600,
    settleMs: 250,
    riskyNamePatterns: ["下载", "上传", "购买", "支付", "订阅", "download", "upload", "buy", "purchase", "subscribe"],
    blocked: false,
    reason: null,
  },
  {
    id: "office",
    label: "Office 文档",
    processNames: ["winword", "excel", "powerpnt", "onenote", "outlook", "wps", "et", "wpp"],
    titlePatterns: [],
    readyWaitMs: 900,
    settleMs: 300,
    riskyNamePatterns: ["另存为", "覆盖", "发送", "删除", "打印", "save as", "overwrite", "delete", "send", "print"],
    blocked: false,
    reason: null,
  },
  {
    id: "explorer",
    label: "文件资源管理器",
    processNames: ["explorer"],
    titlePatterns: [],
    readyWaitMs: 400,
    settleMs: 250,
    riskyNamePatterns: ["删除", "格式化", "清空回收站", "移除", "delete", "format", "empty recycle"],
    blocked: false,
    reason: null,
  },
  {
    id: "settings",
    label: "系统设置",
    processNames: ["systemsettings", "settings", "control"],
    titlePatterns: ["设置", "控制面板", "settings", "control panel"],
    readyWaitMs: 500,
    settleMs: 400,
    riskyNamePatterns: ["重置", "卸载", "删除", "禁用", "关闭", "reset", "uninstall", "delete", "disable"],
    blocked: false,
    reason: null,
  },
  {
    id: "terminal",
    label: "终端",
    processNames: ["windowsterminal", "cmd", "powershell", "pwsh", "conhost", "wt"],
    titlePatterns: [],
    readyWaitMs: 500,
    settleMs: 300,
    riskyNamePatterns: ["删除", "格式化", "关机", "重启", "delete", "format", "shutdown", "restart"],
    blocked: false,
    reason: null,
  },
  {
    id: "system-tools",
    label: "系统工具（高风险）",
    processNames: ["regedit", "taskmgr", "mmc"],
    titlePatterns: ["注册表编辑器", "任务管理器", "registry editor", "task manager"],
    readyWaitMs: 500,
    settleMs: 350,
    riskyNamePatterns: ["删除", "结束任务", "禁用", "导入", "delete", "end task", "disable", "import"],
    blocked: false,
    reason: null,
  },
];

function normalizeProcessName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim().toLowerCase();
  if (!value) return "";
  return value.endsWith(".exe") ? value.slice(0, -4) : value;
}

const TITLE_MATCH_LIMIT = 200;
const patternCache = new Map<string, RegExp | null>();

function compilePattern(source: string): RegExp | null {
  const cached = patternCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  if (typeof source === "string" && source.length > 0 && source.length <= 64) {
    try {
      compiled = new RegExp(source, "i");
    } catch {
      compiled = null;
    }
  }
  patternCache.set(source, compiled);
  return compiled;
}

export interface ResolveAppProfileInput {
  appName?: string | null;
  windowTitle?: string | null;
}

/** 应用画像解析：进程名精确匹配 → 标题模式（无匹配 → null） */
export function resolveDesktopAppProfile(
  input: ResolveAppProfileInput
): DesktopAppProfile | null {
  const processName = normalizeProcessName(input.appName);
  const title = typeof input.windowTitle === "string" ? input.windowTitle.slice(0, TITLE_MATCH_LIMIT) : "";
  const titleMatch = (candidates: DesktopAppProfile[]): DesktopAppProfile | null => {
    if (!title) return null;
    for (const profile of candidates) {
      for (const source of profile.titlePatterns) {
        const pattern = compilePattern(source);
        if (pattern && pattern.test(title)) return profile;
      }
    }
    return null;
  };

  if (processName) {
    const processProfile = DESKTOP_APP_PROFILES.find((profile) =>
      profile.processNames.includes(processName)
    );
    if (processProfile) {
      if (processProfile.blocked) return processProfile;
      // 安全覆盖：浏览器内打开的网银 / 支付页面 → blocked（进程名不降低风险）
      const blockedByTitle = titleMatch(DESKTOP_APP_PROFILES.filter((profile) => profile.blocked));
      if (blockedByTitle) return blockedByTitle;
      return processProfile;
    }
  }
  return titleMatch(DESKTOP_APP_PROFILES);
}

/** 模型 / renderer 可见的画像事实（无匹配 → null） */
export function desktopAppProfileInfo(
  profile: DesktopAppProfile | null
): DesktopAppProfileInfo | null {
  if (!profile) return null;
  return { id: profile.id, label: profile.label, blocked: profile.blocked };
}

/** classifyGuiAction 画像提示（无匹配 → undefined） */
export function desktopAppProfileRiskHint(
  profile: DesktopAppProfile | null
): DesktopAppProfileRiskHint | undefined {
  if (!profile) return undefined;
  return {
    id: profile.id,
    label: profile.label,
    blocked: profile.blocked,
    reason: profile.reason,
    riskyNamePatterns: profile.riskyNamePatterns,
  };
}

/** 动作后固定 settle（有画像 → 画像值；否则默认） */
export function desktopAppSettleMs(profile: DesktopAppProfile | null): number {
  return profile?.settleMs ?? DEFAULT_APP_SETTLE_MS;
}

/** 启动后等待窗口就绪（有画像 → 画像值；否则默认） */
export function desktopAppReadyWaitMs(profile: DesktopAppProfile | null): number {
  return profile?.readyWaitMs ?? DEFAULT_APP_READY_WAIT_MS;
}
