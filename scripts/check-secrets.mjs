#!/usr/bin/env node
/**
 * Secret Scan — Task 08 Security Hotfix
 * 扫描 production source 中明显真实 secret pattern
 * 测试 fixture 使用 sk-test-placeholder-not-a-real-key 等假值，不应触发
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "app", "components", "lib", "store"];
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".git"]);
const SKIP_FILES = new Set(["check-secrets.mjs"]);

const SECRET_PATTERNS = [
  { name: "sk- real key", regex: /\bsk-[A-Za-z0-9]{20,}\b/, allowPlaceholder: "sk-test-placeholder-not-a-real-key" },
  { name: "Bearer token", regex: /Authorization:\s*Bearer\s+[A-Za-z0-9\._-]{20,}/, allowPlaceholder: "" },
  { name: "apiKey assignment", regex: /apiKey\s*=\s*["']sk-[A-Za-z0-9]{20,}["']/, allowPlaceholder: "" },
  { name: "accessToken assignment", regex: /accessToken\s*=\s*["'][A-Za-z0-9\._-]{20,}["']/, allowPlaceholder: "" },
  { name: "refreshToken assignment", regex: /refreshToken\s*=\s*["'][A-Za-z0-9\._-]{20,}["']/, allowPlaceholder: "" },
];

let found = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (SKIP_FILES.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (e.isFile() && /\.(ts|tsx|js|mjs|jsx)$/.test(e.name)) {
      const content = readFileSync(full, "utf8");
      for (const pat of SECRET_PATTERNS) {
        const matches = content.match(pat.regex);
        if (matches) {
          for (const m of matches) {
            if (pat.allowPlaceholder && m.includes(pat.allowPlaceholder)) continue;
            // 排除测试假值
            if (m.includes("sk-test") || m.includes("placeholder") || m.includes("not-a-real-key")) continue;
            if (m.length < 20) continue;
            // 检查是否为真实 secret（简单启发：含 sk- 且长度>20 且非测试）
            if (pat.name === "sk- real key" && m.startsWith("sk-") && m.length >= 25) {
              // 额外检查：是否为注释中的假值
              if (content.includes("sk-test-placeholder")) continue;
              found.push({ file: full.replace(ROOT + "/", ""), pattern: pat.name, match: m.slice(0, 20) + "..." });
            } else if (pat.name !== "sk- real key") {
              found.push({ file: full.replace(ROOT + "/", ""), pattern: pat.name, match: m.slice(0, 30) + "..." });
            }
          }
        }
      }
      // 额外：检查硬编码的完整 sk-... 在非测试文件中
      const skHardcoded = content.match(/\bsk-[A-Za-z0-9_\-]{20,}\b/g);
      if (skHardcoded) {
        for (const m of skHardcoded) {
          if (m === "sk-test-placeholder-not-a-real-key") continue;
          if (m.includes("sk-test")) continue;
          // 排除 redact.ts 中的正则本身
          if (full.includes("redact.ts") || full.includes("check-secrets.mjs")) continue;
          if (m.length >= 25) {
            found.push({ file: full.replace(ROOT + "/", ""), pattern: "hardcoded sk-", match: m.slice(0, 20) + "..." });
          }
        }
      }
    }
  }
}

for (const dir of SCAN_DIRS) {
  const full = join(ROOT, dir);
  try {
    if (statSync(full).isDirectory()) walk(full);
  } catch {}
}

if (found.length > 0) {
  console.error("Secret scan FAILED: found potential secrets in production source:");
  for (const f of found) {
    console.error(`  ${f.file}: ${f.pattern} -> ${f.match}`);
  }
  console.error("\nIf these are test fixtures, use sk-test-placeholder-not-a-real-key");
  process.exit(1);
} else {
  console.log("Secret scan passed: no real secrets found in production source.");
}
