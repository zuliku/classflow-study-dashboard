// @vitest-environment node
import { describe, it, expect } from "vitest";
import { UiaWorker } from "@/src/main/computer/uiaWorker";
import { listNativeWindows, parseWindowEnumeration } from "@/src/main/computer/windows";
import { inspectNativeUiTree, parseUiTree, parseUiElement } from "@/src/main/computer/uia";
import { runNativeGuiAction, parseGuiActionResult } from "@/src/main/computer/guiAction";

/**
 * V2.2 常驻 UIA Worker — 真实 Windows smoke（gated）。
 * 默认跳过；本地验证运行：CLASSFLOW_UIA_WORKER_SMOKE=1 npx vitest run tests/uiaWorkerWindowsSmoke.test.ts
 *
 * 验证：worker 全链路（windows/inspect/resolve/act）可用，且 warm 调用明显快于一次性脚本。
 * 不做硬性倍数断言（CI 负载会抖动），只断言 warm < one-shot（实测 4–70x 差距）。
 */
const gated = process.env.CLASSFLOW_UIA_WORKER_SMOKE === "1" ? describe : describe.skip;

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = Date.now();
  const value = await fn();
  return { ms: Date.now() - start, value };
}

gated("V2.2 UIA Worker（真实 Windows）", () => {
  it("worker 全链路可用且 warm 快于一次性脚本", async () => {
    const worker = new UiaWorker({ enableIdleTimer: false });
    try {
      const ping = await time(() => worker.request("ping"));
      expect(ping.value).toMatchObject({ pong: true });

      const windowsW = await time(() => worker.request<unknown>("windows"));
      const windows = parseWindowEnumeration(windowsW.value);
      expect(windows.length).toBeGreaterThan(0);
      const active = windows.find((w) => w.isActive) ?? windows[0];

      const inspectW = await time(() => worker.request<unknown>("inspect", { hwnd: active.hwnd }));
      const tree = parseUiTree(inspectW.value);
      expect(tree.elements.length).toBeGreaterThan(0);

      const target =
        tree.elements.find((e) => e.role === "Button" && e.nativeRef) ?? tree.elements[1] ?? tree.elements[0];
      const resolveW = await time(() =>
        worker.request<unknown>("resolve", { hwnd: active.hwnd, nativeRef: target.nativeRef })
      );
      const element = parseUiElement((resolveW.value as { element?: unknown }).element);
      expect(element).toBeTruthy();

      const focusW = await time(() =>
        worker.request<unknown>("act", { hwnd: active.hwnd, nativeRef: target.nativeRef, action: "focus" })
      );
      expect(parseGuiActionResult(focusW.value).ok).toBe(true);

      const oneShotWindows = await time(() => listNativeWindows());
      const oneShotInspect = await time(() => inspectNativeUiTree(active.hwnd));
      const oneShotFocus = await time(() =>
        runNativeGuiAction({ hwnd: active.hwnd, nativeRef: target.nativeRef, action: "focus" })
      );

      console.log(
        `[V2.2 smoke] worker: start=${ping.ms}ms windows=${windowsW.ms}ms inspect=${inspectW.ms}ms resolve=${resolveW.ms}ms act=${focusW.ms}ms`
      );
      console.log(
        `[V2.2 smoke] one-shot: windows=${oneShotWindows.ms}ms inspect=${oneShotInspect.ms}ms act=${oneShotFocus.ms}ms`
      );

      expect(inspectW.ms).toBeLessThan(oneShotInspect.ms);
      expect(focusW.ms).toBeLessThan(oneShotFocus.ms);
    } finally {
      worker.dispose();
    }
  }, 120000);
});
