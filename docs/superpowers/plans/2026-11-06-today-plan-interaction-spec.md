# Today + Plan Interaction Spec v1

> 状态：Phase 1–2 高保真交互规格（方向已确认，未实现）
> 日期：2026-11-06
> 前置契约：`docs/superpowers/plans/2026-11-06-task-lifecycle-data-truth-contract.md`
> 视觉基线：`docs/ui-product-system-v1.md`、`docs/motion-system-v6.md`
> 范围：Today 页面、Plan 页面、二者与全局 Shell / Kiro / Task Drawer 的交互边界

---

## 0. 一句话

**Today 是“今天做什么”的行动驾驶舱；Plan 是“这周怎么排”的统一时间画布。**

- Today 不展示完整周课表，不再让 520px 的 TimetableGrid 占据首屏。
- Plan 不再有“水平 00–24 Key Lane + 垂直 08–21 网格”两套坐标；所有带时间的实体进入同一垂直时间轴。
- Today 的时间线只读，编辑去 Plan；Today 负责决策与开始，Plan 负责安排与调整。
- Kiro 不抢主线：Today 的 Kiro Brief 默认本地生成，只有用户点 “Plan my day” 才发起 AI；Plan 的 “Plan my week” 始终是 proposal-first。

---

## 1. 设计目标与不变量

### 1.1 页面目标

| 页面 | 用户问题 | 首屏必须回答 | 主操作 |
|---|---|---|---|
| Today | 我现在该做什么？ | 现在/下一节、今天要做什么、什么有风险 | 开始专注、提交/完成、安排 |
| Plan | 这周排不排得下？ | 这周有哪些硬约束、待安排什么、容量够不够 | 拖入时间块、调整计划、Plan my week |

### 1.2 不变量

1. **Today 首屏不出现完整周课表。** 周课表只在 Plan。
2. **Today 的任务先于时间线。** 行动清单是主角，时间线是上下文。
3. **Plan 只有一条时间轴。** 课程、学习块、考试/活动、DDL、实际专注共用垂直时间坐标。
4. **提交/完成走 Phase 0 契约。** UI 不直接写 status；preview / undo / reopen。
5. **submitted / completed 不进入 Today / Plan 活跃层。**
6. **released StudyBlock 不进入活跃层。** 需要时用“显示已释放计划”只读查看。
7. **Today 的 Kiro Brief 不自动调用 LLM。** 本地摘要 + 用户主动请求。
8. **Plan 的 AI 计划始终预览。** ghost blocks + 逐项/全部接受 + Undo。
9. **移动端不强制拖拽。** 用“安排到…”流程替代。
10. **切页不重播首屏 choreography。** 页面状态、滚动、筛选、选中项在会话内保留。

---

## 2. 全局 Shell 调整

### 2.1 导航

目标导航：

```text
Today
Plan
Courses
Review
Groups
Kiro
Inbox
Settings
```

- Today 图标：`Sun`（今天/日光）。
- Plan 图标：`CalendarRange`。
- Courses：`Library`。
- Review：`BarChart3`。
- Groups：`Users2`。
- Kiro：现有正式 Logo。
- Inbox / Settings 仍是全局 Action，不是 Workspace Tab。

Plan 内部不再拆成两个一级导航：

```text
Plan
├─ Calendar（默认）
├─ Tasks（复用现有任务工作区）
└─ Agenda（移动端默认）
```

Backlog 是 Calendar 的一部分，不是独立一级入口。

### 2.2 路由与旧页映射

| 旧 | 新 | 行为 |
|---|---|---|
| `overview` | `today` | 默认启动页；旧的 `startupView=overview` 迁移到 `today` |
| `timetable` | `plan` + Calendar | 旧快捷键/深链进入 Plan 周视图 |
| `assignments` | `plan` + Tasks | 旧任务深链进入 Plan 的 Tasks 视图 |
| `courses` | `courses` | 本轮不改 IA，只统一壳层 |
| `analytics` | `review` | 下一阶段 |
| `group` | `groups` | 下一阶段 |
| `kiro` | `kiro` | 保持 |

迁移期使用 `todayPlanV1` Feature Flag：

- Flag ON：Sidebar 显示 Today/Plan；旧 Overview/Timetable 隐藏，但 `?legacy=1` 可访问。
- Flag OFF：保持现有 7 个入口。

### 2.3 Header 契约

所有页面继续使用 `WorkspaceHeader`，高度 64px。

Today Header：

```text
Today · 11月6日 · 第 8 周          [查看本周] [Ask Kiro] [+ 快速添加] [搜索]
```

- 左：标题 + context。
- 右：
  - L2 次要：`查看本周`（去 Plan 当前周）。
  - AI：`Ask Kiro`（打开 Sidecar，带 Today 上下文）。
  - 主要：`+ 快速添加`（Quick Capture）。
  - 全局搜索图标。
- 不在 Header 放 `Plan my day`；它在 Kiro Brief 卡片里，避免重复 AI 入口。

Plan Header：

```text
Plan · 第 8 周 · 11月3日–11月9日     [第 8 周 ▾] [Plan my week] [+ 新建] [搜索]
```

- 左：标题 + context。
- 右：
  - L2：Week Picker 触发器（第 8 周 ▾）。
  - AI：`Plan my week`。
  - 主要：`+ 新建` 下拉（任务 / 学习块 / 课程 / 考试或活动）。
  - 搜索。
- Tasks 视图时：主要按钮变成 `+ 新建任务`；`Plan my week` 保留但禁用/提示先回 Calendar。
- Inspector 内有 `Ask Kiro`，Header 不再重复。

### 2.4 页面状态保持

当前 `PageTransition` 以 tab 为 key 整页 remount，导致筛选、滚动、展开态丢失。Today/Plan 必须改为：

- **壳层稳定**：Sidebar / Header / ViewBar 不重挂载。
- **内容轻过渡**：新页面内容 180ms 淡入 + 4px 位移；不重播整页 choreography。
- **会话记忆**：
  - Today：滚动位置、展开的任务组、课程筛选、riskOnly。
  - Plan：selectedWeek、selectedDate、view mode、filters、layers、backlog 折叠、滚动位置、选中实体。
  - 使用非持久化 `useWorkspaceMemory` / `useWorkspaceContextStore`；应用重启回当前周/今天。
- **返回路径**：从 Today 打开 Plan、从 Plan 打开 Drawer，关闭后回到原滚动位置与选中项。

### 2.5 滚动所有权

| 页面 | 滚动模型 |
|---|---|
| Today | 页面级单滚动；rail 使用 `position: sticky`，内容不独立滚动 |
| Plan | **Shell 例外**：Plan 根占满可用高度，Backlog / Canvas / Inspector 三列各自滚动；页面本身不滚 |
| 移动端 Plan | 页面级滚动；Backlog / Inspector 用 Bottom Sheet |

Plan 是继 Kiro 之后第二个“页面拥有自己的滚动”的例外，必须在 `app/page.tsx` 明确注释，避免未来再出现双滚动。

### 2.6 响应式断点

| 宽度 | Sidebar | Today | Plan |
|---|---|---|---|
| ≥1880 | 展开 224 | 2 列：main + 360 rail | 3 列：Backlog 300 + Canvas + Inspector 340 |
| 1440–1879 | 展开 224 | 2 列：main + 340 rail | 2 列：Backlog 280 + Canvas；Inspector 覆盖层 360 |
| 1280–1439 | 展开 224 或 rail 64 | 2 列：main + 320 rail | 2 列：Backlog 260 + Canvas；Inspector 覆盖层 |
| 1024–1279 | rail 64 | 单列；rail 卡片下移 | Canvas + Backlog Sheet；Inspector 覆盖层；默认 3-day |
| 768–1023 | rail 64 | 单列；rail 卡片 2 列网格 | 3-day；Backlog Sheet；Inspector 全屏 Sheet |
| <768 | BottomNav | 单列；Kiro Brief 紧跟 Now/Next | Agenda 默认；Day 可选；Backlog/Inspector Bottom Sheet |

内容宽度上限：

- Today：`max-width: 1480px`，居中。
- Plan：`max-width: 1760px`，居中；超宽屏不把 7 天拉成 300px/天。

---

## 3. Today

### 3.1 页面职责

Today 只回答三件事：

1. **现在/接下来是什么？**（Now/Next）
2. **今天要做哪些事？**（Today task groups）
3. **今天排得下吗？**（Capacity + timeline）

Today 不做：

- 完整周课表。
- 周计划编辑。
- Backlog 拖拽。
- 课程资料管理。
- 复杂批量操作（去 Tasks）。

### 3.2 数据绑定

| 区块 | 数据来源 | 契约 selector |
|---|---|---|
| Now/Next 课程 | `courses / schedules / overrides / semester` | `resolveCourseOccurrencesForWeek` |
| Now/Next DDL | `assignments / preferences.ddlWarningDays` | `buildDeadlineFeed` |
| Now/Next 专注 | `focusSessions` | `deriveFocusView` / `FocusControl` |
| Attention | Today + Health + Backlog | `buildTodayProjection` + `deriveAssignmentHealthV2` |
| Today 任务 | `assignments / studyBlocks` | `buildTodayProjection` |
| Today 时间线 | occurrences / active blocks / marks | `isActiveBlock` + occurrence resolver |
| Capacity | `buildPlanningCapacity` / `useStudyOutlook` | P0 契约 |
| Waiting | `assignments` | `isWaitingTask` |
| Week glance | `studyLoad` / tasks / marks | canonical selectors |

Today 不直接读原始 `schedules`；必须使用 occurrence resolver（调课/停课/补课生效）。

### 3.3 桌面线框（≥1280）

