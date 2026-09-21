/**
 * Computer Use Phase 2 — GUI Risk Classifier（纯函数）。
 *
 * 输入是 Main 校验过的真实控件事实（prepared target），不是模型自述字段。
 * 输出等级：
 * - normal      普通：点击 tab / 输入搜索词 / 滚动
 * - external    需要确认：发送消息 / 提交表单 / 下载 / 发布 / 修改设置 / 最终确认
 * - destructive 需要确认（allow-once only）：删除 / 卸载 / 格式化 / 关闭窗口
 * - sensitive   需要确认（allow-once only）：密码字段操作 / 疑似凭证字符串
 * - blocked     永不执行（审批也不放行）：密码 / API Key / Token / Secret / 提权 / clipboard
 *
 * 敏感文本绝不进入 tool output / audit / 审批预览。
 */
import type {
  DesktopGuiActionType,
  DesktopGuiRiskLevel,
  ClassFlowDesktopComputerActionTargetInfo,
} from "@/lib/desktop/types";
import { parseGuiKey } from "@/lib/ai/computer/gui/keymap";

export interface GuiRiskDecision {
  level: DesktopGuiRiskLevel;
  reason: string;
  /** 非敏感文本预览（≤80 chars）；敏感 / blocked → null */
  textPreview: string | null;
}

export interface GuiRiskContext {
  action: DesktopGuiActionType;
  text?: string;
  key?: string;
  target: Pick<
    ClassFlowDesktopComputerActionTargetInfo,
    "kind" | "role" | "name" | "isPassword" | "appName" | "windowTitle"
  >;
}

const DESTRUCTIVE_NAME_PATTERN =
  /(删除|移除|卸载|格式化|清空|重置|注销|关机|重启|delete|remove|uninstall|format|wipe|erase|reset|shutdown|restart|sign\s?out|log\s?off)/i;

const EXTERNAL_NAME_PATTERN =
  /(发送|提交|发布|上传|下载|购买|支付|付款|下单|确认|安装|更新|保存|应用|设置|登录|注册|分享|订阅|send|submit|publish|post|upload|download|buy|purchase|pay|checkout|confirm|install|update|save|apply|settings|sign\s?in|log\s?in|register|share|subscribe)/i;

/** Blocked：系统安全 / 提权 / 凭据界面（进程名来自 Main，模型不可伪造） */
const BLOCKED_APPS = new Set([
  "consent",
  "logonui",
  "credentialui",
  "lsass",
  "winlogon",
  "useraccountcontrol",
]);

/** External：系统设置 / 终端类窗口操作需要确认 */
const EXTERNAL_APPS = new Set([
  "regedit",
  "taskmgr",
  "control",
  "systemsettings",
  "cmd",
  "powershell",
  "pwsh",
  "windowsterminal",
  "mmc",
]);

const SENSITIVE_TEXT_PATTERNS: RegExp[] = [
  /(password|passwd|pwd|密码)/i,
  /(api[\s_-]?key|apikey|access[\s_-]?key)/i,
  /(secret|token|bearer\s|credential)/i,
  /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{12,}|xox[bap]-[A-Za-z0-9-]{8,})/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** 高熵字符串启发式：长、无空格、同时含字母/数字/符号 → 疑似凭证 */
export function looksLikeCredentialString(text: string): boolean {
  if (text.length < 24) return false;
  if (/\s/.test(text)) return false;
  return /[A-Za-z]/.test(text) && /[0-9]/.test(text) && /[^A-Za-z0-9]/.test(text);
}

