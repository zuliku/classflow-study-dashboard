/**
 * Desktop Action 键盘 allowlist（纯逻辑；renderer 校验 + Main 执行共用）。
 *
 * 设计原则：
 * - 只允许明确列举的按键 / 组合键（未知 → INVALID_INPUT，绝不透传任意虚拟键码）
 * - clipboard 组合（ctrl+c/x/v）与系统级组合（win+*、ctrl+alt+del）不在 allowlist
 * - 每个键带静态风险级别；GUI Risk Gate 在元素上下文之上再合成最终风险
 */
export type GuiKeyRiskHint = "normal" | "external" | "destructive" | "blocked";

export interface GuiKeyDefinition {
  /** 规范化名称（allowlist key） */
  name: string;
  /** 需要按下的键序列（修饰键在前） */
  keys: string[];
  riskHint: GuiKeyRiskHint;
  riskReason?: string;
}

const NAMED_KEYS: Record<string, string> = {
  enter: "enter",
  return: "enter",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  f1: "f1",
  f2: "f2",
  f3: "f3",
  f4: "f4",
  f5: "f5",
  f6: "f6",
  f7: "f7",
  f8: "f8",
  f9: "f9",
  f10: "f10",
  f11: "f11",
  f12: "f12",
};

/** Windows 虚拟键码（仅 allowlist 内的键会被映射） */
export const GUI_KEY_VK: Record<string, number> = {
  enter: 0x0d,
  tab: 0x09,
  escape: 0x1b,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
  ctrl: 0x11,
  shift: 0x10,
  alt: 0x12,
  a: 0x41,
  b: 0x42,
  c: 0x43,
  d: 0x44,
  e: 0x45,
  f: 0x46,
  g: 0x47,
  h: 0x48,
  i: 0x49,
  j: 0x4a,
  k: 0x4b,
  l: 0x4c,
  m: 0x4d,
  n: 0x4e,
  o: 0x4f,
  p: 0x50,
  q: 0x51,
  r: 0x52,
  s: 0x53,
  t: 0x54,
  u: 0x55,
  v: 0x56,
  w: 0x57,
  x: 0x58,
  y: 0x59,
  z: 0x5a,
  "0": 0x30,
  "1": 0x31,
  "2": 0x32,
  "3": 0x33,
  "4": 0x34,
  "5": 0x35,
  "6": 0x36,
  "7": 0x37,
  "8": 0x38,
  "9": 0x39,
};

/** Blocked：系统级 / 提权 / clipboard —— 永不执行（审批也不能放行） */
const BLOCKED_KEYS = new Set([
  "win",
  "meta",
  "ctrl+alt+del",
  "ctrl+alt+delete",
  "ctrl+shift+esc",
  "ctrl+shift+escape",
  "alt+ctrl+del",
  "alt+ctrl+delete",
  "ctrl+c",
  "ctrl+x",
  "ctrl+v",
  "ctrl+insert",
  "shift+insert",
]);

/** Destructive：可能丢失用户内容 / 关闭窗口的重要组合 */
const DESTRUCTIVE_KEYS = new Set(["alt+f4", "shift+delete", "ctrl+w", "ctrl+shift+w"]);

/** External：提交 / 保存 / 打印等可能产生外部效果 */
const EXTERNAL_KEYS = new Set(["ctrl+s", "ctrl+p", "ctrl+enter", "ctrl+shift+enter"]);

/**
 * 解析 key 字符串（允许 ctrl+a 形式组合，最多 3 段）。
 * 返回 null = 不在 allowlist（调用方按 INVALID_INPUT 拒绝）。
 */
export function parseGuiKey(input: string): GuiKeyDefinition | null {
  if (typeof input !== "string") return null;
  const normalized = input
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (normalized.length === 0 || normalized.length > 3) return null;

  const keys = normalized.map((part) => NAMED_KEYS[part] ?? part);
  for (const key of keys) {
    if (!(key in GUI_KEY_VK)) return null;
  }
  // 修饰键不能作为唯一按键
  if (keys.length === 1 && (keys[0] === "ctrl" || keys[0] === "shift" || keys[0] === "alt")) {
    return null;
  }
  const name = keys.join("+");
  if (BLOCKED_KEYS.has(name)) {
    return { name, keys, riskHint: "blocked", riskReason: "系统级 / 剪贴板组合键被禁用" };
  }
  if (DESTRUCTIVE_KEYS.has(name)) {
    return { name, keys, riskHint: "destructive", riskReason: "可能关闭窗口或永久删除内容" };
  }
  if (EXTERNAL_KEYS.has(name)) {
    return { name, keys, riskHint: "external", riskReason: "可能保存 / 提交 / 产生外部效果" };
  }
  return { name, keys, riskHint: "normal" };
}

/** 是否为合法的 allowlist 按键（schema / executor 校验用） */
export function isAllowedGuiKey(input: string): boolean {
  const parsed = parseGuiKey(input);
  return parsed !== null && parsed.riskHint !== "blocked";
}

/** 供 Main 输入适配器使用：key 名称 → VK 序列（无效 / blocked → null） */
export function guiKeyToVirtualKeys(input: string): number[] | null {
  const parsed = parseGuiKey(input);
  if (!parsed || parsed.riskHint === "blocked") return null;
  return parsed.keys.map((key) => GUI_KEY_VK[key]);
}
