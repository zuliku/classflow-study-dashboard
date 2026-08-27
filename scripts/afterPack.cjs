const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

/** 从 electron-builder 缓存中递归定位 rcedit（本机无开发者模式，winCodeSign 自动解压失败，需手动） */
function findRcedit() {
  const base = path.join(
    process.env.LOCALAPPDATA ?? path.join(require("node:os").homedir(), "AppData", "Local"),
    "electron-builder",
    "Cache",
    "winCodeSign"
  );
  if (!existsSync(base)) return null;
  const { readdirSync, statSync } = require("node:fs");
  const queue = [base];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = path.join(dir, name);
      if (name === "rcedit-x64.exe") return p;
      if (statSync(p).isDirectory()) queue.push(p);
    }
  }
  return null;
}

exports.default = async (context) => {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName !== "win32") return;
  const exe = path.join(appOutDir, "ClassFlow.exe");
  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn("[afterPack] rcedit not found, skip icon edit");
    return;
  }
  const icon = path.join(__dirname, "..", "build", "icon.ico");
  const version = require("../package.json").version;
  execFileSync(rcedit, [
    exe,
    "--set-icon", icon,
    "--set-version-string", "FileDescription", "ClassFlow",
    "--set-version-string", "ProductName", "ClassFlow",
    "--set-version-string", "CompanyName", "ClassFlow",
    "--set-version-string", "ProductVersion", version,
    "--set-version-string", "FileVersion", version,
  ]);
  console.log("[afterPack] icon + version info written to", exe);
};
