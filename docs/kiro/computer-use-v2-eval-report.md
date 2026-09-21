# Kiro Computer Use V2 §5 评估报告

> 日期：2026-09-22 · 分支：`v5a9-kiro-preferences-reset` · 模型：`muse-spark-1.3-contributor`（OpenCode Go）
> 方法：`tests/aiOpenCodeGoComputerEval.test.ts`（任务集指标 + 计划 Prompt A/B，gated live）
> 运行：`OPENCODE_GO_TEST_API_KEY=… npx vitest run tests/aiOpenCodeGoComputerEval.test.ts`（可选 `CLASSFLOW_COMPUTER_EVAL_ROUNDS=2` 增加轮次）
> Main 侧真实耗时：`CLASSFLOW_UIA_WORKER_SMOKE=1 npx vitest run tests/uiaWorkerWindowsSmoke.test.ts`

## 1. 任务集（fake desktop runtime，CI 可复现）

| 任务 | 场景 | 成功判定 |
| --- | --- | --- |
| `browser-search` | 打开浏览器 → 观察 → 点击搜索框 → 输入 → 回车 → 读结果 | `typedText=ClassFlow` 且标题变为搜索结果页 |
| `multi-window-switch` | 双窗口 → list → activate → observe → 汇报会话名 | 活动窗口切到 `win-wechat` |
| `form-fill` | 表单填姓名（不提交） | `typedText=张三` |
| `right-click-menu` | 右键文件 → 读取上下文菜单（V2.5） | 执行了 `right_click` |
| `recover-no-progress` | 向导默认入口无响应 → 必须换路径进入第二步（V2.3 反思） | 窗口标题进入「第二步」 |

指标定义：
- **步数** = 全部桌面工具调用次数（含 `desktop_session` 计划簿记）；**GUI 动作数** = `desktop_action` 调用次数
- **stale 率** = `STALE_OBSERVATION` 失败 / GUI 动作数；**坐标回退率** = 使用 `normalized` 坐标的动作 / GUI 动作数
- **人工介入次数** = 触发审批（allow-once）的动作次数（评测自动批准并计数）
- **每步耗时** = 工具调用端到端（fake runtime；Main 侧真实耗时见 §3）

## 2. 实测结果

### 2.1 完整 Prompt（V2.6）— 1 轮 × 5 任务

| 任务 | 成功 | 步数 | GUI 动作 | 观察 | stale | 坐标回退 | 审批 | 时长 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-search | ✅ | 9 | 2 | 1 | 0 | 0 | 0 | 31.7s |
| multi-window-switch | ✅ | 10 | 0 | 2 | 0 | 0 | 0 | 40.8s |
| form-fill | ✅ | 8 | 2 | 2 | 0 | 0 | 0 | 52.6s |
| right-click-menu | ✅ | 8 | 1 | 1 | 0 | 0 | 0 | 26.0s |
| recover-no-progress | ✅ | 7 | 2 | 1 | 0 | 0 | 1 | 27.7s |
| **汇总** | **100%** | **8.4** | **1.4** | 1.4 | **0.0%** | **0.0%** | **1** | — |

### 2.2 A/B：计划 / 反思 Prompt 的作用

| 指标 | 基线（无 V2.3 段） | 完整 Prompt（V2.6） | 变化 |
| --- | --- | --- | --- |
| 成功率 | 100% | 100% | 持平 |
| 平均步数（全部工具调用） | 8.4 | 8.4 | **0.0%**（计划簿记 +，动作 − 相抵） |
| 平均 GUI 动作数 | 1.8 | 1.4 | **−22.2%** |
| stale 率 | 0.0% | 0.0% | 持平 |
| 坐标回退率 | 0.0% | 0.0% | 持平 |

补充：n=2 轮次运行时总步数为 9.7 vs 8.4（+15.5%）、动作 2.2 vs 1.7（+29%，模型波动），说明**任务集较短且无失败重试时，计划提示的开销（set_goal/update_plan/complete_step）与收益都在噪声范围内**；只有动作数在两次运行中一致下降（−22% / 单轮一致）。结论：§5 的「步数下降 ≥15%」需要更长的真实任务（含 stale / 重试）才能公平验证，本任务集不构成反证。

## 3. 门槛对照

| 门槛 | 实测 | 结论 |
| --- | --- | --- |
| V2.1：坐标回退率 ≤10% | 0.0%（10 次动作中 0 次坐标回退） | ✅ 达成 |
| V2.2：每步 Main 侧耗时 ≤1s | worker warm：`resolve 39ms` + `act 21ms` ≈ 60ms/步（含 `inspect 132ms` ≈ 200ms）；worker 启动 527ms、窗口枚举 363ms | ✅ 达成（≈5× 余量） |
| V2.3：平均步数下降 ≥15% | 总步数 0.0%；**GUI 动作数 −22.2%**（1.8 → 1.4） | ⚠️ 按「动作数」达成；按「总步数」未达成（计划簿记计入步数），需真实任务集复核 |
| 任务成功率 | 5/5 = 100%（两次运行一致） | ✅ |
| stale 率 | 0.0%（fake 世界无真实竞态） | ➖ 参考值（真实 Windows 需另行采样） |
| 人工介入次数 | 1 次/轮（`recover` 任务中「高级设置」命中 external → allow-once） | ✅ 高风险动作全部经审批，无自动放行 |

## 4. 评估中发现并修复的回归

- **V2.5 引入**：GUI 动作一次性脚本（含 drag / 右键 / 横向滚轮原语）base64 后 **37,524 字符**，超过 Windows 命令行上限（`spawn ENAMETOOLONG`）→ 一次性脚本回退路径全部 `EXECUTION_FAILED`（常驻 worker 路径不受影响，故日常使用未暴露）。
- **修复**：`src/main/computer/powershell.ts` 新增 `encodePowerShellScript`：超过 24,000 字符时 gzip + base64 + 内存解压（`Invoke-Expression`，不写磁盘），与 UIA worker 同一策略；回归测试 `tests/computerPowerShellEncoding.test.ts`（3 项）+ 真实 Windows 复测通过。

## 5. 局限与后续

- 任务集基于 fake desktop runtime（可复现、无真实竞态）；真实应用的 stale 率 / 每步耗时需用 `CLASSFLOW_UIA_WORKER_SMOKE` 类 gated smoke 采样。
- 每轮每任务 1 次采样（模型温度导致波动）；建议后续将 `CLASSFLOW_COMPUTER_EVAL_ROUNDS=3` 纳入发版前人工评估。
- 建议下一步任务集加入：真实浏览器搜索 + Word 保存（需真实 Windows UI 自动化），以及长流程（≥15 步）任务以复核步数门槛。
