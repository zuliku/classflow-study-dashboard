/**
 * Computer Use V2.2 — 常驻 UIA Worker 的 PowerShell 脚本（stdin/stdout JSON lines）。
 *
 * 目的：把每步 2–3 次 PowerShell 冷启动（每次 1–2s）收敛为一次常驻进程 + 元素缓存：
 *   {"id":1,"op":"ping"}
 *   {"id":2,"op":"windows"}
 *   {"id":3,"op":"inspect","payload":{"hwnd":123,"limit":150,"maxDepth":6}}
 *   {"id":4,"op":"resolve","payload":{"hwnd":123,"nativeRef":"42.1002"}}
 *   {"id":5,"op":"act","payload":{...NativeGuiActionConfig}}
 *   {"id":6,"op":"activate","payload":{"hwnd":123}}
 * 响应：{"id":N,"ok":true,"data":{...}} / {"id":N,"ok":false,"error":"reason"}
 *
 * 与一次性脚本的关系：
 * - 窗口枚举复用 windows.ts 的 WINDOW_ENUMERATION_FUNCTION（单一来源）
 * - inspect/act 逻辑与 uia.ts / guiAction.ts 的一次性脚本保持一致（后者仍是 fallback）
 * - 所有失败都以 {ok:false,error} 返回（绝不 throw 到 stdout 污染协议）
 */
import { WINDOW_ENUMERATION_FUNCTION } from "./windows";
import {
  GUI_ACTION_BOUNDS_POSITION_TOLERANCE,
  GUI_ACTION_BOUNDS_SIZE_TOLERANCE,
} from "./guiAction";

export const UIA_WORKER_MAX_CACHE = 300;
export const UIA_WORKER_RESOLVE_MAX_DEPTH = 8;
export const UIA_WORKER_RESOLVE_MAX_VISITED = 600;

export function buildUiaWorkerScript(): string {
  return String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
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

$script:ElementCache = @{}
$script:MaxCache = ${UIA_WORKER_MAX_CACHE}

${WINDOW_ENUMERATION_FUNCTION}

function Emit-Response([int]$id, [bool]$ok, $data, [string]$error) {
  $payload = @{ id = $id; ok = $ok }
  if ($null -ne $data) { $payload.data = $data }
  if ($error) { $payload.error = $error }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $payload -Compress -Depth 8))
  [Console]::Out.Flush()
}

function Round-Int([double]$value) { return [int][Math]::Round($value) }

function Get-ElementInfo($element, [int]$depth) {
  $c = $element.Current
  $role = [string]$c.ControlType.ProgrammaticName
  if ($role.StartsWith("ControlType.")) { $role = $role.Substring(12) }
  $rect = $c.BoundingRectangle
  $runtimeId = $null
  try { $runtimeId = $element.GetRuntimeId() } catch { $runtimeId = $null }
  $ref = ""
  if ($null -ne $runtimeId -and @($runtimeId).Count -gt 0) { $ref = (@($runtimeId) -join ".") }
  return @{
    nativeRef = $ref
    role = $role
    name = [string]$c.Name
    enabled = [bool]$c.IsEnabled
    focused = [bool]$c.HasKeyboardFocus
    isPassword = [bool]$c.IsPassword
    x = (Round-Int $rect.X)
    y = (Round-Int $rect.Y)
    width = (Round-Int $rect.Width)
    height = (Round-Int $rect.Height)
    depth = $depth
  }
}

function Get-UiTree([int64]$hwnd, [int]$limit, [int]$maxDepth) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  if ($null -eq $root) { return @{ elements = @(); truncated = $false } }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $items = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.ArrayList
  [void]$queue.Add($root)
  $depth = 0
  while ($queue.Count -gt 0 -and $items.Count -lt $limit -and $depth -le $maxDepth) {
    $next = New-Object System.Collections.ArrayList
    foreach ($element in $queue) {
      if ($items.Count -ge $limit) { break }
      try { [void]$items.Add((Get-ElementInfo $element $depth)) } catch { }
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child) {
        if ($items.Count + $next.Count -ge $limit) { break }
        [void]$next.Add($child)
        $child = $walker.GetNextSibling($child)
      }
    }
    $queue = $next
    $depth = $depth + 1
  }
  return @{ elements = @($items); truncated = [bool]($items.Count -ge $limit) }
}

