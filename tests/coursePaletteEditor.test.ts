import { describe, expect, it } from "vitest";
import {
  CURATED_COLOR_PRESETS,
  MAX_COURSE_PALETTE_SIZE,
  MIN_COURSE_PALETTE_SIZE,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  isValidHex,
  normalizeHex,
  paletteIncludes,
  rgbToHex,
  rgbToHsv,
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

describe("自绘取色器 HSV 工具", () => {
  it("hexToRgb / rgbToHex 互逆", () => {
    expect(hexToRgb("#A8E6CF")).toEqual({ r: 168, g: 230, b: 207 });
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(rgbToHex(168, 230, 207)).toBe("#A8E6CF");
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("hsvToHex 基准色", () => {
    expect(hsvToHex(0, 100, 100)).toBe("#FF0000");
    expect(hsvToHex(120, 100, 100)).toBe("#00FF00");
    expect(hsvToHex(240, 100, 100)).toBe("#0000FF");
    expect(hsvToHex(0, 0, 0)).toBe("#000000");
    expect(hsvToHex(0, 0, 100)).toBe("#FFFFFF");
    expect(hsvToHex(360, 100, 100)).toBe("#FF0000");
  });

  it("rgbToHsv 灰色与纯色", () => {
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv(255, 255, 255)).toEqual({ h: 0, s: 0, v: 100 });
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 100, v: 100 });
  });

  it("预设色往返误差在 2 以内（整数度数取整）", () => {
    for (const hex of CURATED_COLOR_PRESETS) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      const back = hsvToRgb(hsv!.h, hsv!.s, hsv!.v);
      const orig = hexToRgb(hex)!;
      expect(Math.abs(back.r - orig.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - orig.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - orig.b)).toBeLessThanOrEqual(2);
    }
  });
});
