/**
 * OpenXmlValidator fixture gate runner（V2.4）。
 * - dotnet SDK 不存在 → SKIPPED（exit 0，本地不安装系统依赖；CI 由 workflow 显式 setup .NET）
 * - dotnet 存在 → 对 5 个 fixture 逐个运行 kiro-openxml-validator，任何 error → exit 1
 * - 无法打开 package → exit 2
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = ["01-paragraph", "02-headings", "03-lists", "04-table-2x2", "05-schedule"];
const outDir = path.resolve(".tmp/kiro-docx-compat");
const csproj = path.join(here, "..", "openxml-validator", "OpenXmlValidator.csproj");

function hasDotnet() {
  try {
    const out = execFileSync("dotnet", ["--list-sdks"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

if (!hasDotnet()) {
  console.log("SKIPPED: dotnet SDK not found — OpenXmlValidator fixture gate skipped locally");
  process.exit(0);
}

console.log("building validator...");
execFileSync("dotnet", ["build", csproj, "-v", "q", "--nologo"], { stdio: "inherit" });

let failed = false;
for (const fixture of fixtures) {
  const file = path.join(outDir, `${fixture}.docx`);
  console.log(`validating ${fixture}.docx ...`);
  try {
    execFileSync("dotnet", ["run", "--project", csproj, "--no-build", "--", file], { stdio: "inherit" });
  } catch (e) {
    failed = true;
    console.error(`FAILED: ${fixture}.docx`);
    if (typeof e === "object" && e && "status" in e && e.status === 2) process.exit(2);
  }
}
process.exit(failed ? 1 : 0);
