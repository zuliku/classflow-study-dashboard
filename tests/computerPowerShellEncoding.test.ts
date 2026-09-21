// @vitest-environment node
/**
 * V2.5 回归：GUI 动作脚本超过 Windows 命令行长度上限时，
 * runPowerShellJson 必须走 gzip + 内存解压路径（否则 spawn ENAMETOOLONG → EXECUTION_FAILED）。
 */
import { describe, it, expect } from "vitest";
import {
  POWERSHELL_ENCODED_COMMAND_LIMIT,
  encodePowerShellScript,
} from "@/src/main/computer/powershell";
import { buildGuiActionScript } from "@/src/main/computer/guiAction";

describe("PowerShell EncodedCommand 长度回归", () => {
  it("短脚本直传（不做压缩）", () => {
    const encoded = encodePowerShellScript("bootstrap;", "Write-Output 1");
    const direct = Buffer.from("bootstrap;Write-Output 1", "utf16le").toString("base64");
    expect(encoded).toBe(direct);
  });

  it("GUI 动作脚本超过直传上限 → 压缩后低于上限", () => {
    const script = buildGuiActionScript({
      hwnd: 1,
      nativeRef: null,
      action: "drag",
      point: { x: 1, y: 1 },
      toPoint: { x: 2, y: 2 },
    });
    const direct = Buffer.from("bootstrap;" + script, "utf16le").toString("base64");
    expect(direct.length).toBeGreaterThan(POWERSHELL_ENCODED_COMMAND_LIMIT);
    const encoded = encodePowerShellScript("bootstrap;", script);
    expect(encoded.length).toBeLessThan(POWERSHELL_ENCODED_COMMAND_LIMIT);
    // gzip 路径包含内存解压 bootstrap（不写磁盘）
    const decoded = Buffer.from(encoded, "base64").toString("utf16le");
    expect(decoded).toContain("GzipStream");
    expect(decoded).toContain("Invoke-Expression");
  });

  it("压缩路径内容可还原为原脚本（UTF-8）", () => {
    const script = "Write-Output '中文内容 ✓'\n" + "x".repeat(30_000);
    const encoded = encodePowerShellScript("bootstrap;", script);
    const decoded = Buffer.from(encoded, "base64").toString("utf16le");
    const match = decoded.match(/FromBase64String\('([^']+)'\)/);
    expect(match).toBeTruthy();
    const { gunzipSync } = require("node:zlib") as typeof import("node:zlib");
    const restored = gunzipSync(Buffer.from(match![1], "base64")).toString("utf8");
    expect(restored).toBe("bootstrap;" + script);
  });
});
