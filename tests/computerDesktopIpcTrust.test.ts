// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateIpcSender } from "@/lib/security/ipcSender";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("Computer IPC — trusted sender validation", () => {
  it("非受信任 sender 无法调用 bridge:computer:observe", () => {
    const res = validateIpcSender("bridge:computer:observe", {
      destroyed: false,
      isTrustedWindow: false,
      url: "app://bundle/index.html",
    });
    expect(res.ok).toBe(false);
  });

  it("受信任 app:// renderer → 允许", () => {
    const res = validateIpcSender(
      "bridge:computer:observe",
      { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" },
      { allowedApiOrigin: "http://127.0.0.1:1234" }
    );
    expect(res.ok).toBe(true);
  });

  it("非信任 origin（https://evil.com）→ 拒绝", () => {
    const res = validateIpcSender("bridge:computer:capabilities", {
      destroyed: false,
      isTrustedWindow: true,
      url: "https://evil.com",
    });
    expect(res.ok).toBe(false);
  });

  it("sender destroyed → 拒绝", () => {
    const res = validateIpcSender("bridge:computer:observe", {
      destroyed: true,
      isTrustedWindow: true,
      url: "app://bundle/index.html",
    });
    expect(res.ok).toBe(false);
  });

  it("main ipc 注册使用 validateIpcSender + withValidation（结构化错误）", () => {
    const source = read("src/main/computer/ipc.ts");
    expect(source).toContain("validateIpcSender");
    expect(source).toContain("withValidation");
    expect(source).toContain("bridge:computer:observe");
    expect(source).toContain("bridge:computer:capabilities");
    expect(source).toContain("DesktopComputerIpcError");
  });

  it("main index 注册 Computer IPC", () => {
    const source = read("src/main/index.ts");
    expect(source).toContain("registerComputerIpc");
  });

  it("preload 只暴露结构化 computer API（capabilities / observe）", () => {
    const source = read("src/preload/index.ts");
    expect(source).toContain("bridge:computer:observe");
    expect(source).toContain("bridge:computer:capabilities");
    expect(source).toContain("computer: computerBridge");
    // 不暴露通用 IPC / native handle
    expect(source).not.toContain("computer: ipcRenderer");
    expect(source).not.toContain("hwnd");
    expect(source).not.toContain("pid:");
  });

  it("Observation Store 只存在内存（不 import fs / localStorage / indexedDB）", () => {
    const source = read("src/main/computer/observation.ts");
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("indexedDB");
    expect(source).toContain("DESKTOP_OBSERVATION_TTL_MS");
  });

  it("截图模块不写磁盘（无 fs write / mkdir）", () => {
    const source = read("src/main/computer/screenshot.ts");
    expect(source).not.toMatch(/node:fs/);
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("mkdir");
  });

  it("Phase 1 无 GUI 修改 API（input / clipboard / launch）", () => {
    const files = [
      "src/main/computer/ipc.ts",
      "src/main/computer/runtime.ts",
      "src/main/computer/observation.ts",
      "src/main/computer/windows.ts",
      "src/main/computer/uia.ts",
      "src/main/computer/screenshot.ts",
      "lib/ai/computer/desktop/observe.ts",
    ];
    for (const file of files) {
      const source = read(file).toLowerCase();
      for (const needle of ["sendinputevent", "robotjs", "mouse_event", "keybd_event", "clipboard.write", "child_process.exec("]) {
        expect(source, `${file} 不应包含 ${needle}`).not.toContain(needle);
      }
    }
  });
});
