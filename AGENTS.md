# ClassFlow 开发约定

## 生产分支

- `master`（`origin/master` 已废弃，统一使用 `master`）

## 技术栈

- `Electron 43.3.0` + `electron-vite 2.3.0` + `React 18` + `TypeScript 5.5` + `Vite 5.4` + `Vitest 4.1`

## 提交与推送（2026-08-15 起）

- **任务完成后默认 `git push`**（推送到 `desktop/master` / `origin/master` 按仓库实际远端），无需用户每次提醒。
- 推送前检查 `git status` / `git diff`，只提交本任务相关的文件，不提交 secrets。
- 提交信息遵循仓库风格（`feat(...)` / `fix(...)` / `test(...)` 前缀 + 中文描述）。

## 本地预览 dev server 常驻

- **`npm run dev` 保持常驻运行**（`electron-vite dev`，renderer `http://localhost:5173`，main `out/`）。
  它独立于 opencode 进程启动，**opencode 关闭后不会自动停止**。
- 用户会在需要时手动关闭本地预览；**不要在本会话/任务结束时杀掉 dev server**。

## 规范验证（CI 唯一口径）

```sh
npm ci
npm run security:secrets
npm run typecheck
npm test
npm run build
```

- `npm ci` 为 clean reproducible gate（`package-lock.json` 必须与 `package.json` 同步，禁止 `--force`/`--legacy-peer-deps`/`npm install` 替代）
- `engines: node >=22.12 <23`，`packageManager: npm@10.9.8`（`npm install -g npm@10.9.8` 在 CI 显式固定）
- `npm run build` 为 `electron-vite build`（`out/`），非 `next build`，本地与 CI 均可稳定执行

## 测试策略（Settings V2 起）

- 开发阶段只跑受影响测试：`npx vitest run <files>` / `npx playwright test <spec>`
- 常规验证 = `npm run typecheck` + 受影响 `vitest` + `npm run build`（见上）
- 仅当修改公共核心基础设施（如 store 初始态、导航模型、全部 E2E fixture）且影响范围无法判断时，才跑全量
- 依赖演示数据的 E2E 使用 `tests/e2e/demoFixtures.ts` 的 `test`（自动 seed 空 localStorage）；不依赖演示数据的 spec（如 first-run）用原生 `@playwright/test`
- 生产 First Run 状态 = 空工作区（无 demo 数据）；`lib/mockData.ts` 仅测试使用
