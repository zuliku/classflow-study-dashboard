/**
 * Email Sync Scheduler — Task 18A
 * Per-account 60s, no overlapping, manual syncNow respects running, stop cancels.
 */

export type SyncFn = () => Promise<void>;

export class EmailSyncScheduler {
  private intervalMs: number;
  private syncFn: SyncFn;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  /** BUG-056：进行中的 tick，stop() 可等待其结束（防止快速禁用→启用产生双 doPoll） */
  private inFlight: Promise<void> | null = null;

  constructor(syncFn: SyncFn, intervalSeconds = 60) {
    this.syncFn = syncFn;
    // 持久化配置可能被手改（加载路径无 zod）：钳制到 ≥30s，防止 setTimeout(0) 轰击
    const safeSeconds = Number.isFinite(intervalSeconds) ? Math.max(30, Math.floor(intervalSeconds)) : 60;
    this.intervalMs = safeSeconds * 1000;
  }

  start(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 等待进行中的 tick 结束（adapter.stop 用；带 5s 上限防悬挂） */
  async whenSettled(): Promise<void> {
    if (!this.inFlight) return;
    await Promise.race([
      this.inFlight.catch(() => {}),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      if (this.running) {
        // Skip overlapping, reschedule
        this.scheduleNext();
        return;
      }
      this.running = true;
      this.inFlight = (async () => {
        try {
          await this.syncFn();
        } catch (e) {
          // 周期同步失败不能完全无声：渠道看起来「在线」但邮件已停止同步
          console.error(`[email-scheduler] sync failed: ${(e as Error).message?.slice(0, 200)}`);
        }
      })();
      await this.inFlight;
      this.running = false;
      this.scheduleNext();
    }, this.intervalMs);
  }

  async syncNow(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncFn();
    } finally {
      this.running = false;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
