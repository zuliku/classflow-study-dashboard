import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalProcess } from "@/src/main/terminalRuntime";
import { sanitizeTerminalModelOutput } from "@/lib/ai/computer/terminal/redact";
import {
  createInteractiveHandle,
  setInteractivePromise,
  getInteractiveRecord,
  deleteInteractiveHandle,
  activeInteractiveHandleCount,
  clearAllInteractiveHandles,
} from "@/lib/ai/computer/terminal/interactiveRegistry";
import { waitForTerminalOutput } from "./helpers/terminalHarness";

function scratchCwd(): string {
  return mkdtempSync(join(tmpdir(), "classflow-async-"));
}

afterEach(() => {
  clearAllInteractiveHandles();
});

describe("Phase 3 async lifecycle — start/write/wait handle", () => {
  it("handle returned while process still alive; write → wait → stdout contains received:hello", async () => {
    const cwd = scratchCwd();
    const executionId = `term-async-${Date.now()}`;
    const handle = createInteractiveHandle(executionId, "call-1", "powershell", "$x=[Console]::In.ReadLine()");
    expect(activeInteractiveHandleCount()).toBe(1);
    expect(getInteractiveRecord(handle)?.status).toBe("running");

    const { promise: runtimePromise, handle: runtimeHandle } = runTerminalProcess({
      executionId,
      shell: "powershell",
      cwd,
      command: '$x=[Console]::In.ReadLine(); Write-Output "received:$x"',
      timeoutMs: 10000,
      onEvent: () => {},
    });

    // 将 runtime promise 包装为 sanitized 并注册到 interactive registry
    const sanitizedPromise = runtimePromise.then((outcome) => {
      const stdout = sanitizeTerminalModelOutput(outcome.stdout, 32000);
      const stderr = sanitizeTerminalModelOutput(outcome.stderr, 32000);
      const truncated = outcome.stdoutTruncated || outcome.stderrTruncated || stdout.truncated || stderr.truncated;
      const status = outcome.timedOut ? "timed-out" : outcome.exitCode === 0 ? "completed" : "failed";
      return {
        status: status as "completed" | "failed" | "timed-out",
        exitCode: outcome.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs: outcome.durationMs,
        truncated,
        timedOut: outcome.timedOut,
      };
    });
    setInteractivePromise(handle, sanitizedPromise as Promise<import("@/lib/ai/computer/terminal/interactiveRegistry").InteractiveFinalResult>);

    // handle 已返回，进程仍 alive（未完成）
    expect(getInteractiveRecord(handle)?.status).toBe("running");
    // 短暂等待确保进程进入 ReadLine 等待（避免 race）
    await new Promise((r) => setTimeout(r, 500));
    expect(getInteractiveRecord(handle)?.status).toBe("running");

    await runtimeHandle.write("hello\n");
    const final = await getInteractiveRecord(handle)!.resultPromise;
    expect(final.exitCode).toBe(0);
    expect(final.stdout).toContain("received:hello");
    expect(final.status).toBe("completed");
  });

  it("stale handle cleanup: wait 成功后 handle 删除，已删除的 handle 再次访问 NotFound", async () => {
    const cwd = scratchCwd();
    const executionId = `term-async-clean-${Date.now()}`;
    const handle = createInteractiveHandle(executionId, "call-2", "powershell", "echo ok");
    const { promise } = runTerminalProcess({
      executionId,
      shell: "powershell",
      cwd,
      command: 'Write-Output "ok"',
      timeoutMs: 5000,
      onEvent: () => {},
    });
    const sanitizedPromise = promise.then((o) => ({
      status: "completed" as const,
      exitCode: o.exitCode,
      stdout: o.stdout,
      stderr: o.stderr,
      durationMs: o.durationMs,
      truncated: false,
      timedOut: false,
    }));
    setInteractivePromise(handle, sanitizedPromise);
    const rec = getInteractiveRecord(handle)!;
    await rec.resultPromise;
    // 模拟 wait 成功后的删除（executor 的 wait 会 delete）
    deleteInteractiveHandle(handle);
    expect(getInteractiveRecord(handle)).toBeUndefined();
    expect(activeInteractiveHandleCount()).toBe(0);
  });

  it("timeout status 优先级：timedOut=true 即使 cancelled=false 也应为 timed-out", async () => {
    const { applyTerminalEvent, createTerminalActivity } = await import("@/lib/ai/computer/terminal/activity");
    const init = { executionId: "e1", toolCallId: "c1", shell: "powershell" as const, commandPreview: "sleep" };
    const activity = createTerminalActivity(init);
    const after = applyTerminalEvent(activity, {
      type: "exit",
      executionId: "e1",
      sequence: 2,
      exitCode: null,
      timedOut: true,
      cancelled: false,
      durationMs: 1000,
    });
    expect(after?.status).toBe("timed-out");
  });

  it("final result 脱敏：fake secret + absolute path 不泄漏", async () => {
    const cwd = scratchCwd();
    const executionId = `term-async-redact-${Date.now()}`;
    const fakeSecret = "sk-fake-secret-abi1234567890";
    const { promise } = runTerminalProcess({
      executionId,
      shell: "powershell",
      cwd,
      command: `Write-Output "${fakeSecret}"\nWrite-Output "C:\\\\Users\\\\alice\\\\private\\\\file.txt"`,
      timeoutMs: 5000,
      onEvent: () => {},
    });
    const result = await promise;
    // Main 已脱敏
    expect(result.stdout).not.toContain(fakeSecret);
    expect(result.stdout).not.toContain("C:\\Users\\alice");
    expect(result.stdout).toContain("[REDACTED_SECRET]");
    expect(result.stdout).toContain("[REDACTED_PATH]");
    // executor 层同样脱敏（再经 sanitizeTerminalModelOutput）
    const sanitized = sanitizeTerminalModelOutput(result.stdout, 32000);
    expect(sanitized.text).not.toContain(fakeSecret);
    expect(sanitized.text).toContain("[REDACTED_SECRET]");
  });
});