```text
┌ Sidebar ─┬─ WorkspaceHeader ───────────────────────────────────────────────┐
│ Today    │ Today · 11月6日 · 第8周      [查看本周] [Ask Kiro] [+ 快速添加] │
│ Plan     ├─ TodayToolbar ─────────────────────────────────────────────────┤
│ Courses  │ [全部课程 ▾] [只看风险]              3 项任务 · 2 项风险       │
│ Review   ├───────────────────────────────────┬─────────────────────────────┤
│ Groups   │ Main                              │ Rail 340                    │
│          │ ┌ Now / Next ────────────────────┐ │ ┌ Kiro Brief ─────────────┐ │
│ Kiro     │ │ 现在 · 第3节                    │ │ │ 今天 3 件事，先做…       │ │
│          │ │ 微观经济学 14:00–15:40 · 教二201│ │ │ [Plan my day] [换一个]   │ │
│ Inbox    │ │ [查看课程] [开始专注]            │ │ └─────────────────────────┘ │
│ Settings │ └─────────────────────────────────┘ │ ┌ 今日/本周容量 ──────────┐ │
│          │ ┌ 需要关注 ──────────────────────┐ │ │ 今日 2h/4h              │ │
│          │ │ 逾期2 · 今天截止1 · 风险3 · 未排4│ │ │ 本周 14h/18h            │ │
│          │ └─────────────────────────────────┘ │ └─────────────────────────┘ │
│          │ ┌ 今天要做 ──────────────────────┐ │ ┌ 等待反馈 2 ─────────────┐ │
│          │ │ 逾期 (2)                       │ │ │ 计量作业 · 昨天提交      │ │
│          │ │ [ ] 计量作业  剩余3h  逾期6h    │ │ │ 统计学 · 2天前提交      │ │
│          │ │ [ ] 英语阅读  今天23:59        │ │ └─────────────────────────┘ │
│          │ │ 今天截止 (1)                   │ │ ┌ 本周一览 ───────────────┐ │
│          │ │ [ ] 数据结构  15:00            │ │ │ 一 二 三 四 五 六 日     │ │
│          │ │ 今天做 (1)                     │ │ │ ▂ ▅ ▃ ▆ ▂ ▁ ▁           │ │
│          │ │ [ ] 复习线代  45min            │ │ │ 3 个截止 · 2 个考试      │ │
│          │ │ 今天有安排 (1)                 │ │ └─────────────────────────┘ │
│          │ │ [ ] 计量作业  10:00–11:00      │ │                             │
│          │ └─────────────────────────────────┘ │                             │
│          │ ┌ 今天的时间 ────────────────────┐ │                             │
│          │ │ 08  [课程] [学习块]            │ │                             │
│          │ │ 10  [学习块]                   │ │                             │
│          │ │ 12  [考试]                     │ │                             │
│          │ │ 14  [课程]                     │ │                             │
│          │ │ 16  [学习块]                   │ │                             │
│          │ │ 18                             │ │                             │
│          │ │ 20                             │ │                             │
│          │ └─────────────────────────────────┘ │                             │
└──────────┴───────────────────────────────────┴─────────────────────────────┘
```

视觉层级：

- Now/Next 是唯一“Hero”级卡片，但不做成巨大 banner；高度 120–148。
- Attention 是一行 chip，不是第二组大卡片。
- 任务组是一整块 Surface，内部用 divider + Row，不再每行套 Card。
- 时间线是一整块 Surface，内部 grid。
- Rail 卡片 12px 圆角、弱 shadow；不堆叠多个强边框。

### 3.4 TodayToolbar

高度 48px，sticky 在 Header 下。

内容：

- 左：课程筛选 `UISelect`（全部课程 / 单课程）。
- 左：`只看风险` chip（active 时 mint/ink 反转）。
- 右：`N 项任务 · M 项风险`，tabular numbers。
- 移动端：只保留课程筛选图标 + 风险 chip；计数在标题下方。

行为：

- 课程筛选只影响任务组、Attention、时间线高亮；不改变 Now/Next 的课程（Now/Next 始终是真实今天）。
- `只看风险` 过滤 `at-risk` / `overdue`；空态显示“当前没有风险任务” + 清除筛选。
- 筛选状态进入会话记忆。

### 3.5 Now / Next

#### 结构

```text
┌──────────────────────────────────────────────────────────────┐
│ [eyebrow] 现在 · 第3节                         [course color]│
│ 微观经济学                                                   │
│ 14:00–15:40 · 教二 201 · 李老师                              │
│ [查看课程] [开始专注]                                        │
└──────────────────────────────────────────────────────────────┘
```

高度：120–148；移动端 112–132。

#### 状态优先级

1. **专注中**（running/paused）：
   - eyebrow `专注中`；
   - title = 任务名；
   - meta = 计时 + 关联课程；
   - CTA = 暂停/继续 + 结束；
   - 下一节课作为第二行小字。
2. **当前课程**（now 在 occurrence 内）：
   - eyebrow `现在 · 第 N 节`；
   - title = 课程名；
   - meta = 时间 · 地点 · 教师；
   - CTA = `查看课程`；若当前有未完成任务，可加 `开始专注`。
3. **下一节课程**（今天还有课）：
   - eyebrow `下一节 · 16:00`；
   - meta = `1 小时后 · 教二 201`；
   - CTA = `查看课程`。
4. **下一个截止**（今天/未来 warning 窗口）：
   - eyebrow `下一个截止`；
   - title = 任务名；
   - meta = `明天 23:59 · 计量经济学`；
   - CTA = `打开任务`。
5. **空**：
   - eyebrow `今天`；
   - title `没有课程和截止`；
   - meta `给自己留一点空白，或者补一件事`；
   - CTA = `快速添加`。

#### 规则

- 逾期 DDL 优先于未来 DDL；如果存在逾期，Now/Next 可以显示 `最早逾期` 而不是“下一个截止”。
- 当前课程使用 occurrence resolver；调课/停课/补课必须正确。
- 点击卡片空白处打开对应课程/任务；CTA 阻止冒泡。
- 时间每 30s tick；焦点在页面内时不打断输入。
- 课程色只作为左侧 3px accent + 小圆点，不做整卡背景。

### 3.6 Attention Strip

一行 2–4 个 chip：

```text
[! 逾期 2] [◷ 今天截止 1] [△ 有风险 3] [○ 未安排 4] [⚡ 冲突 1]
```

- 逾期：danger。
- 今天截止：warning。
- 有风险：sand。
- 未安排：mint/neutral。
- 冲突：danger outline；只有存在硬冲突时出现。
- 全部为 0 时隐藏整行（避免噪音）。
- 点击：
  - 逾期/今天截止：滚动到 Today 任务对应分组并短暂高亮。
  - 有风险：打开 Tasks `all` + `riskOnly`。
  - 未安排：打开 Plan Backlog `needsScheduling`。
  - 冲突：打开 Plan 并筛选冲突。
- 每个 chip 是可聚焦 button，`aria-label` 包含数量与动作。

`有风险` 的计算范围：

- active 任务；
- DDL 在未来 7 天内；
- `health === "at-risk"`；
- 排除已在 Today overdue/dueToday 的任务，避免重复。

`未安排` 的计算范围：

- active 任务；
- DDL 在未来 7 天内；
- `schedulingState !== "full"`；
- 排除 Today 已出现且今天已有 block 的任务。

### 3.7 Today 任务组

#### 分组

顺序固定：

1. **逾期**（danger dot）
2. **今天截止**（warning dot）
3. **今天做**（doDate，mint dot）
4. **今天有安排**（active StudyBlock，ink dot）

每个任务只出现一次，按 Phase 0 契约的优先级归组。

#### 组头

```text
[chevron] 逾期  2                    [查看全部]
```

- 组头是 button；点击展开/收起。
- 默认展开；超过 8 条时显示前 8 条 + `查看全部 N 项`（去 Tasks Today）。
- 空组不渲染。
- 组头计数使用 tabular numbers。

#### 任务行

```text
[✓/→]  计量作业                         [安排] [›]
       计量经济学 · 剩余 3h · 逾期 6h   ⚠
```

桌面高度 56–64；紧凑 48。

- 左侧完成控件：
  - active + `submissionRequired: false` → checkbox（完成）。
  - active + `submissionRequired: true` → 提交图标（纸飞机/勾选）。
  - submitted → 不显示可勾选控件；显示等待 chip。
- 标题：1 行 truncate；移动端 2 行 clamp。
- meta 行：
  - 课程色点 + 课程名；
  - DDL 相对时间（逾期/今天/明天/日期）；
  - 剩余 `3h`（unknown 不显示 0）；
  - `3/5` 子任务；
  - 重复图标；
  - Health 异常时显示小三角/文字，不只用颜色。
- 右侧：
  - hover/focus 显示 `安排`（日历图标）。
  - 常驻 chevron。
  - 移动端不依赖 hover：行尾 `⋯` 菜单。
- 逾期行：左侧 2px danger accent + 极浅 danger 背景；不做整行红色。
- 点击行：打开 `AssignmentDrawer`，保留 Today 滚动位置。
- 右键：上下文菜单（今天做/明天做/安排/优先级/DDL/删除）。
- 完成/提交：
  - preview（有 side effects）或直接执行 + Undo Toast；
  - 行 `ExitCollapse` 退场；
  - group count、Attention、Capacity、Waiting 同步更新。
- 空态：
  - `今天没有任务`；
  - 次级 `从本周挑一件事，或快速添加`；
  - 按钮 `从 Plan 挑一件事` / `快速添加`。
- 无课程 + 无任务：
  - 三步 setup：导入课表 / 添加课程 / 设置学期；
  - 不显示假装有数据的空 dashboard。

#### 为什么不在 Today 做多选

- Today 是决策面，不是管理面。
- 批量优先级/DDL/删除去 Tasks。
- Today 只保留单任务快速动作；减少 Bulk Bar 在移动端遮挡 BottomNav 的风险。

### 3.8 Today 时间线

#### 结构

```text
今天的时间                               [在 Plan 中编辑]
┌ All-day ────────────────────────────────────────────────┐
│ [考试] 计量期中   [活动] 社团招新                         │
├──────────────────────────────────────────────────────────┤
│ 08  ┃ [课程] 数据结构                                     │
│ 09  ┃                                                    │
│ 10  ┃ [学习块] 计量作业 10:00–11:00                        │
│ 11  ┃                                                    │
│ 12  ┃ [考试] 英语期中 12:00–13:30                         │
│ 13  ┃                                                    │
│ 14  ┃ [课程] 微观经济学                                   │
│ 15  ┃                                                    │
│ 16  ┃ [学习块] 复习线代 16:00–17:00                        │
│ 17  ┃                                                    │
│ 18  ┃                                                    │
│ 19  ┃                                                    │
│ 20  ┃                                                    │
└──────────────────────────────────────────────────────────┘
```

#### 时间窗口

- 默认 08:00–21:00。
- 动态扩展：取当天最早/最晚事件，前后加 30 分钟；clamp 到 06:00–24:00。
- 窗口外事件显示顶部/底部 chip：
  - `06:30 有 1 项`
  - `22:00 后 1 项`
- 点击 chip 展开完整时间窗或打开当天 Agenda；不能静默隐藏。

#### 高度

- 桌面 hourHeight = 44px（今天总览，不是完整周）。
- 移动端 hourHeight = 36px；时间线默认折叠为“接下来 3 项”，点击 `展开时间线` 才显示完整 grid。
- 不使用独立滚动；页面滚动。

#### 图层

| 图层 | 视觉 | 交互 |
|---|---|---|
| 课程 | 实色 course color 左侧 3px，标题+时间+地点 | 点击打开 CourseDrawer |
| 学习块 | 浅 mint 底 + 虚线边框，标题+时间，任务状态点 | 点击打开 AssignmentDrawer |
| 考试/活动 | 暖沙色块 + 图标，标题+时间 | 点击打开 mark 详情 |
| DDL | 小旗标 + 短标题；同一时刻多个聚合 +N | 点击打开任务 |
| 实际专注 | 浅 mint 半透明带（P1） | 点击打开专注详情 |
| 已释放计划 | 默认隐藏；不在 Today 显示 | — |

