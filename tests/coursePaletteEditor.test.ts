import { describe, expect, it } from "vitest";
import {
  CURATED_COLOR_PRESETS,
  MAX_COURSE_PALETTE_SIZE,
  MIN_COURSE_PALETTE_SIZE,
  isValidHex,
  normalizeHex,
  paletteIncludes,
} from "@/lib/color";

describe("统一调色板颜色工具（无原生 picker）", () => {
  it("normalizeHex：大小写/缺# /3位宽容归一化，非法返回 null", () => {
    expect(normalizeHex("#a8e6cf")).toBe("#A8E6CF");
    expect(normalizeHex("A8E6CF")).toBe("#A8E6CF");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("  #FADCD9  ")).toBe("#FADCD9");
    expect(normalizeHex("#GGGGGG")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });

  it("isValidHex 与 paletteIncludes 大小写不敏感去重", () => {
    expect(isValidHex("#A8E6CF")).toBe(true);
    expect(isValidHex("#abc")).toBe(true);
    expect(isValidHex("not-a-color")).toBe(false);
    expect(paletteIncludes(["#FADCD9"], "#fadcd9")).toBe(true);
    expect(paletteIncludes(["#FADCD9"], "#A8E6CF")).toBe(false);
  });

  it("预设与上下限约束诚实（无“共 8 色”硬编码）", () => {
    expect(CURATED_COLOR_PRESETS.length).toBe(16);
    expect(new Set(CURATED_COLOR_PRESETS.map((c) => c.toUpperCase())).size).toBe(16);
    expect(MIN_COURSE_PALETTE_SIZE).toBe(1);
    expect(MAX_COURSE_PALETTE_SIZE).toBe(12);
  });
});
