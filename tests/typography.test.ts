import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  FONT_REGISTRY,
  UI_FONT_PRESETS,
  DEFAULT_UI_FONT,
  isUIFontPreset,
  normalizeUIFontPreset,
  UI_FONT_LABELS,
  cssFontUiValue,
} from "@/lib/typography/fonts";
import { DEFAULT_PREFERENCES, sanitizePreferences, PREFERENCE_SECTIONS } from "@/lib/preferences";

describe("Typography V1 — Font Registry (single source)", () => {
  it("DEFAULT_UI_FONT = harmonyos-sans-sc", () => {
    expect(DEFAULT_UI_FONT).toBe("harmonyos-sans-sc");
    expect(DEFAULT_PREFERENCES.uiFont).toBe("harmonyos-sans-sc");
  });

  it("UI_FONT_PRESETS contains exactly three items", () => {
    expect(UI_FONT_PRESETS).toEqual(["harmonyos-sans-sc", "source-han-sans-sc", "misan"]);
  });

  it("FONT_REGISTRY has all presets with required fields", () => {
    for (const id of UI_FONT_PRESETS) {
      const meta = FONT_REGISTRY[id];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(id);
      expect(meta.displayName).toBeTruthy();
      expect(meta.cssFamily).toBeTruthy();
      expect(meta.cssFallback).toBeTruthy();
      expect(meta.license).toBeTruthy();
      expect(meta.licenseDetail).toBeTruthy();
    }
  });

  it("HarmonyOS is bundled default, SourceHan bundled, MiSans local-only", () => {
    expect(FONT_REGISTRY["harmonyos-sans-sc"].bundled).toBe(true);
    expect(FONT_REGISTRY["source-han-sans-sc"].bundled).toBe(true);
    expect(FONT_REGISTRY["source-han-sans-sc"].secondaryName).toBe("Source Han Sans SC");
    expect(FONT_REGISTRY["misan"].bundled).toBe(false);
    expect(FONT_REGISTRY["misan"].localOnly).toBe(true);
  });

  it("MiSans fallback contains HarmonyOS", () => {
    expect(FONT_REGISTRY["misan"].cssFallback).toContain("HarmonyOS Sans SC");
    expect(FONT_REGISTRY["misan"].cssFallback).toContain("ClassFlow HarmonyOS Sans SC");
  });

  it("UI_FONT_LABELS matches spec", () => {
    expect(UI_FONT_LABELS["harmonyos-sans-sc"]).toBe("HarmonyOS Sans SC（默认）");
    expect(UI_FONT_LABELS["source-han-sans-sc"]).toBe("思源黑体 / Source Han Sans");
    expect(UI_FONT_LABELS["misan"]).toBe("MiSans（需本机安装）");
  });

  it("cssFontUiValue returns quoted family + fallback", () => {
    expect(cssFontUiValue("harmonyos-sans-sc")).toContain("ClassFlow HarmonyOS Sans SC");
    expect(cssFontUiValue("source-han-sans-sc")).toContain("ClassFlow Source Han Sans SC");
    expect(cssFontUiValue("misan")).toContain("MiSans");
  });

  it("isUIFontPreset / normalizeUIFontPreset whitelist", () => {
    expect(isUIFontPreset("harmonyos-sans-sc")).toBe(true);
    expect(isUIFontPreset("source-han-sans-sc")).toBe(true);
    expect(isUIFontPreset("misan")).toBe(true);
    expect(isUIFontPreset("comic-sans")).toBe(false);
    expect(isUIFontPreset("")).toBe(false);
    expect(normalizeUIFontPreset("comic-sans")).toBe("harmonyos-sans-sc");
    expect(normalizeUIFontPreset("misan")).toBe("misan");
    expect(normalizeUIFontPreset(undefined)).toBe("harmonyos-sans-sc");
  });

  it("PREFERENCE_SECTIONS.uiFont = general", () => {
    expect(PREFERENCE_SECTIONS.uiFont).toBe("general");
  });
});

