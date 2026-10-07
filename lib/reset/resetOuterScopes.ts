import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useUIChromeStore } from "@/store/useUIChromeStore";
import { useInboxStore } from "@/store/useInboxStore";
import { setSessionApiKey } from "@/lib/ai/sessionKeys";
import { clearSessionWebSearchApiKey } from "@/lib/ai/web/credentials";
import { setSessionWebPdfVisionApiKey } from "@/lib/ai/web/vision/credentials";
import { clearPendingApprovalSnapshot } from "@/lib/ai/computer/pendingApprovalSnapshot";

/**
 * 全局清除外围编排（DangerZone “清除所有本地数据”调用，主 store resetEntireApp 之后执行）：
 * - 5 个偏好 store 回到首次使用 + 收件箱清空
 * - 本 Tab 会话凭据（AI Key x3 + 联网搜索 + Vision）清除
 * - 待确认审批快照 + 待删 Blob 队列清理（避免重置后幽灵对账/误删）
 *
 * 明确不碰（需备份口径与二次确认，P3）：
 * - vault 密文（删 metadata 即悬空孤儿，删密文不可逆）
 * - Kiro 对话/记忆/项目/知识/审计 IDB 与扩展 metadata
 */
export function resetOuterScopesForEntireApp(): void {
  try {
    useKiroPreferencesStore.getState().resetToDefaults();
  } catch {
    /* 单域失败不阻断其余 */
  }
  try {
    useReminderPreferencesStore.getState().resetToDefaults();
  } catch {
    /* ignore */
  }
  try {
    useAISettingsStore.getState().reset();
  } catch {
    /* ignore */
  }
  try {
    useKiroComputerStore.getState().resetToDefaults();
  } catch {
    /* ignore */
  }
  try {
    useUIChromeStore.getState().reset();
  } catch {
    /* ignore */
  }
  try {
    useInboxStore.getState().clearAll();
  } catch {
    /* ignore */
  }
  // session-only 凭据（本 Tab；关闭会话本就消失，此处显式清避免“凭据复活”误解）
  try {
    setSessionApiKey("opencode-go", "");
    setSessionApiKey("deepseek", "");
    setSessionApiKey("custom-openai", "");
    clearSessionWebSearchApiKey();
    setSessionWebPdfVisionApiKey("");
  } catch {
    /* 隐私模式 sessionStorage 不可用时跳过 */
  }
  try {
    clearPendingApprovalSnapshot();
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("classflow-pending-blob-deletes");
    }
  } catch {
    /* ignore */
  }
}
