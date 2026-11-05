#!/usr/bin/env node
/**
 * Motion Contract Lint — Motion V3 产品化护栏（硬门禁）。
 *
 * 检查 production source 中绕过 Motion Contract 的写法：
 * - FAIL（exit 1）：transition-all（整属性过渡，性能 + 语义双输）
 * - FAIL（exit 1）：animate-bounce / animate-ping / animate-[任意]（非治理常驻动画）
 * - FAIL（exit 1）：duration-[<数字>ms] 裸时长（必须引用 motion token 变量）
 * - WARN（exit 0）：裸 cubic-bezier（新代码优先引用 ease token；globals.css :root 与
 *   lib/motion.ts EASE 定义处除外）
 * - WARN（exit 0）：裸 Tailwind 具名时长 duration-150/200/300/500/700/1000
 *   （默认 150ms ≠ fast:160/base:200，且曲线非 --ease-standard；一律用 duration-[var(--motion-*)]）
 * - WARN（exit 0）：CSS animation 简写里的字面量时长（新代码走 var(--motion-*) token；
 *   recharts animationDuration/animationEasing 走库关键字，不在此列）
 * - WARN（exit 0）：transition-[left/top/right/bottom]（布局位移，优先 transform；
 *   拖拽跟手 Timetable/Timeline 与滑块旋钮暂白名单，见 WARN_LAYOUT_ALLOW）
 * - WARN（exit 0）：transition-[width/height/min/max-height]（布局尺寸；进度条 data-tier
 *   有意过渡保持 WARN 可见不进白名单，JS 直写高度处禁用）
 * - WARN（exit 0）：.style.(left/top/width/height)= 直接写布局属性（优先 transform）
 *
 * 对标 scripts/check-secrets.mjs 的目录 walk 口径；可在 CI 显式调用。
 * 用法：node scripts/check-motion.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "app", "components", "lib", "store", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".git"]);

const FAIL_PATTERNS = [
  { name: "transition-all", regex: /transition-all\b/g },
  { name: "animate-bounce/ping", regex: /animate-(bounce|ping)\b/g },
  { name: "animate-[arbitrary]", regex: /animate-\[/g },
  // duration-[140ms] 等裸数字时长；允许 duration-[var(--motion-*)] / duration-[var(--kiro-*))]
  { name: "duration-[Nms]（须引用 motion token）", regex: /duration-\[\d+ms\]/g },
];

const WARN_PATTERNS = [
  { name: "裸 cubic-bezier（优先 --ease-* token）", regex: /cubic-bezier\(/g },
  // Tailwind 具名档裸时长：默认 ease/150ms 偏离 token（fast:160/base:200 + --ease-standard）
  { name: "duration-具名档（须引用 motion token）", regex: /duration-(150|200|300|500|700|1000)\b/g },
  // CSS animation 简写字面量时长：新代码引用 var(--motion-*)；token 定义源头（globals.css）在白名单
  { name: "animation 字面量时长（须引用 motion token）", regex: /animation:[^;{}]*?\b\d[\d.]*(ms|s)\b/g },
  // 布局位移过渡：优先 transform 合成层；拖拽跟手/滑块旋钮暂白名单（见 WARN_LAYOUT_ALLOW）
  { name: "transition-[left/top/right/bottom]（优先 transform）", regex: /transition-\[[^\]]*\b(left|top|right|bottom)\b[^\]]*\]/g },
  // 布局尺寸过渡：JS 直写高度处禁用；结构折叠/进度/分段暂白名单
  { name: "transition-[width/height]（JS 直写高度处禁用）", regex: /transition-\[[^\]]*\b(width|height|min-height|max-height)\b[^\]]*\]/g },
  // 网格轨道过渡：repeat 条数变化不可插值（MiniCalendar 5↔6 周永不播），只留占位误导；结构折叠走 ExitCollapse
  { name: "transition-[grid]（轨道数变化不可插值）", regex: /transition-\[[^\]]*\bgrid-template-(rows|columns)\b[^\]]*\]/g },
  // JS 直接写布局属性：优先 transform（autoGrow 高度直写除外，其处禁止配 height 过渡）
  { name: "style.layout 直写（优先 transform）", regex: /\.style\.(left|top|width|height)\s*=/g },
];

// WARN 豁免：token 定义源头本身就是字面量
const WARN_ALLOW_FILES = new Set([
  "app/globals.css",
  "lib/motion.ts",
  "scripts/check-motion.mjs",
]);

// 布局过渡 WARN 豁免（有意为之，勿扩散）：
// - ExitCollapse / DisclosureRegion：grid 0fr↔1fr 结构折叠标准件（IM4B/IM2B）
// - SegmentedControl/KiroModeCapsule：transform+width（width 只在切换瞬间 layout 一次，非逐帧）
// - KiroComposer 模型下线 CTA / KiroContextBar 整条 / ReminderCenter 编辑器：同语义手写 0fr↔1fr
//   （ExitCollapse 内层常驻 overflow-hidden 会裁 popover，故手写；注释已立约）
// 其余（ReasoningControl 滑块 / Timetable-Timeline 拖拽跟手 / Terminal max-height / TimelineKeyLane /
// MiniCalendar-UpcomingDDL repeat 条数）保持 WARN 可见，留给后续批次收敛，不在此静默。
const WARN_TRANSITION_ALLOW = [
  "components/ui/ExitCollapse.tsx",
  "components/ui/DisclosureRegion.tsx",
  "components/ui/SegmentedControl.tsx",
  "components/kiro/KiroModeCapsule.tsx",
  "components/kiro/KiroComposer.tsx",
  "components/kiro/KiroContextBar.tsx",
  "components/reminders/ReminderCenter.tsx",
];
// JS 直写布局属性 WARN 豁免：autoGrow 直写 height 无过渡是有意正确模式
//（bug 是直写+过渡并存；直写本身保留），仅此两处豁免。
const WARN_STYLE_ALLOW = [
  "components/kiro/KiroComposer.tsx",
  "components/kiro/KiroMessage.tsx",
];

const failures = [];
const warnings = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (e.isFile() && /\.(ts|tsx|css)$/.test(e.name)) {
      const rel = full.replace(ROOT + "\\", "").replace(ROOT + "/", "");
      const content = readFileSync(full, "utf8");
      // 注释不计入（文档/注释中提及写法本身不是旁路）
      const code = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1");
      for (const p of FAIL_PATTERNS) {
        const m = code.match(p.regex);
        if (m) failures.push(`${p.name}: ${rel} x${m.length}`);
      }
      if (!WARN_ALLOW_FILES.has(rel.replace(/\\/g, "/"))) {
        for (const p of WARN_PATTERNS) {
          // 布局类 WARN 分两类白名单：过渡 vs 直写；白名单文件跳过对应项，仍检查 cubic-bezier
          const relPosix = rel.replace(/\\/g, "/");
          const isTransitionWarn = p.name.startsWith("transition-[");
          const isStyleWarn = p.name.startsWith("style.layout");
          if (isTransitionWarn && WARN_TRANSITION_ALLOW.includes(relPosix)) continue;
          if (isStyleWarn && WARN_STYLE_ALLOW.includes(relPosix)) continue;
          // WARN 同 FAIL 用去注释后 code 匹配（注释里提及写法本身不是旁路，如 Shelf 注释）
          const m = code.match(p.regex);
          if (m) warnings.push(`${p.name}: ${rel} x${m.length}`);
        }
      }
    }
  }
}

for (const d of SCAN_DIRS) {
  try {
    if (statSync(join(ROOT, d)).isDirectory()) walk(join(ROOT, d));
  } catch {}
}

if (warnings.length > 0) {
  console.log("Motion lint WARN（只报告、不拦截）：");
  for (const w of warnings) console.log(`  WARN ${w}`);
}

if (failures.length > 0) {
  console.log("Motion lint FAIL（阻断）：");
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

console.log("Motion lint OK：无 transition-all / bounce-ping / 裸 duration 旁路。");
