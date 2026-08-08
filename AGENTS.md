# ClassFlow 开发约定

## 本地预览 dev server 常驻

- **`npm run dev` 保持常驻运行**（http://localhost:3000，当前 PID 见任务记录）。
  它独立于 opencode 进程启动，**opencode 关闭后不会自动停止**。
- 用户会在需要时手动关闭本地预览；**不要在本会话/任务结束时杀掉 dev server**。
- 验证命令：`Get-NetTCPConnection -LocalPort 3000 -State Listen`
- dev server 日志：`C:\Users\ye\AppData\Local\Temp\opencode\classflow-dev.log`

## 需要 `npm run build` 时的安全流程

`next build` 与 `next dev` 共用 `.next` 目录，并行运行会破坏 dev server（页面加载正常但客户端交互失效）。
需要跑 build 时按以下顺序：

1. 停 dev server（按 PID kill node 进程）
2. `npm run build`
3. 删除 `.next`
4. 重新启动 dev server（Start-Process，hidden window）
5. 验证 http://localhost:3000 返回 200

## 测试策略（Settings V2 起）

- 开发阶段只跑受影响测试：`npx vitest run <files>` / `npx playwright test <spec>`
- 不默认跑全量 `npm test` / `npm run test:e2e` / `npm run build`
- 仅当修改公共核心基础设施（如 store 初始态、导航模型、全部 E2E fixture）且影响范围无法判断时，才跑全量
- 依赖演示数据的 E2E 使用 `tests/e2e/demoFixtures.ts` 的 `test`（自动 seed 空 localStorage）；不依赖演示数据的 spec（如 first-run）用原生 `@playwright/test`
- 生产 First Run 状态 = 空工作区（无 demo 数据）；`lib/mockData.ts` 仅测试使用
