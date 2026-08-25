# HarmonyOS Sans SC — Bundled Font Placeholder

请将 Huawei / OpenHarmony 官方发布的原始 HarmonyOS Sans SC 字体文件置于此目录。

约束（Typography V1）：
- 只允许使用官方原始文件（不使用 GitHub 第三方转换版、非官方 woff/woff2、不自行修改/subset/convert）
- 优先使用官方 variable font（若官方发行包确实提供并适合 Chromium）
- 否则保留 UI 实际需要的 Regular / Medium / Bold 原始文件
- 保留官方 license / copyright notice（见 `../licenses/HarmonyOS_Sans_LICENSE_NOTICE.txt`）

期望文件名（CSS 已引用，未放置时静默回退，不会导致空白）：
- `HarmonyOS_Sans_SC_Regular.woff2` / `.ttf`
- `HarmonyOS_Sans_SC_Medium.woff2` / `.ttf`
- `HarmonyOS_Sans_SC_Bold.woff2` / `.ttf`
- `HarmonyOS_Sans_SC_Variable.woff2`（若官方提供 variable）

构建：`public/fonts/` 为 electron-vite `publicDir`，会自动拷贝至渲染产物。