#### 重叠

- 课程与学习块重叠：并排缩窄，4px gap；不隐藏。
- 学习块之间硬冲突：并排 + danger outline；Today 不编辑，点击去 Plan 解决。
- 同一时段超过 3 个：显示前 2 个 + `+N` popover，不能静默堆叠。
- 块高度 < 18px：显示 2px 色条 + 可聚焦 tooltip，不直接消失。

#### Now Line

- 横跨 day column，1.5px。
- 左侧 `现在 15:12` pill。
- 每 60s 更新；只更新 now line 子组件，不重渲染整页。
- 当前周/当天才显示；如果 Today 是真实今天，始终显示。

#### 交互

- 点击块：打开对应实体 Drawer。
- hover/focus 学习块：右上角出现 `▶` 开始专注；打开 `FocusStartPopover`。
- Today 时间线**不支持拖拽编辑**；`在 Plan 中编辑` 进入 Plan 对应日期。
- 空态：
  - `今天没有安排`；
  - `在 Plan 中安排学习时间` / `快速添加任务`。
- 无课程但有学习块：
  - 仍显示学习块；
  - 顶部一行轻提示 `本周没有课程`，不能覆盖 grid（修复旧空态遮挡）。
- 数据：只读 active blocks；released 不绘制；occurrence resolver 生效。

### 3.9 Rail

#### Kiro Brief

```text
┌ Kiro 简报 ──────────────────────────┐
│ 今天 3 件事，最近截止是计量作业       │
│ （明天 23:59）。建议先做 45 分钟。     │
│ [Plan my day]        [换一个]        │
└──────────────────────────────────────┘
```

- 默认本地生成，不自动发 LLM。
- 本地 brief 规则：
  - 逾期 > 0：优先提示逾期。
  - 今天任务 > 0：提示第一件事 + 建议时长（取 remaining 或 45min）。
  - 今天无任务但 DDL 临近：提示最近截止。
  - 超载：提示“计划 5h / 可用 3h，建议移走 1 个学习块”。
  - 等待反馈 > 0：一句提示。
- `Plan my day`：打开 Kiro Sidecar，带 Today 上下文 + prompt；返回 proposal；用户接受后写入。
- `换一个`：本地重新排序建议，不调 LLM。
- 状态：
  - Kiro 未配置：`配置 Kiro 后可生成每日计划` + `去设置`。
  - loading：2 行 skeleton（仅用户主动请求后）。
  - error：`Kiro 暂时不可用` + `重试`；本地 brief 仍显示。
  - busy：`Kiro 正在处理，已加入队列` + 队列 badge。
- 不使用渐变/发光；Kiro Logo + 轻 mint 背景即可。

#### Capacity

```text
今日容量
计划 2h / 可用 4h            [====----]
未安排 1h

本周容量
计划 14h / 可用 18h          [=======---]
2 天超载
```

- 数字 tabular；单位用 `h` / `min`。
- `可用` 来自 `buildPlanningCapacity` 的 preferred 层；tooltip/`查看假设` 说明作息、周末、课程占用。
- 数据不足：`无法估算` + `补充作息或预计耗时`，不显示 0。
- 超载：danger 文本 + `让 Kiro 重排`（打开 Plan / Rescue）。
- 点击卡片：打开 Plan 当前周；`查看容量` popover 显示每天 planned/available。
- 进度条 `role="progressbar"`，aria-valuenow/min/max 使用分钟。

#### Waiting Feedback

```text
等待反馈 2
计量作业 · 昨天提交
统计学 · 2 天前提交
[查看全部]
```

- 0 时隐藏。
- 点击行打开任务 Drawer；`查看全部` 去 Tasks Waiting。
- 不出现“完成”按钮；等待反馈不是行动项。
- 提交时间未知显示 `提交时间未知`，不伪造。

#### Week Glance

```text
本周一览
一  二  三  四  五  六  日
▂  ▅  ▃  ▆  ▂  ▁  ▁
3 个截止 · 2 个考试
```

- 7 天（或 5 天，尊重 showWeekends）。
- 每天：weekday、date、load bar、任务/课程数量（通过 title/aria 显示）。
- 今天高亮；点击某天 -> Plan 对应日期。
- load bar 使用课程 + active blocks 的计划分钟；unknown 不伪造。
- 移动端横向滚动，每格 min 44px。
- 0 数据时显示 `本周还没有安排`，不画假柱。

### 3.10 Today 响应式

#### 手机线框（<768）

```text
┌ Today ──────────────────────┐
│ 11月6日 · 第8周    [+] [搜索]│
├──────────────────────────────┤
│ 现在 · 第3节                 │
│ 微观经济学                   │
│ 14:00–15:40 · 教二201        │
│ [查看课程]                   │
├──────────────────────────────┤
│ Kiro 简报                    │
│ 今天 3 件事，先做计量作业 45m │
│ [Plan my day]                │
├──────────────────────────────┤
│ [!逾期2] [◷今天1] [△风险3] → │
├──────────────────────────────┤
│ 今天要做                 5 项│
│ 逾期 2                       │
│ [ ] 计量作业                 │
│     计量经济学 · 剩余3h · 逾期│
│ [ ] 英语阅读                 │
│     大学英语 · 今天23:59     │
│ 今天截止 1                   │
│ [ ] 数据结构                 │
│ ...                          │
├──────────────────────────────┤
│ 今天的时间          [展开]   │
│ 接下来：                     │
│ 14:00 微观经济学             │
│ 16:00 复习线代               │
│ 23:59 英语阅读 DDL           │
├──────────────────────────────┤
│ 今日容量 2h/4h               │
│ 本周一览  ▂▅▃▆▂▁▁           │
└──────────────────────────────┘
│ Today Plan Courses Kiro More │
└──────────────────────────────┘
```

- 首屏只保证 Now/Next + 第一条任务；Kiro Brief 与 Attention 紧随其后。
- 时间线默认折叠为 Agenda 摘要；展开后显示完整单日 grid。
- BottomNav 不被 Bulk Bar 覆盖；Today 不做批量。

#### 平板 768–1023

```text
Header
Toolbar
Now/Next
Kiro Brief（紧凑）
Attention
今天要做
今天的时间（折叠为接下来 3 项）
Capacity（2 列）
Waiting / Week Glance（2 列）
```

- 单列，rail 卡片下移。
- Kiro Brief 在 Now/Next 之后，保证“今天建议”早出现。
- 时间线默认折叠；点击展开。

#### 手机 <768

```text
Header（标题 + 快速添加 + 搜索）
Now/Next
Kiro Brief（1 行 + Plan my day）
Attention（横向滚动 chips）
今天要做（前 3 组；每组前 5 条）
今天的时间（接下来 3 项）
Capacity
Week Glance
BottomNav
```

- 首屏必须出现 Now/Next + 至少第一条任务；时间线在 fold 以下。
- 不使用 520px 周课表。
- 任务行触控目标 ≥44px。
- 快捷动作通过行尾 `⋯` / Bottom Sheet，不依赖 hover。
- Quick Capture 全屏 sheet；键盘弹起时保持输入可见。

### 3.11 Today 空态 / 加载 / 错误

| 场景 | 表现 | 文案 |
|---|---|---|
| First Run | 三步 setup 卡 | `先导入课表，或添加第一门课程` |
| 无课程有任务 | 正常任务；顶部轻提示 | `本周没有课程，任务仍可安排` |
| 无任务有课程 | 任务组空态 | `今天没有任务` / `从 Plan 挑一件事` |
| 无任务无课程 | 空态 + setup | `今天还没有安排` |
| 无时间线事件 | 时间线空态 | `今天没有课程或学习块` |
| Capacity 缺数据 | 灰色 `无法估算` | `补充作息或预计耗时后可估算` |
| Kiro 未配置 | 配置卡 | `配置 Kiro 后可生成每日计划` |
| Kiro 错误 | 行内错误 | `Kiro 暂时不可用，手动规划不受影响` |
| 数据 hydration | 骨架 | 不显示 spinner 盖整页 |

### 3.12 Today 动效

| 动作 | 动效 | 时长 |
|---|---|---|
| 页面进入 | opacity 0.94→1 + 4px 上移 | 180ms |
| Now/Next 切换 | 交叉淡入 | 120ms |
| Attention chip hover | 背景/边框 | 120ms |
| 任务完成 | checkbox 120ms + 行 ExitCollapse 160ms | 160ms |
| 任务组展开 | height/opacity | 180ms |
| 时间线 now line | 位置更新 | 线性，无动画 |
| 时间线块 hover | 背景加深/边框 | 120ms |
| Kiro Brief 更新 | 文本交叉淡入 | 120ms |
| Undo Toast | 上移/淡入 | 160ms |

- 不使用庆祝动画、不弹彩带。
- 尊重 `prefers-reduced-motion` / Motion V6 reduced：只保留 opacity。

### 3.13 Today 可访问性

- 页面 `<main>` + `<h1>Today</h1>`；各组 `<section aria-labelledby>`。
- Now/Next 是 `article`，CTA 有明确 label。
- 任务行：
  - 行本身不是 button；内部有“打开任务”链接/按钮。
  - 完成控件 `aria-label="提交《任务名》"` / `"完成《任务名》"`。
  - 状态 chip 有文字，不仅颜色。
- 时间线：
  - 提供 `Agenda` 文本列表作为替代（移动端折叠视图就是 Agenda）。
  - 每个块 `aria-label="周一 10:00 到 11:00，计量作业学习块"`。
  - 块是 button，可 Tab 聚焦。
- Attention chip 是 button，数量 + 动作读屏可懂。
- 颜色对比：关键文字 ≥4.5:1；时间轴/元信息 ≥3:1 或 12px 以上。
- 焦点可见：2px ring，不被 overflow 裁剪。
- 键盘顺序：Header → Toolbar → Now/Next → Attention → 任务组 → 时间线 → Rail。
- 可在任务组区域使用 `J/K` / `Enter` / `Space`；`Esc` 清除高亮。

---

## 4. Plan

### 4.1 页面职责

Plan 是唯一的周计划工作台：

- 左：待安排任务（Backlog）。
- 中：统一时间画布（Calendar）。
- 右：选中实体 Inspector。
- 顶部：周切换、视图、图层、容量、AI 计划。
- Tasks 视图：复用现有任务工作区，承接旧 Assignments 页。

Plan 不做：

- 今日行动清单（Today 负责）。
- 课程资料管理（Courses 负责）。
- 复盘图表（Review 负责）。

### 4.2 数据绑定

