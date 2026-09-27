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
];

// WARN 豁免：token 定义源头本身就是字面量
const WARN_ALLOW_FILES = new Set([
  "app/globals.css",
  "lib/motion.ts",
  "scripts/check-motion.mjs",
]);

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
          const m = content.match(p.regex);
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
