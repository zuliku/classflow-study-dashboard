# Learning Analytics V2 — 学习洞察

> Status: 实现完成（Analytics Engine + Weekly Review + Canonical Kiro Analytics Tool + Kiro Action Loop）
> 前置依赖：[learning-history-v1.md](./learning-history-v1.md)（History IndexedDB / Recorder / Query / Aggregate）

## 一、数据源

学习洞察**只消费 Learning History**（IndexedDB `classflow-learning-history`），不读 Zustand 内存态：

| 指标 | 事件来源 |
| --- | --- |
| 实际专注 | `focus.completed`（只累计 `data.actualActiveMs`；计划值/墙钟推算一律不用） |
| 完成任务 | `assignment.completed`（distinct entityId） |
| 重新开启 | `assignment.reopened`（distinct entityId） |
| 计划学习 | `study_block.created / updated / deleted`（revision 重放） |
| 按时完成 | `assignment.created / deadline_changed / completed / reopened`（DDL 重建） |

## 二、范围（Analytics Period）

`lib/analytics/range.ts` → `resolveAnalyticsPeriod(preset, semester, now)`

| Preset | current | previous | trendGrain |
| --- | --- | --- | --- |
| `week` 本周 | 本周一 00:00 → now | 上周一 00:00 → + 同 elapsed | `day` |
| `4weeks` 近 4 周 | now−28d → now | now−56d → now−28d | `week` |
| `semester` 本学期 | 开学日 → min(now, 学期结束日) | `null`（不比较） | `semester-week`（wN） |

所有时间均为**本地墙钟**。

## 三、Projection 语义（确定性重放）

- 事件按 `(occurredAt, sequence)` 升序、按 entityId 分组重放；同批次毫秒级事件靠 `sequence` 保序。
- **成熟计划**：`scheduledStart ∈ [revisionStartedAt, nextRevisionAt)`——revision 在该计划开始时刻仍然有效。
  - created 在 scheduledStart 之后 → 不成熟；
  - updated 在 scheduledStart 之前改走 → 旧 revision 不成熟（不重复计）；
  - deleted 在 scheduledStart 之前 → 不成熟（删除本身不产生计划）；
  - 缺 `created` 事件（history coverage 前已存在）→ `incompleteEntities`，**不猜初始状态**；
  - `plannedMinutes` 缺失 → 用 `endTime − startTime` 推断（分钟）。
- **按时完成**：完成时刻重建该任务当时的 DDL（`created.data.ddl` / `deadline_changed.data.after`）。
  - DDL 从未出现过 / 无法重建 → `onTime = null`，**不进入按时率分母**（绝不把"未知"当"按时"）；
  - 有 DDL：`completedAt ≤ parseLocalDDL(ddl)` 为按时。

## 四、Coverage 与比较

- `fullCoverage = current.from ≥ historyStartedAt`；不完整时 UI 显示低干扰提示条。
- `comparisonAvailable = previous.from ≥ historyStartedAt 且 previous 周期存在事件`；否则**不显示任何 delta / period 对比信号**（不显示假 delta）。

## 五、指标定义（Snapshot）

`lib/analytics/learningAnalytics.ts` → `buildLearningAnalyticsSnapshot(input)`，单次查询 → 派生全部 section：

- **overview**：实际专注（分钟 + `5h 30m` 标签）、专注对比 `focusDeltaPercent`（前后均 ≥60min 才计算）、完成任务（distinct）、计划学习（成熟计划 plannedMinutes 之和）、`actualToPlanRatio`、按时率（eligible ≥1 时）。
- **trend**：按 trendGrain 聚合（日=日期键 / 周=周一起始日 / 教学周=wN）；仅出现数据的 bucket；计划/实际两组相邻 Bar。
- **courseInvestment**：按课程聚合专注分钟 + sessions，`share = 该课 / 总专注`，按分钟降序（Top5 + 其他）。
- **focusRhythm**：时段分布（深夜 00–05 / 上午 05–12 / 下午 12–18 / 晚间 18–24）、activeDays、平均/最长单次专注；`dominantTimeOfDay` 仅当 sessions≥5 且总专注≥120min。
- **execution**：完成任务 / 重新开启 / 按时 / 逾期 / 按时率 / 专注活跃天数。
- **signals**：`lib/analytics/signals.ts` — 最多 3 条 primary signals，确定性顺序：
  1. 明显的专注增减（对比可用 & 前后 ≥60min）
  2. 计划 vs 实际（计划 ≥120min）
  3. 截止节奏（可判断 ≥3 个）
  4. 投入集中（专注 ≥120min 且 Top 课程 ≥45%）
  5. 专注时段（dominant 存在）

  Signals **不是评分**：无综合分数，tone 只反映事实方向（positive / neutral / attention），文案全部由可解释数字构成。

