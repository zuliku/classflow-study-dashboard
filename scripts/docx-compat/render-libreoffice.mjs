/**
 * LibreOffice headless 渲染 smoke（V2.6）。
 * - soffice 不存在 → SKIPPED（exit 0；本地不安装系统依赖，CI workflow 显式安装）
 * - 存在 → 对指定 fixtures 执行 --convert-to pdf，断言 exit 0 且 PDF 非空
 * 运行：node scripts/docx-compat/render-libreoffice.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import * as path from "node:path";

const fixtures = ["05-schedule", "07-legacy-repaired"];
const outDir = path.resolve(".tmp/kiro-docx-compat");
const pdfDir = path.resolve(".tmp/kiro-docx-compat/pdf");
const pdfDirArg = pdfDir;

function hasSoffice() {
  try {
    const out = execFileSync("soffice", ["--version"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

if (!hasSoffice()) {
  console.log("SKIPPED: soffice not found — LibreOffice compatibility smoke skipped");
  process.exit(0);
}

await mkdir(pdfDir, { recursive: true });

let failed = false;
for (const fixture of fixtures) {
  const file = path.join(outDir, `${fixture}.docx`);
  console.log(`rendering ${fixture}.docx via LibreOffice headless ...`);
  try {
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", pdfDirArg, file], {
      stdio: "inherit",
      timeout: 120_000,
    });
    const pdfPath = path.join(pdfDir, `${fixture}.pdf`);
    const s = await stat(pdfPath);
    if (s.size <= 0) {
      failed = true;
      console.error(`FAILED: ${fixture}.pdf is empty`);
    } else {
      console.log(`ok: ${fixture}.pdf ${s.size} bytes`);
    }
  } catch (e) {
    failed = true;
    console.error(`FAILED: LibreOffice could not render ${fixture}.docx`, e?.status ?? e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
