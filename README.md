# ClassFlow Desktop

大学生课表与作业 DDL 学习管理系统 — Windows 桌面版（Electron）

> 基于 Electron 43 + React 18 + TypeScript，`app/api` 已托管至 Electron 主进程本地 HTTP 服务（`src/main/httpServer.ts`），不再依赖 Next.js 运行时。

## 技术栈

- Electron 43.3.0 / electron-vite 2.3.0 / electron-builder 24.13.3
- React 18 / TypeScript 5.5 / Vite 5.4 / Vitest 4.1
- Zustand / Tailwind CSS / recharts / pdfjs-dist / docx / node-pty

## 环境要求

- Node `>=22.12 <23`（`engines` 限定）
- npm `10.9.8`（`packageManager` 字段，CI 显式 `npm install -g npm@10.9.8`）

## 快速开始

```sh
npm ci
npm run dev        # electron-vite dev，renderer http://localhost:5173，main out/
npm run build      # electron-vite build → out/
npm run typecheck  # tsc --noEmit（node + web 双配置）
npm test           # vitest run（全量 4292+ 用例）
npm run security:secrets  # 源码 secret 扫描
npm run verify:preload-artifact  # 校验 out/preload/index.cjs 为 CJS 且含 contextBridge
```

### 打包（Windows）

```sh
npm run pack:win   # electron-vite build && electron-builder --win nsis → dist/ClassFlow-Setup-<version>.exe
```

> **未签名说明**：当前 `electron-builder.yml` 设为 `signAndEditExecutable: false`，产出为未签名预览版，安装时 Windows SmartScreen 会提示“未知发布者”。正式分发需配置代码签名（`CSC_LINK` / `CSC_KEY_PASSWORD` 或 AzureSignTool）并移除该开关；`scripts/afterPack.cjs` 仍会在 `winCodeSign` 缓存可用时通过 `rcedit` 写入图标与版本信息（版本取自 `package.json`）。

## 环境变量

见 `.env.example`：

```
TAVILY_API_KEY=            # 可选：Kiro 联网搜索的 Tavily 增强凭据
# KIRO_TAVILY_API_KEY=     # 兼容别名，KIRO_ 前缀优先
# CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH=1  # 可选：禁用免 Key 基础搜索（企业/隐私场景）
```

- **不配置 `TAVILY_API_KEY` 也能联网搜索**：Kiro 默认使用官方 hosted MCP（Exa / Parallel）免 Key 基础搜索；Tavily 仅作为可选的增强通道（更高额度/更稳定的中文结果）。
- 用户自己的 Tavily Key 通过桌面 `SecretVault` 加密保存（Renderer 只持有 `credentialRef`，不读取明文）；首次实际联网搜索后会显示一次性隐私提示。
- 基础搜索只把搜索关键词发送给当前使用的第三方搜索服务（Exa / Parallel；配置 Tavily 时为 Tavily）；不发送对话全文、文件或本地数据。用户可在 Settings 或 Composer 关闭联网搜索。
- QQ / 邮件 remote-channel 也允许联网搜索，但额度收紧为每轮 1 次搜索 / 1 次读取，写入类工具仍被 invocation allowlist 拒绝。
- 真实 `TAVILY_API_KEY` / `GOOGLE_OAUTH` 等凭据**严禁**写入源码或 `.env.production`，仅通过系统环境变量或桌面端 `SecretVault`（`bridge:credential:*`）注入。
- `process.env.NEXT_PUBLIC_APP_VERSION` 仍沿用 Next 前缀，仅为兼容 `lib/version.ts`，构建时由 `electron.vite.config.ts` 从 `package.json` 注入。

## 规范验证（CI 唯一口径）

与 `.github/workflows/ci.yml` 保持一致（`windows-latest`）：

```sh
npm ci
npm run security:secrets
npm run typecheck
npm test
npm run build
npm run verify:preload-artifact
```

## 目录结构

```
src/main/        # Electron 主进程（窗口、协议、IPC、channels/mcp/skills/secrets）
src/preload/     # contextBridge 暴露（filesystem/terminal/credentials/skills/mcp/channels/inbox/api）
src/renderer/    # 渲染进程入口（TitleBar + app/page 挂载）
app/api/         # 复用为纯 handler 库，由 src/main/httpServer.ts 注册（不依赖 next/server）
components/      # React 组件（Kiro、时间线、课程、设置等）
lib/             # 业务库（schedule、history、ai、security 等）
store/           # Zustand stores（useAppStore 等）
tests/           # Vitest 用例（352 文件）
scripts/         # afterPack、check-secrets、docx-compat 等
build/           # 打包资源（icon.ico）
```

## 安全要点

- 主进程为本地 API 能力（`x-classflow-capability`）的唯一持有者，通过 `session.webRequest` 注入，Renderer 闭包保存不暴露。
- 所有 `bridge:*` / `window:*` IPC 均经 `validateIpcSender` 校验；外部导航由 `decideNavigation` 统一裁定。
- `SecretVault` fail-closed（`safeStorage` 不可用时拒绝持久化）。
- `SKILL_IMPORT_PATH` 已移除，技能导入统一走原生目录选择器，避免任意路径拷贝绕过 `fs grant` 模型。

## 生产 First Run

空工作区（无 demo 数据）为生产首帧状态；`lib/mockData.ts` / `lib/dev/fullDemoData.ts` 仅测试/设置页手动注入使用。

## 许可与字体

`public/fonts/*` 见各自 `README.md`（含 HarmonyOS Sans 等授权说明）。
