# ClassFlow 开发约定

## 提交与推送（2026-08-15 起）

- **任务完成后默认 `git push`**（推送到 `origin/main`），无需用户每次提醒。
- 推送前检查 `git status` / `git diff`，只提交本任务相关的文件，不提交 secrets。
- 提交信息遵循仓库风格（`feat(...)` / `fix(...)` / `test(...)` 前缀 + 中文描述）。

## 本地预览 dev server 常驻

- **`npm run dev` 保持常驻运行**（http://localhost:3000，当前 PID 见任务记录）。
  它独立于 opencode 进程启动，**opencode 关闭后不会自动停止**。
- 用户会在需要时手动关闭本地预览；**不要在本会话/任务结束时杀掉 dev server**。
- 验证命令：`Get-NetTCPConnection -LocalPort 3000 -State Listen`
- dev server 日志：`C:\Users\ye\AppData\Local\Temp\opencode\classflow-dev.log`

## `npm run build` 不再默认执行（2026-08-15 起）

本机 Node v24 下 `next build`（Next 14.2.35）在「Collecting page data」阶段崩溃（`_document` / API route
require-hook 竞态，Node 20 下则 jsdom/undici 与 Node 版本不兼容）——属于环境问题，非代码问题。
**今后任务默认跳过 `npm run build`**，验证以 `npm run typecheck` + dev server 人工 smoke 为准。

若确实需要跑 build，仍按安全流程（与 dev server 共用 `.next`）：

1. 停 dev server（按 PID kill node 进程）
2. `npm run build`（失败属预期环境问题，不修代码）
3. 删除 `.next`
4. 重新启动 dev server（Start-Process，hidden window）
5. 验证 http://localhost:3000 返回 200

## 测试策略（Settings V2 起）

- 开发阶段只跑受影响测试：`npx vitest run <files>` / `npx playwright test <spec>`
- 不默认跑全量 `npm test` / `npm run test:e2e` / `npm run build`
- 常规验证 = `npm run typecheck` + dev server 人工 smoke（build 见上方约定）
- 仅当修改公共核心基础设施（如 store 初始态、导航模型、全部 E2E fixture）且影响范围无法判断时，才跑全量
- 依赖演示数据的 E2E 使用 `tests/e2e/demoFixtures.ts` 的 `test`（自动 seed 空 localStorage）；不依赖演示数据的 spec（如 first-run）用原生 `@playwright/test`
- 生产 First Run 状态 = 空工作区（无 demo 数据）；`lib/mockData.ts` 仅测试使用
