// @vitest-environment node
/**
 * 后台静默操作真机 smoke（只读、无 spawn、无焦点抢夺，可安全运行）。
 * Gate：CLASSFLOW_BACKGROUND_SMOKE=1（手动；沙盒杀 GUI 子进程，故绝不 spawn 新窗口）。
 *
 * 覆盖（Phase 1 + Phase 2 的只读半边）：
 * - 在现有窗口中找一个非前台、非屏外、≥300px 的遮挡窗口；
 * - UIA 后台读树（pattern 直调的前置条件）；
 * - PrintWindow 遮挡截图（JPEG 魔数 + 尺寸 + 下界）；
 * - 最小化窗口 → 优雅 null（若环境无最小化窗口则 log-skip）。
 * 写路径（Invoke/SetValue）由单测 + 既有语义路径覆盖，不碰用户窗口。
 */
import { describe, it, expect } from "vitest";
import { listNativeWindows } from "@/src/main/computer/windows";
import { inspectNativeUiTree } from "@/src/main/computer/uia";
import { captureOccludedWindowScreenshot } from "@/src/main/computer/printWindow";
import { runPowerShellJson } from "@/src/main/computer/powershell";

const GATED = process.env.CLASSFLOW_BACKGROUND_SMOKE === "1" ? describe : describe.skip;

GATED("background live smoke（只读现有窗口）", () => {
  it("遮挡窗口：UIA 后台读树 + PrintWindow 截图", async () => {
    const windows = await listNativeWindows();
    expect(windows.length).toBeGreaterThan(0);
    // Progman（桌面本身）PrintWindow 无意义，只做读树目标
    const progman = windows.find((w) => w.appName === "explorer" && w.title === "Program Manager");
    if (progman) {
      const progTree = await inspectNativeUiTree(progman.hwnd);
      expect(progTree.elements.length).toBeGreaterThan(0);
      console.log(`[B5] progman background tree elements=${progTree.elements.length}`);
    }
    // 首选遮挡应用窗口；环境没有时退化为前台窗口做机制验证
    // （PrintWindow 走离屏 DC，与 z-order 无关；像素不落盘不记录，只断言形状）
    let target = windows.find(
      (w) =>
        !w.isActive &&
        !w.isOffscreen &&
        w.bounds.width >= 300 &&
        w.bounds.height >= 300 &&
        !(w.appName === "explorer" && w.title === "Program Manager")
    );
    let occluded = true;
    if (!target) {
      target = windows.find((w) => w.isActive && w.bounds.width >= 300 && w.bounds.height >= 300);
      occluded = false;
    }
    if (!target) {
      console.log("[B5] skip: no suitable window in this environment");
      return;
    }
    console.log(`[B5] target hwnd=${target.hwnd} app=${target.appName} occluded=${occluded}`);

    const tree = await inspectNativeUiTree(target.hwnd);
    expect(tree.elements.length).toBeGreaterThan(0);

    const shot = await captureOccludedWindowScreenshot(target.hwnd);
    expect(shot).not.toBeNull();
    expect(shot!.mimeType).toBe("image/jpeg");
    expect(shot!.width).toBeGreaterThan(0);
    expect(shot!.height).toBeGreaterThan(0);
    expect(shot!.bytes).toBeGreaterThan(2000);
    const bytes = Buffer.from(shot!.dataUrl.split(",")[1], "base64");
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    console.log(`[B5] shot ${shot!.width}x${shot!.height} bytes=${shot!.bytes}`);
  }, 60000);

  it("最小化窗口 → null（优雅拒绝，不抛错）", async () => {
    const minimized = (await runPowerShellJson<{ hwnd?: unknown }>(
      `Add-Type -TypeDefinition @" using System; using System.Runtime.InteropServices; public static class M { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }"@; ` +
        `$root = [System.Windows.Automation.AutomationElement]::RootElement; ` +
        `$found = $null; foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) { try { $h = [int64]$e.Current.NativeWindowHandle; if ($h -ne 0 -and [M]::IsIconic([IntPtr]$h)) { $found = $h; break } } catch { } }; ` +
        `ConvertTo-Json @{ hwnd = $found } -Compress`
    ).catch(() => null)) as { hwnd?: number } | null;
    const hwnd = typeof minimized?.hwnd === "number" ? minimized.hwnd : 0;
    if (!hwnd) {
      console.log("[B5] skip: no minimized window in this environment");
      return;
    }
    expect(await captureOccludedWindowScreenshot(hwnd)).toBeNull();
  }, 60000);
});
