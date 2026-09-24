#!/usr/bin/env node
/**
 * Token Debt Ledger — S1 立约债务台账（只报告、不拦截）
 * 统计 production source 中旁路 token 的写法存量，跟踪收敛进度。
 * 对标 scripts/check-secrets.mjs 的目录 walk 口径；CI 不设门禁，S1-2 起对增量设限。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "app", "components", "lib", "store"];
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".git"]);

const LEDGERS = [
  { name: "bg-white", regex: /\bbg-white\b/g },
  { name: "HEX6", regex: /#[0-9a-fA-F]{6}\b/g },
  { name: "text-[arbitrary]", regex: /text-\[/g },
  { name: "rounded-[arbitrary]", regex: /rounded-\[/g },
  { name: "inline style", regex: /style=\{\{/g },
  { name: "shadow escape", regex: /shadow-(2xl|\[)/g },
];

const counts = Object.fromEntries(LEDGERS.map((l) => [l.name, 0]));
const topFiles = Object.fromEntries(LEDGERS.map((l) => [l.name, []]));

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      const content = readFileSync(full, "utf8");
      for (const ledger of LEDGERS) {
        const matches = content.match(ledger.regex);
        if (matches) {
          counts[ledger.name] += matches.length;
          topFiles[ledger.name].push({ file: full.replace(ROOT + "\\", "").replace(ROOT + "/", ""), n: matches.length });
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

console.log("Token Debt Ledger (S1 baseline; lower is better):");
for (const ledger of LEDGERS) {
  const top = topFiles[ledger.name].sort((a, b) => b.n - a.n).slice(0, 3);
  console.log(`  ${ledger.name}: ${counts[ledger.name]}${top.length ? `  top: ${top.map((t) => `${t.file}(${t.n})`).join(", ")}` : ""}`);
}
