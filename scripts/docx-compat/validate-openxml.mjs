/**
 * OpenXmlValidator fixture gate runner（V2.4 / V2.6）。
 * - dotnet SDK 不存在 → SKIPPED（exit 0，本地不安装系统依赖；CI 由 workflow 显式 setup .NET）
 * - 对 current-renderer fixtures 01–05 + 07-legacy-repaired 逐个验证：任何 error → exit 1
 * - 06-legacy-real 是「已知坏文件」回归：必须被 validator 拒绝（非 0 exit）
 * - 无法打开 package → exit 2
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mustBeValid = ["01-paragraph", "02-headings", "03-lists", "04-table-2x2", "05-schedule", "07-legacy-repaired"];
const mustBeInvalid = ["06-legacy-real"];
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
for (const fixture of mustBeValid) {
  const file = path.join(outDir, `${fixture}.docx`);
  console.log(`validating ${fixture}.docx (expect 0 errors) ...`);
  try {
    execFileSync("dotnet", ["run", "--project", csproj, "--no-build", "--", file], { stdio: "inherit" });
  } catch (e) {
    failed = true;
    console.error(`FAILED: ${fixture}.docx should be valid`);
    if (typeof e === "object" && e && "status" in e && e.status === 2) process.exit(2);
  }
}
for (const fixture of mustBeInvalid) {
  const file = path.join(outDir, `${fixture}.docx`);
  console.log(`validating ${fixture}.docx (expect schema errors) ...`);
  try {
    execFileSync("dotnet", ["run", "--project", csproj, "--no-build", "--", file], { stdio: "inherit" });
    failed = true;
    console.error(`FAILED: ${fixture}.docx should be rejected but validator found 0 errors`);
  } catch (e) {
    if (typeof e === "object" && e && "status" in e && e.status === 2) {
      console.error(`FAILED: ${fixture}.docx could not be opened`);
      process.exit(2);
    }
    console.log(`ok: ${fixture}.docx rejected (exit ${e?.status ?? "?"})`);
  }
}
process.exit(failed ? 1 : 0);