| 区域 | 数据 | 规则 |
|---|---|---|
| Week | `semester / selectedWeek` | 周一–周日；showWeekends |
| Courses | `resolveCourseOccurrencesForWeek` | 调课/停课/补课生效 |
| Study blocks | `isActiveBlock` | released 默认隐藏 |
| DDL | `isActiveTask` + `hasTaskDeadline` | submitted/completed 不显示 |
| Exams/activities | `calendarMarks` | all-day / timed |
| Group deadlines | `groupProjects.tasks` | 只读；Phase 0 不桥接个人计划 |
| Capacity | `buildPlanningCapacity` | preferred/combined 说明 |
| Backlog | `buildPlanBacklogProjection` | selectedWeek + now |
| Inspector | canonical selectors | 不自行算逾期/剩余 |
| Proposal | Kiro proposal | ghost + apply/undo |

### 4.3 桌面线框（≥1880）

```text
┌ Sidebar ─┬─ WorkspaceHeader ────────────────────────────────────────────────────┐
│ Today    │ Plan · 第8周 · 11/3–11/9      [第8周▾] [Plan my week] [+新建] [搜索] │
│ Plan     ├─ PlanViewBar ────────────────────────────────────────────────────────┤
│ Courses  │ ‹ 今天 ›  11/3–11/9     [周|3日|日|Agenda|任务]   [图层][筛选]       │
│ Review   ├──────────────┬──────────────────────────────────┬───────────────────┤
│ Groups   │ Backlog 300  │ Canvas                           │ Inspector 340     │
│          │ 待安排 7     │ ┌ all-day ─────────────────────┐ │ 任务详情           │
│ Kiro     │ 逾期 2       │ │ 考试 活动 DDL               │ │ 状态 / 课程        │
│          │ [任务]       │ ├──────────────────────────────┤ │ DDL / doDate       │
│ Inbox    │ [任务]       │ │ 08 一 二 三 四 五 六 日      │ │ 预计 / 已排 / 剩余  │
│ Settings │ 本周到期 3   │ │ 09 [课程][学习块]            │ │ Health             │
│          │ [任务]       │ │ 10 [学习块]                  │ │ 子任务 / 资料       │
│          │ [任务]       │ │ 11                           │ │ [开始专注] [安排]  │
│          │ 需要安排 2   │ │ 12 [考试]                    │ │ [打开完整详情]     │
│          │ [任务]       │ │ 13                           │ │                   │
│          │              │ │ 14 [课程]                    │ │                   │
│          │              │ │ 15                           │ │                   │
│          │              │ │ 16 [学习块]                  │ │                   │
│          │              │ │ 17                           │ │                   │
│          │              │ │ 18                           │ │                   │
│          │              │ │ 19                           │ │                   │
│          │              │ │ 20                           │ │                   │
│          │              │ └──────────────────────────────┘ │                   │
└──────────┴──────────────┴──────────────────────────────────┴───────────────────┘
```

### 4.4 布局与断点

#### ≥1880：三列

- Backlog 300。
- Canvas `minmax(640, 1fr)`。
- Inspector 340。
- 三列独立滚动；Canvas 是主滚动。
- Inspector 关闭时 Canvas 扩展，宽度过渡 180ms。

#### 1440–1879：两列 + Inspector 覆盖

- Backlog 280 + Canvas。
- Inspector 以 360px 覆盖层从右侧滑入，覆盖 Canvas 右侧，不挤压日列。
- Backlog 可折叠；折叠后 Canvas 扩展。
- 这是默认笔记本尺寸，必须优先优化。

#### 1280–1439：两列 + 窄 Backlog

- Backlog 260 + Canvas。
- Inspector 覆盖层。
- 7 天日列 < 110px 时自动建议切 3-day；顶部出现轻提示，不强制切换。

#### 1024–1279：Canvas + Backlog Sheet

- Backlog 默认收起，ViewBar `待安排 N` 按钮打开左侧 Sheet。
- 默认 3-day；周视图可选。
- Inspector 覆盖层。

#### 768–1023：3-day

- 3 天列 + 时间轴。
- Backlog Bottom Sheet。
- Inspector 全屏 Sheet。
- Header/ViewBar 压缩，隐藏次要文字。

#### <768：Agenda / Day

- 默认 Agenda；Day 可选。
- Backlog Bottom Sheet。
- Inspector 全屏 Sheet。
- 不做 7 天网格。
- 拖拽禁用，改用“安排到…”。

#### 手机 Agenda 线框（<768）

```text
┌ Plan ───────────────────────┐
│ 第8周 · 11/3–11/9    [搜索]  │
├──────────────────────────────┤
│ ‹ 11/6 ›   [Agenda ▾] [筛选] │
├──────────────────────────────┤
│ 周四 11/6                    │
│ 全天                         │
│  [考试] 计量期中             │
│ 09:00–10:00                  │
│  [学习块] 计量作业           │
│ 10:00–11:40                  │
│  [课程] 数据结构 · 教二201   │
│ 14:00–15:40                  │
│  [课程] 微观经济学           │
│ 23:59                        │
│  [DDL] 英语阅读              │
├──────────────────────────────┤
│ 周五 11/7                    │
│ 08:00–09:00                  │
│  [学习块] 复习线代           │
│ ...                          │
└──────────────────────────────┘
│ [待安排 7]  [Plan my week]   │
│ Today Plan Courses Kiro More │
└──────────────────────────────┘
```

- Agenda 是移动端默认；点击行打开全屏 Inspector Sheet。
- 底部固定两条动作：`待安排 N` 打开 Backlog Sheet；`Plan my week` 打开 Proposal Sheet。
- 不展示 7 天网格；Day 视图可选，但仍是单列。
- 拖拽禁用；“安排到…”是唯一排期路径。

### 4.5 Header / ViewBar

#### Header

```text
Plan · 第 8 周 · 11月3日–11月9日
[第 8 周 ▾]  [Plan my week]  [+ 新建 ▾]  [搜索]
```

- `第 8 周 ▾` 打开 Week Picker。
- `Plan my week` 打开 Proposal Panel；无待安排任务时禁用，tooltip `先添加或安排任务`。
- `+ 新建` 菜单：
  - 新建任务（打开 Quick Add / Full Editor）
  - 新建学习块（打开 ArrangeSheet，默认当前选中时间）
  - 新建课程（现有 AddCourseModal）
  - 新建考试/活动（MarkSheet）
- Tasks 视图：`+ 新建任务`；`Plan my week` 禁用并提示回 Calendar。

#### ViewBar

```text
[‹] [今天] [›]  11/3–11/9     [周 | 3日 | 日 | Agenda | 任务]     [待安排 7] [图层] [筛选]
```

- 左：周导航。`今天` 回到当前周 + 今天；已在当前周时滚动到 now。
- 中：视图 SegmentedControl。
- 右：
  - `待安排 N` 按钮（<1280 时打开 Backlog Sheet；≥1280 时可折叠/展开 Backlog）。
  - `图层` Popover。
  - `筛选` Popover。
  - `密度` 在图层 popover 内（44/60/80 px/h）。
- 周标签点击打开 Week Picker。
- 视图切换不改 URL（Tab 状态）；但进入 Tasks 时记忆上一次任务视图。
- 移动端：`‹ 11/6 ›` + 视图下拉 + `筛选` + `更多`。

### 4.6 Backlog

#### 结构

```text
待安排 7                         [折叠]
[全部课程 ▾] [只看风险]

逾期 2
  [::] 计量作业     计量经济学   逾期6h   剩余3h   ⚠
  [::] 英语阅读     大学英语     昨天     剩余1h
本周到期 3
  [::] 数据结构     计算机      周五     剩余2h
  ...
需要安排 2
  [::] 复习线代     数学        下周三   剩余1h
```

- 组：逾期 / 本周到期 / 需要安排。
- 组头 sticky；可折叠；计数 tabular。
- 排序按 Phase 0 契约。
- 每项高度 64；紧凑 52；触控目标 ≥44。
- 拖拽手柄 `::` 在左；桌面整行可拖；移动端 `安排` 按钮。
- 行内容：
  - 标题（1 行 truncate，tooltip 全名）
  - 课程色点 + 课程名
  - DDL 相对时间
  - `剩余 3h`（unknown 不显示 0）
  - priority/health 小标记
  - hover/focus `安排` / `⋯`
- 拖入 Canvas：
  - 默认时长 `clamp(remainingMinutes ?? 60, 30, 120)`，15 分钟取整。
  - 无估时 → 60。
  - 拖拽 ghost 显示 `周三 10:00–11:00 · 60min`。
  - 冲突时红 ghost，drop 拒绝并提示最近空档。
  - 成功后打开 Inspector，Toast `已安排 1h · 撤销`。
- 空态：
  - `没有待安排任务`；
  - `所有任务都已安排，或者去任务页添加`；
  - 按钮 `打开任务`。
- 筛选：
  - 课程单选；riskOnly；只看有 DDL；只看有估时？保持简单：课程 + risk。
- 移动端：
  - Bottom Sheet 高度 70dvh；顶部 drag handle；内部滚动。
  - 任务行右侧 `安排` 按钮；点击打开 Arrange Sheet。

### 4.7 Canvas

#### 时间轴

- 默认 08:00–22:00。
- 动态扩展：最早/最晚事件前后 30min，clamp 06:00–24:00。
- 15 分钟网格；整点线更深；半点线更浅。
- 左侧时间轴 56px；小时标签 11px，对比度 ≥4.5:1。
- 顶部 all-day strip 32–96px。
- 日列 min 120px；周视图 7 列；showWeekends=false 时 5 列。
- 日列头：
  ```text
  周一  11/3   [容量条]  3 项
  ```
  - 今天：mint tint + `今天` chip。
  - 周末：alabaster tint。
  - 容量条：planned/available；超载 danger。
  - 点击日列头 -> Day view。
- Now line：仅当前周/今天；60s tick；独立组件。
- 非当前周：不显示 now line；ViewBar 显示 `正在查看第 8 周` / `回到今天`。

#### 图层

| 图层 | 默认 | 视觉 | 交互 |
|---|---|---|---|
| 课程 | 开 | 实色 course color；标题/时间/地点 | 点击 Inspector 课程摘要；双击打开 CourseDrawer |
| 学习块 | 开 | mint 虚线；标题/时间/任务状态点 | 选择/拖拽/缩放 |
| DDL | 开 | 小旗标 + 标题；时刻定位；all-day 在顶部 | 点击任务 |
| 考试/活动 | 开 | 暖沙色块；图标/标题 | 点击 mark |
| 小组截止 | 开 | 小旗标 + 小组图标；只读 | 点击打开 Group deep link |
| 实际专注 | 关 | 浅 mint 半透明带 | P1 |
| 已释放计划 | 关 | 灰色虚线、低透明；只读 | 点击查看历史任务 |
| 时间冲突 | 自动 | danger outline + badge | 点击 Inspector 解决 |

Layers Popover：

- checkbox + 图标 + 说明；
- `显示已释放计划` 单独分组，标注“只读”；
- 密度 `44 / 60 / 80 px/h`；
- `重置图层`。
- 图层状态会话记忆；不写业务数据。

#### DDL 与考试/活动

