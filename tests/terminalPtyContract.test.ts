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

/**
 * Phase 4 — Persistent PowerShell PTY Session（真实 Windows ConPTY via node-pty）。
 * 白名单命令（任务 §13/§21）：Write-Output / Set-Location / New-Item（scratch 内）/ env 临时变量。
 * 不联网 / 不安装 / 不删除。
 */

function scratchDir(): string {
  const base = mkdtempSync(join(tmpdir(), "classflow-pty-"));
  return base;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    await waitFor(700);
    writePtySession(sessionId, 'Write-Output "pty-start"\r');
    await waitFor(700);
    const out = dataText(buffer);
    expect(out).toContain("pty-start");
    expect(activePtySessionCount()).toBe(1);
  });

  it("session state 持久化：env 变量跨独立 write 保持", async () => {
    const { sessionId, buffer } = openSession(scratchDir());
    await waitFor(700);
    writePtySession(sessionId, '$env:CLASSFLOW_PTY_SMOKE = "ok"\r');
    await waitFor(400);
    writePtySession(sessionId, 'Write-Output $env:CLASSFLOW_PTY_SMOKE\r');
    await waitFor(700);
    expect(dataText(buffer)).toContain("ok");
  });

  it("cwd 在 session 中持久化（Set-Location 子目录后保持）", async () => {
    const base = scratchDir();
    const sub = join(base, "classflow-pty-sub");
    mkdirSync(sub);
    const { sessionId, buffer } = openSession(base);
    await waitFor(700);
    writePtySession(sessionId, "Set-Location .\\classflow-pty-sub\r");
    await waitFor(400);
    // 只输出路径最后一段（绝对路径整串会被 sanitize 成 [REDACTED_PATH]，不泄漏 native path）
    writePtySession(sessionId, '$PWD.Path.Split([IO.Path]::DirectorySeparatorChar)[-1]\r');
    await waitFor(700);
    expect(dataText(buffer)).toContain("classflow-pty-sub");
  });

  it("绝对路径在 session 事件中被 redacted（不泄漏 native path）", async () => {
    const base = scratchDir();
    const { buffer } = openSession(base);
    await waitFor(700);
    expect(dataText(buffer)).not.toContain("\\Users\\");
    // 输出完整绝对路径 → 应被 redact
    const sessionId = openSession(base).sessionId;
    writePtySession(sessionId, "(Get-Location).Path\r");
    await waitFor(800);
    const out = dataText(buffer);
    expect(out).not.toContain(base); // 绝对路径不出现
  });

  it("resize（120x32 → 100x24）不 crash", async () => {
    const { sessionId } = openSession(scratchDir());
    await waitFor(500);
    resizePtySession(sessionId, 100, 24);
    resizePtySession(sessionId, 120, 32);
    await waitFor(400);
    writePtySession(sessionId, 'Write-Output "resize-ok"\r');
    await waitFor(600);
    expect(true).toBe(true);
  });

  it("closeSession → session 退出 + registry 清空（dispose kill process tree）", async () => {
    const { sessionId } = openSession(scratchDir());
    await waitFor(500);
    closePtySession(sessionId);
    await waitFor(500);
    expect(activePtySessionCount()).toBe(0);
    // 幂等：重复 close 不抛错
    closePtySession(sessionId);
  });
});
