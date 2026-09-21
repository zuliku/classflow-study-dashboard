/**
 * Computer Use Phase 3 — 应用控制（logical app identifier → allowlisted resolution）。
 *
 * 安全契约：
 * - 模型只能传 logical app id（如 "chrome" / "word" / "wechat"），绝不接受 exe / 绝对路径
 * - 解析只使用白名单 alias + 系统事实（App Paths 注册表 / PATH / Start Apps），
 *   结果绝不回传路径给 renderer / model
 * - 启动使用 detached spawn（不 elevation、无 shell window 注入）
 */
import { spawn } from "node:child_process";
import { runPowerShellJson } from "./powershell";

export interface DesktopAppEntry {
  id: string;
  label: string;
  aliases: string[];
  /** 启动后用于匹配新窗口的进程名（小写） */
  processHints: string[];
}

/** 允许 Kiro 打开的 installed apps（logical id；可扩展） */
export const DESKTOP_APP_ALLOWLIST: Record<string, DesktopAppEntry> = {
  chrome: { id: "chrome", label: "Chrome", aliases: ["chrome", "google chrome"], processHints: ["chrome"] },
  edge: { id: "edge", label: "Edge", aliases: ["msedge", "microsoft edge"], processHints: ["msedge"] },
  firefox: { id: "firefox", label: "Firefox", aliases: ["firefox", "mozilla firefox"], processHints: ["firefox"] },
  explorer: { id: "explorer", label: "文件资源管理器", aliases: ["explorer", "文件资源管理器"], processHints: ["explorer"] },
  notepad: { id: "notepad", label: "记事本", aliases: ["notepad", "记事本"], processHints: ["notepad"] },
  calculator: { id: "calculator", label: "计算器", aliases: ["calc", "calculator", "计算器"], processHints: ["calculator", "calc"] },
  word: { id: "word", label: "Word", aliases: ["winword", "word", "microsoft word"], processHints: ["winword"] },
  excel: { id: "excel", label: "Excel", aliases: ["excel", "microsoft excel"], processHints: ["excel"] },
  powerpoint: { id: "powerpoint", label: "PowerPoint", aliases: ["powerpnt", "powerpoint", "microsoft powerpoint"], processHints: ["powerpnt"] },
  onenote: { id: "onenote", label: "OneNote", aliases: ["onenote"], processHints: ["onenote"] },
  outlook: { id: "outlook", label: "Outlook", aliases: ["outlook", "microsoft outlook"], processHints: ["outlook"] },
  wechat: { id: "wechat", label: "微信", aliases: ["wechat", "weixin", "微信"], processHints: ["wechat", "weixin"] },
  wecom: { id: "wecom", label: "企业微信", aliases: ["wxwork", "wecom", "企业微信"], processHints: ["wxwork"] },
  qq: { id: "qq", label: "QQ", aliases: ["qq"], processHints: ["qq"] },
  dingtalk: { id: "dingtalk", label: "钉钉", aliases: ["dingtalk", "钉钉"], processHints: ["dingtalk"] },
  vscode: { id: "vscode", label: "VS Code", aliases: ["code", "visual studio code", "vs code"], processHints: ["code"] },
  terminal: { id: "terminal", label: "Windows Terminal", aliases: ["wt", "windows terminal", "terminal"], processHints: ["windowsterminal", "wt"] },
  settings: { id: "settings", label: "设置", aliases: ["设置", "settings", "ms-settings"], processHints: ["systemsettings", "settings"] },
  paint: { id: "paint", label: "画图", aliases: ["mspaint", "paint", "画图"], processHints: ["mspaint"] },
  snippingtool: { id: "snippingtool", label: "截图工具", aliases: ["snippingtool", "截图工具"], processHints: ["snippingtool"] },
};

