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

  constructor(syncFn: SyncFn, intervalSeconds = 60) {
    this.syncFn = syncFn;
    this.intervalMs = intervalSeconds * 1000;
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
      try {
        await this.syncFn();
      } catch (e) {
        // 周期同步失败不能完全无声：渠道看起来「在线」但邮件已停止同步
        console.error(`[email-scheduler] sync failed: ${(e as Error).message?.slice(0, 200)}`);
      }
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
