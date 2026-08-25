# 字体与许可（Typography V1 Closure）

ClassFlow Typography V1 涉及三款中文字体，授权与分发策略如下。About 设置中提供此说明的入口，许可文本不塞入普通主 UI。

## HarmonyOS Sans SC — 默认（bundled）

- 来源：华为 / OpenHarmony 官方发布的原始字体（`openharmony/resources`）
- 上游：`https://github.com/openharmony/resources` `fonts/` 目录，`master` 分支
- upstream commit：`9c3252997df79002beb67c13903755651215f9cd`（HEAD at download）
- 版权：Huawei Device Co., Ltd.
- 许可：`HarmonyOS_Sans_LICENSE.txt`（`LICENSE_Fonts` 原文） + `HarmonyOS_Sans_LICENSE_NOTICE.txt`（ClassFlow NOTICE）
- 下载日期：2026-08-25
- 本地文件：
  | 文件 | 大小 | SHA-256 |
  |---|---|---|
  | `HarmonyOS_Sans_SC_Regular.ttf` | 8261060 | `2DEABF97EAF17958DC24746B922779D9913008526DAF1C853903547505A8F9CA` |
  | `HarmonyOS_Sans_SC_Medium.ttf` | 8227216 | `564B0D89943402E4B90FE764BC5726FEE12DDBD7D4F681F5150B5B8271E685E8` |
  | `HarmonyOS_Sans_SC_Bold.ttf` | 8158924 | `9AA37F5EDD6BF15AF8B8B1655B8455753CD61ABAF5D53454D4966261923B6C61` |
- 策略：仅官方原始 TTF，不转换 woff2/subset/重命名；内部 family `ClassFlow HarmonyOS Sans SC` 优先 bundled URL（`src: url(...)`），系统安装版仅作 `--font-ui` fallback；600 映射至 Medium 避免 Bold 过粗与合成

## Source Han Sans SC / 思源黑体（bundled）

- 来源：Adobe 官方 `adobe-fonts/source-han-sans`
- 上游：`https://github.com/adobe-fonts/source-han-sans` `release` 分支
- upstream commit：`a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`（release branch tip）
- 许可：SIL Open Font License 1.1（`OFL.txt`，来自 `master/LICENSE.txt` 原文，4463 字节）
- 下载日期：2026-08-25
- 本地文件：
  | 文件 | 路径 | 大小 | SHA-256 |
  |---|---|---|---|
  | `SourceHanSansSC-VF.ttf.woff2` | `Variable/WOFF2/TTF/SourceHanSansSC-VF.ttf.woff2` | 14129688 | `CFEC773CDC2EA964DE8713471C6FD20774BC40617F5567F92EFEECCACA6604B0` |
  | 字体 weight 轴 | `wght` 250–900（fvar metadata，default 250） |
  | CSS 声明 | `@font-face weight 250 900, format("woff2")` |
- 策略：仅下载 SC 单文件 Variable WOFF2（非 848MB 全 archive），文件名保留官方 `SourceHanSansSC-VF.ttf.woff2`，内部 family `ClassFlow Source Han Sans SC`，单文件覆盖 250–900 连续权重

## MiSans（local-only，不 bundled）

- 版权与商标：小米（Xiaomi）
- 许可：MiSans 官方许可禁止再分发字体软件副本
- 策略：
  - **不将 MiSans 字体文件提交进 repo / installer**（仓库与产物中无二进制）
  - **不自动从网络下载 MiSans**
  - 仅 CSS `local("MiSans")` → `HarmonyOS bundled` fallback
  - 未安装时自动回退，偏好保留 `misan`，安装重启即生效
  - Settings 显示 `MiSans（需本机安装）`
  - About 中明确不分发
- 验证：`public/fonts` 下无 `*misan*.woff2|ttf|otf`；`out/` 与 installer 均不含 MiSans

---

## 文件清单（最终）

```
public/fonts/
  harmonyos-sans-sc/
    HarmonyOS_Sans_SC_Regular.ttf  (400, 8261060, bundled)
    HarmonyOS_Sans_SC_Medium.ttf   (500/600, 8227216, bundled)
    HarmonyOS_Sans_SC_Bold.ttf     (700, 8158924, bundled)
  source-han-sans-sc/
    SourceHanSansSC-VF.ttf.woff2   (250–900 Variable, 14129688, bundled)
  licenses/
    HarmonyOS_Sans_LICENSE.txt     (官方 LICENSE_Fonts 原文, 3352)
    HarmonyOS_Sans_LICENSE_NOTICE.txt (ClassFlow NOTICE)
    OFL.txt                        (SIL OFL 1.1, 4463)
    MiSans_NOTICE.txt
    README.md                      (本文件)
```

## Bundle 验证

- `npm run build` 后 `out/renderer/fonts/harmonyos-sans-sc/` 与 `out/renderer/fonts/source-han-sans-sc/` 必须包含上述文件（`electron-vite publicDir` 自动拷贝，无需 extraResources）
- `npm run pack:win` 后的 installer / `app.asar` 内同样包含；业务验证以 `out/` 为准，仅当缺失时才增 `electron-builder` 配置