- 有具体时间：在日列对应时刻画一个 `flag` 标记 + 短标题；同一时刻多个 -> 堆叠 +N popover。
- 无具体时间（all-day）：进入顶部 all-day strip，最多 3 行 + `+N`。
- DDL 不再使用水平 Key Lane。
- 考试/活动：
  - 有 start/end -> interval block；
  - 无时间 -> all-day chip。
- 颜色：
  - DDL danger/sand flag；
  - exam 深 sand；
  - activity 浅 sand。
- 不可拖拽；点击打开详情。

#### 块布局

- 课程/学习块/考试/活动共用重叠布局算法：
  - 同一时间段重叠 -> 等宽并排，4px gap；
  - >3 个 -> 前 2 + `+N` popover；
  - 最小高度 18px；<18px 显示 2px 色条 + tooltip，仍可聚焦/点击。
- 学习块与课程重叠：
  - 并排显示（soft overlap），不再隐藏成一个点；
  - 学习块右上角显示 `与课程重叠` 小图标；
  - 拖动到课程时间时，drop 前显示确认 `与课程时间重叠，仍要安排？`；确认后写 courseOverlapApproval。
- 学习块之间硬冲突：
  - 拖动 ghost danger；
  - drop 拒绝；
  - Inspector 显示冲突对象 + “移到最近空档”。
- 已释放计划：
  - 默认不渲染；开启图层后灰色虚线只读；
  - 不参与重叠布局的 active 计算，避免把当前计划挤窄；
  - 点击可查看原任务。

#### 空白格

- 单击空白：选择时间槽，显示轻量菜单：
  - `新建学习块`
  - `新建任务`
  - `新建考试/活动`
- 双击空白：直接打开 ArrangeSheet，预填时间（默认 60min）。
- 不静默创建 block；必须经过 sheet 或明确的“快速创建”确认。
- 空白格 hover 显示时间 tooltip。

#### 容量

- 日列头容量条：planned/available。
- ViewBar 右侧 `本周 14h / 18h`：
  - under：mint；
  - near：sand；
  - over：danger；
  - unknown：`无法估算`。
- 超载 banner（Canvas 顶部，仅 when over）：
  ```text
  这周排不下：计划 18h / 可用 14h。
  [Rescue my week] [查看容量]
  ```
- 点击 `查看容量` 打开 per-day 明细 popover；不跳页。

#### 空态

- 无课程：
  - Canvas 仍显示任务/学习块；
  - 顶部轻提示 `本周没有课程` + `导入课表`；
  - 空态不能覆盖已有 blocks（修复旧 P0）。
- 无学习块：
  - `这周还没有学习计划`；
  - `从待安排拖入，或让 Kiro 规划`；
  - CTA `Plan my week`。
- 无待安排 + 无 blocks：
  - `这周还很空` + `新建学习块` / `打开任务`。
- 搜索无结果：
  - `没有匹配的任务或时间块` + `清除筛选`。

### 4.8 Inspector

#### 任务 Inspector

```text
┌ 任务 ─────────────────────────── [×] ┐
│ 计量作业                             │
│ 计量经济学 · 高优先级 · 进行中        │
│                                      │
│ 截止  明天 23:59            [修改]   │
│ 今天做 11/6                 [修改]   │
│ 预计  3h                             │
│ 已排  1h  ·  剩余 2h                 │
│ Health 有风险：截止前可用时间不足     │
│                                      │
│ 子任务  2/5                          │
│ [ ] 收集数据                         │
│ [ ] 写方法                           │
│ ...                                  │
│                                      │
│ 资料  2 份                           │
│ [开始专注] [安排] [打开完整详情]      │
└──────────────────────────────────────┘
```

- Header：类型 badge + 标题 + 关闭。
- 状态 chip 只读；主操作在底部。
- DDL/doDate inline 编辑；closed 任务只读。
- 子任务：active 可勾选；closed 只读。
- Health 使用 canonical selector；closed 不显示。
- 资料显示数量 + 前 2 个；点击打开 FilePreview。
- 底部动作：
  - `开始专注`（active）
  - `安排`（打开 ArrangeSheet）
  - `提交/完成`（走 preview）
  - `打开完整详情`（AssignmentDrawer）
  - `更多`（删除、重新打开等）
- `Ask Kiro` 在 Inspector header 的 `⋯` 菜单里，或底部次级；不要每段都放 AI 按钮。

#### 学习块 Inspector

```text
┌ 学习块 ───────────────────────── [×] ┐
│ 计量作业 · 周三 10:00–11:00          │
│ 关联任务：计量作业（进行中）          │
│ 课程：计量经济学                      │
│ 时长：60min                          │
│ 冲突：无 / 与课程重叠（已批准）       │
│ [开始专注] [编辑时间] [复制] [删除]   │
└──────────────────────────────────────┘
```

- 编辑时间：内联日期/开始/结束，15min step；保存前校验冲突。
- 复制：复制到明天同一时间；冲突则提示。
- 删除：Toast Undo。
- 已完成任务的学习块可能是 released；默认只读，显示“已释放”。

#### 课程 Inspector

- 课程名、代码、教师、地点、下一节、本周任务、资料数。
- `打开课程` -> CourseDrawer。
- 不做完整 Course Home（下一阶段）。

#### 空态

- `选择一个任务或时间块`；
- `从左侧拖入任务，开始安排这一周`；
- 快捷 `新建学习块`。

### 4.9 Plan Proposal Panel（Plan my week / Rescue）

#### 入口

- Header `Plan my week`。
- 超载 banner `Rescue my week`。
- Inspector 任务 `让 Kiro 安排这个任务`（可选，打开同一面板，scope=task）。

#### 布局

- ≥1440：右侧 dock 360px，覆盖/替换 Inspector；Canvas 保持可见，显示 ghost。
- <1440：全屏 Sheet 或右侧覆盖层；Canvas 在背后可见但不交互，直到关闭。
- 移动端：全屏 Sheet；不显示 ghost，改用 before/after 列表。

#### 内容

```text
┌ 本周计划建议 ─────────────── [×] ┐
│ Kiro · 需要安排 6h / 可用 9h      │
│ 7 个学习块 · 已避开 2 个冲突       │
│                                  │
│ 周一                             │
│ [✓] 计量作业 10:00–11:00  1h     │
│     原因：截止最早，上午空闲       │
│ [✓] 英语阅读 16:00–17:00  1h     │
│ 周二                             │
│ [✓] 数据结构 09:00–10:30  1.5h   │
│ ...                              │
│                                  │
│ [全部接受] [接受选中] [调整] [取消]│
└──────────────────────────────────┘
```

- 摘要：需求分钟 / 可用分钟 / block 数 / 冲突数 / 假设。
- 每项：checkbox、任务、时间、时长、原因（可展开）。
- `调整`：关闭面板，在 Canvas 上保留 ghost，允许拖动 ghost 后再接受？Phase 1 可以只允许逐项取消，不支持拖 ghost；P1 再支持。
- Ghost：
  - 新增 block：mint dashed；
  - 移动：before 位置灰色 + after 位置 mint + 箭头；
  - 冲突：danger dashed；
  - 全部 ghost `pointer-events-none`，避免误操作。
- Apply：
  - Preflight -> 若有冲突，阻止并列出；
  - 原子写入；
  - Toast `已应用 7 个学习块 · 撤销`；
  - 关闭面板，选中第一个新块。
- Cancel：
  - ghost 180ms 淡出；0 写入。
- 失败：
  - 行内错误 + 重试；不关闭面板；不部分写入。

### 4.10 Tasks 视图（复用旧 Assignments）

- Plan ViewBar 选中 `任务`。
- Backlog/Inspector/Canvas 隐藏；全宽任务工作区。
- 复用：
  - `AssignmentTable` workspace
  - `AssignmentWorkspaceViewBar`
  - `QuickAddCard`
  - `AssignmentPeekPanel`
  - `AssignmentContextMenu`
  - `useAssignmentWorkspaceController`
- Plan Header 保留，标题 `Plan`，context `任务 · 第 8 周`，主按钮 `+ 新建任务`。
- 视图集合使用 Phase 0 契约：Today / Upcoming / Unscheduled / Waiting / Completed / All。
- `at-risk` 变 filter chip；不再有孤儿视图。
- 任务视图的课程筛选、搜索、riskOnly 会话记忆。
- 点击任务打开 AssignmentDrawer；关闭回 Tasks 原滚动。
- 这是旧 Assignments 页的迁移目标；不重新实现一套列表。
- 需要拆分 `AssignmentsWorkspace` 为：
  - `TaskWorkspaceBody`（ViewBar + QuickAdd + Table + Peek + Bulk）
  - `AssignmentsWorkspace`（独立页壳，迁移期保留）
  - `PlanTasksView`（嵌入 Plan 的壳）
- 避免双 Header：PlanTasksView 不渲染自己的 WorkspaceHeader。

### 4.11 Agenda 视图

移动端默认；桌面也可选，作为可访问替代。

```text
11月6日 周四
全天
  [考试] 计量期中
09:00–10:00
  [学习块] 计量作业
10:00–11:40
  [课程] 数据结构 · 教二201
14:00–15:40
  [课程] 微观经济学
23:59
  [DDL] 英语阅读
```

- 按天分组；sticky day header。
- 每行：时间、类型图标、标题、课程、状态。
- 点击打开 Inspector / Drawer。
- 空天：`今天没有安排`。
- 适合读屏与移动端；不显示重叠几何，只按时间排序。

### 4.12 交互细节

#### 拖拽

- 从 Backlog 拖入：
  - 拖动阈值 4px；行 lift（scale 1.01 / shadow）。
  - ghost 跟随指针；Canvas 高亮最近 30min 槽。
  - drop 计算 day + start + duration；15min snap。
  - 默认时长见 4.6。
  - 冲突：硬冲突拒绝；课程重叠 soft confirm。
  - 成功后 Inspector 打开；Toast Undo。
- 移动学习块：
  - 拖动 body；保持时长；15min snap。
  - 跨日：左右移动到相邻日列。
  - 跨周：P1；MVP 通过 Week Picker + 重新拖。
  - 自动滚动：距 Canvas 上下边缘 48px 时 rAF 滚动；左右日列不自动滚（周视图全部可见）。
  - Esc 取消，块回到原位。
- 缩放学习块：
  - 上下 handle；最小 15min；15min snap。
  - 拖动顶部改开始，底部改结束。
  - 冲突时 handle 红色，release 回退。
- 课程拖拽：
  - 仅 `enableScheduleDirectManipulation` + 精细指针 + ≥768；
  - 默认课程只读；Layers 里显示锁图标；
  - 移动/缩放走现有 `TimetableGrid` 交互与冲突检测。
- 多选：
  - MVP 单选。
  - P1：Shift 点选 + 批量移动；先不做框选。

#### 键盘（Plan scoped）