function cleanPreview(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function sanitizeAppName(appName: string): string {
  return appName.trim().toLowerCase();
}

/**
 * GUI Risk 分类（deterministic；先 blocked → sensitive → destructive → external → normal）。
 */
export function classifyGuiAction(context: GuiRiskContext): GuiRiskDecision {
  const { action, target } = context;
  const app = sanitizeAppName(target.appName);
  const name = target.name ?? "";

  // 1. Blocked：系统安全界面
  if (app && BLOCKED_APPS.has(app)) {
    return { level: "blocked", reason: "目标窗口属于系统安全 / 凭据界面", textPreview: null };
  }

  // 2. 键盘组合风险（blocked / destructive / external）
  let keyHint: "normal" | "external" | "destructive" | "blocked" = "normal";
  if (action === "key" && context.key) {
    const parsed = parseGuiKey(context.key);
    if (!parsed) {
      return { level: "blocked", reason: "按键不在允许列表内", textPreview: null };
    }
    keyHint = parsed.riskHint;
    if (keyHint === "blocked") {
      return { level: "blocked", reason: parsed.riskReason ?? "系统级 / 剪贴板组合键被禁用", textPreview: null };
    }
  }

  // 3. 文本输入：密码字段 / 敏感内容
  if (action === "type") {
    const text = context.text ?? "";
    if (target.isPassword) {
      return { level: "blocked", reason: "目标元素是密码字段，Kiro 不会输入密码", textPreview: null };
    }
    if (SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
      return { level: "blocked", reason: "检测到疑似密码 / API Key / Token，禁止经模型输入", textPreview: null };
    }
    if (looksLikeCredentialString(text)) {
      return {
        level: "sensitive",
        reason: "疑似凭证字符串（高熵），需要用户确认",
        textPreview: null,
      };
    }
    if (target.kind !== "element") {
      return {
        level: "external",
        reason: "未指定 UI 元素，将输入到当前焦点控件",
        textPreview: cleanPreview(text),
      };
    }
    if (app && EXTERNAL_APPS.has(app)) {
      return {
        level: "external",
        reason: "目标是系统 / 终端类窗口",
        textPreview: cleanPreview(text),
      };
    }
    return { level: "normal", reason: "普通文本输入", textPreview: cleanPreview(text) };
  }

  // 4. 密码字段点击（sensitive）
  if ((action === "click" || action === "double_click") && target.isPassword) {
    return { level: "sensitive", reason: "目标是密码字段，可能需要用户确认", textPreview: null };
  }

  // 5. 目标元素名称风险（删除 / 提交 / 发送 / 下载 / 设置…）
  if (name) {
    if (DESTRUCTIVE_NAME_PATTERN.test(name)) {
      return { level: "destructive", reason: `目标「${name.slice(0, 24)}」可能删除或不可逆`, textPreview: null };
    }
    // 最终确认型：Enter 落在发送/提交控件上
    if (action === "key" && keyHint === "normal" && /^enter$/i.test(context.key ?? "") && EXTERNAL_NAME_PATTERN.test(name)) {
      return { level: "external", reason: `焦点元素「${name.slice(0, 24)}」可能是发送 / 提交`, textPreview: null };
    }
    if (EXTERNAL_NAME_PATTERN.test(name)) {
      return { level: "external", reason: `目标「${name.slice(0, 24)}」可能产生外部效果`, textPreview: null };
    }
  }

  // 6. 键盘 external / destructive 提示
  if (keyHint === "destructive") {
    return { level: "destructive", reason: "该组合键可能关闭窗口或永久删除内容", textPreview: null };
  }
  if (keyHint === "external") {
    return { level: "external", reason: "该组合键可能保存 / 提交 / 打印", textPreview: null };
  }

  // 7. 窗口级 external（系统设置 / 终端）
  if (app && EXTERNAL_APPS.has(app)) {
    return { level: "external", reason: "目标窗口属于系统设置 / 终端类应用", textPreview: null };
  }

  // 8. 坐标回退：未经 UIA 元素验证 → 需要确认
  if (target.kind === "coordinates") {
    return { level: "external", reason: "未使用 UI 元素定位（坐标回退），需要确认", textPreview: null };
  }

  return { level: "normal", reason: "普通 GUI 操作", textPreview: null };
}

/** 高风险（需要强制 allow-once only 审批）等级集合 */
export function isHighRiskGuiLevel(level: DesktopGuiRiskLevel): boolean {
  return level === "external" || level === "destructive" || level === "sensitive";
}

/** 是否永远禁止（审批也不放行） */
export function isBlockedGuiLevel(level: DesktopGuiRiskLevel): boolean {
  return level === "blocked";
}
