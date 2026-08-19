import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPtySession,
  writePtySession,
  resizePtySession,
  closePtySession,
  closeAllPtySessions,
  activePtySessionCount,
} from "@/src/main/terminalSessionRuntime";
import { DesktopTerminalSessionEvent } from "@/lib/desktop/types";
import { waitForSessionOutput, waitForSessionEvent } from "./helpers/terminalHarness";

/**
 * Phase 4 — Persistent PowerShell PTY Session（真实 Windows ConPTY via node-pty）。
 * 白名单命令（任务 §13/§21）：Write-Output / Set-Location / New-Item（scratch 内）/ env 临时变量。
 * 不联网 / 不安装 / 不删除。
 */

function scratchDir(): string {
  const base = mkdtempSync(join(tmpdir(), "classflow-pty-"));
  return base;
}

/** 创建 session + 事件收集 helper；返回 { sessionId, collect } */
function openSession(cwd: string) {
  const buffer: DesktopTerminalSessionEvent[] = [];
  const sessionId = createPtySession({
    shell: "powershell",
    cwd,
    cols: 120,
    rows: 32,
    onEvent: (e) => buffer.push(e),
  });
  return { sessionId, buffer };
}

function dataText(buffer: DesktopTerminalSessionEvent[]): string {
  return buffer.filter((e) => e.type === "data").map((e) => (e.type === "data" ? e.data : "")).join("");
}

afterEach(() => {
  closeAllPtySessions();
});

describe("Phase 4 — PTY session（真实 ConPTY）", () => {
  it("create → write → 输出回显（pty-start）", async () => {
    const { sessionId, buffer } = openSession(scratchDir());
    writePtySession(sessionId, 'Write-Output "pty-start"\r');
    await waitForSessionOutput(buffer, (t) => t.includes("pty-start"), 5000);
    expect(dataText(buffer)).toContain("pty-start");
    expect(activePtySessionCount()).toBe(1);
  });

  it("session state 持久化：env 变量跨独立 write 保持", async () => {
    const { sessionId, buffer } = openSession(scratchDir());
    writePtySession(sessionId, '$env:CLASSFLOW_PTY_SMOKE = "ok"\r');
    await waitForSessionOutput(buffer, (t) => t.includes("ok") || t.includes("CLASSFLOW_PTY_SMOKE"), 3000).catch(() => {});
    // 清空 buffer 避免前一个包含 ok 的误判，重新等待
    buffer.length = 0;
    writePtySession(sessionId, 'Write-Output $env:CLASSFLOW_PTY_SMOKE\r');
    await waitForSessionOutput(buffer, (t) => t.includes("ok"), 5000);
    expect(dataText(buffer)).toContain("ok");
  });

  it("cwd 在 session 中持久化（Set-Location 子目录后保持）", async () => {
    const base = scratchDir();
    const sub = join(base, "classflow-pty-sub");
    mkdirSync(sub);
    const { sessionId, buffer } = openSession(base);
    writePtySession(sessionId, "Set-Location .\\classflow-pty-sub\r");
    await new Promise((r) => setTimeout(r, 400));
    buffer.length = 0;
    // 只输出路径最后一段（绝对路径整串会被 sanitize 成 [REDACTED_PATH]，不泄漏 native path）
    writePtySession(sessionId, '$PWD.Path.Split([IO.Path]::DirectorySeparatorChar)[-1]\r');
    await waitForSessionOutput(buffer, (t) => t.includes("classflow-pty-sub"), 5000);
    expect(dataText(buffer)).toContain("classflow-pty-sub");
  });

  it("绝对路径在 session 事件中被 redacted（不泄漏 native path）", async () => {
    const base = scratchDir();
    const { sessionId, buffer } = openSession(base);
    await new Promise((r) => setTimeout(r, 300));
    expect(dataText(buffer)).not.toContain("\\Users\\");
    // 输出完整绝对路径 → 应被 redact（同一 session/buffer）
    writePtySession(sessionId, "(Get-Location).Path\r");
    await waitForSessionOutput(buffer, (t) => t.includes("[REDACTED_PATH]"), 5000);
    expect(dataText(buffer)).toContain("[REDACTED_PATH]");
    expect(dataText(buffer)).not.toContain(base); // 绝对路径不出现
  });

  it("resize（120x32 → 100x24）不 crash 且后续命令仍有输出", async () => {
    const { sessionId, buffer } = openSession(scratchDir());
    resizePtySession(sessionId, 100, 24);
    resizePtySession(sessionId, 120, 32);
    writePtySession(sessionId, 'Write-Output "resize-ok"\r');
    await waitForSessionOutput(buffer, (t) => t.includes("resize-ok"), 5000);
    expect(dataText(buffer)).toContain("resize-ok");
  });

  it("closeSession → session 退出 + registry 清空（dispose kill process tree）", async () => {
    const { sessionId, buffer } = openSession(scratchDir());
    await new Promise((r) => setTimeout(r, 300));
    const exitBefore = buffer.filter((e) => e.type === "exit").length;
    closePtySession(sessionId);
    await waitForSessionEvent(buffer, (events) => events.filter((e) => e.type === "exit").length > exitBefore, 5000).catch(() => {});
    // exit 事件或 registry 清空任一可观测
    const hasExit = buffer.filter((e) => e.type === "exit").length > exitBefore;
    const isCleared = activePtySessionCount() === 0;
    expect(hasExit || isCleared).toBe(true);
    expect(activePtySessionCount()).toBe(0);
    // 幂等：重复 close 不抛错
    closePtySession(sessionId);
    // write after close → INVALID_OPERATION
    expect(() => writePtySession(sessionId, "Write-Output \"late\"\r")).toThrow();
  });
});
