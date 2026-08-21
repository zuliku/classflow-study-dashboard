import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type RuntimeProfile = "packaged" | "dev" | "preview";

export type RuntimeUserDataPolicy = "electron-default" | "isolated-dev" | "isolated-preview";

export interface RuntimeProfileDecision {
  profile: RuntimeProfile;
  userDataPolicy: RuntimeUserDataPolicy;
  userDataOverride: string | null;
}

export interface RuntimeProfileInput {
  isPackaged: boolean;
  hasDevRendererUrl: boolean;
  appDataPath: string;
}

export interface RuntimeProfileApp {
  isPackaged: boolean;
  getPath(name: "appData"): string;
  setPath(name: "userData", path: string): void;
}

export function resolveRuntimeProfile(input: RuntimeProfileInput): RuntimeProfileDecision {
  if (input.isPackaged) {
    return {
      profile: "packaged",
      userDataPolicy: "electron-default",
      userDataOverride: null,
    };
  }
  if (input.hasDevRendererUrl) {
    return {
      profile: "dev",
      userDataPolicy: "isolated-dev",
      userDataOverride: join(input.appDataPath, "classflow-desktop"),
    };
  }
  return {
    profile: "preview",
    userDataPolicy: "isolated-preview",
    userDataOverride: join(input.appDataPath, "classflow-desktop-preview"),
  };
}

export function getRuntimeProfileDiagnostic(decision: RuntimeProfileDecision): {
  profile: RuntimeProfile;
  userDataPolicy: RuntimeUserDataPolicy;
} {
  return {
    profile: decision.profile,
    userDataPolicy: decision.userDataPolicy,
  };
}

export function configureRuntimeProfile(
  app: RuntimeProfileApp,
  opts: { hasDevRendererUrl: boolean; ensureDirectory?: (path: string) => void }
): RuntimeProfileDecision {
  const appDataPath = app.getPath("appData");
  const decision = resolveRuntimeProfile({
    isPackaged: app.isPackaged,
    hasDevRendererUrl: opts.hasDevRendererUrl,
    appDataPath,
  });

  if (decision.userDataOverride) {
    const ensure = opts.ensureDirectory ?? ((p: string) => mkdirSync(p, { recursive: true }));
    ensure(decision.userDataOverride);
    app.setPath("userData", decision.userDataOverride);
  }

  return decision;
}
