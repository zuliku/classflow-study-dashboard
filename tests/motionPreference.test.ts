import { describe, expect, it } from "vitest";
import {
  readPersistedMotionPreference,
  readEffectiveMotionDataset,
  resolveEffectiveReducedMotion,
} from "@/lib/motionPreference";

describe("resolveEffectiveReducedMotion", () => {
  it.each([
    ["system", false, false],
    ["system", true, true],
    ["full", false, false],
    ["full", true, false],
    ["reduced", false, true],
    ["reduced", true, true],
  ] as const)("resolves %s preference with system reduced=%s to %s", (preference, systemReduced, expected) => {
    expect(resolveEffectiveReducedMotion(preference, systemReduced)).toBe(expected);
  });
});

describe("readPersistedMotionPreference", () => {
  it.each([
    [JSON.stringify({ state: { preferences: { motionPreference: "system" } } }), "system"],
    [JSON.stringify({ state: { preferences: { motionPreference: "full" } } }), "full"],
    [JSON.stringify({ state: { preferences: { motionPreference: "reduced" } } }), "reduced"],
    [null, "system"],
    [JSON.stringify({}), "system"],
    [JSON.stringify({ state: { preferences: {} } }), "system"],
    [JSON.stringify({ preferences: { motionPreference: "full" } }), "full"],
    [JSON.stringify({ state: { preferences: { motionPreference: "invalid" } } }), "system"],
    ["not-json", "system"],
  ] as const)("reads %j as %s", (raw, expected) => {
    expect(readPersistedMotionPreference(raw)).toBe(expected);
  });
});

describe("readEffectiveMotionDataset", () => {
  it("uses the pre-hydration dataset for the first client render", () => {
    expect(readEffectiveMotionDataset("reduced")).toBe(true);
    expect(readEffectiveMotionDataset("full")).toBe(false);
    expect(readEffectiveMotionDataset(undefined)).toBe(false);
  });
});
