/**
 * Computer Use Phase 1 — UI Automation adapter（基础实现）。
 *
 * 通过 Windows 自带 .NET UIAutomationClient 读取指定窗口的控件树：
 * - 只读：FindAll / TreeWalker 遍历，绝不 Invoke / SetValue / 输入
 * - 有界：max elements + max depth；跨进程异常逐元素吞掉
 * - nativeRef（UIA RuntimeId）只存在 runtime memory，用于 elementId → native 映射
 *
 * 后续阶段可替换为原生 UIA adapter / 完整能力，接口保持不变。
 */
import { runPowerShellJson } from "./powershell";

export interface NativeUiElement {
  /** runtime-only：绝不外传（UIA RuntimeId 字符串） */
  nativeRef: string;
  role: string;
  name: string;
  enabled: boolean;
  focused: boolean;
  /** 控件是否密码字段（语义事实；用于阻止敏感输入） */
  isPassword: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  depth: number;
}

export const MAX_UI_ELEMENTS = 150;
export const MAX_UI_DEPTH = 6;
export const MAX_UI_ELEMENT_NAME_LENGTH = 120;

interface RawUiNode {
  nativeRef?: unknown;
  role?: unknown;
  name?: unknown;
  enabled?: unknown;
  focused?: unknown;
  isPassword?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  depth?: unknown;
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function sanitizeText(raw: unknown, maxLength: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** 纯解析：UIA 探测结果 → runtime 内部元素记录（可测试） */
export function parseUiTree(raw: unknown): { elements: NativeUiElement[]; truncated: boolean } {
  const container = raw && typeof raw === "object" ? (raw as { elements?: unknown; truncated?: unknown }) : null;
  const list = Array.isArray(container?.elements) ? (container.elements as RawUiNode[]) : [];
  const elements: NativeUiElement[] = [];
  for (const node of list) {
    if (!node || typeof node !== "object") continue;
    const role = sanitizeText(node.role, 64);
    if (!role) continue;
    elements.push({
      nativeRef: typeof node.nativeRef === "string" ? node.nativeRef.slice(0, 128) : "",
      role,
      name: sanitizeText(node.name, MAX_UI_ELEMENT_NAME_LENGTH),
      enabled: node.enabled === true,
      focused: node.focused === true,
      isPassword: node.isPassword === true,
      bounds: {
        x: toInt(node.x),
        y: toInt(node.y),
        width: Math.max(0, toInt(node.width)),
        height: Math.max(0, toInt(node.height)),
      },
      depth: Math.max(0, Math.min(toInt(node.depth), MAX_UI_DEPTH + 1)),
    });
    if (elements.length >= MAX_UI_ELEMENTS) break;
  }
  return { elements, truncated: container?.truncated === true || elements.length >= MAX_UI_ELEMENTS };
}

function buildUiTreeScript(hwnd: number): string {
  const safeHwnd = String(Math.trunc(hwnd));
  return String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]${safeHwnd})
if ($null -eq $root) {
  ConvertTo-Json -InputObject @{ elements = @(); truncated = $false } -Compress
  exit 0
}
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$items = New-Object System.Collections.ArrayList
$limit = ${MAX_UI_ELEMENTS}
$maxDepth = ${MAX_UI_DEPTH}
# 广度优先：保证浅层可操作控件（按钮/输入框等）优先于深层容器进入预算
$queue = New-Object System.Collections.ArrayList
[void]$queue.Add($root)
$depth = 0
while ($queue.Count -gt 0 -and $items.Count -lt $limit -and $depth -le $maxDepth) {
  $next = New-Object System.Collections.ArrayList
  foreach ($element in $queue) {
    if ($items.Count -ge $limit) { break }
    try {
      $c = $element.Current
      $role = [string]$c.ControlType.ProgrammaticName
      if ($role.StartsWith("ControlType.")) { $role = $role.Substring(12) }
      $rect = $c.BoundingRectangle
      $runtimeId = $null
      try { $runtimeId = $element.GetRuntimeId() } catch { $runtimeId = $null }
      $ref = ""
      if ($null -ne $runtimeId -and @($runtimeId).Count -gt 0) { $ref = (@($runtimeId) -join ".") }
      [void]$items.Add([pscustomobject]@{
        nativeRef = $ref
        role = $role
        name = [string]$c.Name
        enabled = [bool]$c.IsEnabled
        focused = [bool]$c.HasKeyboardFocus
        isPassword = [bool]$c.IsPassword
        x = [int][Math]::Round($rect.X)
        y = [int][Math]::Round($rect.Y)
        width = [int][Math]::Round($rect.Width)
        height = [int][Math]::Round($rect.Height)
        depth = $depth
      })
    } catch { }
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
ConvertTo-Json -InputObject @{ elements = @($items); truncated = [bool]($items.Count -ge $limit) } -Compress -Depth 5
`;
}

/** 读取指定窗口的 UI 控件树（有界；异常 → 抛 PowerShellProbeError，调用方降级） */
export async function inspectNativeUiTree(
  hwnd: number,
  timeoutMs?: number
): Promise<{ elements: NativeUiElement[]; truncated: boolean }> {
  const raw = await runPowerShellJson<unknown>(buildUiTreeScript(hwnd), timeoutMs);
  return parseUiTree(raw);
}

const UI_AUTOMATION_PROBE_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
ConvertTo-Json -InputObject @{ available = $true } -Compress
`;

let uiaProbeCache: { at: number; available: boolean } | null = null;
const UIA_PROBE_CACHE_MS = 60_000;

/** UI Automation 是否可用（有缓存；探测失败绝不抛出） */
export async function probeUiAutomation(now: number = Date.now()): Promise<boolean> {
  if (uiaProbeCache && now - uiaProbeCache.at < UIA_PROBE_CACHE_MS) return uiaProbeCache.available;
  let available = false;
  try {
    const raw = await runPowerShellJson<{ available?: unknown }>(UI_AUTOMATION_PROBE_SCRIPT, 8_000);
    available = raw?.available === true;
  } catch {
    available = false;
  }
  uiaProbeCache = { at: now, available };
  return available;
}

/** 测试用：清空探测缓存 */
export function resetUiAutomationProbeCache(): void {
  uiaProbeCache = null;
}
