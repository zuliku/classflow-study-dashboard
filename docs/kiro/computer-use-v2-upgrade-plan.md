# Kiro Computer Use V2 升级执行计划

> 状态：执行中
> 参考实现：Agent S / S2 / S3（ACI + 分层规划 + 经验记忆）、Microsoft UFO / UFO² / UFO³（UIA Control Automator + SoM + 双代理）、Claude Computer Use（截图→动作→验证循环）
> 约束：不重写现有 Computer Agent；Filesystem / Terminal / GUI 继续共用同一 Policy / Approval / Audit / Kiro 主循环

## 进度

- [x] **V2.1 Grounding & 确定性验证**（commit `8d7a9db`）
  - `find_desktop_element`（确定性检索）、vision 候选 ↔ UIA 元素 IoU 关联、`desktop_action.expect` 验证、自适应 settle、Prompt/描述更新；Live smoke 3/3
- [x] **V2.2 常驻 UIA Runtime**（性能）
  - `src/main/computer/uiaWorker.ts` + `uiaWorkerScript.ts` + `uiaWorkerClient.ts`：单进程 stdin/stdout JSON lines（ping/windows/inspect/resolve/act/activate）、RuntimeId 元素缓存（≤300）、超时/崩溃自动重启、空闲 5 分钟回收、启动失败回退一次性脚本（业务失败不重试）
  - `resolveUiElement` 依赖：action 目标校验走单元素解析（缓存命中），不再每次全树扫描
  - 实测（本机 Windows）：worker warm windows 437ms / inspect 121ms / resolve 40ms / act 24ms vs 一次性脚本 746 / 525 / 1681ms → 单步路径 ~0.5s vs ~2.7s（**≈80% 下降**，超过 ≥50% 目标）；启动成本 1.97s 一次性
  - App 退出 `disposeUiaWorker()`；gated 真实 Windows smoke：`CLASSFLOW_UIA_WORKER_SMOKE=1 npx vitest run tests/uiaWorkerWindowsSmoke.test.ts`
- [ ] V2.3 计划 / 反思 / Session 工件
- [ ] V2.4 应用画像与敏感应用策略
- [ ] V2.5 动作覆盖扩展
- [ ] V2.6 经验记忆（轨迹 → Skill）

---

## 1. 现状审查（代码事实）

### 1.1 已有能力

| 层 | 文件 | 现状 |
| --- | --- | --- |
| Observation | `src/main/computer/runtime.ts`、`windows.ts`、`uia.ts` | 窗口枚举（UIA + 前台 HWND）、BFS 控件树（150 元素 / 深度 6）、desktopCapturer JPEG、opaque windowId/elementId、短 TTL store（120s） |
| Action | `src/main/computer/guiAction.ts` | 单次 PowerShell 原子脚本：RuntimeId 重解析 → bounds 校验 → UIA Invoke/Select/SetValue → bounds click → 坐标回退；SendInput 键盘/滚轮；DPI aware |
| Session | `src/main/computer/session.ts` | 状态机 + Loop Guard（30 动作 / 60 观察 / 10 分钟 / repeated-action / no-progress） |
| Risk / Approval | `lib/ai/computer/gui/risk.ts`、`approval.ts`、`ComputerApprovalDialog.tsx` | normal/external/destructive/sensitive/blocked；高风险 allow-once；密码/密钥/clipboard/提权 blocked |
| App / Window | `apps.ts`、`windowTools.ts` | 逻辑应用名 allowlist（App Paths / PATH / Start Apps 解析）、list/activate/open |
| Vision fallback | `lib/ai/computer/gui/vision.ts` | UIA 空/canvas 时输出 candidate region/label/confidence（归一化坐标） |
| Loop | `hooks/useKiroChat.ts` | 每 Turn 冻结 snapshot；Stop → session cancel；observe→action→re-observe |

### 1.2 关键差距（按影响排序）

1. **Grounding 精度不足（最大瓶颈）**
   - 控件树是**纯文本**且被 150/深度 6 截断；深层/懒加载控件（浏览器内容区、Office Ribbon 深层）常拿不到 elementId，模型被迫用坐标回退（每次都要审批）。
   - vision fallback 只给「区域 + 标签」，**不与 UIA 元素做关联**；模型拿不到可操作的 elementId。
   - 对比：UFO² 用 SoM 编号控件列表（"从预定义列表选择" 显著优于模型自行定位）；Agent S 用「截图 + 增强 accessibility tree（OCR 补元素 + 元素整数 tag）」双输入。
