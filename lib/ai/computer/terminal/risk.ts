/**
 * Desktop Terminal V1 — Terminal Command Risk Classifier（deterministic lexical）。
 *
 * 风险由 ClassFlow runtime 判断；模型无法提供 risk/safe/requiresApproval 字段。
 * 不做完整 PowerShell AST / CMD parser——保守 lexical 扫描：
 * - case-insensitive、trim、归一化空白
 * - 识别命令链（; && || | 换行），每个 segment 单独扫描
 * - 任一 segment 命中更高级别 → 整条命令升级（防审批规避：
 *   "Write-Output test; Remove-Item x.txt" 整条 destructive）
 * - nested shell（命令内启动 powershell/cmd）仍对完整原始命令扫描；
 *   -EncodedCommand / runas / Start-Process -Verb RunAs → blocked
 */
import { ClassFlowDesktopTerminalShell } from "@/lib/desktop/types";

export type TerminalCommandRisk = "normal" | "destructive" | "privileged" | "blocked";

/** 命令链分隔符（PowerShell 与 CMD 共有；换行视为分隔） */
const CHAIN_SEPARATORS = /[;|&\n]/;

/** PowerShell 别名展开表（常见 destructive 别名 → Remove-Item） */
const PS_DESTRUCTIVE_ALIASES: Record<string, string> = {
  rm: "remove-item",
  del: "remove-item",
  erase: "remove-item",
  rmdir: "remove-item",
  rd: "remove-item",
  cls: "clear-host",
};

/** PowerShell destructive 命令（词边界匹配；含 -Recurse/-Force 已包含在 Remove-Item 通用命中） */
const PS_DESTRUCTIVE_PATTERNS = [
  /\bremove-item\b/,
  /\bclear-content\b/,
  /\bclear-item\b/,
  /\bremove-itemproperty\b/,
];

/** CMD destructive 命令 */
const CMD_DESTRUCTIVE_PATTERNS = [
  /\bdel\b/,
  /\berase\b/,
  /\brd\b/,
  /\brmdir\b/,
  /\brmdir\s+\/s\b/,
];

/** 跨 shell 的 destructive git 操作（工作区文件不可逆变更） */
const GIT_DESTRUCTIVE_PATTERNS = [
  /\bgit\s+clean\b/,
  /\bgit\s+reset\s+--hard\b/,
  /git\s+checkout\s+--/,
  /\bgit\s+restore\s+--worktree\b/,
  /git\s+restore\s+\./,
  /\bgit\s+restore\s+--staged\s+--worktree\b/,
];

/** 系统级 / 高权限操作（至少 ASK） */
const PRIVILEGED_PATTERNS = [
  /\breg\s+(add|delete)\b/,
  /\bsc\s+/,
  /\bschtasks\b/,
  /\bnetsh\b/,
  /\btaskkill\b/,
  /\bstop-process\b/,
  /\bkill\s+-?\w*\s*\d/,
  /\bshutdown\b/,
  /\brestart-computer\b/,
  /\bstop-computer\b/,
  /\bset-executionpolicy\b/,
  /\btakeown\b/,
  /\bicacls\b/,
  /\bformat\s+[a-z]:/,
  /\bdiskpart\b/,
  /\bwinget\s+uninstall\b/,
];

/** 直接拒绝（elevation / obfuscation / encoded payload） */
const BLOCKED_PATTERNS = [
  /\bstart-process\b[^|&;\n]*\b-verb\s+runas\b/i,
  /\brunas\b/,
  /-enc(odedcommand)?\b/i,
  /-encodedcommand\b/i,
];

/** 归一化：trim + 折叠空白 + 小写（词边界匹配基于小写文本） */
function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 按命令链分隔符切分（保留原始顺序；空 segment 忽略） */
function splitSegments(normalized: string): string[] {
  return normalized.split(CHAIN_SEPARATORS).map((s) => s.trim()).filter(Boolean);
}

/** 词边界 token 匹配（destructive；PowerShell 别名展开后同样命中） */
function hasDestructiveToken(segment: string, shell: ClassFlowDesktopTerminalShell): boolean {
  if (shell === "powershell") {
    const first = segment.split(/\s+/)[0];
    // 别名首 token（rm/del/erase/rmdir/rd → remove-item）
    if (first in PS_DESTRUCTIVE_ALIASES) return true;
    if (PS_DESTRUCTIVE_PATTERNS.some((re) => re.test(segment))) return true;
    return false;
  }
  return CMD_DESTRUCTIVE_PATTERNS.some((re) => re.test(segment));
}

/**
 * 对完整原始命令做风险判定（含命令链分段；任一 segment 升级整条）。
 * 返回 blocked / privileged / destructive / normal（优先级 blocked > privileged > destructive > normal）。
 */
export function classifyTerminalCommandRisk(
  command: string,
  shell: ClassFlowDesktopTerminalShell
): TerminalCommandRisk {
  const normalized = normalizeCommand(command);
  if (!normalized) return "blocked"; // 空命令

  const segments = splitSegments(normalized);
  if (segments.length === 0) return "blocked";

  let risk: TerminalCommandRisk = "normal";
  for (const segment of segments) {
    // blocked 优先（encod 等隐藏执行方式）
    if (BLOCKED_PATTERNS.some((re) => re.test(segment))) return "blocked";
    if (GIT_DESTRUCTIVE_PATTERNS.some((re) => re.test(segment))) {
      risk = "destructive";
      continue;
    }
    if (hasDestructiveToken(segment, shell)) {
      risk = "destructive";
      continue;
    }
    if (PRIVILEGED_PATTERNS.some((re) => re.test(segment))) {
      // 已有 destructive 不降级
      if (risk !== "destructive") risk = "privileged";
      continue;
    }
  }
  return risk;
}
