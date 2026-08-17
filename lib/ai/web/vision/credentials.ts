/**
 * Kiro Web PDF Vision — 独立会话凭据（Task 19C1）。
 *
 * 与主聊天 Key（lib/ai/sessionKeys.ts）逻辑独立：即使用户主聊天也是 OpenCode Go，
 * 两个 Key 互不覆盖。sessionStorage ONLY：
 * 绝不进入 Zustand / localStorage / history / attachments / source metadata / logs / Tool Results。
 *
 * Storage Key：classflow-ai-key:web-pdf-vision-opencode-go
 */
const WEB_PDF_VISION_KEY_STORAGE = "classflow-ai-key:web-pdf-vision-opencode-go";

function canUseSessionStorage(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem("__classflow_test__", "1");
    sessionStorage.removeItem("__classflow_test__");
    return true;
  } catch {
    return false;
  }
}

export function getSessionWebPdfVisionApiKey(): string {
  if (!canUseSessionStorage()) return "";
  return sessionStorage.getItem(WEB_PDF_VISION_KEY_STORAGE) ?? "";
}

export function setSessionWebPdfVisionApiKey(apiKey: string): void {
  if (!canUseSessionStorage()) return;
  const trimmed = apiKey.trim();
  if (trimmed) sessionStorage.setItem(WEB_PDF_VISION_KEY_STORAGE, trimmed);
  else sessionStorage.removeItem(WEB_PDF_VISION_KEY_STORAGE);
}

export function hasSessionWebPdfVisionApiKey(): boolean {
  return getSessionWebPdfVisionApiKey().length > 0;
}
