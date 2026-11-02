// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

/**
 * Native Title Contract：
 * 产品不使用浏览器/系统原生 title 浮层（Windows 默认黑色文字框与设计语言冲突）。
 * 需要补足语义时用 aria-label / 可见文案；唯一例外是课表课程卡的截断信息
 * （课程名 / 教师 / 地点，属于软件特性）。
 *
 * 本测试扫描 components / app 下的 TSX：
 * - 原生小写标签上的 title 属性
 * - 会透传 title 到 DOM 的 Button / IconButton / ColorSwatch
 * iframe 的 title 是无障碍名称，不产生 hover 浮层，允许保留。
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["components", "app"];
const FORWARDING_COMPONENTS = new Set(["Button", "IconButton", "ColorSwatch"]);
/** 课表例外：课程卡截断信息仍使用原生 title（产品特性） */
const ALLOWED_FILES = new Set(["components/dashboard/TimetableGrid.tsx"]);

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...listTsx(full));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function findViolations(file: string): string[] {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (ALLOWED_FILES.has(rel)) return [];
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const intrinsic = /^[a-z]/.test(tag);
      const forwarding = FORWARDING_COMPONENTS.has(tag);
      if ((intrinsic && tag !== "iframe") || forwarding) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(sf) === "title") {
            const line = sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1;
            violations.push(`${rel}:${line} <${tag} title>`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

describe("Native Title Contract：不使用系统默认 title 浮层", () => {
  it("components / app 中不存在原生 title（课表课程卡除外）", () => {
    const files = SCAN_DIRS.flatMap((dir) => listTsx(path.join(ROOT, dir)));
    const violations = files.flatMap(findViolations);
    expect(violations).toEqual([]);
  });
});
