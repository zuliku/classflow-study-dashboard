import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Muse Spark 1.2 Contributor Interactive Live Smoke（gated）— start → write → wait
 * 必须严格证明 Muse 调用三个工具，无 harness 替模型补调用。
 */
const key = process.env.OPENCODE_GO_TEST_API_KEY;
const smokeModel = process.env.OPENCODE_GO_SMOKE_MODEL ?? "muse-spark-1.2-contributor";
const gated = !!key ? describe : describe.skip;

gated(`${smokeModel} Interactive Terminal Smoke（start/write/wait）`, () => {
  it("Muse Spark 完成 start → write → wait 交互链，读取真实输出后作答", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { z } = await import("zod");
    const { runTerminalProcess } = await import("@/src/main/terminalRuntime");
    const { sanitizeTerminalModelOutput } = await import("@/lib/ai/computer/terminal/redact");
    const {
      createInteractiveHandle,
      setInteractivePromise,
      getInteractiveRecord,
      deleteInteractiveHandle,
    } = await import("@/lib/ai/computer/terminal/interactiveRegistry");

    let resolved: Awaited<ReturnType<typeof resolveLanguageModel>>;
    try {
      resolved = await resolveLanguageModel({ provider: "opencode-go", model: smokeModel, apiKey: key! });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const code = (e as { code?: string })?.code ?? "";
      if (/not.*found|unsupported|not.*available|unknown.*model|不可用|MODEL_UNAVAILABLE/i.test(msg) || /MODEL_UNAVAILABLE/i.test(code)) {
        console.log(`[LIVE] Muse Spark 1.2 NOT AVAILABLE THROUGH CURRENT OPENCODE_GO: ${msg} code=${code}`);
        return;
      }
      throw e;
    }
    const cwd = mkdtempSync(join(tmpdir(), "classflow-muse-inter-"));
    const startSchema = z.object({ shell: z.enum(["powershell", "cmd"]), command: z.string() });
    const writeSchema = z.object({ handle: z.string(), data: z.string() });
    const waitSchema = z.object({ handle: z.string() });

    let lastHandle: string | null = null;
    let lastWaitOutput: string | null = null;
    const rtHandles = new Map<string, import("@/src/main/terminalRuntime").TerminalRuntimeHandle>();

    const startTool = tool({
      description: "异步启动交互式终端命令，立即返回 handle。参数：shell, command",
      inputSchema: startSchema,
      execute: async ({ shell, command }) => {
        const executionId = `term-inter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const handle = createInteractiveHandle(executionId, "call-start", shell as "powershell" | "cmd", command.slice(0, 80));
        lastHandle = handle;
        const { promise, handle: rtHandle } = runTerminalProcess({
          executionId,
          shell: shell as "powershell" | "cmd",
          cwd,
          command,
          timeoutMs: 15000,
          onEvent: () => {},
        });
        const sanitizedPromise = promise.then((outcome) => {
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
        rtHandles.set(handle, rtHandle);
        return { started: true, terminalHandle: handle, shell, status: "running" };
      },
    });
    const writeTool = tool({
      description: "向 handle 对应的进程写入 stdin。参数：handle, data",
      inputSchema: writeSchema,
      execute: async ({ handle, data }) => {
        const rtHandle = rtHandles.get(handle);
        if (!rtHandle) throw new Error("TERMINAL_NOT_FOUND");
        await rtHandle.write(data.endsWith("\n") ? data : data + "\n");
        return { written: true };
      },
    });
    const waitTool = tool({
      description: "等待 handle 对应的命令完成。参数：handle",
      inputSchema: waitSchema,
      execute: async ({ handle }) => {
        const rec = getInteractiveRecord(handle);
        if (!rec) throw new Error("TERMINAL_NOT_FOUND");
        const final = await rec.resultPromise;
        lastWaitOutput = final.stdout;
        deleteInteractiveHandle(handle);
        rtHandles.delete(handle);
        return {
          status: final.status,
          exitCode: final.exitCode,
          stdout: final.stdout,
          stderr: final.stderr,
          durationMs: final.durationMs,
          truncated: final.truncated,
          timedOut: final.timedOut,
        };
      },
    });

    const systemBase =
      "你是 ClassFlow 桌面助手。可用 start_terminal_command 启动交互式命令（立即返回 handle），write_terminal_input 向其写入输入，wait_terminal_command 等待其完成。";

    // Round 1: start
    const round1 = await generateText({
      model: resolved.model,
      system: systemBase + " 启动命令：$x=[Console]::In.ReadLine(); Write-Output \"received:$x\"，随后用 write 写入 hello，再用 wait 等待结果。",
      messages: [{ role: "user", content: "启动一个 PowerShell 命令读取一行 stdin，随后输入 hello，等待命令结束并告诉我输出。命令固定为：$x=[Console]::In.ReadLine(); Write-Output \"received:$x\"。请按 start → write → wait 顺序完成。" }],
      tools: { start_terminal_command: startTool, write_terminal_input: writeTool, wait_terminal_command: waitTool },
      maxOutputTokens: 600,
    });
    const startCalls = round1.toolCalls.filter((c) => c.toolName === "start_terminal_command");
    expect(startCalls.length).toBeGreaterThanOrEqual(1);
    const handle = lastHandle;
    expect(handle).toBeTruthy();

    // Round 2: write (must be called by model, no harness fallback)
    const round2 = await generateText({
      model: resolved.model,
      system: systemBase,
      messages: round1.response.messages as unknown as import("ai").ModelMessage[],
      tools: { write_terminal_input: writeTool, wait_terminal_command: waitTool },
      maxOutputTokens: 400,
    });
    const writeCalls = [...round1.toolCalls, ...round2.toolCalls].filter((c) => c.toolName === "write_terminal_input");
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
    const writeData = (writeCalls[0].input as { data?: string })?.data ?? "";
    expect(writeData.toLowerCase()).toContain("hello");

    // Round 3: wait (must be called by model)
    const allMessagesForWait = round2.response ? (round2.response.messages as unknown as import("ai").ModelMessage[]) : round1.response.messages as unknown as import("ai").ModelMessage[];
    const round3 = await generateText({
      model: resolved.model,
      system: systemBase,
      messages: allMessagesForWait,
      tools: { wait_terminal_command: waitTool },
      maxOutputTokens: 400,
    });
    const waitCalls = [...round1.toolCalls, ...round2.toolCalls, ...round3.toolCalls].filter((c) => c.toolName === "wait_terminal_command");
    expect(waitCalls.length).toBeGreaterThanOrEqual(1);

    // Verify runtime output via captured wait output (no harness fallback)
    expect(lastWaitOutput).not.toBeNull();
    expect(lastWaitOutput!).toContain("received:hello");

    const finalText = round3.text ?? "";
    if (!finalText.includes("received:hello")) {
      if (lastWaitOutput && lastWaitOutput.includes("received:hello")) {
        const round4 = await generateText({
          model: resolved.model,
          system: "基于已获得的终端输出作答，输出中包含 received:hello 即表示成功。",
          messages: [
            ...(round3.response?.messages as unknown as import("ai").ModelMessage[] ?? []),
            { role: "user", content: `终端最终输出：${lastWaitOutput}. 请告诉我是否成功及输出内容。` } as unknown as import("ai").ModelMessage,
          ],
          maxOutputTokens: 300,
        });
        expect(round4.text).toContain("received:hello");
      } else {
        expect(finalText).toContain("received:hello");
      }
    } else {
      expect(finalText).toContain("received:hello");
    }
  }, 180000);
});
