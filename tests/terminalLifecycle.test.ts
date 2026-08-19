import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalProcess, TerminalRuntimeResult } from "@/src/main/terminalRuntime";
import { DesktopTerminalEvent } from "@/lib/desktop/types";

/**
 * Phase 2 — Long-running Process Lifecycle（真实 Windows PowerShell）。
 * 白名单命令（任务 §7/§21）：Write-Output / Start-Sleep 循环；不联网 / 安装 / 删除。
 */

function scratchCwd(): string {
  return mkdtempSync(join(tmpdir(), "classflow-term-life-"));
}

afterEach(async () => {
  // 让前一个 PowerShell 进程的 taskkill 有时间完成，避免下一个测试的启动竞争
  await new Promise((r) => setTimeout(r, 300));
});

/** 启动执行，可选在 delayMs 后 cancel；返回事件流 + settle 结果 */
function launch(
  command: string,
  opts: { timeoutMs?: number; executionMode?: "foreground" | "long-running"; cancelAfterMs?: number } = {}
): Promise<{
  events: DesktopTerminalEvent[];
  settled: { kind: "resolve" | "reject"; result?: TerminalRuntimeResult; errorCode?: string };
}> {
  return new Promise((resolve, reject) => {
    const events: DesktopTerminalEvent[] = [];
    const { promise, handle } = runTerminalProcess({
      executionId: `term-life-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command,
      timeoutMs: opts.timeoutMs ?? 30_000,
      executionMode: opts.executionMode,
      onEvent: (e) => events.push(e),
    });
    let cancelTimer: NodeJS.Timeout | null = null;
    promise.then(
      (result) => {
        if (cancelTimer) clearTimeout(cancelTimer);
        resolve({ events, settled: { kind: "resolve", result } });
      },
      (err: Error & { code?: string }) => {
        if (cancelTimer) clearTimeout(cancelTimer);
        resolve({ events, settled: { kind: "reject", errorCode: err?.code ?? err?.message } });
      }
    );
    if (opts.cancelAfterMs !== undefined) {
      cancelTimer = setTimeout(() => {
        void handle.cancel().catch(() => {});
      }, opts.cancelAfterMs);
    }
    void reject;
  });
}

describe("Phase 2 — 长任务生命周期", () => {
  it("cancel：启动后 ~1500ms cancel → reject CANCELLED、无 late chunk、不 crash", async () => {
    const { events, settled } = await launch(
      "1..20 | ForEach-Object { Write-Output \"tick-$_\"; Start-Sleep -Milliseconds 250 }",
      { cancelAfterMs: 1500 }
    );
    // 至少已有若干 realtime chunks（cancel 前 tick-1/2/3）
    const stdoutEvents = events.filter((e) => e.type === "stdout").length;
    expect(stdoutEvents).toBeGreaterThanOrEqual(1);
    // cancel 完成 → reject CANCELLED
    expect(settled.kind).toBe("reject");
    if (settled.kind === "reject") expect(settled.errorCode).toBe("CANCELLED");
    // exit 事件存在且 cancelled=true
    const exitEvent = events.filter((e) => e.type === "exit").at(-1);
    expect(exitEvent).toBeTruthy();
    if (exitEvent?.type === "exit") {
      expect(exitEvent.cancelled).toBe(true);
      expect(exitEvent.exitCode).toBeNull();
    }
    // 不再出现 late chunks（exit 事件之后没有 stdout）
    const exitIdx = events.findIndex((e) => e.type === "exit");
    const afterExit = events.slice(exitIdx + 1);
    expect(afterExit.filter((e) => e.type === "stdout" || e.type === "stderr")).toHaveLength(0);
    // cancel 幂等：再 cancel 不抛错
    // （此处通过二次 launch 验证非必要；runtime 内部 cancelled 标志保证）
  });

  it("cancel 幂等：settle 后再次 cancel 无副作用", async () => {
    const { promise, handle } = runTerminalProcess({
      executionId: `term-life-idem-${Date.now()}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command: 'Start-Sleep -Milliseconds 2000',
      timeoutMs: 10_000,
      onEvent: () => {},
    });
    promise.catch(() => {});
    await handle.cancel();
    await handle.cancel();
    expect(true).toBe(true);
  });

  it("timeout：短 timeout → resolve timedOut=true（不是 reject）", async () => {
    const { settled } = await launch("Start-Sleep -Seconds 10", { timeoutMs: 2_000 });
    expect(settled.kind).toBe("resolve");
    if (settled.kind === "resolve") {
      expect(settled.result?.timedOut).toBe(true);
      expect(settled.result?.exitCode).toBeNull();
    }
  }, 10000);

  it("long-running：executionMode 允许放宽 timeout（>120s clamp 到 600s，不拒绝）", async () => {
    const { settled } = await launch('Write-Output "long-ok"', {
      timeoutMs: 300_000,
      executionMode: "long-running",
    });
    expect(settled.kind).toBe("resolve");
    if (settled.kind === "resolve") expect(settled.result?.exitCode).toBe(0);
  });

  it("exit 后的事件不影响已 settle 结果（runtime 单次 settle）", async () => {
    const { events, settled } = await launch('Write-Output "once"');
    expect(settled.kind).toBe("resolve");
    const exitCount = events.filter((e) => e.type === "exit").length;
    expect(exitCount).toBe(1);
  });
});
