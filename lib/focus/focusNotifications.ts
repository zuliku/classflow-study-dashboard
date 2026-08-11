/**
 * Task 3：Focus 完成通知（本地短提示音 + Browser Notification）。
 * - 不创建 Reminder entity；绝不调用 Notification.requestPermission()
 * - 声音 / 系统通知失败一律静默，不得影响 Session 完成
 */

/** WebAudio 本地短提示音（一次即可；不支持 / 失败 → false） */
export function playFocusCompleteSound(): boolean {
  try {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return false;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
    void osc.onended;
    return true;
  } catch {
    return false;
  }
}

/** Browser Notification：仅 granted 才发送（已开启且已授权；失败静默 false） */
export function showFocusBrowserNotification(input: {
  title: string;
  body: string;
}): boolean {
  try {
    if (typeof window === "undefined") return false;
    const api = (window as Window & typeof globalThis).Notification;
    if (!api || api.permission !== "granted") return false;
    const n = new api(input.title, {
      body: input.body,
      icon: "/kiro/kiro-mark.png",
      tag: `classflow-focus-complete-${Date.now()}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
