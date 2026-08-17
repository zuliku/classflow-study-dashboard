# Learning Analytics V3 — Truth & Information Architecture Refocus

日期：2026-08-16
基础提交：81dbe7c

## 目标

把「学习洞察」从“统计卡片集合”重构为“用户能够快速理解学习投入、趋势、分布和问题的决策面板”。

两个连续 Gate：

- **Gate A（Truth）**：数据表达可信 —— course identity、metric-level coverage、continuous trend buckets、duration 口径。A 全绿前禁止进入 B。
- **Gate B（IA）**：页面骨架与视觉层级 —— Summary Strip、Trend 主视觉、Signals h-fit、三层 Surface、max-width 1500。

## 产品原则

1. Unknown ≠ Zero
2. Snapshot First（历史 snapshot 优先于当前对象名）
3. Continuous Time（趋势轴不因无事件删除 bucket）
4. One Main Visual（Trend 是唯一主分析视觉）
5. Progressive Hierarchy（Summary → Trend → Insight → Distribution → Execution/Outlook）
6. No Card Soup（三层 Surface 强弱明确）

## Gate A — Analytics Truth

### A1. Course Investment identity

- `courseId === undefined/null` → 真「未关联课程」（唯一聚合，minutes/sessions 求和）
- `courseId` 存在但 snapshot 缺失 → current Course.name fallback
- `courseId` 存在、snapshot 与 current Course 均不存在 → 「已删除课程」
- snapshot 优先：同一 courseId 多个 session 不同 snapshot → 取该 courseId 最近一个非空 snapshot（deterministic，按时间排序）
- 最小侵入：buildLearningAnalyticsSnapshot 保持纯 History 投影（不改 input 契约），display name 由 Presentation Resolver（courseId + snapshot + current courses map）解决。先审计所有 caller（Kiro tools / tests）再动类型。

### A2. True unlinked aggregation

所有 `courseId === undefined` 的 Focus Session 聚合成唯一一条「未关联课程」。

### A3. Course Investment Top 5 + Other

minutes desc 排序；前 5 保留；第 6 项之后聚合为 `{ label: "其他", minutes: sum, sessions: sum, share: sum }`；总课程 ≤5 无 Other；未关联课程按普通课程参与排序，不强制塞 Other。

### A4. Metric-level coverage（Unknown ≠ Zero）

基于真实 History metadata（historyStartedAt / studyBlockBatchIntegrityStartedAt / planCoverageStartedAt = max(两者) / Focus backfill 现状）建立：

- `AnalyticsReliability = "complete" | "partial" | "unavailable"`
- assignments：period.from < historyStartedAt → partial
- plans：period.from < planCoverageStartedAt → partial；ratio 一律 unavailable
- onTime：assignment coverage 非 complete 或 onTimeEligible === 0 → unavailable
- focus：审计真实 backfill metadata；无完整起点证明则不声称完整（UI 表达「已有专注记录仍计入统计」）

### A5. Partial presentation model

新增 `lib/analytics/presentation.ts`：

- `AnalyticsMetricView { value, detail?, reliability }`
- Focus：complete+0 → 「0 分钟」；partial+>0 → 实际值 + 「已记录 · 当前区间可能不完整」；partial+0 → 「—」+「该区间记录不完整」
- Completed：complete → N 项；partial+N>0 → 「已记录 N 项」；partial+0 → 「—」
- Plan：complete → 正常；partial → 「已记录 X」，ratio unavailable；partial+0 → 「—」
- OnTime：仅 assignment complete 且 eligible>0 → rate；否则 「—」
- `formatAnalyticsDuration(minutes, mode: "full" | "compact")`：全中文（0 分钟 / 45 分钟 / 1 小时 / 1 小时 28 分；compact：45分 / 1时28分）

### A6. Summary KPI 语义

顶部四项：实际专注 / 完成任务 / 计划执行 / 按时完成

- 计划执行：complete plan 且 planned>0 → ratio%（detail 实际 X / 计划 Y）；planned===0 → 「—」+「本周期暂无已到时间的学习计划」；partial → 「—」+「计划记录不完整」
- 按时完成：partial → 「—」

### A7. Coverage Notice rewrite

由真实 coverage 状态驱动文案，低关注（无红色/黄色 banner）。明确列出受影响数据（如「任务与学习计划仅从 X 起完整记录；已有专注记录仍会正常计入」；若仅 plan partial →「学习计划在该区间记录不完整，计划执行相关指标暂不显示」）。

### A8. Continuous trend buckets

由 Analytics Period 生成 canonical buckets，事件只填值：

- week：period.current.from → to/now，每天一个 bucket
- 4weeks：连续 4 个 weekly bucket（缺失周仍存在）
- semester：第 1 周 → 当前教学周，连续

metric 值 `number | null`（null = unknown，禁止补 0）。per-bucket reliability：bucket 进入 coverage 前 → null。

### A9. Trend labels