function Find-ElementByRuntimeRef([int64]$hwnd, [string]$runtimeRef) {
  if (-not $runtimeRef) { return $null }
  $key = "$hwnd|$runtimeRef"
  if ($script:ElementCache.ContainsKey($key)) {
    $cached = $script:ElementCache[$key]
    try {
      $null = $cached.Current.BoundingRectangle
      return $cached
    } catch {
      $null = $script:ElementCache.Remove($key)
    }
  }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  if ($null -eq $root) { return $null }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.ArrayList
  [void]$queue.Add($root)
  $depth = 0
  $visited = 0
  while ($queue.Count -gt 0 -and $depth -le ${UIA_WORKER_RESOLVE_MAX_DEPTH} -and $visited -lt ${UIA_WORKER_RESOLVE_MAX_VISITED}) {
    $next = New-Object System.Collections.ArrayList
    foreach ($element in $queue) {
      $visited = $visited + 1
      try {
        $rid = $element.GetRuntimeId()
        if ($null -ne $rid -and (@($rid) -join '.') -eq $runtimeRef) {
          if ($script:ElementCache.Count -ge $script:MaxCache) { $script:ElementCache = @{} }
          $script:ElementCache[$key] = $element
          return $element
        }
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
  return $null
}

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
    $down.mi.dwFlags = 2
    $down.mi.dwExtraInfo = [IntPtr]::Zero
    $up = New-Object CF_INPUT
    $up.type = 0
    $up.mi.dwFlags = 4
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
  $wheel.mi.mouseData = $mouseData
  $wheel.mi.dwFlags = 0x0800
  $wheel.mi.dwExtraInfo = [IntPtr]::Zero
  [void][CFInput]::SendInput(1, @($wheel), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CF_INPUT]))
}

function Ensure-Foreground([int64]$hwnd) {
  $isForeground = ([int64][CFInput]::GetForegroundWindow() -eq $hwnd)
  if (-not $isForeground) {
    if ([CFInput]::IsIconic([IntPtr]$hwnd)) { [void][CFInput]::ShowWindow([IntPtr]$hwnd, 9) }
    [void][CFInput]::SetForegroundWindow([IntPtr]$hwnd)
    Start-Sleep -Milliseconds 180
    $isForeground = ([int64][CFInput]::GetForegroundWindow() -eq $hwnd)
  }
  return $isForeground
}

function Invoke-Activate([int64]$hwnd) {
  if (-not (Ensure-Foreground $hwnd)) { return @{ active = $false } }
  Start-Sleep -Milliseconds 120
  return @{ active = ([int64][CFInput]::GetForegroundWindow() -eq $hwnd) }
}