2. **动作执行慢**：每个 action 需 3 次 PowerShell 冷启动（prepare 校验 1 次 + 执行 1 次 + 重新观察 1 次），实测 ~5–7s/步；10 步任务约 1 分钟。Agent S/UFO 均为常驻进程 + 单步毫秒级反馈。
3. **缺少显式计划与反思**：目前是「模型自由链式调用」，没有 plan 工件、没有 step 级 self-check；UFO² 有 Plan/Execute/Reflect，Agent S 有 Manager/Worker + Trajectory Reflector。
4. **验证靠 UI 指纹 + 模型自觉**：`uiSignature` 只能判断"有没有变化"，不能表达"应该出现什么"；缺少确定性 verification predicate。
5. **无应用画像**：等待策略固定 350ms settle；没有「窗口就绪 / 列表加载完成 / 弹窗出现」的按应用等待；敏感应用（密码管理器、银行、UAC）仅靠进程名 blocklist。
6. **动作覆盖有限**：无 hover / 右键菜单 / 横向滚动 / 拖拽 / 剪贴板 / 文件上传协议（部分为刻意限制，需按需开放并加门）。
7. **多显示器/DPI 边界**：截图回退主屏、窗口匹配靠标题；跨屏与混合 DPI 未验证。
8. **经验不可复用**：没有轨迹记忆；同类任务（如"给微信文件传输助手发文件"）每次从零探索。Agent S 的 episodic memory / OS-Copilot FRIDAY 的自我改进都指向"轨迹→技能"。

---

## 2. 参考设计要点（开源对照）

| 设计 | 出处 | 我们采纳什么 |
| --- | --- | --- |
| **ACI：有界动作空间 + 元素 ID** | Agent S（ICLR'25） | 保持（我们已有 elementId + 7 种 primitive）；不引入任意代码执行 |
| **双输入：截图看状态 + 树做 grounding** | Agent S | 目前只有树；V2 增加「视觉候选 ↔ UIA 元素 IoU 关联」 |
| **SoM 编号控件列表** | UFO² | 增加 `find_desktop_element`（语义检索 + 编号返回）与可选标注截图证据 |
| **UIA Control Automator** | UFO²（pywinauto/UIA） | 已有；V2 改为常驻 worker + 语义动作优先级不变 |
| **分层规划（Host/App 或 Manager/Worker）** | UFO² / Agent S | 不引入双代理；在 Session 增加 `goal/plan/step` 工件 + 模型每步可更新 plan |
| **Trajectory Reflector / reflection agent** | Agent S / UFO² | 每 N 步或 stale 时强制一次反思提示（self-check：上一步是否达成、是否换策略） |
| **经验记忆（narrative / episodic）** | Agent S | 成功轨迹 → Skill（复用现有 Skill 系统与 distill 流程） |
| **三层架构（State/Strategy/Command）+ 服务端/设备端分离** | UFO³ | 我们已是 Main(执行) / Renderer(推理+策略) 分离；补齐 session 状态可视化 |
| **Human-in-the-loop** | UFO | 已有审批；V2 增加 Sidecar 逐步时间线 + 暂停/继续/停止 |

---

## 3. V2 升级路线（分阶段，可独立交付）

### Phase V2.1 — Grounding & 确定性验证（最高优先，低风险）

**目标**：让模型"更容易点对"，并让"成功"可被机器验证。

- **T1 `find_desktop_element` 工具**（read，capability `ui.inspect`）
  - 输入：`observationId` + `query`（名称/角色/关键字）+ `maxResults`
  - Main：对当前 observation 的控件树做确定性打分（名称精确 > 前缀 > 包含 > 角色匹配；enabled/focused 加权），返回 `elementId/role/name/bounds/score`
  - 价值：替代模型在长列表里"肉眼"找元素；配合 `includeUiTree:false` 降低 token
- **T2 视觉候选 ↔ UIA 元素 IoU 关联**
  - `vision.ts` 输出候选后，在 Main 用 bounds IoU 匹配现有 elementId；命中则候选直接携带 `elementId`（坐标仅作兜底）
  - 视觉模型不再"只能给区域"：canvas 里的按钮若能对上 UIA 元素，可走语义动作（无需坐标审批）
- **T3 `desktop_action.expect` 确定性验证**
  - 输入：`expect?: { elementAppears?: {role?, nameContains?}, elementDisappears?: {elementId?}, titleContains?, windowAppears?: {appName?} }`
  - Action 后 settle + re-observe，Main 判定并返回 `verification: { passed, checks[], evidence }`
  - 模型被要求：发送/保存类动作必须带 expect；未通过必须重新观察而不是宣告成功
- **T4 自适应 settle**（替代固定 350ms）
  - Main 轮询 UI 指纹（150/300/500/800ms，上限 1.5s）：指纹稳定即返回；同时观察窗口标题变化
  - 减少慢应用误判 + 快应用等待浪费
- **T5 Prompt/描述更新**：工具选择优先级加入 `find_desktop_element`；verification 规则收紧

**验收**：fake runtime 场景（搜索/发文件）+ 真实 Windows smoke；`STALE` 率与坐标回退率在 eval 中下降；发送类任务 verification.passed 由真实 UI 事实驱动。

### Phase V2.2 — 常驻 UIA Runtime（性能）

**目标**：单步从 ~5–7s 降到 <1s（不含模型耗时）。

- **T1 常驻 PowerShell worker**（`src/main/computer/uiaWorker.ts`）
  - `powershell -NoProfile -Command -` 保持 stdin 打开；JSON lines 协议：`{id, op: "list"|"inspect"|"act"|"activate", payload}`
  - 单进程内缓存 UIA 元素句柄（RuntimeId → AutomationElement），避免每次 BFS
  - 崩溃/超时自动重启 + 请求超时回退到一次性脚本（保持兼容）