const APP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/** logical app id 归一（alias 也接受；未知 → null） */
export function normalizeDesktopAppId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 32) return null;
  if (raw.includes("\\") || raw.includes("/") || raw.includes(":")) return null; // 路径样式一律拒绝
  // alias（含中文名）优先精确匹配
  for (const entry of Object.values(DESKTOP_APP_ALLOWLIST)) {
    if (entry.aliases.includes(raw)) return entry.id;
  }
  if (!APP_ID_PATTERN.test(raw)) return null;
  return DESKTOP_APP_ALLOWLIST[raw] ? raw : null;
}

export function desktopAppLabel(appId: string): string {
  return DESKTOP_APP_ALLOWLIST[appId]?.label ?? appId;
}

export type ResolvedDesktopApp =
  | { kind: "exe"; command: string }
  | { kind: "appsFolder"; appId: string; label: string }
  | { kind: "none" };

export function buildAppResolveScript(appId: string): string {
  const entry = DESKTOP_APP_ALLOWLIST[appId];
  const aliases = JSON.stringify(entry?.aliases ?? []);
  const base64 = Buffer.from(aliases, "utf8").toString("base64");
  return String.raw`
$aliases = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__ALIASES_B64__')) | ConvertFrom-Json
$roots = @("HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths", "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths")
foreach ($alias in @($aliases)) {
  foreach ($root in $roots) {
    foreach ($name in @(($alias + ".exe"), $alias)) {
      $key = Join-Path $root $name
      if (Test-Path $key) {
        try {
          $exe = (Get-ItemProperty -Path $key).'(default)'
          if ($exe -and (Test-Path $exe)) {
            ConvertTo-Json -InputObject @{ kind = 'exe'; command = [string]$exe } -Compress
            exit 0
          }
        } catch { }
      }
    }
  }
  $cmd = Get-Command $alias -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd -and $cmd.Source) {
    ConvertTo-Json -InputObject @{ kind = 'exe'; command = [string]$cmd.Source } -Compress
    exit 0
  }
  $app = Get-StartApps | Where-Object { $_.Name -ieq $alias } | Select-Object -First 1
  if (-not $app) { $app = Get-StartApps | Where-Object { $_.Name -like ("*" + $alias + "*") } | Select-Object -First 1 }
  if ($app) {
    ConvertTo-Json -InputObject @{ kind = 'appsFolder'; appId = [string]$app.AppID; label = [string]$app.Name } -Compress
    exit 0
  }
}
ConvertTo-Json -InputObject @{ kind = 'none' } -Compress
`.replace("__ALIASES_B64__", base64);
}

/** 纯解析：PowerShell 解析结果 → ResolvedDesktopApp（fail closed） */
export function parseAppResolveResult(raw: unknown): ResolvedDesktopApp {
  if (!raw || typeof raw !== "object") return { kind: "none" };
  const value = raw as { kind?: unknown; command?: unknown; appId?: unknown; label?: unknown };
  if (value.kind === "exe" && typeof value.command === "string" && value.command.length > 0) {
    return { kind: "exe", command: value.command.slice(0, 1024) };
  }
  if (value.kind === "appsFolder" && typeof value.appId === "string" && value.appId.length > 0) {
    return {
      kind: "appsFolder",
      appId: value.appId.slice(0, 256),
      label: typeof value.label === "string" ? value.label.slice(0, 64) : "",
    };
  }
  return { kind: "none" };
}

/** 解析已安装应用（allowlist alias → App Paths / PATH / Start Apps） */
export async function resolveDesktopApp(appId: string): Promise<ResolvedDesktopApp> {
  const entry = DESKTOP_APP_ALLOWLIST[appId];
  if (!entry) return { kind: "none" };
  const raw = await runPowerShellJson<unknown>(buildAppResolveScript(appId));
  return parseAppResolveResult(raw);
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

/** 启动已解析应用；失败 → false（绝不在日志 / 错误中带出路径） */
export function launchResolvedDesktopApp(resolved: ResolvedDesktopApp): boolean {
  try {
    if (resolved.kind === "exe") {
      spawnDetached(resolved.command, []);
      return true;
    }
    if (resolved.kind === "appsFolder") {
      spawnDetached("explorer.exe", [`shell:AppsFolder\\${resolved.appId}`]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
