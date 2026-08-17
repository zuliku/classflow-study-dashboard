/**
 * Desktop Terminal V1.0.1 — Terminal Command Risk Classifier（deterministic lexical；Handoff 冻结）。
 *
 * 风险由 ClassFlow runtime 判定；模型无法提供 risk/safe/requiresApproval 字段。
 * 不做完整 PowerShell AST / CMD parser——保守 lexical 扫描：
 * - case-insensitive、trim、归一化空白
 * - 命令链（; && || | 换行）分段；同时扫描「完整 normalized command」（quoted nested
 *   命令内容不会被 quoting 隐藏——§28）
 * - 最终风险优先级（统一）：blocked > destructive > privileged > normal
 *
 * V1.0.1 hardening：
 * - cross-shell destructive patterns：不依赖 outer shell 类型（cmd /c "del x" 在 powershell
 *   outer 下同样 destructive；powershell Remove-Item 在 cmd outer 下同样 destructive）
 * - nested shell（cmd /c|/k、powershell(.exe)、pwsh(.exe)）→ 至少 privileged
 * - inline interpreter（python -c / node -e / ruby -e / perl -e 等）→ 至少 privileged
 * - blocked（EncodedCommand / runas / Start-Process -Verb RunAs / 空命令）仍最高优先
 *
 * 已知局限（不得在 UI/docs 声称“所有副作用都会被检测”）：
 * python script.py / node script.js / npm test 等普通脚本执行本身可能产生副作用——
 * ClassFlow 只对「已识别」的危险模式请求确认。
 */
import { ClassFlowDesktopTerminalShell } from "@/lib/desktop/types";

export type TerminalCommandRisk = "normal" | "destructive" | "privileged" | "blocked";

/** 命令链分隔符（PowerShell 与 CMD 共有；换行视为分隔） */
const CHAIN_SEPARATORS = /[;|&\n]/;

/** PowerShell destructive cmdlet / alias（outer shell 无关；cross-shell 均检测） */
const PS_DESTRUCTIVE_ALIASES: Record<string, string> = {
  rm: "remove-item",
  del: "remove-item",
  erase: "remove-item",
  rmdir: "remove-item",
  rd: "remove-item",
};

/**
 * Cross-shell recognizable destructive patterns（不依赖 outer shell：
 * cmd /c "del x" 在 powershell outer、powershell -Command "Remove-Item x" 在 cmd outer 都必须命中）。
 * 词边界匹配；不需要理解 quoting semantics（保守识别危险 token）。
 */
const CROSS_SHELL_DESTRUCTIVE_PATTERNS = [
  /\bremove-item\b/,
  /\bclear-content\b/,
  /\bclear-item\b/,
  /\bremove-itemproperty\b/,
  /\bdel\b/,
  /\berase\b/,
  /\brmdir\b/,
  /\brd\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+reset\s+--hard\b/,
  /git\s+checkout\s+--/,
  /\bgit\s+restore\s+--worktree\b/,
  /git\s+restore\s+\./,
  /\bgit\s+restore\s+--staged\s+--worktree\b/,
];

/**
 * Nested shell invocation（V1.0.1：出现即至少 privileged）。
 * 注意：不解析 AST——保守地把这些 token 的调用视为额外解释器启动。
 */
const NESTED_SHELL_PATTERNS = [
  /\bcmd(\.exe)?\s+[/]c\b/,
  /\bcmd(\.exe)?\s+[/]k\b/,
  /\bpowershell(\.exe)?\b/,
  /\bpwsh(\.exe)?\b/,
];

/** Inline arbitrary interpreter（V1.0.1：出现即至少 privileged；不解析其内容） */
const INLINE_INTERPRETER_PATTERNS = [
  /\bpython(?:3|\.exe)?\s+-c\b/,
  /\bpy(?:\.exe)?\s+-c\b/,
  /\bnode(\.exe)?\s+(?:-e|--eval)\b/,
  /\bruby(\.exe)?\s+-e\b/,
  /\bperl(\.exe)?\s+-e\b/,
];

/** 系统级 / 高权限操作（至少 privileged） */
const SYSTEM_PRIVILEGED_PATTERNS = [
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

/** 直接拒绝（elevation / obfuscation / encoded payload）；blocked 优先级最高 */
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

/** PowerShell 别名展开后的首 token 是否 destructive（rm/del/erase/rmdir/rd → remove-item） */
function shellAliasDestructive(segment: string, shell: ClassFlowDesktopTerminalShell): boolean {
  if (shell !== "powershell") return false;
  const first = segment.split(/\s+/)[0];
  return first in PS_DESTRUCTIVE_ALIASES;
}

/**
 * 风险判定入口（优先级：blocked > destructive > privileged > normal）：
 * 完整 normalized command + 每个 segment 都扫描；quoted nested 内容不因 quoting 被隐藏。
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

  // blocked 最高优先（完整文本扫描；quoted 内容同样命中）
  if (BLOCKED_PATTERNS.some((re) => re.test(normalized))) return "blocked";

  // destructive：cross-shell patterns（完整文本 + 每个 segment）+ shell-specific alias
  const destructiveIn = (text: string) =>
    CROSS_SHELL_DESTRUCTIVE_PATTERNS.some((re) => re.test(text));
  if (destructiveIn(normalized)) {
    risk = "destructive";
  } else {
    for (const segment of segments) {
      if (destructiveIn(segment) || shellAliasDestructive(segment, shell)) {
        risk = "destructive";
        break;
      }
    }
  }

  // privileged：nested shell / inline interpreter / system privileged
  //（已有 destructive 不降级；blocked 已提前返回）
  if (risk !== "destructive") {
    const privilegedIn = (text: string) =>
      NESTED_SHELL_PATTERNS.some((re) => re.test(text)) ||
      INLINE_INTERPRETER_PATTERNS.some((re) => re.test(text)) ||
      SYSTEM_PRIVILEGED_PATTERNS.some((re) => re.test(text));
    if (privilegedIn(normalized) || segments.some((s) => privilegedIn(s))) {
      risk = "privileged";
    }
  }

  return risk;
}
