import { describe, it, expect } from "vitest";
import {
  buildPrintWindowScript,
  parsePrintWindowResult,
  captureOccludedWindowScreenshot,
  PRINT_WINDOW_MAX_WIDTH,
  PRINT_WINDOW_MAX_JPEG_BYTES,
} from "@/src/main/computer/printWindow";

const jpeg = "x".repeat(20000);

describe("PrintWindow 脚本构建", () => {
  it("hwnd/上限注入；含 PrintWindow/IsIconic/JPEG 语义；无 node-gyp", () => {
    const script = buildPrintWindowScript(123456, 1280);
    expect(script).toContain("PrintWindow");
    expect(script).toContain("IsIconic");
    expect(script).toContain("window-minimized");
    expect(script).toContain("[IntPtr][int64]123456");
    expect(script).toContain("image/jpeg");
    // Windows PowerShell 5.1：Imaging 命名空间必须显式引用程序集，否则编译失败
    expect(script).toContain("-ReferencedAssemblies System.Drawing");
    expect(script).not.toContain("__HWND__");
    expect(script).not.toContain("__MAXWIDTH__");
    expect(script).not.toContain("__MAXBYTES__");
  });
  it("非法 hwnd 抛错；宽度收敛到 [320, 3840]", () => {
    expect(() => buildPrintWindowScript(1.5)).toThrow();
    expect(buildPrintWindowScript(9, 100)).toContain("[int]320");
    expect(buildPrintWindowScript(9, 99999)).toContain("[int]3840");
    expect(buildPrintWindowScript(9, 1280)).toContain("[int]1280");
    expect(PRINT_WINDOW_MAX_WIDTH).toBe(1280);
    expect(PRINT_WINDOW_MAX_JPEG_BYTES).toBe(1_200_000);
  });
});

describe("parsePrintWindowResult（fail closed）", () => {
  it("合法 → dataUrl + 尺寸；缺 printOk/坏尺寸/坏字节一律 null", () => {
    expect(
      parsePrintWindowResult({ ok: true, printOk: true, width: 800, height: 600, bytes: 50000, jpeg })
    ).toEqual({
      dataUrl: `data:image/jpeg;base64,${jpeg}`,
      width: 800,
      height: 600,
      bytes: 50000,
    });
    expect(parsePrintWindowResult({ ok: true, width: 800, height: 600, bytes: 50000, jpeg })).toBeNull();
    expect(parsePrintWindowResult({ ok: true, printOk: false, width: 800, height: 600, bytes: 50000, jpeg })).toBeNull();
    expect(parsePrintWindowResult({ ok: true, printOk: true, width: 0, height: 600, bytes: 50000, jpeg })).toBeNull();
    expect(parsePrintWindowResult({ ok: true, printOk: true, width: 800, height: 600, bytes: 0, jpeg })).toBeNull();
    expect(parsePrintWindowResult({ ok: true, printOk: true, width: 8000, height: 600, bytes: 50000, jpeg })).toBeNull();
    expect(parsePrintWindowResult({ ok: true, printOk: true, width: 800, height: 600, bytes: 50000, jpeg: "x" })).toBeNull();
    expect(parsePrintWindowResult({ ok: false, reason: "window-minimized" })).toBeNull();
    expect(parsePrintWindowResult(null)).toBeNull();
    expect(parsePrintWindowResult("nope")).toBeNull();
  });
});

describe("captureOccludedWindowScreenshot（runner 可注入）", () => {
  it("成功 → NativeScreenshot 同构；失败/非法 hwnd → null", async () => {
    const good = { ok: true, printOk: true, width: 800, height: 600, bytes: 50000, jpeg };
    const shot = await captureOccludedWindowScreenshot(123, async () => good);
    expect(shot?.mimeType).toBe("image/jpeg");
    expect(shot?.width).toBe(800);
    expect(shot?.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(typeof shot?.capturedAt).toBe("string");
    expect(await captureOccludedWindowScreenshot(123, async () => ({ ok: false, reason: "minimized" }))).toBeNull();
    expect(await captureOccludedWindowScreenshot(123, async () => {
      throw new Error("boom");
    })).toBeNull();
    expect(await captureOccludedWindowScreenshot(0, async () => good)).toBeNull();
    expect(await captureOccludedWindowScreenshot(-5, async () => good)).toBeNull();
  });
});
