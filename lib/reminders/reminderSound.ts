/**
 * Reminder 提示音（WebAudio 轻量实现）。
 * P2：模块单例 AudioContext + play 前 resume（此前每次 new Ctx，autoplay 策略下 suspended 即静默失败还返回 true）。
 * - 音量参数化（0–100；默认 100 保持既有 0.16 增益听感）
 * - 失败返回 false 由调用方降级（震动/无声），不再空吞
 */

let sharedCtx: AudioContext | null = null;
function getSharedCtx(): AudioContext | null {
  try {
    if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    sharedCtx = new Ctx();
    return sharedCtx;
  } catch {
    return null;
  }
}

export function playReminderSound(volume = 100): boolean {
  try {
    const percent = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 100));
    if (percent <= 0) return false;
    // 保持默认 100% 与既有听感一致：0.16 是原固定增益。
    const gainValue = 0.16 * (percent / 100);
    const ctx = getSharedCtx();
    if (!ctx) return false;
    // autoplay 拦截下 resume 后再播；仍 suspended 则诚实返回 false
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
      if (ctx.state === "suspended") return false;
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
    return true;
  } catch {
    return false;
  }
}