| 键 | 行为 |
|---|---|
| `[` / `]` | 上一周 / 下一周 |
| `T` | 回到今天 |
| `W` | Week Picker |
| `L` | Layers |
| `F` | Filters |
| `1` | 周视图 |
| `2` | 3 日 |
| `3` | 日 |
| `4` | Agenda |
| `5` | 任务 |
| `↑` / `↓` | 在 Canvas 中按 15min 移动选中块（或选择相邻块） |
| `←` / `→` | 前后一天 |
| `Enter` | 打开 Inspector |
| `E` | 编辑选中块时间 |
| `Delete` | 删除选中块（Undo） |
| `S` | 安排选中的 Backlog 任务 |
| `Esc` | 清除选择 / 关闭 popover |

- 全局快捷键优先：`Cmd/Ctrl+K`、`/`、`?`、`N` 不被 Plan 覆盖。
- 输入框聚焦时，Plan 快捷键禁用。
- 快捷键指南更新；不宣称未注册的键。

#### 周切换

- `‹` / `›` / `[` / `]`：selectedWeek ±1；Canvas 180ms 方向位移 + 淡入；Header/Backlog 同步。
- `今天` / `T`：回到当前周 + 今天；如果已在当前周，滚动到 now line。
- Week Picker：
  - 16 周矩阵；当前周 ring；选中周 filled；考试/DDL 点；点击跳转。
  - 键盘方向键 + Enter。
  - 移动端 Bottom Sheet。
- 跨周时 Backlog 重新计算 `dueThisWeek`；overdue 仍按真实 now。

#### 搜索

- ViewBar 搜索图标打开全局 Command Center？Plan 内搜索需要过滤任务/块。
- 设计：
  - 点击搜索 -> ViewBar 变成输入框；输入过滤 Backlog 和 Canvas 高亮。
  - 结果：任务、学习块、课程、DDL、考试/活动。
  - `Esc` 清除；`Enter` 打开第一个结果。
  - 移动端全屏搜索。
- 全局 `⌘K` 仍可搜全应用；Plan 内搜索只过滤当前计划。

#### 创建

- `+ 新建` 菜单。
- 新建任务：Quick Add（默认 doDate=selectedDate，若在 Calendar 视图）。
- 新建学习块：ArrangeSheet，预填 selectedDate/selectedTime；必须选任务或标题；默认 60min。
- 新建课程：现有 AddCourseModal。
- 新建考试/活动：MarkSheet，预填 selectedDate。
- 创建成功后：
  - 若当前视图/筛选看不到，Toast 带 `查看`；
  - 不静默消失。

### 4.13 计划容量与 Rescue

- `CapacityStrip`（ViewBar 下方或 Canvas 顶部）：
  - `本周 14h / 18h`；
  - `2 天超载`；
  - 进度条分段：已计划 / 未安排需求 / 可用余量。
- 超载判定：
  - 任一天 planned > available；
  - 或周总 planned > available。
- Banner：
  ```text
  这周排不下：计划 18h / 可用 14h。
  [Rescue my week] [查看容量]
  ```
- `Rescue my week` 打开 Proposal Panel，scope=week，Kiro 生成 move/shorten/defer 建议；不自动改 DDL。
- 数据不足：`无法估算`，不显示 0；提示补充作息/估时。
- Capacity 计算与 Phase 0 契约一致，排除 released blocks。

### 4.14 Plan 空态 / 加载 / 错误

| 场景 | 表现 | 文案 |
|---|---|---|
| Hydration | 骨架：Header/ViewBar/Canvas 网格 | 不盖整页 spinner |
| 无课程 | Canvas 仍显示 blocks；顶部轻提示 | `本周没有课程` / `导入课表` |
| 无 blocks | Canvas 空态 | `这周还没有学习计划` / `从待安排拖入，或 Plan my week` |
| 无 Backlog | 左栏空态 | `没有待安排任务` |
| 无搜索结果 | Canvas/Backlog 空态 | `没有匹配的任务或时间块` |
| Kiro 未配置 | Proposal 错误 | `配置 Kiro 后可生成计划` |
| Kiro 错误 | 行内错误 | `Kiro 暂时不可用，手动规划不受影响` |
| 数据读取失败 | 顶部 banner | `数据读取失败，已进入保护模式` |
| 冲突 | Banner + badge | `2 个时间冲突` / `查看冲突` |

### 4.15 Plan 动效

| 动作 | 动效 | 时长 |
|---|---|---|
| 页面进入 | opacity + 4px | 180ms |
| 周切换 | 方向 8px + fade | 180ms |
| Backlog 折叠 | width/opacity | 180ms |
| Inspector 打开 | 8px slide + fade | 180ms |
| 拖拽开始 | scale 1.01 + shadow | 120ms |
| Drop | 160ms settle | 160ms |
| Ghost 出现 | opacity 0→1 | 180ms |
| 接受计划 | ghost → real block morph | 200ms |
| 冲突 | 边框/背景闪烁一次（不循环） | 120ms |
| Toast | 上移/淡入 | 160ms |

- 拖拽跟手不动画；只有 lift/settle 有动画。
- 周切换不使用整页 remount。
- reduced motion：只保留 opacity，不做位移/scale。
- 不使用连续 pulse 的 now line / 过期项；静态即可。

### 4.16 Plan 可访问性

- Plan 根 `<main>`；Canvas `role="grid"`，日列 `role="columnheader"`，时间槽 `role="gridcell"`。
- 每个 block 是 button，`aria-label` 含星期、时间、类型、标题、状态。
- Agenda 视图是可访问替代；ViewBar 明确提供。
- 拖拽有键盘替代：
  - Backlog 的 `安排` 按钮；
  - Inspector 的日期/时间输入；
  - 选中块后用方向键移动。
- 焦点管理：
  - 打开 Inspector 后焦点进入 Inspector 标题；
  - 关闭后回到触发块；
  - Proposal Panel 打开后焦点进入面板，Esc 关闭（有未接受改动时确认）。
- live region：
  - `已安排 1 小时`
  - `已应用 7 个学习块`
  - `周切换：第 9 周`
- 颜色不是唯一编码：DDL/考试/学习块都有图标/文字。
- 触控目标 ≥44px；块内小按钮在移动端改为 Sheet 动作。
- 对比度：时间轴、块标题、meta 达到可读标准；关键文字不用 9px。

### 4.17 Plan 性能

- Canvas 只渲染当前视图的日列；周视图 7 列 × 14h，DOM 可控。
- 每个 block memo；拖拽期间用 CSS transform + ref，不 setState per pointermove。
- now line / capacity 独立组件，60s tick 不重渲染 Canvas。
- Backlog 使用 `content-visibility: auto` 或虚拟化（>100 项）。
- 容量/冲突计算 memo；按 selectedWeek + blocks 版本失效。
- Proposal ghost 单独 layer，accepted 后一次性提交。
- 目标：
  - 拖拽 60fps；
  - 视图切换 <100ms；
  - 周切换 <180ms；
  - 2,000 tasks + 1,000 blocks 下 Backlog 不卡。

---

## 5. 共享视觉与组件

### 5.1 Surface 层级

延续 `ui-product-system-v1`：

1. **Page**：`--background` #F7F5F5。
2. **Surface**：`bg-surface` + `border-line` + 12–14px radius + 极弱 shadow。
3. **Row**：无独立卡片；hover `bg-alabaster/50`；divider。
4. **Floating**：Popover / Sheet / Toast：`bg-surface` + `border-line-strong` + `shadow-card`。
5. **Selected**：共享 selection indicator；不每个 item 自己加边框。

Today：

- Now/Next = Surface。
- Attention = chips，不是 Surface 套 Surface。
- 任务组 = 一个 Surface。
- 时间线 = 一个 Surface。
- Rail = 多个独立 Surface，但每个只承担一个信息组。

Plan：

- Canvas = 一个 Surface。
- Backlog = 一个 Surface。
- Inspector = 一个 Surface。
- 不在 Backlog/Inspector 内继续套 Card；用 Row + divider。

### 5.2 尺寸

| 元素 | 尺寸 |
|---|---|
| Header | 64px |
| Toolbar / ViewBar | 44–48px |
| Today rail | 340 / 320 / 300 |
| Plan Backlog | 300 / 280 / 260 |
| Plan Inspector | 340 / 360 overlay |
| Canvas day min | 120px |
| Hour height | Today 44 / Plan 60 default；compact 44；focus 80 |
| Task row | 56–64 / compact 48 |
| Block radius | 10–12px |
| Icon | 14–16px |
| Touch target | ≥44px |

### 5.3 字体

- 页面标题：20px / 600。
- Section 标题：13–14px / 600。
- Now/Next 标题：16–18px / 600。
- 任务标题：12–13px / 500–600。
- Meta：11–12px；关键 meta 不用 9px。
- 时间轴：10–11px；对比度足够。
- 数字：`tabular-nums`。
- 长标题：1 行 truncate + tooltip；移动端 2 行 clamp。

### 5.4 颜色

- 页面/表面：现有暖纸面 token。
- Ink：`--charcoal`。
- Muted：`--satin-grey` / `--sandrift`；sandrift 只用于非关键信息。
- Mint：学习块 / 成功 / 今天。
- Sand：warning / exam / activity。
- Danger：overdue / conflict。
- 课程色：`course.bgHex` / `course.textHex`；必须保证文字对比度；深色课程用 `textHex` 或白色。
- 不用高饱和渐变；不用玻璃拟态。

### 5.5 动效 token

沿用 Motion V6：

- `--motion-fast` 120ms
- `--motion-page` 180ms
- `--ease-standard`
- 拖拽 settle 160ms
- 不新增旁路时长；如确需 200ms，使用 `--motion-page` 的扩展 token 并在 motion contract 注册。

### 5.6 组件清单

新增：

- `components/today/TodayWorkspace.tsx`
- `components/today/TodayToolbar.tsx`
- `components/today/NowNextCard.tsx`
- `components/today/AttentionStrip.tsx`
- `components/today/TodayTaskGroups.tsx`
- `components/today/TodayTaskRow.tsx`
- `components/today/TodayTimeline.tsx`
- `components/today/TodayRail.tsx`
- `components/today/KiroBriefCard.tsx`
- `components/today/CapacityCard.tsx`
- `components/today/WaitingFeedbackCard.tsx`
- `components/today/WeekGlance.tsx`
- `components/plan/PlanWorkspace.tsx`
- `components/plan/PlanViewBar.tsx`
- `components/plan/PlanBacklog.tsx`
- `components/plan/PlanCanvas.tsx`
- `components/plan/PlanInspector.tsx`
- `components/plan/PlanProposalPanel.tsx`
- `components/plan/PlanTasksView.tsx`
- `components/plan/WeekPicker.tsx`
- `components/plan/LayersPopover.tsx`
- `components/plan/PlanAgenda.tsx`
- `components/plan/PlanDayView.tsx`
- `hooks/useTodayController.ts`
- `hooks/usePlanController.ts`
- `hooks/useWorkspaceMemory.ts`
- `store/useWorkspaceContextStore.ts`（非持久化）
- `lib/today/projection.ts`（或复用 `lib/tasks/taskProjections.ts`）
- `lib/plan/layout.ts`（重叠布局/时间槽）
- `lib/plan/drag.ts`（拖拽状态机）
- `lib/plan/capacityView.ts`（容量展示 projection）