describe("Typography V1 — sanitize / fallback", () => {
  it("sanitize keeps three legal values", () => {
    for (const v of UI_FONT_PRESETS) {
      expect(sanitizePreferences({ uiFont: v }).uiFont).toBe(v);
    }
  });
  it("illegal → harmonyos-sans-sc", () => {
    expect(sanitizePreferences({ uiFont: "comic-sans" }).uiFont).toBe("harmonyos-sans-sc");
  });
  it("missing → harmonyos-sans-sc", () => {
    expect(sanitizePreferences({}).uiFont).toBe("harmonyos-sans-sc");
  });
});

describe("Typography V1 — CSS tokens & ownership", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const html = readFileSync(resolve(process.cwd(), "src/renderer/index.html"), "utf8");

  it("globals.css defines --font-ui, --font-display, --font-mono", () => {
    expect(css).toContain("--font-ui");
    expect(css).toContain("--font-display");
    expect(css).toContain("--font-mono");
  });

  it("globals.css has @font-face for bundled fonts, not MiSans files", () => {
    expect(css).toContain('font-family: "ClassFlow HarmonyOS Sans SC"');
    expect(css).toContain('font-family: "ClassFlow Source Han Sans SC"');
    // MiSans must NOT have bundled @font-face with url(...MiSans...)
    expect(css).not.toMatch(/@font-face[^}]*MiSans[^}]*url\(/);
  });

  it("globals.css html[data-ui-font] variants use correct fallbacks", () => {
    expect(css).toContain('html[data-ui-font="harmonyos-sans-sc"]');
    expect(css).toContain('html[data-ui-font="source-han-sans-sc"]');
    expect(css).toContain('html[data-ui-font="misan"]');
    // misan must fallback to HarmonyOS
    const misanBlock = css.match(/html\[data-ui-font="misan"\][\s\S]*?--font-ui:[\s\S]*?}/);
    expect(misanBlock).toBeTruthy();
    expect(misanBlock![0]).toContain("MiSans");
    expect(misanBlock![0]).toContain("HarmonyOS Sans SC");
  });

  it("body uses var(--font-ui) and keeps -webkit-font-smoothing", () => {
    expect(css).toContain("font-family: var(--font-ui)");
    expect(css).toContain("-webkit-font-smoothing: antialiased");
  });

  it("mono / KaTeX ownership preserved", () => {
    expect(css).toContain("pre,");
    expect(css).toContain("code,");
    expect(css).toContain("var(--font-mono)");
    // KaTeX must keep its own font
    expect(css).toContain(".katex");
    expect(css).toContain("KaTeX_Main");
  });

  it("tabular-numeric utility exists and is not applied globally", () => {
    expect(css).toContain(".tabular-numeric");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    // should NOT have body { font-variant-numeric } globally
    const bodyBlock = css.match(/body\s*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(bodyBlock).not.toContain("tabular-nums");
  });

  it("font-weight 400/500/700 declared (Variable + static)", () => {
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-weight: 500");
    expect(css).toContain("font-weight: 700");
    expect(css).toContain("font-weight: 100 900");
  });

  it("index.html pre-paint whitelist is correct and sets dataset.uiFont", () => {
    // whitelist must be explicit in html script
    expect(html).toContain('"harmonyos-sans-sc"');
    expect(html).toContain('"source-han-sans-sc"');
    expect(html).toContain('"misan"');
    expect(html).toContain("dataset.uiFont");
    // default fallback
    expect(html).toContain('uiFont = "harmonyos-sans-sc"');
    // no separate localStorage key for font
    const storageMatches = html.match(/localStorage\.getItem\("([^"]+)"\)/g) ?? [];
    expect(storageMatches.every((s) => s === 'localStorage.getItem("classflow-storage-v2")')).toBe(true);
  });

  it("public/fonts licenses exist (no MiSans binary)", () => {
    const readme = readFileSync(resolve(process.cwd(), "public/fonts/licenses/README.md"), "utf8");
    expect(readme).toContain("HarmonyOS Sans");
    expect(readme).toContain("Source Han Sans");
    expect(readme).toContain("MiSans");
    expect(readme).toContain("不将 MiSans");
    // verify no MiSans font file committed
    const fontsRoot = resolve(process.cwd(), "public/fonts");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else out.push(p);
      }
      return out;
    };
    const all = walk(fontsRoot);
    const hasMiSansBinary = all.some((p) => /misan/i.test(p) && /\.(woff2?|ttf|otf)$/i.test(p));
    expect(hasMiSansBinary).toBe(false);
  });
});
