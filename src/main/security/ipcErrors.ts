/**
 * Main → Renderer 错误脱敏（skill / mcp / channels 共用；对照 desktopBridge.mapFsError）。
 *
 * 原则：code 原样透传（调用方按 code 做 UX 分支），message 只做最小清洗后保留
 * （调用方 toast/行内错误直接展示 message，全丢会劣化合法校验文案）：
 * - Windows 绝对路径（天然含用户名 C:\Users\<name>\…）→ [path]
 * - Unix home（/home/<name>、/Users/<name>）→ 用户名打码
 * - 超长截断 300（与 channels 现有上限对齐）
 */
const WINDOWS_ABS_PATH_RE = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const UNIX_HOME_RE = /\/(Users|home)\/[^/\s"']+/g;
const MAX_IPC_ERROR_MESSAGE_LENGTH = 300;

export function sanitizeIpcErrorMessage(message: unknown): string {
  const raw = typeof message === "string" ? message : String(message ?? "");
  const masked = raw
    .replace(WINDOWS_ABS_PATH_RE, "[path]")
    .replace(UNIX_HOME_RE, "/$1/[redacted]");
  return masked.length > MAX_IPC_ERROR_MESSAGE_LENGTH
    ? masked.slice(0, MAX_IPC_ERROR_MESSAGE_LENGTH)
    : masked;
}

/** toIpcError 统一出口：保留 code（+ 可选透传字段如 approvalRequestId），message 只放清洗后的文本 */
export function toSanitizedIpcError(
  err: unknown,
  fallbackCode = "UNKNOWN",
  extra?: Record<string, unknown>
): never {
  const e = err as { code?: unknown; message?: unknown };
  const raw = err instanceof Error ? err.message : String(err);
  let code = typeof e?.code === "string" ? e.code : fallbackCode;
  let message: unknown = typeof e?.message === "string" ? e.message : raw;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown };
    if (typeof parsed?.code === "string") code = parsed.code;
    if (typeof parsed?.message === "string") message = parsed.message;
  } catch {
    /* 非 JSON：沿用外层提取 */
  }
  throw new Error(JSON.stringify({ code, message: sanitizeIpcErrorMessage(message), ...extra }));
}
