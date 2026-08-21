import * as fs from "node:fs";
import * as path from "node:path";

const cjs = path.join(process.cwd(), "out/preload/index.cjs");
const mjs = path.join(process.cwd(), "out/preload/index.mjs");

let ok = true;

if (!fs.existsSync(cjs)) {
  console.error(`FAIL: ${cjs} does not exist`);
  ok = false;
} else {
  console.log(`PASS: ${cjs} exists`);
  const content = fs.readFileSync(cjs, "utf8");
  if (!content.includes('require("electron")')) {
    console.error("FAIL: index.cjs should contain require(\"electron\")");
    ok = false;
  } else {
    console.log("PASS: index.cjs contains require(\"electron\")");
  }
  if (!content.includes("contextBridge")) {
    console.error("FAIL: index.cjs should contain contextBridge");
    ok = false;
  } else {
    console.log("PASS: index.cjs contains contextBridge");
  }
  if (content.includes("import { contextBridge")) {
    console.error("FAIL: index.cjs should not contain ESM import { contextBridge");
    ok = false;
  } else {
    console.log("PASS: index.cjs is CJS (no ESM import)");
  }
}

if (fs.existsSync(mjs)) {
  console.error(`FAIL: ${mjs} should not exist`);
  ok = false;
} else {
  console.log(`PASS: ${mjs} does not exist`);
}

process.exitCode = ok ? 0 : 1;
if (ok) console.log("verify:preload-artifact PASS");
else console.error("verify:preload-artifact FAIL");
