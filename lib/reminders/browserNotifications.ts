/**
 * Task 7G-A2：Browser Notification Bridge。
 * 只在 browser 环境调用；SSR 安全（typeof window / Notification 检查）。
 * 权限：绝不自动申请 —— 只有用户主动开启 Settings 开关时才调用 requestPermission。
 * 当前：Local Runtime → Web Notification API。
 * 未来（Cloud Phase）：Cloud Scheduler → Service Worker → Web Push（不在本文件实现）。
 */

/** window.Notification 安全访问（SSR / 测试环境容错） */
function notificationApi(): (typeof Notification) | null {
  if (typeof window === "undefined") return null;
  return (window as Window & typeof globalThis).Notification ?? null;
}

export function isBrowserNotificationSupported(): boolean {
  return notificationApi() !== null;
}

export function getBrowserNotificationPermission(): NotificationPermission | "unsupported" {
  const api = notificationApi();
  if (!api) return "unsupported";
  return api.permission;
}

export type BrowserNotificationPermissionState = NotificationPermission | "unsupported";

/** Settings 展示用的权限状态（纯函数；真实反映浏览器状态，绝不伪造「已开启」） */
export function describeBrowserNotificationPermission(
  state: BrowserNotificationPermissionState
): { label: string; tone: "success" | "warning" | "neutral" } {
  switch (state) {
    case "granted":
      return { label: "系统已授权", tone: "success" };
    case "denied":
      return { label: "系统已阻止通知权限，请在系统设置中修改", tone: "warning" };
    case "default":
      return { label: "未授权 · 开启开关时会请求授权", tone: "neutral" };
    default:
      return { label: "当前设备不支持系统通知，站内提醒仍可使用", tone: "neutral" };
  }
}

/** 用户主动开启开关时调用（granted → 后续可发送；denied/default → 由调用方处理） */
export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  const api = notificationApi();
  if (!api) return "unsupported";
  try {
    return await api.requestPermission();
  } catch {
    return "denied";
  }
}

/** 发送系统通知：仅 permission === "granted" 时执行；失败静默返回 false（站内提醒不受影响） */
export function showBrowserReminderNotification(input: {
  title: string;
  body: string;
  reminderId: string;
  /** 系统通知点击回调（由 Runtime 注入 target navigation；bridge 保持通用，不 import store） */
  onClick?: () => void;
}): boolean {
  const api = notificationApi();
  if (!api || api.permission !== "granted") return false;
  try {
    const n = new api(input.title, {
      body: input.body,
      icon: "/kiro/kiro-mark.png",
      // 每个 Reminder 独立 tag：不同提醒不会互相覆盖
      tag: `classflow-reminder-${input.reminderId}`,
    });
    n.onclick = () => {
      window.focus();
      input.onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
