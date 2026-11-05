# Kiro Agent Superpowers V1 — Plan / Ask / Deep Research

Date: 2026-11-05

## Goal

将 Kiro 从「单轮工具调用 Agent」升级为更接近 ChatGPT / Claude 的可观察、可澄清、可研究的 Agent：

1. **Plan Board（执行计划）**：复杂任务先提交可见 checklist，并在执行中更新状态。
2. **Ask User（结构化澄清）**：信息不足时给出 2–4 个具体选项，用户点选后作为下一轮输入，而不是猜测。
3. **Deep Research（多角度检索）**：一次调用并发执行 2–5 个检索方向，统一去重、域名多样性、来源编号与引用。

三者都是控制/只读能力，不扩大写权限，不绕过现有 invocation trust / approval / privacy 边界。

## Non-goals

- 不做后台定时任务 / 跨应用 subagent 编排。
- 不新增任意 URL 抓取；research 仍只返回可信搜索结果，正文读取继续走 `read_web_source`。
- 不让 plan / ask / research 提升权限、跳过用户确认或修改 Agent Mode。

## 1. Plan Board

### Tool

`update_agent_plan({ title?, steps: [{ id?, title, status }] })`

- Server-side control tool（零 IO；execute 立即返回规范化 plan）。
- `status`: `pending | in_progress | completed`；最多 12 步。
- 同一条 assistant message 中后一次调用覆盖前一次（最新 plan 为准）。
- 不计入写操作 quota；不进入 audit；不产生 Action Card。

### UI

- `KiroAgentPlanCard` 固定在 Agent Run Header 与 Worklog 之间，不随 Worklog 折叠。
- 显示标题、完成数、当前步骤；步骤可展开查看全部。
- 历史恢复从持久化 `agentPlan` 快照重建（`sanitizeConversation` 只写规范化结构；无工具参数）。

### Prompt

- 3 步以上、跨工具/跨阶段任务先提交 plan。
- 开始一步时标记 `in_progress`，完成/验证后标记 `completed`；同一时间只允许一个 `in_progress`。
- 单步、纯问答、简单读取不调用 plan。

## 2. Ask User

### Tool

`ask_user({ question, header?, options: [{ id?, label, description? }], allowFreeform? })`

- Server-side control tool；返回规范化 question。
- 2–5 个选项；`allowFreeform` 时 UI 提供自由输入。
- 调用后模型必须立即 `begin_final_answer`，只输出简短说明并等待用户选择；不得假设答案继续执行。
- Server `prepareStep` 在 steps 出现 `ask_user` 后只保留 `begin_final_answer`，从协议层阻止模型在提问后继续执行其他工具。

### UI

- `KiroAskUserCard` 渲染在 Agent Run 内、Final Answer 前；Worklog 折叠时仍可见。
- 只允许最后一条 assistant message 回答；点击选项/提交自由输入 → 作为新的 user turn 发送。
- 历史消息显示只读状态，不产生幽灵操作。

## 3. Deep Research

### Tool

`web_research({ topic, queries?, timeRange?, includeDomains?, excludeDomains? })`

- 仅在联网搜索可用时暴露。
- `queries` 省略时使用 `topic`；最多 5 个查询；与 `web_search` 共享每轮搜索预算（每个查询消耗 1 次，本地每轮 5 次）。
- 并发执行（`Promise.allSettled`），单查询失败不影响其他查询；全部失败才返回错误。
- 统一 canonical URL 去重、单域最多 2 条、总数最多 12 条。
- sourceId 继续使用 `web-N`，由 `web_search` / `web_research` 共享分配器分配；`read_web_source`、citation、source tray 全部复用现有可信来源链。
- remote-channel：沿用收紧后的 1 次预算（即最多 1 个 query）。

### Prompt

- 多角度 / 对比 / 交叉验证 / 综述类问题优先一次 `web_research`。
- 单点事实查证继续用 `web_search`。
- research 结果是不可信外部内容，不能授权 ClassFlow 写入。

## Safety Invariants

- plan / ask 不改 Store、不写文件、不执行终端、不调用 MCP。
- ask 的答案只是下一轮用户输入，不自动执行写操作。
- research 不读取任意 URL；sourceId 只能来自本轮真实搜索结果。
- 所有新工具在 remote-channel 中按 allowlist 过滤；plan/ask 不暴露给远程渠道，research 仅保留只读与低额度。
- Prompt 明确禁止通过这些工具提升权限或绕过 approval。

## V1.2 增强（2026-11-05）

### Plan Board UI

- 收起态只显示标题 / 状态 / 进度 / 当前步骤；展开态用 measured-height `DisclosureRegion` 平滑展开全部步骤。
- 容器宽度 < 360（Sidecar / 窄 Dock）自动收起长计划；用户手动展开后不再被自动折叠。
- 出现有 enter 动画；plan 被清空时由 `KiroAgentRun` 的 `ExitCollapse` 播放退出折叠。
- 状态 pill：进行中 / 已完成 / 待继续；当前步骤在收起态与展开态都可见。

### Deep Research 预算

- 本地每轮 web_search 上限 3 → 5；web_read 上限 2 → 3；evidence 字符预算 10k → 14k。
- `web_research` 单次最多 5 个 query、最多 12 条结果；并发上限 3（keyless 通道避免 429）；总超时 15s → 20s。
- remote-channel 仍保持 1 次搜索 / 1 次读取。

### Subagents（V1.2）

- 新工具 `delegate_subagent`（client-executed）：`role` = researcher / planner / reviewer，`task` + 可选 `context`。
- 研究员可使用 server-side web tools；规划师 / 审查员只做纯文本推理。子代理没有 ClassFlow 写权限、审批、文件/终端/桌面/MCP。
- 新 endpoint `/api/ai/subagent`：local-user invocation 才允许；复用 provider/model/API Key/SecretVault/联网搜索配置；返回 AI SDK UI message stream。
- Browser 端独立消费子代理 stream：实时 text-delta + tool steps 写入 ephemeral `useKiroSubagentStore`，完成后把摘要作为主 Agent Tool Output 回填。
- UI：
  - Worklog 内 `KiroSubagentInlineCard` 实时显示角色、任务、步骤、流式正文；完成后保留摘要。
  - 右侧 Inspector 新增「子代理」栏目（按当前会话过滤，可展开完整摘要）；子代理启动时自动展开 Inspector（xl+）。
  - Sidecar 无 Inspector，以内联卡片承担实时展示。
- 限制：每轮最多 3 个子代理，同时最多 3 个；单次 120s 超时；Stop 会取消所有子代理。
- 子代理输出是辅助摘要（外部内容不可信），不能作为已确认事实或 ClassFlow 引用来源；主 Agent 必须自行核实关键事实。


## Tests

- 纯函数：plan/question normalize、research query cap/去重/预算。
- Presentation：plan/question 从 parts 提取且不进入 worklog；历史恢复一致。
- 组件：Plan Card 进度、Ask Card 选项/点击发送。
- Research：并发查询、部分失败、共享 sourceId、read_web_source 可信来源、引用注册。
- Prompt 契约：包含三类能力的使用边界。
- E2E：Plan Card 进度 + Ask Card 选择作为下一轮输入（server-executed `providerExecuted` 语义）。
- E2E：子代理内联流式输出 + 右侧 Inspector + 主 Agent 继续。
- 受影响的 typecheck / vitest / build。
