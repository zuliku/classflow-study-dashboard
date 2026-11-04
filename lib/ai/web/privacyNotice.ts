/** 是否已有真实 web_search Tool Part（含 live / 历史恢复；只认 tool type，不扫正文）。 */
export function hasUsedWebSearch(messages: unknown[]): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if ((part as { type?: unknown }).type === "tool-web_search") return true;
    }
  }
  return false;
}