function Invoke-Action($cfg) {
  $hwnd = [int64]$cfg.hwnd
  $background = ($null -ne $cfg.background -and $cfg.background -eq $true)
  if ($background) {
    # 后台静默模式：与 guiAction.ts 同语义（绝不前台化；最小化直接失败；仅语义直调）
    if ([CFInput]::IsIconic([IntPtr]$hwnd)) { return @{ ok = $false; reason = 'window-minimized'; background = $true } }
  } elseif (-not (Ensure-Foreground $hwnd)) { return @{ ok = $false; reason = 'window-not-foreground' } }

  $target = $null
  if ($null -ne $cfg.nativeRef -and "$($cfg.nativeRef)" -ne "") {
    $target = Find-ElementByRuntimeRef $hwnd "$($cfg.nativeRef)"
    if ($null -eq $target) { return @{ ok = $false; reason = 'element-missing' } }
  }

  $action = [string]$cfg.action
  $needElement = @('click','double_click','focus') -contains $action
  if ($needElement -and $null -eq $target) { return @{ ok = $false; reason = 'element-missing' } }

  $bounds = $null
  if ($null -ne $target) {
    try {
      $b = $target.Current.BoundingRectangle
      $bounds = @{ x = (Round-Int $b.X); y = (Round-Int $b.Y); width = (Round-Int $b.Width); height = (Round-Int $b.Height) }
    } catch {
      return @{ ok = $false; reason = 'element-missing' }
    }
    if ($null -ne $cfg.expectedBounds) {
      $dx = [Math]::Abs([int]$bounds.x - [int]$cfg.expectedBounds.x)
      $dy = [Math]::Abs([int]$bounds.y - [int]$cfg.expectedBounds.y)
      $dw = [Math]::Abs([int]$bounds.width - [int]$cfg.expectedBounds.width)
      $dh = [Math]::Abs([int]$bounds.height - [int]$cfg.expectedBounds.height)
      if ($dx -gt ${GUI_ACTION_BOUNDS_POSITION_TOLERANCE} -or $dy -gt ${GUI_ACTION_BOUNDS_POSITION_TOLERANCE} -or $dw -gt ${GUI_ACTION_BOUNDS_SIZE_TOLERANCE} -or $dh -gt ${GUI_ACTION_BOUNDS_SIZE_TOLERANCE}) {
        return @{ ok = $false; reason = 'bounds-changed' }
      }
    }
    if (-not $target.Current.IsEnabled -and (@('click','double_click','focus','type','key') -contains $action)) {
      return @{ ok = $false; reason = 'element-disabled' }
    }
  }

  $method = ''
  # 后台模式只允许语义直调（与 guiAction.ts 同语义；焦点/坐标/光标依赖一律 foreground-required）
  if ($background -and @('focus','double_click','key','scroll') -contains $action) {
    return @{ ok = $false; reason = 'foreground-required'; background = $true }
  }
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
      if ($target.Current.IsPassword) { return @{ ok = $false; reason = 'password-field' } }
      if (-not $background) {
        $target.SetFocus()
        Start-Sleep -Milliseconds 80
      }
      $done = $false
      $valuePattern = $null
      try {
        if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
          $valuePattern.SetValue([string]$cfg.text)
          $method = 'uia-setvalue'
          $done = $true
        }
      } catch { $done = $false }
      if (-not $done) {
        if ($background) { return @{ ok = $false; reason = 'foreground-required'; background = $true } }
        Send-UnicodeText ([string]$cfg.text)
        $method = 'sendinput-text'
      } elseif ($background) {
        # 后台写入回读复核（Phase-1 verify：无截图，用 UIA 回读代替像素验证）
        try {
          $readback = $valuePattern.Current.Value
          if ($readback -ne [string]$cfg.text) { return @{ ok = $false; reason = 'verify-failed'; background = $true } }
        } catch { return @{ ok = $false; reason = 'verify-failed'; background = $true } }
      }
    } else {
      if ($background) { return @{ ok = $false; reason = 'foreground-required'; background = $true } }
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
      return @{ ok = $false; reason = 'missing-point' }
    }
    Send-Wheel $cx $cy ([int]$cfg.scroll)
    $method = 'scroll'
  } else {
    return @{ ok = $false; reason = 'unsupported-action' }
  }
  return @{ ok = $true; method = $method; background = $background }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    $op = [string]$req.op
    $payload = $req.payload
    if ($op -eq 'ping') {
      Emit-Response $id $true @{ pong = $true } $null
    } elseif ($op -eq 'windows') {
      Emit-Response $id $true (Get-ClassFlowWindows) $null
    } elseif ($op -eq 'inspect') {
      $limit = 150
      $maxDepth = 6
      if ($null -ne $payload.limit) { $limit = [int]$payload.limit }
      if ($null -ne $payload.maxDepth) { $maxDepth = [int]$payload.maxDepth }
      Emit-Response $id $true (Get-UiTree ([int64]$payload.hwnd) $limit $maxDepth) $null
    } elseif ($op -eq 'resolve') {
      $element = Find-ElementByRuntimeRef ([int64]$payload.hwnd) ([string]$payload.nativeRef)
      if ($null -eq $element) {
        Emit-Response $id $true @{ element = $null } $null
      } else {
        Emit-Response $id $true @{ element = (Get-ElementInfo $element 0) } $null
      }
    } elseif ($op -eq 'act') {
      Emit-Response $id $true (Invoke-Action $payload) $null
    } elseif ($op -eq 'activate') {
      Emit-Response $id $true (Invoke-Activate ([int64]$payload.hwnd)) $null
    } else {
      Emit-Response $id $false $null 'unsupported-op'
    }
  } catch {
    Emit-Response $id $false $null 'worker-error'
  }
}
`;
}
