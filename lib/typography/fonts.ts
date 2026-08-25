import type { UIFontPreset } from "@/types";

/** 字体 metadata 单一来源 — 任何 UI / CSS / Runtime 不得各自硬编码映射 */
export interface FontMeta {
  id: UIFontPreset;
  displayName: string;
  secondaryName?: string;
  description: string;
  /** CSS 中使用的首选 family 名（@font-face 内部 family） */
  cssFamily: string;
  /** 系统回退家族（不含 cssFamily 本身） */
  cssFallback: string;
  /** 是否随应用打包 */
  bundled: boolean;
  /** 仅 local（本机已安装才可用） */
  localOnly?: boolean;
  /** 授权说明（About 中展示） */
  license: string;
  /** license 详情（可多行，About 展开查看） */
  licenseDetail: string;
  /** 权重声明（用于文档） */
  weights: string;
}

export const UI_FONT_PRESETS: readonly UIFontPreset[] = [
  "harmonyos-sans-sc",
  "source-han-sans-sc",
  "misan",
] as const;

export const DEFAULT_UI_FONT: UIFontPreset = "harmonyos-sans-sc";

export function isUIFontPreset(v: unknown): v is UIFontPreset {
  return (UI_FONT_PRESETS as readonly unknown[]).includes(v);
}

export function normalizeUIFontPreset(v: unknown): UIFontPreset {
  return isUIFontPreset(v) ? v : DEFAULT_UI_FONT;
}

/**
 * 字体注册表 — 唯一真值。
 * Bundled 字体使用内部 family "ClassFlow ..." 避免与系统同名字体命名冲突；
 * MiSans 仅 local("MiSans")，不打包，fallback 到 HarmonyOS。
 */
export const FONT_REGISTRY: Record<UIFontPreset, FontMeta> = {
  "harmonyos-sans-sc": {
    id: "harmonyos-sans-sc",
    displayName: "HarmonyOS Sans SC",
    description: "默认 · 现代中英文混排，视觉统一",
    cssFamily: "ClassFlow HarmonyOS Sans SC",
    cssFallback: `"HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif`,
    bundled: true,
    license: "HarmonyOS Sans — Huawei / OpenHarmony",
    licenseDetail:
      "HarmonyOS Sans SC 由华为提供，版权归华为所有。仅使用华为/ OpenHarmony 官方发布的原始字体文件，不修改、不自行转换。随应用分发的为官方原始文件，遵循其许可条款。",
    weights: "Variable 或 400 / 500 / 700（依官方发行包）",
  },
  "source-han-sans-sc": {
    id: "source-han-sans-sc",
    displayName: "思源黑体",
    secondaryName: "Source Han Sans SC",
    description: "Adobe 思源黑体 · 开源人文感",
    cssFamily: "ClassFlow Source Han Sans SC",
    cssFallback: `"Source Han Sans SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif`,
    bundled: true,
    license: "SIL Open Font License 1.1",
    licenseDetail:
      "Source Han Sans SC (思源黑体) 由 Adobe 提供，遵循 SIL Open Font License 1.1。可自由使用、分发与修改，需保留许可声明。随应用分发为 Adobe 官方发布版本。",
    weights: "Variable OTF，涵盖 400–700（font-weight 连续）",
  },
  misan: {
    id: "misan",
    displayName: "MiSans",
    description: "需本机安装 · 小米澎湃字体",
    cssFamily: "MiSans",
    cssFallback: `"ClassFlow HarmonyOS Sans SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif`,
    bundled: false,
    localOnly: true,
    license: "MiSans — Xiaomi（本地使用）",
    licenseDetail:
      "MiSans 由小米提供，许可禁止再分发字体文件。ClassFlow 不打包、不下载 MiSans；仅通过 local(\"MiSans\") 引用本机已安装字体。未安装时自动回退至 HarmonyOS Sans SC，偏好仍可保留为 misan，安装后重启即可生效。MiSans 商标与版权归小米所有。",
    weights: "跟随本机安装版本（建议 400/500/600）",
  },
};

/** 选择器文案 — Settings 唯一来源，不在组件内另写映射 */
export const UI_FONT_LABELS: Record<UIFontPreset, string> = {
  "harmonyos-sans-sc": "HarmonyOS Sans SC（默认）",
  "source-han-sans-sc": "思源黑体 / Source Han Sans",
  misan: "MiSans（需本机安装）",
};

/** html[data-ui-font] 的合法取值（pre-paint whitelist） */
export const UI_FONT_DATASET_VALUES = UI_FONT_PRESETS as readonly string[];

/** 给 CSS 使用的 --font-ui 声明（display 同 ui） */
export function cssFontUiValue(preset: UIFontPreset): string {
  const meta = FONT_REGISTRY[preset];
  return `"${meta.cssFamily}", ${meta.cssFallback}`;
}