canonical key 用于数据；UI label 单独生成（week：8/10 周一；4weeks：7/20；semester：第1周）。Tooltip 保留完整日期。

### A10. Gate A tests（tests/learningAnalyticsV3.test.ts 或现有文件扩展）

A. 不同 courseId 缺 snapshot → 无重复「未关联课程」
B. 真 unlinked → 唯一聚合
C. snapshot 优先
D. snapshot 缺失 → current Course fallback
E. course 不存在 → 已删除课程
F. Top5 + Other
G. partial+zero → —
H. partial+positive → 已记录
I. Plan partial → ratio unavailable
J. OnTime partial → unavailable
K. week continuous buckets
L. 零活动日 complete → 0
M. coverage 前 bucket → null
N. 4weeks 缺失周仍存在
O. semester 周 labels
P. 中文 duration formatter

**Gate A 全绿后才进入 Gate B。**

## Gate B — Information Architecture

### B1. Max width

Analytics workspace 内容统一 `w-full max-w-[1500px] mx-auto`（Header 与 Body 对齐；外层仍铺满）。

### B2. Summary Strip

删除 4 个独立 AnalyticsMetricCard → 新 `AnalyticsSummaryStrip`（一个共同 surface，4 列；tablet 2×2；390 2×2 或 1 列）。Label 11–12px sandrift / Value 22–26px bold charcoal / Secondary 10–11px satin-grey。Desktop 高度约 100–120px。加载骨架 `AnalyticsSummaryStripSkeleton`（布局接近最终）。

### B3. Trend = Primary Visual

Desktop `lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]` items-start；Trend Level 1 surface（bg-surface border rounded-2xl shadow-subtle）；标题「学习趋势」+ Legend（● 实际专注 / ● 计划学习）+ 单位：分钟；plan unavailable → 不显示 plan legend，显示轻量「计划记录不足，暂不显示完整计划序列」。图表高度 desktop h-64 / mobile h-56。XAxis 用 V3 label；Tooltip 完整日期 + 分钟/项；null → 「记录不足」不显示 0。

### B4. Signals → 值得注意

最大 3 条；card h-fit self-start（与 Trend 不等高）；Icon+Title+description+actions（domain navigation secondary，Ask Kiro 非主 CTA）。

### B5. Surface hierarchy

- Level 1：Summary Strip、Trend（border rounded-2xl shadow-subtle）
- Level 2：Course Investment / Focus Rhythm / Execution Quality / Estimate Calibration（border rounded-2xl，去 shadow）
- Level 3：Coverage / metadata / helper（subtle bg / divider）

### B6. Distribution section

「投入与节奏」section heading（不包大 card）→ Course Investment + Focus Rhythm（grid items-start，禁 stretch）。

### B7. Execution / Outlook

「执行情况」section → ExecutionQualityCard（Level 2 surface）；「下一步」section → StudyOutlookCard + EstimateCalibrationCard。不改 Domain。

### B8. Card header 审计

Trend 保留 divider；Course/Rhythm 标题 → 8–12px gap 无横线（减少噪音）。

### B9. Page spacing

section gap 24–28px；within-grid 16px；card internal 16px；headline→content 10–12px。

### B10. Loading / Empty

Loading：SummaryStripSkeleton + 页面骨架；Empty：保持克制（学习洞察会随着使用逐渐形成 + Weekly Review 保留）。

### B11. 不触碰

周回顾 workflow、range selector 语义、Recharts 版本、chart library、Focus Domain、Task Execution Loop、Reminder、Planner、Course Hub、Upcoming DDL、Settings、Kiro、Material、Calendar/Timeline、Group Project。Kiro analytics tools 保持兼容（additive type extension）。

### B12. Tests

- Component：AnalyticsSummaryStrip / LearningTrendChart / CourseInvestmentCard（partial → —；已记录 copy；计划执行 %+实际/计划；无 raw ISO label；Top5+Other；无重复未关联）
- E2E：learning-analytics-v3.spec.ts 或扩展现有 —— A Desktop hierarchy / B 1920 max-width≈1500 居中 / C Signals 高度明显 < Trend / D Course vs Rhythm 不等高 top 对齐 / E 真实课程名无重复未关联 / F 本周显示 周一 而非 raw ISO

## Validation

- Gate A：`npx vitest run tests/learningAnalyticsV3.test.ts`（+ 现有 analytics tests 回归）
- Gate B：component tests + `npx playwright test tests/e2e/learning-analytics-v3.spec.ts`（+ 现有 analytics E2E 回归）
- `npx tsc --noEmit`（本任务文件 0 error）
- dev server smoke：1440 / 1920 / 1024 / 768 / 390

## Git

- Commit 1（Gate A）：`fix(analytics): strengthen learning insight data semantics`
- Commit 2（Gate B）：`feat(analytics): refocus learning insights dashboard`
- 显式 add 本任务文件；最后 push origin/main
