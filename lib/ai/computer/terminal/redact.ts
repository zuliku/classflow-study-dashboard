/**
 * Terminal chunk sanitization（V2 streaming；Main runtime 与 Web 共享）。
 * - ANSI 控制序列剥离
 * - Windows 绝对路径 / UNC 路径 redaction（native path 绝不进 renderer / UI / 模型）
 * - 常见 secret 形状 redaction（绝不进 UI / audit / 模型）
 * - 字符上限（每 chunk 有界；Web 层另有最终 aggregate bound）
 */

export const REDACTED_PATH_MARK = "[REDACTED_PATH]";
export const REDACTED_SECRET_MARK = "[REDACTED_SECRET]";

/** 剥离开启序列与着色等 ANSI 控制序列（CSI / OSC / 单字符 ESC 序列） */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;:?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "").replace(/\u001b[()][0-9A-Z]/g, "");
}

/** Windows 绝对路径（C:\...）与 UNC（\\server\share）redaction */
export function redactAbsolutePaths(text: string): string {
  return text
    .replace(/(?<![\w:.])([A-Za-z]:\\(?:[^\\\r\n"'\s<>|?*]+\\?)*)(?![\w:])/g, REDACTED_PATH_MARK)
    .replace(/(?<![\w.])[\\]{2}[^\\\r\n"'\s<>|?*]+(?:\\[^\\\r\n"'\s<>|?*]+)+(?![\w.])/g, REDACTED_PATH_MARK);
}

/** 常见 secret 形状（sk-… / Bearer … / Authorization / *_API_KEY / token / password / secret 等） */
export function redactTerminalSecrets(text: string): string {
  return (
    text
      // sk- 前缀的 provider key（OpenAI/DeepSeek/OpenCode Go 等）
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, REDACTED_SECRET_MARK)
      // Bearer <token>
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer " + REDACTED_SECRET_MARK)
      // Authorization: <scheme> <token>
      .replace(/(Authorization\s*:\s*[A-Za-z]+)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 " + REDACTED_SECRET_MARK)
      // KEY=value 赋值（api_key / apikey / token / secret / password 等；允许 TEST_ 等前缀；
      // 无前导 \b——API_KEY 前是 _ 时 word boundary 不成立，[\w-]* 回溯保证匹配）
      .replace(/([\w-]*(?:api[_-]?key|apikey|token|secret|password|passwd|access[_-]?key)\b\s*[=:]\s*)\S+/gi, "$1" + REDACTED_SECRET_MARK)
      // 长随机 hex/base64 串（>=24 字符，疑似 key；不误伤正常长输出）
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED_SECRET_MARK)
      // 短引号内的 "xxx" 形式 secret 赋值
      .replace(/(["'](?:api[_-]?key|token|secret|password)["']\s*[=:]\s*["'])[^"']+(["'])/gi, "$1" + REDACTED_SECRET_MARK + "$2")
  );
}

/** 完整 chunk sanitize：ANSI → path → secret → char bound */
export function sanitizeTerminalChunk(text: string, maxChars = 16_000): string {
  const cleaned = redactTerminalSecrets(redactAbsolutePaths(stripAnsi(text)));
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars);
}

/** 最终模型输出 sanitize（Final Tool Result → MiMo）：ANSI → path → secret → bound（与 streaming 同规则） */
export function sanitizeTerminalModelOutput(text: string, maxChars: number): { text: string; truncated: boolean } {
  const cleaned = redactTerminalSecrets(redactAbsolutePaths(stripAnsi(text)));
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };
  return { text: cleaned.slice(0, maxChars), truncated: true };
}

/** 命令预览（进 audit / UI）同样必须过 secret redaction */
export function redactCommandPreview(command: string, maxChars = 500): string {
  const cleaned = redactTerminalSecrets(redactAbsolutePaths(command)).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…`;
}
