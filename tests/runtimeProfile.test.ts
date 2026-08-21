import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  configureRuntimeProfile,
  getRuntimeProfileDiagnostic,
  resolveRuntimeProfile,
} from "@/src/main/runtimeProfile";

const APP_DATA = join("runtime-root", "app-data");

describe("runtimeProfile", () => {
  it("packaged keeps Electron production userData untouched", () => {
    const decision = resolveRuntimeProfile({
      isPackaged: true,
      hasDevRendererUrl: false,
      appDataPath: APP_DATA,
    });

    expect(decision).toEqual({
      profile: "packaged",
      userDataPolicy: "electron-default",
      userDataOverride: null,
    });
  });

  it("dev uses an isolated path while preserving the existing development directory", () => {
    const decision = resolveRuntimeProfile({
      isPackaged: false,
      hasDevRendererUrl: true,
      appDataPath: APP_DATA,
    });

    expect(decision.profile).toBe("dev");
    expect(decision.userDataPolicy).toBe("isolated-dev");
    expect(decision.userDataOverride).toBe(join(APP_DATA, "classflow-desktop"));
  });

  it("preview uses its own userData directory", () => {
    const decision = resolveRuntimeProfile({
      isPackaged: false,
      hasDevRendererUrl: false,
      appDataPath: APP_DATA,
    });

    expect(decision.profile).toBe("preview");
    expect(decision.userDataPolicy).toBe("isolated-preview");
    expect(decision.userDataOverride).toBe(join(APP_DATA, "classflow-desktop-preview"));
  });

  it("dev and preview never share a userData leaf", () => {
    const dev = resolveRuntimeProfile({ isPackaged: false, hasDevRendererUrl: true, appDataPath: APP_DATA });
    const preview = resolveRuntimeProfile({ isPackaged: false, hasDevRendererUrl: false, appDataPath: APP_DATA });

    expect(dev.userDataOverride).not.toBe(preview.userDataOverride);
    expect(basename(dev.userDataOverride!)).toBe("classflow-desktop");
    expect(basename(preview.userDataOverride!)).toBe("classflow-desktop-preview");
  });

  it("configuration only selects the profile path and never reads or copies userData contents", () => {
    const getPath = vi.fn((name: string) => {
      if (name !== "appData") throw new Error(`unexpected getPath: ${name}`);
      return APP_DATA;
    });
    const setPath = vi.fn();

    const decision = configureRuntimeProfile(
      { isPackaged: false, getPath, setPath },
      { hasDevRendererUrl: false }
    );

    expect(getPath).toHaveBeenCalledTimes(1);
    expect(getPath).toHaveBeenCalledWith("appData");
    expect(setPath).toHaveBeenCalledOnce();
    expect(setPath).toHaveBeenCalledWith("userData", join(APP_DATA, "classflow-desktop-preview"));
    expect(decision.profile).toBe("preview");
  });

  it("diagnostics expose profile policy but never the filesystem path", () => {
    const decision = resolveRuntimeProfile({
      isPackaged: false,
      hasDevRendererUrl: false,
      appDataPath: APP_DATA,
    });
    const diagnostic = getRuntimeProfileDiagnostic(decision);
    const rendered = JSON.stringify(diagnostic);

    expect(diagnostic).toEqual({ profile: "preview", userDataPolicy: "isolated-preview" });
    expect(rendered).not.toContain(APP_DATA);
    expect(rendered).not.toContain("classflow-desktop-preview");
  });
});
