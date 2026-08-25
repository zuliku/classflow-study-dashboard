# HarmonyOS Sans SC — Bundled

官方来源：`https://github.com/openharmony/resources` (`fonts/` 目录, `master` 分支)

已下载（2026-08-25，commit `9c3252997df79002beb67c13903755651215f9cd`）：

- `HarmonyOS_Sans_SC_Regular.ttf` (400) — 8261060 — SHA256 `2DEABF97EAF17958DC24746B922779D9913008526DAF1C853903547505A8F9CA`
- `HarmonyOS_Sans_SC_Medium.ttf` (500/600) — 8227216 — SHA256 `564B0D89943402E4B90FE764BC5726FEE12DDBD7D4F681F5150B5B8271E685E8`
- `HarmonyOS_Sans_SC_Bold.ttf` (700) — 8158924 — SHA256 `9AA37F5EDD6BF15AF8B8B1655B8455753CD61ABAF5D53454D4966261923B6C61`

许可：`../licenses/HarmonyOS_Sans_LICENSE.txt`（官方 `LICENSE_Fonts` 原文）与 `HarmonyOS_Sans_LICENSE_NOTICE.txt`

CSS：`app/globals.css` 使用 `ClassFlow HarmonyOS Sans SC` 内部 family，`src: url(...) format("truetype")` 优先 bundled，`--font-ui` fallback 链为 `"HarmonyOS Sans SC", "Microsoft YaHei UI"`。
600 的 `font-semibold` 显式映射至 Medium 避免合成粗体。

构建：`public/fonts` 为 `electron-vite publicDir`，自动拷贝至 `out/renderer/fonts/`，无需额外 electron-builder 配置。
