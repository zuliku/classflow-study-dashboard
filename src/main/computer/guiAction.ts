/**
 * Computer Use Phase 2 — Desktop GUI Action 执行器（Windows / Electron Main）。
 *
 * 单次 PowerShell 原子步骤：窗口前台确认 → 元素重新解析（按 RuntimeId）→
 * bounds 变化校验 → UIA 语义动作优先 → bounds 点击 → 归一化坐标 fallback。
 *
 * 输入优先级（契约）：
 *   UIA semantic action（Invoke / Select / SetValue）
 *   → UIA bounds click
 *   → normalized coordinate fallback
 *
 * 安全：
 * - 全部输入由本模块（Main / native runtime）执行；renderer 无 unrestricted input API
 * - 绝不实现 drag&drop / clipboard / 文件上传协议 / 支付 / 密码自动输入
 * - 敏感 / blocked 动作在 renderer 与 runtime 双重拦截，不会到达本脚本
 * - 结果只回结构化 { ok, method, reason }；绝不回传 raw OS error
 */
import { runPowerShellJson } from "./powershell";

export type NativeGuiActionType = "click" | "double_click" | "focus" | "type" | "key" | "scroll";

export interface NativeGuiActionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeGuiActionConfig {
  /** runtime-only：目标窗口 HWND */
  hwnd: number;
  /** runtime-only：目标元素 UIA RuntimeId（coordinates-only 动作为 null） */
  nativeRef: string | null;
  /** 观察时记录的 bounds（stale 校验基准） */
  expectedBounds?: NativeGuiActionBounds;
  action: NativeGuiActionType;
  /** type：待输入文本（敏感内容不得到达此处） */
  text?: string;
  /** key：虚拟键序列（已由 keymap allowlist 过滤） */
  vk?: number[];
  /** scroll：正数向上、负数向下（每单位 120 wheel delta） */
  scroll?: number;
  /** 归一化坐标 → 绝对像素（仅在无 UIA 元素 / 元素 bounds 点击时使用） */
  point?: { x: number; y: number };
}

export interface NativeGuiActionResult {
  ok: boolean;
  method?: string;
  reason?: string;
}

export const GUI_ACTION_SETTLE_MS = 350;
export const GUI_ACTION_BOUNDS_POSITION_TOLERANCE = 24;
export const GUI_ACTION_BOUNDS_SIZE_TOLERANCE = 32;

const SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct CF_MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct CF_KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct CF_INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public CF_MOUSEINPUT mi; [FieldOffset(8)] public CF_KEYBDINPUT ki; }
public class CFInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, CF_INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
[void][CFInput]::SetProcessDPIAware()
$cfg = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__CONFIG_B64__')) | ConvertFrom-Json
function Emit([hashtable]$result) { ConvertTo-Json -InputObject $result -Compress }
function New-KeyInput([int]$vk, [int]$scan, [uint32]$flags) {
  $input = New-Object CF_INPUT
  $input.type = 1
  $input.ki.wVk = [uint16]$vk
  $input.ki.wScan = [uint16]$scan
  $input.ki.dwFlags = $flags
  $input.ki.time = 0
  $input.ki.dwExtraInfo = [IntPtr]::Zero
  return $input
}
function Send-KeyCombo($vks) {
  if ($null -eq $vks -or @($vks).Count -eq 0) { return }
  $list = New-Object System.Collections.Generic.List[CF_INPUT]
  foreach ($vk in @($vks)) { [void]$list.Add((New-KeyInput ([int]$vk) 0 0)) }
  for ($i = @($vks).Count - 1; $i -ge 0; $i--) { [void]$list.Add((New-KeyInput ([int]$vks[$i]) 0 2)) }
  [void][CFInput]::SendInput([uint32]$list.Count, $list.ToArray(), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
}
function Send-UnicodeText([string]$text) {
  $list = New-Object System.Collections.Generic.List[CF_INPUT]
  foreach ($ch in $text.ToCharArray()) {
    [void]$list.Add((New-KeyInput 0 ([int]$ch) 4))
    [void]$list.Add((New-KeyInput 0 ([int]$ch) 6))
  }
  if ($list.Count -gt 0) {
    [void][CFInput]::SendInput([uint32]$list.Count, $list.ToArray(), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
  }
}
function Move-And-Click([int]$x, [int]$y, [int]$count) {
  [void][CFInput]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 60
  for ($i = 0; $i -lt $count; $i++) {
    $down = New-Object CF_INPUT
    $down.type = 0
    $down.mi.dx = 0
    $down.mi.dy = 0
    $down.mi.mouseData = 0
    $down.mi.dwFlags = 2
    $down.mi.time = 0
    $down.mi.dwExtraInfo = [IntPtr]::Zero
    $up = New-Object CF_INPUT
    $up.type = 0
    $up.mi.dx = 0
    $up.mi.dy = 0
    $up.mi.mouseData = 0
    $up.mi.dwFlags = 4
    $up.mi.time = 0
    $up.mi.dwExtraInfo = [IntPtr]::Zero
    [void][CFInput]::SendInput(1, @($down), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
    Start-Sleep -Milliseconds 40
    [void][CFInput]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
    if ($i -lt ($count - 1)) { Start-Sleep -Milliseconds 70 }
  }
}
function Send-Wheel([int]$x, [int]$y, [int]$clicks) {
  [void][CFInput]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 60
  $delta = [int]($clicks * 120)
  $mouseData = [uint32]([int64]$delta -band [int64]0xFFFFFFFF)
  $wheel = New-Object CF_INPUT
  $wheel.type = 0
  $wheel.mi.dx = 0
  $wheel.mi.dy = 0
  $wheel.mi.mouseData = $mouseData
  $wheel.mi.dwFlags = 0x0800
  $wheel.mi.time = 0
  $wheel.mi.dwExtraInfo = [IntPtr]::Zero
  [void][CFInput]::SendInput(1, @($wheel), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
}
function Round-Int([double]$value) { return [int][Math]::Round($value) }

$hwnd = [int64]$cfg.hwnd
$isForeground = ([int64][CFInput]::GetForegroundWindow() -eq $hwnd)
if (-not $isForeground) {
  if ([CFInput]::IsIconic([IntPtr]$hwnd)) { [void][CFInput]::ShowWindow([IntPtr]$hwnd, 9) }
  [void][CFInput]::SetForegroundWindow([IntPtr]$hwnd)
  Start-Sleep -Milliseconds 180
  $isForeground = ([int64][CFInput]::GetForegroundWindow() -eq $hwnd)
}
if (-not $isForeground) { Emit @{ ok = $false; reason = 'window-not-foreground' }; exit 0 }

$target = $null
if ($null -ne $cfg.nativeRef -and "$($cfg.nativeRef)" -ne "") {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  if ($null -ne $root) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = New-Object System.Collections.ArrayList
    [void]$queue.Add($root)
    $depth = 0
    $visited = 0
    while ($queue.Count -gt 0 -and $null -eq $target -and $depth -le 8 -and $visited -lt 500) {
      $next = New-Object System.Collections.ArrayList
      foreach ($element in $queue) {
        $visited = $visited + 1
        try {
          $rid = $element.GetRuntimeId()
          if ($null -ne $rid -and (@($rid) -join '.') -eq "$($cfg.nativeRef)") { $target = $element; break }
        } catch { }
        $child = $walker.GetFirstChild($element)
        while ($null -ne $child) {
          [void]$next.Add($child)
          $child = $walker.GetNextSibling($child)
        }
      }
      $queue = $next
      $depth = $depth + 1
    }
  }
  if ($null -eq $target) { Emit @{ ok = $false; reason = 'element-missing' }; exit 0 }
}

$needElement = @('click','double_click','focus') -contains [string]$cfg.action
if ($needElement -and $null -eq $target) { Emit @{ ok = $false; reason = 'element-missing' }; exit 0 }

$bounds = $null
if ($null -ne $target) {
  try {
    $b = $target.Current.BoundingRectangle
    $bounds = @{ x = (Round-Int $b.X); y = (Round-Int $b.Y); width = (Round-Int $b.Width); height = (Round-Int $b.Height) }
  } catch {
    Emit @{ ok = $false; reason = 'element-missing' }
    exit 0
  }
  if ($null -ne $cfg.expectedBounds) {
    $posTol = __POS_TOL__
    $sizeTol = __SIZE_TOL__
    $dx = [Math]::Abs([int]$bounds.x - [int]$cfg.expectedBounds.x)
    $dy = [Math]::Abs([int]$bounds.y - [int]$cfg.expectedBounds.y)
    $dw = [Math]::Abs([int]$bounds.width - [int]$cfg.expectedBounds.width)
    $dh = [Math]::Abs([int]$bounds.height - [int]$cfg.expectedBounds.height)
    if ($dx -gt $posTol -or $dy -gt $posTol -or $dw -gt $sizeTol -or $dh -gt $sizeTol) {
      Emit @{ ok = $false; reason = 'bounds-changed' }
      exit 0
    }
  }
  if (-not $target.Current.IsEnabled -and (@('click','double_click','focus','type','key') -contains $action)) {
    Emit @{ ok = $false; reason = 'element-disabled' }
    exit 0
  }
}

$action = [string]$cfg.action
$method = ''
try {
  if ($action -eq 'focus') {
    $target.SetFocus()
    $method = 'uia-focus'
  } elseif ($action -eq 'click' -or $action -eq 'double_click') {
    $semantic = $false
    if ($action -eq 'click') {
      try {
        $select = $null
        if ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$select)) {
          $select.Select()
          $method = 'uia-select'
          $semantic = $true
        }
      } catch { }
      if (-not $semantic) {
        try {
          $invoke = $null
          if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
            $invoke.Invoke()
            $method = 'uia-invoke'
            $semantic = $true
          }
        } catch { }
      }
    }
    if (-not $semantic) {
      $cx = [int]$bounds.x + [int]([Math]::Floor([int]$bounds.width / 2))
      $cy = [int]$bounds.y + [int]([Math]::Floor([int]$bounds.height / 2))
      $count = 1
      if ($action -eq 'double_click') { $count = 2 }
      Move-And-Click $cx $cy $count
      $method = 'bounds-click'
    }
  } elseif ($action -eq 'type') {
    if ($null -ne $target) {
      if ($target.Current.IsPassword) { Emit @{ ok = $false; reason = 'password-field' }; exit 0 }
      $target.SetFocus()
      Start-Sleep -Milliseconds 80
      $done = $false
      try {
        $valuePattern = $null
        if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
          $valuePattern.SetValue([string]$cfg.text)
          $method = 'uia-setvalue'
          $done = $true
        }
      } catch { $done = $false }
      if (-not $done) {
        Send-UnicodeText ([string]$cfg.text)
        $method = 'sendinput-text'
      }
    } else {
      Send-UnicodeText ([string]$cfg.text)
      $method = 'sendinput-text'
    }
  } elseif ($action -eq 'key') {
    if ($null -ne $target) {
      $target.SetFocus()
      Start-Sleep -Milliseconds 80
    }
    Send-KeyCombo $cfg.vk
    $method = 'sendinput-key'
  } elseif ($action -eq 'scroll') {
    $cx = 0
    $cy = 0
    if ($null -ne $bounds) {
      $cx = [int]$bounds.x + [int]([Math]::Floor([int]$bounds.width / 2))
      $cy = [int]$bounds.y + [int]([Math]::Floor([int]$bounds.height / 2))
    } elseif ($null -ne $cfg.point) {
      $cx = [int]$cfg.point.x
      $cy = [int]$cfg.point.y
    } else {
      Emit @{ ok = $false; reason = 'missing-point' }
      exit 0
    }
    Send-Wheel $cx $cy ([int]$cfg.scroll)
    $method = 'scroll'
  } else {
    Emit @{ ok = $false; reason = 'unsupported-action' }
    exit 0
  }
} catch {
  Emit @{ ok = $false; reason = 'action-failed' }
  exit 0
}

