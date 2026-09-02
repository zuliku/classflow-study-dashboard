/**
 * Reminder 提示音（WebAudio 轻量实现，与 Focus helper 同生命周期）。
 * - 不引入音频库 / 全局服务 / 常驻 AudioContext
 * - create → play short sound → onended close AudioContext
 * - 失败静默（不影响 Reminder fired/enqueue）
 */

export function playReminderSound(): boolean {
  try {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return false;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
    return true;
  } catch {
    return false;
  }
}
