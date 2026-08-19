import { DesktopTerminalEvent, DesktopTerminalSessionEvent } from "@/lib/desktop/types";

/** 轮询 buffer 直到 predicate 满足或超时（避免固定 sleep 导致的 flaky/浪费） */
export async function waitForSessionOutput(
  buffer: DesktopTerminalSessionEvent[],
  predicate: (text: string) => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = buffer
      .filter((e) => e.type === "data")
      .map((e) => (e.type === "data" ? e.data : ""))
      .join("");
    if (predicate(text)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const text = buffer
    .filter((e) => e.type === "data")
    .map((e) => (e.type === "data" ? e.data : ""))
    .join("");
  throw new Error(`waitForSessionOutput timeout after ${timeoutMs}ms, last text: ${JSON.stringify(text.slice(0, 200))}`);
}

export async function waitForTerminalOutput(
  buffer: DesktopTerminalEvent[],
  predicate: (text: string) => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = buffer
      .filter((e) => e.type === "stdout" || e.type === "stderr")
      .map((e) => (e.type === "stdout" || e.type === "stderr" ? e.text : ""))
      .join("");
    if (predicate(text)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const text = buffer
    .filter((e) => e.type === "stdout" || e.type === "stderr")
    .map((e) => (e.type === "stdout" || e.type === "stderr" ? e.text : ""))
    .join("");
  throw new Error(`waitForTerminalOutput timeout after ${timeoutMs}ms, last text: ${JSON.stringify(text.slice(0, 200))}`);
}

export async function waitForSessionEvent(
  buffer: DesktopTerminalSessionEvent[],
  predicate: (events: DesktopTerminalSessionEvent[]) => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(buffer)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForSessionEvent timeout after ${timeoutMs}ms, events: ${JSON.stringify(buffer.slice(-3))}`);
}