Emit @{ ok = $true; method = $method }
`.replace("__POS_TOL__", String(GUI_ACTION_BOUNDS_POSITION_TOLERANCE)).replace(
  "__SIZE_TOL__",
  String(GUI_ACTION_BOUNDS_SIZE_TOLERANCE)
);

export function buildGuiActionScript(config: NativeGuiActionConfig): string {
  const json = JSON.stringify(config);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return SCRIPT.replace("__CONFIG_B64__", base64);
}

/** 纯解析：脚本 JSON → 结构化结果（malformed → fail closed） */
export function parseGuiActionResult(raw: unknown): NativeGuiActionResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid-result" };
  const value = raw as { ok?: unknown; method?: unknown; reason?: unknown };
  if (value.ok === true) {
    const method = typeof value.method === "string" ? value.method.slice(0, 32) : "";
    if (!method) return { ok: false, reason: "invalid-result" };
    return { ok: true, method };
  }
  return {
    ok: false,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 64) : "action-failed",
  };
}

/** 执行单次 GUI 动作（bounds-changed / element-missing 等 → 结构化 reason） */
export async function runNativeGuiAction(
  config: NativeGuiActionConfig,
  timeoutMs?: number
): Promise<NativeGuiActionResult> {
  const raw = await runPowerShellJson<unknown>(buildGuiActionScript(config), timeoutMs);
  return parseGuiActionResult(raw);
}
