/**
 * Computer Use Phase 1 — Windows 顶层窗口枚举（只读）。
 *
 * 实现策略（基础 adapter，可后续替换为原生 UI Automation 模块）：
 * - 通过 UI Automation RootElement 枚举顶层窗口（title/bounds/pid/hwnd 仅 runtime 内部使用）
 * - 通过 user32 GetForegroundWindow 判定当前活动窗口
 * - 对 renderer / model 只暴露 opaque windowId + title + appName
 *
 * 安全：hwnd / pid 永远不离开本模块与 observation registry 的内存映射。
 */
import { randomUUID } from "node:crypto";
import { runPowerShellJson } from "./powershell";

export interface NativeWindowRecord {
  /** runtime-only：绝不外传 */
  hwnd: number;
  /** runtime-only：绝不外传 */
  pid: number;
  title: string;
  appName: string;
  bounds: { x: number; y: number; width: number; height: number };
  isActive: boolean;
  isOffscreen: boolean;
  /** UIA 枚举顺序（近似 z-order，顶部在前） */
  zIndex: number;
}

export const MAX_DESKTOP_WINDOWS = 100;
export const MAX_WINDOW_TITLE_LENGTH = 200;
export const DESKTOP_WINDOW_ID_TTL_MS = 300_000;
export const DESKTOP_WINDOW_ID_PATTERN = /^win-[A-Za-z0-9]{4,32}$/;

const WINDOW_ENUMERATION_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClassFlowForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$foreground = [int64][ClassFlowForegroundWindow]::GetForegroundWindow()
$items = New-Object System.Collections.ArrayList
$procCache = @{}
$children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$index = 0
foreach ($element in $children) {
  try {
    $c = $element.Current
    $name = $c.Name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $rect = $c.BoundingRectangle
    $width = [int][Math]::Round($rect.Width)
    $height = [int][Math]::Round($rect.Height)
    if ($width -le 0 -or $height -le 0) { continue }
    $hwnd = [int64]$c.NativeWindowHandle
    $pidValue = [int]$c.ProcessId
    $procName = ""
    if ($procCache.ContainsKey($pidValue)) { $procName = $procCache[$pidValue] }
    else {
      try { $procName = [string](Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch { $procName = "" }
      $procCache[$pidValue] = $procName
    }
    [void]$items.Add([pscustomobject]@{
      hwnd = $hwnd
      pid = $pidValue
      title = [string]$name
      appName = $procName
      x = [int][Math]::Round($rect.X)
      y = [int][Math]::Round($rect.Y)
      width = $width
      height = $height
      isActive = ($hwnd -eq $foreground -and $hwnd -ne 0)
      isOffscreen = [bool]$c.IsOffscreen
      zIndex = $index
    })
    $index = $index + 1
    if ($index -ge 100) { break }
  } catch { }
}
ConvertTo-Json -InputObject @{ foreground = $foreground; windows = @($items) } -Compress -Depth 4
`;

interface RawWindowEntry {
  hwnd?: unknown;
  pid?: unknown;
  title?: unknown;
  appName?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  isActive?: unknown;
  isOffscreen?: unknown;
  zIndex?: unknown;
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/** 去除控制字符并按长度截断（模型/renderer 可见） */
export function sanitizeWindowTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, MAX_WINDOW_TITLE_LENGTH);
}

/** appName 只允许进程 basename 风格字符（防御性；ProcessName 通常已安全） */
export function sanitizeAppName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return cleaned;
}

/**
 * 纯解析：PowerShell 枚举结果 → runtime 内部记录（可测试）。
 * 过滤：标题为空 / 越界尺寸 / 损坏条目；最多 MAX_DESKTOP_WINDOWS 条。
 */
export function parseWindowEnumeration(raw: unknown): NativeWindowRecord[] {
  const container = raw && typeof raw === "object" ? (raw as { windows?: unknown }) : null;
  const list = Array.isArray(container?.windows) ? (container.windows as RawWindowEntry[]) : [];
  const out: NativeWindowRecord[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const title = sanitizeWindowTitle(entry.title);
    if (!title) continue;
    const width = toInt(entry.width);
    const height = toInt(entry.height);
    if (width <= 0 || height <= 0) continue;
    out.push({
      hwnd: toInt(entry.hwnd),
      pid: toInt(entry.pid),
      title,
      appName: sanitizeAppName(entry.appName),
      bounds: { x: toInt(entry.x), y: toInt(entry.y), width, height },
      isActive: entry.isActive === true,
      isOffscreen: entry.isOffscreen === true,
      zIndex: toInt(entry.zIndex, out.length),
    });
    if (out.length >= MAX_DESKTOP_WINDOWS) break;
  }
  return out;
}

/** 枚举当前可见顶层窗口（runtime 内部记录，含 hwnd/pid） */
export async function listNativeWindows(): Promise<NativeWindowRecord[]> {
  const raw = await runPowerShellJson<unknown>(WINDOW_ENUMERATION_SCRIPT);
  return parseWindowEnumeration(raw);
}

/** 当前活动窗口（无 → null）；基于同一次枚举的 isActive 标记 */
export async function getActiveNativeWindow(): Promise<NativeWindowRecord | null> {
  const windows = await listNativeWindows();
  return windows.find((w) => w.isActive) ?? null;
}

/**
 * opaque windowId ↔ native window 映射（runtime memory only；绝不外传 hwnd/pid）。
 * windowId 在同一 desktop session 内稳定；窗口消失超过 TTL 后清理。
 */
export class DesktopWindowRegistry {
  private byHwnd = new Map<number, { opaqueId: string; record: NativeWindowRecord; lastSeenAt: number }>();
  private byOpaqueId = new Map<string, number>();

  /** 用最新一次枚举同步映射（新增分配 opaque id；更新已知窗口） */
  sync(records: NativeWindowRecord[], now: number = Date.now()): void {
    const seen = new Set<number>();
    for (const record of records) {
      seen.add(record.hwnd);
      const existing = this.byHwnd.get(record.hwnd);
      if (existing) {
        existing.record = record;
        existing.lastSeenAt = now;
      } else {
        const opaqueId = `win-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
        this.byHwnd.set(record.hwnd, { opaqueId, record, lastSeenAt: now });
        this.byOpaqueId.set(opaqueId, record.hwnd);
      }
    }
    for (const [hwnd, entry] of this.byHwnd) {
      if (seen.has(hwnd)) continue;
      if (now - entry.lastSeenAt <= DESKTOP_WINDOW_ID_TTL_MS) continue;
      this.byHwnd.delete(hwnd);
      this.byOpaqueId.delete(entry.opaqueId);
    }
  }

  /** opaque id → runtime record（过期 / 未知 → null） */
  resolve(windowId: string, now: number = Date.now()): NativeWindowRecord | null {
    const hwnd = this.byOpaqueId.get(windowId);
    if (hwnd === undefined) return null;
    const entry = this.byHwnd.get(hwnd);
    if (!entry) return null;
    if (now - entry.lastSeenAt > DESKTOP_WINDOW_ID_TTL_MS) {
      this.byHwnd.delete(hwnd);
      this.byOpaqueId.delete(windowId);
      return null;
    }
    return entry.record;
  }

  /** runtime record → opaque id（未登记 → null） */
  opaqueIdFor(hwnd: number): string | null {
    return this.byHwnd.get(hwnd)?.opaqueId ?? null;
  }

  size(): number {
    return this.byHwnd.size;
  }

  clear(): void {
    this.byHwnd.clear();
    this.byOpaqueId.clear();
  }
}
