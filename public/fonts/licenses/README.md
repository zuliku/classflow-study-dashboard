# 字体与许可（Typography V1）

ClassFlow Typography V1 涉及三款中文字体，授权与分发策略如下。About 设置中提供此说明的入口，许可文本不塞入普通主 UI。

## HarmonyOS Sans SC — 默认

- 来源：华为 / OpenHarmony 官方发布的原始字体
- 版权：华为
- 策略：
  - 仅使用官方原始文件，不使用 GitHub 第三方转换版、非官方 woff/woff2、自行修改/subset/convert 的版本
  - 优先使用官方 Variable Font（若发行包提供且适合 Chromium）；否则保留 UI 实际需要的 Regular / Medium / Bold 原始文件
  - 随应用打包（bundled），内部 family 命名为 `ClassFlow HarmonyOS Sans SC` 以避免与系统同名字体冲突
- 许可：遵循华为发布的 HarmonyOS Sans 许可与版权声明（随字体文件分发时保留官方 license / copyright notice）

> 目录：`public/fonts/harmonyos-sans-sc/` — 请将官方原始字体文件置于此目录（如 `HarmonyOS_Sans_SC_Regular.woff2` 等）。未放置文件时，CSS 通过 `local("HarmonyOS Sans SC")` 与 system fallback 仍可正常显示，不会导致空白或报错。

## Source Han Sans SC / 思源黑体

- 来源：Adobe 官方 source-han-sans release
- 许可：SIL Open Font License 1.1
- 策略：
  - 优先使用 SC Variable OTF（减少多 weight 静态文件）
  - 保留 SIL OFL license 文本（`OFL.txt`）随包分发
  - 内部 family：`ClassFlow Source Han Sans SC`

> 目录：`public/fonts/source-han-sans-sc/` — 请将官方 Variable 字体置于此目录（如 `SourceHanSansSC-VF.woff2` / `.otf`）。OFL 文本见 `OFL.txt`。

## MiSans

- 版权与商标：小米（Xiaomi）
- 许可：MiSans 官方许可禁止再分发字体软件副本
- 策略（IMPORTANT）：
  - **不将 MiSans 字体文件提交进 repo / installer**
  - **不自动从网络下载 MiSans**
  - 仅通过 CSS `local("MiSans")` 引用用户本机已安装的 MiSans
  - 未安装时自动回退至 HarmonyOS Sans SC；偏好可保留为 `misan`，用户后续安装并重启即可生效
  - Settings 中显示为 `MiSans（需本机安装）`

---

## 占位说明

当前仓库未提交二进制字体文件（遵循上述再分发与许可约束）。构建产物在未放置字体文件时仍会通过 fallback 正常渲染；放置官方原始文件后，`app/globals.css` 的 `@font-face` 会自动生效，无需改代码。
