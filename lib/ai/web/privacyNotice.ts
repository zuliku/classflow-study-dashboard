/** 是否已有真实 web_search / web_research Tool Part（含 live / 历史恢复；只认 tool type，不扫正文）。 */
export function hasUsedWebSearch(messages: unknown[]): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const type = (part as { type?: unknown }).type;
      if (type === "tool-web_search" || type === "tool-web_research") return true;
      if (type === "tool-delegate_subagent") {
        const output = (part as { output?: unknown }).output as
          | { ok?: boolean; data?: { webUsed?: boolean } }
          | null;
        if (output?.ok === true && output.data?.webUsed === true) return true;
      }
    }
  }
  return false;
}