复用：

- `TimetableGrid`（扩展 `variant="plan"`, `timeRange`, `hourHeight`, `allDayStrip`, `deadlineLayer`, `focusLayer`, `ghostLayer`）
- `lib/timetableInteraction.ts`
- `lib/timeline/studyBlockInteraction.ts`
- `lib/timeline/studyBlockPlacement.ts`
- `lib/planning/courseOverlapPolicy.ts`
- `lib/planning/planningCapacity.ts`
- `StudyPlanProposalCard` / `StudyRebalanceProposalCard`（抽出共享 proposal 逻辑）
- `FocusStartPopover` / `FocusControl`
- `AssignmentTable` / `AssignmentWorkspaceViewBar` / `useAssignmentWorkspaceController`
- `WorkspaceHeader` / `WorkspaceViewBar`
- `Drawer` / `OverlayLayer` / `Dialog` / `Popover`
- `UISelect` / `SegmentedControl` / `DisclosureRegion`
- `ExitCollapse` / `useExitPresenceList`
- `FloatingTimelineDetail`（可复用碰撞定位）

不新增：

- 第二套拖拽引擎。
- 第二套任务列表。
- 第二套 Kiro runtime。
- 第二套 overlay 体系。

---

## 6. 状态所有权

### 6.1 页面状态

```ts
interface WorkspaceContextState {
  /** Plan 当前浏览周；会话级，不持久化 */
  planWeek: number;
  /** Plan 当前选中日期 */
  planDate: string;
  /** Plan 视图 */
  planView: "week" | "3-day" | "day" | "agenda" | "tasks";
  /** 图层 */
  planLayers: {
    courses: boolean;
    studyBlocks: boolean;
    deadlines: boolean;
    events: boolean;
    groupDeadlines: boolean;
    focusActual: boolean;
    releasedPlans: boolean;
  };
  /** 筛选 */
  planFilters: {
    courseId: string | "all";
    riskOnly: boolean;
  };
  /** Today */
  todayCourseFilter: string | "all";
  todayRiskOnly: boolean;
  /** 会话内滚动/展开 */
  todayScrollTop: number;
  planScrollTop: number;
  expandedTodayGroups: string[];
  expandedBacklogBuckets: string[];
  /** 选中实体 */
  selectedPlanEntity: { type: "task" | "block" | "course" | "mark"; id: string } | null;
}
```

- 非持久化；应用重启回当前周/今天。
- `useWorkspaceContextStore` 只存 UI 上下文，不进 backup。
- `todayScrollTop` / `planScrollTop` 不放进响应式 selector：由 `useWorkspaceMemory` 以 ref / module 级节流记录，避免滚动时触发全页重渲染；离开页面时写一次，返回时恢复。
- `selectedWeek` 不再由各页面自己持有；Today/Plan/Review 共享读取（Review 下一阶段）。
- Tasks 视图的任务筛选仍由 `useAssignmentWorkspaceController` 管理；Plan 只保留视图选择。

### 6.2 数据状态

- 任务/课程/学习块/提醒继续在 `useAppStore`。
- Today/Plan 只派生，不复制业务数据。
- 派生 hook：
  - `useTodayController`：todayProjection、nowNext、attention、timelineItems、capacity、waiting。
  - `usePlanController`：weekDates、occurrences、activeBlocks、backlog、conflicts、capacity、selectedEntity。
- 所有派生纯函数在 `lib/`，hook 只做 memo/subscription。
- Kiro proposal 不写 store，直到用户接受。

### 6.3 与全局 Drawer 的关系

- Today 任务行点击 -> `setSelectedAssignmentId` -> AssignmentDrawer。
- Plan Inspector `打开完整详情` -> `setSelectedAssignmentId` -> AssignmentDrawer。
- Plan 课程 -> `setSelectedCourseId` -> CourseDetailDrawer。
- 关闭 Drawer 后回到 Today/Plan 原位置；不切换 tab。
- 不在 Drawer 内再叠另一个 Drawer；需要跳转时先关闭当前，保留返回路径（P1 做 Drawer stack）。

---

## 7. 迁移与 Feature Flag

### 7.1 页面迁移

- `OverviewWorkspace` -> `TodayWorkspace`。
- `TimelineWorkspace` -> `PlanWorkspace`：
  - 保留 `TimetableGrid` 作为 Canvas 核心；
  - 退役 `TimelineKeyLane` 水平轴；
  - `TimelineUnscheduledShelf` -> `PlanBacklog`（新 projection）；
  - `ArrangeSheet` / `MarkSheet` 复用；
  - `TimelineWorkspace` 的 drag 逻辑抽取到 `usePlanController` / `lib/plan/drag.ts`。
- `AssignmentsWorkspace` -> `PlanTasksView`：
  - 抽 `TaskWorkspaceBody`；
  - 旧路由保留 alias。
- `MiniCalendar`：
  - Today 不再使用完整 MiniCalendar；用 `WeekGlance`。
  - Plan 用 `WeekPicker`。
  - 旧 MiniCalendar 可在迁移期保留在旧 Overview；新页面不引用。
- `TimetableQuickGlance`：
  - Today 的 Now/Next 复用其数据逻辑；
  - 旧 QuickGlance 可在 Plan 中退役或并入日列容量。
- `StudyLoadChart`：
  - Today 用 `CapacityCard`；
  - Plan 用日列容量条 + Capacity popover；
  - 旧图表不在首屏。

### 7.2 Feature Flag

- `todayPlanV1` build-time + localStorage override。
- 读路径：
  - Sidebar / nav 根据 flag 切换。
  - `activeTab` 旧值映射。
- 写路径：
  - Today/Plan 新交互默认走 Phase 0 契约命令。
  - Flag OFF 时旧页面仍可用；旧页面继续走旧 API（迁移期）。
- 灰度：
  1. 内部 dev
  2. 5–10 名 beta 学生
  3. 10% → 50% → 100%
- 回滚：
  - 页面层 flag 关闭即可回旧 Overview/Timetable/Assignments。
  - 数据层 Phase 0 字段 additive；旧页面忽略。
  - 若旧页面读 submitted/progress，行为回到旧口径；需在 beta 说明。

### 7.3 路由别名

- `overview` -> `today`
- `timetable` -> `plan?view=week`
- `assignments` -> `plan?view=tasks`
- `analytics` -> `review`（下一阶段）
- `group` -> `groups`（下一阶段）

深链：

- `openTimelineAtDate` -> `openPlanAtDate`。
- 任务排期 pending -> Plan 对应日期。
- 课程下一节 -> Plan / Today Now/Next。
- Kiro Action Card -> Today/Plan 对应实体。

### 7.4 启动页

- `startupView` 增加 `today` / `plan`。
- 旧 `overview` -> `today`；`timetable` -> `plan`；`assignments` -> `plan` + Tasks。
- `last` 继续记录最后 workspace；迁移期旧值映射。
- 默认 `today`。

---

## 8. 验收标准

### A. Today 首屏

1. 1440×900：
   - 首屏可见 Now/Next、Attention、至少第一组任务的前 2 行；
   - 不出现完整周课表；
   - Rail 可见 Kiro Brief / Capacity。
2. 1920×1080：
   - 内容不超过 1480px；
   - 不出现超宽拉伸的空白 rail。
3. 390×844：
   - 首屏可见 Now/Next + 第一条任务；
   - 时间线在 fold 以下；
   - 无横向滚动；
   - BottomNav 不被 Bulk Bar 覆盖。
4. 1024×768：
   - 单列；
   - 时间线折叠；
   - 任务行不溢出。

### B. Today 任务

5. 逾期任务出现在第一组，不被隐藏。
6. submitted 任务不出现在 Today；Waiting 卡显示数量。
7. `submissionRequired: true` 的任务主操作是提交；preview 显示 side effects；确认后可 Undo。
8. 完成后行退场，Attention / Capacity / Waiting 同步更新。
9. `doDate=today` 的任务进入“今天做”组。
10. 4h 任务 + 1h block 显示 `剩余 3h`，不消失。
11. 无 estimatedMinutes 不显示 `0h`，显示“未估时”。

### C. Today 时间线

12. 课程与学习块重叠时并排显示，不隐藏。
13. 08:00 前/21:00 后的事件显示“时间窗外”chip。
14. 无课程但有学习块时，空态不覆盖 blocks。
15. 点击课程打开 CourseDrawer；点击学习块打开任务；点击 DDL 打开任务。
16. 学习块 hover/focus 可开始专注。
17. Now line 每 60s 更新；不重渲染整页。
18. 时间线在移动端默认折叠为接下来 3 项。

### D. Today Rail

19. Kiro Brief 本地生成，不自动调用 LLM；点击 Plan my day 才打开 Kiro。
20. Capacity 缺数据时显示“无法估算”，不显示 0。
21. Capacity 超载时显示 danger + Rescue CTA。
22. Waiting 0 时隐藏；>0 时可打开 Waiting。
23. Week Glance 点击某天进入 Plan 对应日期。

### E. Plan 布局

24. 1920×1080：三列，Backlog 300 / Canvas / Inspector 340。
25. 1440×900：Backlog + Canvas；Inspector 覆盖层，不挤压日列。
26. 1280×800：Backlog 260 + Canvas；7 天日列 ≥110；否则提示 3-day。
27. 1024×768：默认 3-day；Backlog Sheet。
28. 390×844：默认 Agenda；可切 Day；无 7 天网格。
29. Plan 三列独立滚动；页面本身不滚；移动端页面滚动。

### F. Plan Canvas

30. 周视图只有一条垂直时间轴；没有水平 Key Lane。
31. DDL 有时刻 -> 时间轴 flag；无时刻 -> all-day strip；不隐藏。
32. 课程/学习块/考试/活动重叠 -> 并排；>3 个 -> +N。
33. 已释放计划默认隐藏；开启图层后灰色只读。
34. 时间窗外事件显示 chip。
35. 当前周有 now line；非当前周无 now line，显示“回到今天”。
36. 周切换 180ms 方向位移；不整页 remount。
37. 日列容量条正确反映 planned/available；released 不计。

### G. Plan 拖拽

38. 从 Backlog 拖 4h 任务到周三 10:00：
    - 默认创建 60–120min block（按 remaining）；
    - Inspector 打开；
    - Toast Undo；
    - 任务仍在 Backlog（若 remaining > 0）。
39. 拖到硬冲突：
    - ghost danger；
    - drop 拒绝；
    - 提示最近空档。
40. 拖到课程时间：
    - soft overlap 确认；
    - 确认后写入 approval；
    - Inspector 显示“与课程重叠（已批准）”。
41. 移动/缩放 15min snap；Esc 取消回原位。
42. 删除 block -> Undo。
43. 移动端不使用拖拽；“安排到…”可创建 block。