- **T2 合并 prepare+action**：Main 侧一次 IPC 内完成校验与执行（审批仍在 Renderer；Main 的二次校验保留）
- **T3 压测与看护**：worker 内存/句柄上限、空闲回收、与 app 退出联动

**验收**：10 步任务端到端耗时下降 ≥50%；所有既有 desktop 测试保持通过。

### Phase V2.3 — 计划、反思与 Session 工件

**目标**：从"链式调用"升级为"有计划的循环"。

- **T1 Session 增加 `goal` / `plan[]` / `stepIndex`**（`session.ts`）
  - `desktop_session` 工具（control）：`set_goal` / `update_plan`（步骤文本，非自然语言长文，≤8 步）
  - observation/action 输出附带 `session.plan`（模型每步看到自己的计划）
- **T2 反思触发**：同一 step 连续 2 次未通过 verification、或 no-progress 计数 ≥1 时，工具输出附 `reflectionRequired: true` + 建议（重观察 / 换元素 / 换策略）
- **T3 Sidecar 时间线**：状态卡展示当前 step / 计划进度（复用 session 事件流）
- **T4 Audit 扩展**：记录 stepIndex / plan hash / verification 结果

**验收**：多步任务 eval 中平均步数下降；no-progress 提前终止率下降；Sidecar 可见计划进度。

### Phase V2.4 — 应用画像与敏感应用策略

- **T1 App Profiles**（`src/main/computer/appProfiles.ts`）
  - 匹配：processName / title regex → `{ readyWaitMs, settleMs, riskyNamePatterns, blocked: boolean }`
  - 内置少量：浏览器、Office、微信/QQ、资源管理器、设置、regedit/taskmgr（高风险）
- **T5 敏感应用 blocklist 扩展**：密码管理器（1Password/Bitwarden/LastPass）、银行/支付客户端、UAC/LogonUI → `blocked`（审批也不放行）
- **T3 混合策略提示**：能走结构化工具/API 的（邮件渠道、文件操作）继续优先，Prompt 明确"GUI 是最后手段"

**验收**：敏感应用点击被硬拒绝；按应用等待减少假 stale。

### Phase V2.5 — 动作覆盖扩展（按需，全部带门）

| 动作 | 门控 |
| --- | --- |
| hover / 右键菜单 | 普通（坐标回退仍 ask） |
| 横向滚动 / 拖拽 | 拖拽默认 external→ask-once；禁止拖到窗口外 |
| 剪贴板读/写 | 默认 blocked；用户在设置显式开启后 `sensitive`→ask-once（写剪贴板需提示"会覆盖剪贴板"） |
| 文件上传协议 | 仅通过系统文件选择对话框 + 工作区文件（allowlist 路径），默认 ask-once |

**验收**：每项有独立风险分类与测试；未开启时 schema 层直接拒绝。

### Phase V2.6 — 经验记忆（轨迹 → Skill）

- **T1 轨迹记录**：Session 内记录 `{app, goal, steps:[{action,target,verification}], result}`（无截图、无敏感文本）
- **T2 成功轨迹 → Skill 草稿**：复用 `SkillDistillDialog` 流程，生成 `desktop-<app>-<task>` 指令（含元素语义名与 expect）
- **T3 检索注入**：`computer-control` skill 激活时附「本机成功配方」（≤3 条，来自用户 Skill）

**验收**：重复任务步数下降；生成的 Skill 可被 `/skill` 调用。

---

## 4. 安全与边界（不因 V2 放宽）

- 不引入任意代码执行 / 任意 shell；动作空间保持有界 primitive
- `blocked` 永不因审批放行；高风险仅 `allow-once`
- 截图不落盘（除非用户显式开启会话回放）；Audit 不记录敏感输入
- Session 隔离：一个 Turn 一个 session；Stop 最高优先级
- 新增能力（clipboard/拖拽/上传）默认关闭，逐项显式开启

---

## 5. 评估方法

- **CI**：fake desktop runtime（`tests/helpers/fakeDesktopRuntime.ts`）场景化回归 + 工具契约测试
- **Live**：`tests/aiOpenCodeGoDesktopAgentSmoke.test.ts` 扩展为任务集（搜索、窗口切换、发送前确认、表单填写、Word 保存）
- **指标**：任务成功率 / 平均步数 / stale 率 / 坐标回退率 / 每步耗时 / 人工介入次数
- **门槛**：V2.1 后坐标回退率 ≤10%；V2.2 后每步 Main 侧耗时 ≤1s；V2.3 后平均步数下降 ≥15%

---

## 6. 落地顺序建议

1. V2.1（Grounding + expect + 自适应 settle）— 直接提升成功率
2. V2.2（常驻 worker）— 直接提升速度
3. V2.3（计划/反思/时间线）— 提升长任务稳定性与可解释性
4. V2.4（应用画像 + 敏感应用）— 安全与稳定性
5. V2.5 / V2.6（动作扩展 / 经验记忆）— 按需求排期
