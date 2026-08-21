import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { configureRuntimeProfile } from "@/src/main/runtimeProfile";

const APP_DATA = join("runtime-root", "app-data");

describe("runtimeProfile wiring", () => {
  it("packaged configure does not call setPath or ensureDirectory", () => {
    const getPath = vi.fn(() => APP_DATA);
    const setPath = vi.fn();
    const ensureDirectory = vi.fn();

    const decision = configureRuntimeProfile(
      { isPackaged: true, getPath, setPath } as never,
      { hasDevRendererUrl: false, ensureDirectory }
    );

    expect(decision.profile).toBe("packaged");
    expect(decision.userDataOverride).toBeNull();
    expect(setPath).not.toHaveBeenCalled();
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(getPath).toHaveBeenCalledWith("appData");
  });

  it("dev configure ensures directory before setPath in order", () => {
    const getPath = vi.fn(() => APP_DATA);
    const setPath = vi.fn();
    const order: string[] = [];
    const ensureDirectory = vi.fn(() => order.push("ensure"));
    const origSetPath = setPath;
    setPath.mockImplementation(() => order.push("setPath"));

    const decision = configureRuntimeProfile(
      { isPackaged: false, getPath, setPath } as never,
      { hasDevRendererUrl: true, ensureDirectory }
    );

    expect(decision.profile).toBe("dev");
    expect(ensureDirectory).toHaveBeenCalledTimes(1);
    expect(ensureDirectory).toHaveBeenCalledWith(join(APP_DATA, "classflow-desktop"));
    expect(setPath).toHaveBeenCalledTimes(1);
    expect(setPath).toHaveBeenCalledWith("userData", join(APP_DATA, "classflow-desktop"));
    expect(order).toEqual(["ensure", "setPath"]);
  });

  it("preview configure ensures directory before setPath in order", () => {
    const getPath = vi.fn(() => APP_DATA);
    const setPath = vi.fn();
    const order: string[] = [];
    const ensureDirectory = vi.fn(() => order.push("ensure"));
    setPath.mockImplementation(() => order.push("setPath"));

    const decision = configureRuntimeProfile(
      { isPackaged: false, getPath, setPath } as never,
      { hasDevRendererUrl: false, ensureDirectory }
    );

    expect(decision.profile).toBe("preview");
    expect(ensureDirectory).toHaveBeenCalledWith(join(APP_DATA, "classflow-desktop-preview"));
    expect(order).toEqual(["ensure", "setPath"]);
  });

  it("production Main wiring calls configureRuntimeProfile before whenReady", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain("configureRuntimeProfile");
    expect(src).toContain("getRuntimeProfileDiagnostic");
    const idxConfigureCall = src.indexOf("configureRuntimeProfile(app");
    const idxWhenReady = src.indexOf("app.whenReady");
    expect(idxConfigureCall).toBeGreaterThan(-1);
    expect(idxWhenReady).toBeGreaterThan(-1);
    expect(idxConfigureCall).toBeLessThan(idxWhenReady);
    // Ensure it logs diagnostic without leaking path
    expect(src).toContain("runtime profile=");
    expect(src).toContain("userDataPolicy=");
    // Ensure protocol.registerSchemesAsPrivileged stays before configure call
    const idxProtocol = src.indexOf("registerSchemesAsPrivileged");
    expect(idxProtocol).toBeGreaterThan(-1);
    expect(idxProtocol).toBeLessThan(idxConfigureCall);
  });

  it("runtime profile module does not contain migration/copy logic", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/runtimeProfile.ts"), "utf8");
    expect(src).not.toMatch(/copyFile|cpSync|copyFileSync|cp\(|migrate|fallbackUserData|legacyVault|productionUserData/);
    const mainSrc = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(mainSrc).not.toMatch(/copyFile|migrateVault|fallbackUserData/);
  });

  it("diagnostic never leaks absolute path", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/runtimeProfile.ts"), "utf8");
    // Ensure diagnostic function only returns profile and policy
    expect(src).toContain("getRuntimeProfileDiagnostic");
    // Isolate diagnostic function body only (up to next export)
    const start = src.indexOf("export function getRuntimeProfileDiagnostic");
    const end = src.indexOf("export function configureRuntimeProfile", start);
    const diagBlock = end === -1 ? src.slice(start) : src.slice(start, end);
    expect(diagBlock).not.toContain("userDataOverride");
    expect(diagBlock).not.toContain("appDataPath");
  });
});