## 六、实时性

- `lib/history/recorder.ts` 暴露 `subscribeLearningHistoryChanges(listener)`（append / reset 成功后通知）。
- `hooks/useLearningAnalytics.ts`：mount → `flushLearningHistoryQueue()` → build；订阅 history 变更 → 重建；preset / semester 变化 → 重建；`generation token` 防止 stale 响应覆盖新 preset 结果。
- 每次 build 前 flush 队列，保证"刚发生的变更"已落库。

## 七、UI

- `components/analytics/`：`LearningAnalyticsView`（头部 + range selector + 「周回顾」入口 + coverage 提示 + 4 指标卡 + 趋势图 + 信号卡 + 课程投入 + 专注节奏 + 执行情况）
  - Loading 骨架屏（不闪 0）；Error 兜底；空状态（`isEmpty`）不画假图。
  - recharts：ComposedChart 两组相邻 Bar（计划 `#CDB9AB` / 实际 `#627566`），reduced motion 禁用动画。
- 导航：Sidebar / BottomNav「学习统计」→「学习洞察」；`app/page.tsx` 旧 Analytics（完成率 / 状态 Pie / 优先级 Bar / 旧课程负荷）已移除（`StudyLoadChart` 仍保留在总览）。

## 八、Weekly Review（本周回顾）

- `lib/analytics/weeklyReview.ts` → `buildWeeklyReview(snapshot)`：**纯函数**，只把 `LearningAnalyticsSnapshot("week")` 重新组织为回顾模型。
  - 禁止 import `lib/history/*` 或 `lib/analytics/*Projection`；不重新查询 IndexedDB、不重复计算任何底层指标。
  - `headline`（专注/完成任务/计划/按时率/活跃天数）来自 `overview + focusRhythm`；`change.focusDeltaPercent` 来自 `overview.focusDeltaPercent`；`investment.topCourse` 来自 `courseInvestment[0]`；`highlights / attention` 来自 `signals` 按 tone 分流。
  - 文案 deterministic（`weeklyReviewCopy`）：只报事实，不评价（无"表现优秀/效率高"）。
- `WeeklyReviewCard`：页面内展开（`reviewExpanded` 只属于 component state，不持久化、不入 Zustand）；点击「周回顾」→ 切 preset=week + 展开 + `scrollIntoView`（尊重 `useEffectiveReducedMotion`）；手动切 range 时自动收起。
  - `week.fullCoverage=false` → 顶部提示「完整历史自 YYYY/MM/DD 起记录，本周部分数据可能不完整」（缺失 ≠ 0）。
  - `comparisonAvailable=false` → 显示「历史不足，暂无法与上周同期比较」，不显示 0%。
  - `isEmpty` → 「本周还没有足够的学习记录形成回顾」+「让 Kiro 帮我规划本周」，不伪造回顾。
- Weekly Review 是 **ephemeral 实时 projection**：不生成周报存档 / 不写入 IndexedDB / 无自动生成。

## 九、Canonical Kiro Analytics Tool（get_learning_analytics）