### H. Plan Inspector

44. 点击任务/块打开 Inspector；关闭后焦点回到原块。
45. DDL/doDate 可 inline 编辑；closed 任务只读。
46. Health / 剩余 / 已排与 Today 一致。
47. 开始专注从 Inspector 可执行。
48. 打开完整详情打开 AssignmentDrawer，关闭回 Plan。

### I. Plan AI

49. `Plan my week` 打开 Proposal Panel；Canvas 显示 ghost；0 写入直到接受。
50. 接受 -> preflight -> 原子写入 -> Toast Undo；取消 -> ghost 淡出，0 写入。
51. 冲突 proposal 阻止并列出；不部分写入。
52. Kiro busy -> 队列 + 状态；不静默丢弃。
53. Kiro 未配置/错误 -> 手动规划仍可用。

### J. Week Picker / 键盘

54. Week Picker 16 周矩阵；点击跳转；键盘方向键 + Enter。
55. `[`/`]` 切周，`T` 回今天，`W` 打开 picker，`L` 图层，`F` 筛选。
56. 方向键在 Canvas 移动选中块；Enter 打开 Inspector；Delete 删除 + Undo。
57. 输入框聚焦时 Plan 快捷键不触发。

### K. 状态保持

58. Today -> Plan -> Today：Today 滚动/展开/筛选保持。
59. Plan 切到今天再切回：selectedWeek/view/filters/scroll 保持。
60. 打开 Drawer 再关闭：回到原滚动与选中项。
61. 应用重启：回到今天/当前周；不恢复上次浏览周（会话级）。

### L. 性能与可访问性

62. 拖拽 60fps；视图切换 <100ms；周切换 <180ms。
63. 2,000 tasks + 1,000 blocks：Backlog 滚动不卡；Today 派生 <16ms。
64. Plan 有 Agenda 可访问替代；所有 block 可 Tab 聚焦。
65. 任务完成/安排/计划应用有 live region。
66. reduced motion 下无位移/scale，仅 opacity。
67. 关键文字对比度达标；不出现 9px 关键信息。

---

## 9. 工程组件迁移

### 9.1 Today

| 旧 | 新 | 处理 |
|---|---|---|
| `OverviewWorkspace` | `TodayWorkspace` | 重写布局，保留 First Run 逻辑 |
| `TimetableGrid`（Overview） | `TodayTimeline` | 新单日时间线；复用几何/图层 |
| `TimetableQuickGlance` | `NowNextCard` + `WeekGlance` | 数据逻辑复用 |
| `UpcomingDDL` | `AttentionStrip` + Today groups | 逾期进入首屏 |
| `MiniCalendar` | `WeekGlance` | 新页面不引用完整 MiniCalendar |
| `StudyLoadChart` | `CapacityCard` | 复用 capacity engine |
| `AssignmentTable` compact | `TodayTaskGroups` | 新行组件，不复用 1079 行表 |

### 9.2 Plan

| 旧 | 新 | 处理 |
|---|---|---|
| `TimelineWorkspace` | `PlanWorkspace` | 拆 controller；保留 drag/placement |
| `TimelineKeyLane` | `PlanAllDayStrip` + `DeadlineLayer` | 退役水平轴 |
| `TimelineUnscheduledShelf` | `PlanBacklog` | 新 projection + 分组 |
| `TimetableGrid` | `PlanCanvas` | 扩展 timeRange/hourHeight/extra layers |
| `ArrangeSheet` | ArrangeSheet | 复用；预填 selectedDate/time |
| `MarkSheet` | MarkSheet | 复用 |
| `FloatingTimelineDetail` | Inspector 浮层 | 可复用碰撞定位 |
| `AssignmentsWorkspace` | `PlanTasksView` | 抽 `TaskWorkspaceBody` |
| `StudyPlanProposalCard` | `PlanProposalPanel` | 抽共享 proposal 逻辑 |
| `StudyRebalanceProposalCard` | Rescue proposal | 复用 apply/undo |
| `FullTimetableModal` week matrix | `WeekPicker` | 复用 16 周矩阵 |

### 9.3 新增纯函数

- `lib/today/projection.ts`
  - `buildNowNext`
  - `buildAttention`
  - `buildTodayTimelineItems`
- `lib/plan/layout.ts`
  - `layoutDayItems`（重叠并排）
  - `timeToY` / `yToTime` / `snapMinutes`
  - `resolveTimeWindow`
- `lib/plan/drag.ts`
  - `beginDrag` / `updateGhost` / `resolveDrop`
  - `defaultBlockDuration`
- `lib/plan/capacityView.ts`
  - `buildCapacityView`（today/week/day）
- `lib/plan/week.ts`
  - `getWeekDates` / `shiftWeek` / `formatWeekRange`
- `lib/workspace/memory.ts`
  - session scroll/filter/expanded state helpers
- 复用 Phase 0：
  - `lib/tasks/taskProjections.ts`
  - `lib/tasks/taskLifecycle.ts`
  - `lib/tasks/taskPlanning.ts`

### 9.4 测试

- Unit：
  - Today projection / attention / nowNext。
  - Plan time window / overlap layout / default duration / drop resolution。
  - Capacity view.
  - Week shift.
- Integration：
  - Today complete -> preview -> undo -> counts update。
  - Plan drag backlog -> block create -> inspector -> undo。
  - Plan my week proposal -> apply -> undo。
  - Week picker -> backlog recalculates。
- E2E：
  - `today-first-screen.spec.ts`
  - `today-task-completion.spec.ts`
  - `today-timeline.spec.ts`
  - `plan-week-layout.spec.ts`
  - `plan-drag.spec.ts`
  - `plan-mobile-schedule.spec.ts`
  - `plan-my-week.spec.ts`
  - `plan-week-picker.spec.ts`
- Visual regression：
  - Today 1440 / 1920 / 390。
  - Plan 1920 / 1440 / 1024 / 390。
  - 逾期/空态/超载/冲突/proposal。
- Accessibility：
  - axe：Today/Plan。
  - 键盘：J/K/Enter/Tab/方向键。
  - 读屏：Agenda 替代。

### 9.5 性能

- Today：
  - `useTodayController` memo；now tick 独立。
  - 任务组只渲染前 8 条/组；其余去 Tasks。
  - 时间线只渲染今天。
- Plan：
  - 只渲染当前 view 的日列。
  - block memo；drag 用 rAF/transform。
  - Backlog `content-visibility` / virtualization。
  - capacity/conflicts memo。
  - Proposal ghost 独立 layer。
- 目标：
  - 拖拽 60fps；
  - 视图切换 <100ms；
  - 周切换 <180ms；
  - 首次 Today 渲染 <50ms（不含 hydration）。

### 9.6 风险

| 风险 | 缓解 |
|---|---|
| TimetableGrid 扩展过多 | 只加 timeRange/hourHeight/extraLayers；新布局逻辑放 `lib/plan/layout.ts` |
| Plan 三列在 1440 挤压 | 1440 用 Inspector 覆盖层；三列仅 ≥1880 |
| 拖拽性能 | 不 setState per pointermove；commit on drop |
| Today 时间线过长 | 44px/hour + 移动端折叠 |
| Kiro proposal 复杂 | 复用现有 StudyPlanProposalCard apply/undo；先只支持 move/add |
| 页面状态丢失 | `useWorkspaceMemory` + 稳定 shell；先记忆滚动/筛选/展开 |
| 移动端功能缺失 | Agenda-first + “安排到…”；不依赖拖拽 |
| 旧页面测试漂移 | Feature flag + 旧路由保留；分阶段迁移 |
| 双 Header/双 ViewBar | PlanTasksView 不渲染自己的 Header；复用 TaskWorkspaceBody |

---

## 10. 指标

Today：

- 从打开应用到第一次任务动作的时间。
- 首屏任务可见率（有任务时，首屏至少 1 条）。
- 逾期任务首屏可见率（100%）。
- “Plan my day” 打开率 / 接受率 / 撤销率。
- Today 任务完成率。
- 移动端首屏任务可见率。

Plan：

- 从进入 Plan 到完成一次“任务 → 时间块”的时间。
- 每周有 active StudyBlock 的任务占比。
- 计划覆盖率（remaining = 0 的任务占比）。
- 周计划完成时间（目标 <3 分钟）。
- Plan my week 接受率 / 调整率 / 撤销率。
- 冲突率 / 超载天数。
- 周切换 / 拖拽性能。

跨页：

- Today ↔ Plan 往返后状态保持成功率。
- 任务完成 Undo 使用率 / reopen 使用率。
- 通知/提醒取消后的恢复成功率。

---

## 11. 非目标

- 不在 Today 做完整周课表。
- 不在 Today 做拖拽排期。
- 不在 Plan 做课程资料管理 / 复盘图表 / 小组项目详情。
- 不做 7 天网格的移动端强制适配。
- 不做无预览的 AI 自动写入。
- 不做跨周拖拽（P1）。
- 不做多选批量移动（P1）。
- 不做 Focus actual 完整 overlay（P1）。
- 不做 GroupTask → 个人 Plan 桥（Phase 2）。
- 不做多学期模型（Phase 3）。

---

## 12. 已确认决策（本规格）

| 决策 | 选择 |
|---|---|
| Today 首屏 | Now/Next → Attention → Today tasks → Today timeline |
| Today 周课表 | 不出现；完整周课表只在 Plan |
| Today 时间线 | 只读；编辑去 Plan |
| Plan 时间轴 | 单一垂直时间轴；退役水平 Key Lane |
| Plan 三列断点 | ≥1880 三列；1440–1879 两列 + Inspector 覆盖 |
| Plan 默认视图 | ≥1024 周视图；768–1023 3-day；<768 Agenda |
| Plan 拖拽 | 桌面启用；移动端“安排到…” |
| Plan Tasks | 复用现有任务工作区，嵌入 Plan |
| Kiro Brief | 本地生成；用户主动请求才调 LLM |
| Plan my week | Proposal Panel + ghost + apply/undo |
| Today 状态 | 会话记忆；不持久化浏览周 |
| 旧页迁移 | Feature flag + route alias；旧页可回退 |

---

## 13. 后续文档与下一步

已交付：

- `docs/superpowers/plans/2026-11-06-phase-0-2-engineering-breakdown.md`
  - 文件级改造清单；
  - 组件迁移顺序；
  - 测试矩阵；
  - Feature flag / 灰度 / 回滚；
  - 14–15 周工期估算。

下一步：

1. 评审本规格，确认布局断点、Today 首屏顺序、Plan 三列策略。
2. 进入实现前，先做：
   - Today 静态骨架（真实数据、无交互）；
   - Plan Canvas 扩展 spike（timeRange/hourHeight/deadline layer）；
   - 拖拽性能 spike；
   - 移动端 Agenda 骨架。
3. 按工程拆解从 P0-01 开始，不先做视觉换皮。
