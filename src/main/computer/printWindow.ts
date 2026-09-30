/**
 * Computer Use Phase 2（后台静默操作）— hwnd 精确遮挡截图（PrintWindow）。
 *
 * 为什么不用 desktopCapturer：它按窗口标题匹配 source，遮挡窗口匹配失败会
 * 降级拍主屏（错误像素）；且无法表达“精确就是这个 hwnd”。
 * PrintWindow 要求 DWM 为该 hwnd 保留 surface：被遮挡 OK，最小化不行
 * （IsIconic 先行 fail closed；最小化窗口不渲染，任何截图都是错的）。
 *
 * 实现约束（与 guiAction.ts 同架构）：
 * - PowerShell + Add-Type C# P/Invoke，不引入 node-gyp / 原生模块；
 * - 只在内存生成 bounded JPEG（dataUrl），绝不写盘；
 * - 输出经 runPowerShellJson（1MB 上限、超时杀树、不回传 raw OS error）；
 * - 返回契约与 screenshot.ts NativeScreenshot 同构（调用方无缝替换）。
 */
import { runPowerShellJson } from "./powershell";

/** 与 screenshot.ts 同值（独立声明：本模块必须能在无 electron 的测试环境导入） */
export const PRINT_WINDOW_MAX_WIDTH = 1280;
export const PRINT_WINDOW_MAX_JPEG_BYTES = 1_200_000;

export interface PrintWindowScreenshot {
  mimeType: "image/jpeg";
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
}

const SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class ClassFlowPrintWindow {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, int nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out PWRECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  public struct PWRECT { public int Left, Top, Right, Bottom; }
}
"@
$hwnd = [IntPtr][int64]__HWND__
$maxWidth = [int]__MAXWIDTH__
if ([ClassFlowPrintWindow]::IsIconic($hwnd)) {
  ConvertTo-Json @{ ok = $false; reason = 'window-minimized' } -Compress
  exit 0
}
$rc = New-Object ClassFlowPrintWindow+PWRECT
if (-not [ClassFlowPrintWindow]::GetWindowRect($hwnd, [ref]$rc)) {
  ConvertTo-Json @{ ok = $false; reason = 'bad-rect' } -Compress
  exit 0
}
$w = $rc.Right - $rc.Left
$h = $rc.Bottom - $rc.Top
if ($w -le 0 -or $h -le 0 -or $w -gt 3840 -or $h -gt 2160) {
  ConvertTo-Json @{ ok = $false; reason = 'bad-rect' } -Compress
  exit 0
}
$bmp = New-Object Drawing.Bitmap($w, $h)
$g = [Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$printed = $false
try {
  $printed = [ClassFlowPrintWindow]::PrintWindow($hwnd, $hdc, 0)
} finally {
  $g.ReleaseHdc($hdc)
}
if (-not $printed) {
  $g.Dispose(); $bmp.Dispose()
  ConvertTo-Json @{ ok = $false; reason = 'print-failed' } -Compress
  exit 0
}
$tw = [Math]::Min($w, $maxWidth)
$th = [Math]::Max(1, [int]($h * $tw / $w))
$small = New-Object Drawing.Bitmap($bmp, $tw, $th)
$ms = New-Object IO.MemoryStream
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, 70)
$small.Save($ms, $codec, $params)
$raw = $ms.ToArray()
$g.Dispose(); $bmp.Dispose(); $small.Dispose(); $ms.Dispose()
if ($raw.Length -eq 0 -or $raw.Length -gt __MAXBYTES__) {
  ConvertTo-Json @{ ok = $false; reason = 'bad-bytes' } -Compress
  exit 0
}
$b64 = [Convert]::ToBase64String($raw)
ConvertTo-Json @{ ok = $true; printOk = $true; width = $tw; height = $th; bytes = $raw.Length; jpeg = $b64 } -Compress
`;

export function buildPrintWindowScript(hwnd: number, maxWidth: number = PRINT_WINDOW_MAX_WIDTH): string {
  if (!Number.isInteger(hwnd)) throw new Error("hwnd 必须是整数");
  const width = Math.min(Math.max(Math.floor(maxWidth), 320), 3840);
  return SCRIPT.replace("__HWND__", String(hwnd)).replace("__MAXWIDTH__", String(width)).replace(
    "__MAXBYTES__",
    String(PRINT_WINDOW_MAX_JPEG_BYTES)
  );
}

export type PrintWindowRawResult =
  | { ok: true; printOk?: unknown; width?: unknown; height?: unknown; bytes?: unknown; jpeg?: unknown }
  | { ok: false; reason?: unknown }
  | null
  | undefined;

/** 纯解析（fail closed）：printOk 必须真、尺寸/字节有界、jpeg 非空 base64ish */
export function parsePrintWindowResult(raw: unknown): Omit<PrintWindowScreenshot, "capturedAt" | "mimeType"> | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.ok !== true || v.printOk !== true) return null;
  const width = v.width;
  const height = v.height;
  const bytes = v.bytes;
  const jpeg = v.jpeg;
  if (typeof width !== "number" || !Number.isInteger(width) || width <= 0 || width > 3840) return null;
  if (typeof height !== "number" || !Number.isInteger(height) || height <= 0 || height > 2160) return null;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0 || bytes > PRINT_WINDOW_MAX_JPEG_BYTES) {
    return null;
  }
  if (typeof jpeg !== "string" || jpeg.length < 100 || jpeg.length > PRINT_WINDOW_MAX_JPEG_BYTES * 2) return null;
  return { dataUrl: `data:image/jpeg;base64,${jpeg}`, width, height, bytes };
}

/**
 * 遮挡窗口 hwnd 精确截图；任何失败 → null（调用方走既有 screenshot-unavailable 降级）。
 * runner 可注入（测试用；默认走 runPowerShellJson，与 guiAction 同安全 envelope）。
 */
export async function captureOccludedWindowScreenshot(
  hwnd: number,
  runner: (script: string, timeoutMs?: number) => Promise<unknown> = (s, t) => runPowerShellJson(s, t)
): Promise<PrintWindowScreenshot | null> {
  if (!Number.isInteger(hwnd) || hwnd <= 0) return null;
  let raw: unknown;
  try {
    raw = await runner(buildPrintWindowScript(hwnd), 15000);
  } catch {
    return null;
  }
  const parsed = parsePrintWindowResult(raw);
  if (!parsed) return null;
  return {
    mimeType: "image/jpeg",
    ...parsed,
    capturedAt: new Date().toISOString(),
  };
}