- **UI 与 Kiro 同源**：`lib/ai/tools/read/analytics.ts` → `executeGetLearningAnalytics` 直接调用 `buildLearningAnalyticsSnapshot`，**不复制 Analytics 算法**。
- 执行流程：`flushLearningHistoryQueue()` → `buildLearningAnalyticsSnapshot({ preset, semester: useAppStore.getState().semester })` → model-friendly 输出。
- Schema：`{ preset?: "week" | "4weeks" | "semester" }`（默认 week，`.strict()` 拒绝 now/from/to/historyStartedAt）；模型不拥有学期定义权。
- **Browser 执行**：Server 只注册 schema/description（`schemas.ts` / `registry.ts`）；`executor.ts` 同步路径对异步工具返回「需要异步执行」；`useKiroChat` 中与 `read_material` / history tools 同一 async 边界分发。
- 输出 = snapshot 的 period / coverage / overview / trend / courseInvestment / focusRhythm / execution / signals（裁剪 isEmpty 等内部字段；不外泄 IndexedDB events / projection 内部状态）。
- 失败返回 `READ_FAILED`：prompt guidance 要求如实说明无法读取学习洞察，不凭记忆猜。

## 十、Kiro 三层只读工具职责

| 工具 | 回答 |
| --- | --- |
| `get_learning_analytics` | 学习状态/计划执行/与上周对比/哪门课投入最多/专注节奏/基于洞察的建议（period comparison + signals 已算好） |
| `summarize_learning_history` | 较底层历史总量（过去两个月完成多少任务、按月/按课汇总） |
| `query_learning_history` | 具体历史事实（何时改过 DDL、上周具体完成哪些任务） |

Kiro 不得从 raw events 自行重算 UI Analytics metric。Analytics 数据只读：涉及调整必须走 proposal → 用户确认，绝不自动改 StudyBlock/任务。

## 十一、Analytics → Kiro Action Loop

- **Signal → 问 Kiro**（`LearningSignalsCard`）：每条 Signal 保留原 domain action（如查看任务）+ 弱操作「问 Kiro」；prompt 只表达 intent（deadline / plan-actual / course-concentration / focus-rhythm / focus-up / focus-down 各有固定文案），**不嵌入 Analytics JSON / 数字快照**（Kiro 收到后会调用 `get_learning_analytics` 取最新事实，避免 stale 数字）。
- **Weekly Review → Kiro**（`WeeklyReviewCard`）：
  - 「让 Kiro 深入复盘」→ `handoffPrompt("基于我本周的学习洞察，帮我做一次简洁复盘…不要给学习力评分。")` → 推荐 `get_learning_analytics({preset:"week"})` → 需要具体历史时 `query_learning_history`。
  - 「规划下周」→ `handoffPrompt("结合我本周的学习洞察和未来 7 天任务…")` → `get_learning_analytics` → `get_upcoming_assignments` → 需要时 `get_assignment_health` → 正式排期走 `propose_study_plan`（仍是 READ / PROPOSAL）。
  - 复用 `KiroSessionActionsContext.handoffPrompt`（`useKiroSessionActions()`），不实现第二套 Kiro Chat Runtime；不自动注入 Analytics context、不在每轮聊天构建 snapshot。
- **Planning 不变式**：`propose_study_plan` 是 proposal-first；Apply 前 StudyBlock 无副作用（Ghost Preview 是 ephemeral），用户确认后才写入。

## 十二、Kiro History Tools

`lib/ai/tools/read/history.ts` 不变（query 默认 30d / hard 90d / ≤200 条；summarize 默认 28d / hard 366d；浏览器 IndexedDB 直连）。Analytics V2 **不新增任何 AI 调用**（Weekly Review 是 deterministic；只有用户点击 Ask Kiro / 规划 / 主动询问才调模型）。

## 十三、Known Limitations

- 跨午夜专注会话不拆分（归因到 `startedAt` 日）。
- 按时率只统计 DDL 可重建的任务（history coverage 前的任务不猜）。
- `semester` 无 previous 对比（学期期初开始记录历史时对比不完整属预期）。
- Coverage 不足时不显示 delta / 对比信号；`historyStartedAt` 早于所选范围才显示对比。
- 「投入」≠「效率」：不输出任何效率/评分类结论。
- 本轮不做：AI 自动周报 / 定时周报 / Push / 综合分数 / Streak / Goals / Achievements / Cloud / Export / PDF / 预测 / 自动修改 StudyBlock / 新的 Planning Algorithm。
