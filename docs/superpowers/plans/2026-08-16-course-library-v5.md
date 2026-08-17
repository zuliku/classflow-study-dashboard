# Course Library V5 — Compact Resource Dashboard

日期：2026-08-16
基础提交：9011f52

## 目标

把课程资料页从「横线分割的课程信息表格」重构为「以课程身份为入口、以待处理任务为注意力、以课程资料为资源入口的紧凑课程 Dashboard」，并修复双列课程卡顶部/底部错位。

## 已批准设计要点

- [ ] 强化 Course Color Identity（bgHex header tint + borderHex accent rail，删除 7px dot）
- [ ] Course Name 成为第一视觉锚点（15–16px bold charcoal，单行 truncate）
- [ ] Next Session 降低结构噪音（无下一节只显示 muted nextCellText，不再「下节课 本周无后续课程」叠加）
- [ ] 「任务 · N」→「待处理 N」（todo/doing only；submitted/completed 不算待处理）
- [ ] Materials 标题 →「课程资料 N」，视觉低于 Tasks
- [ ] 删除 Footer；Add Task 迁入 Task Section header；Upload 降级 compact ghost
- [ ] 内部横线：Header border-b line-soft + Materials border-t line-soft（≤2 条）
- [ ] Desktop 双列同一 Grid Row 等高（items-stretch + h-full + xl:min-h-14 preview slots；禁 fixed 320px / JS 测高）
- [ ] 「查看全部 +N」→「全部 N 项 →」（tasks 当 totalCount > 2；materials 当 length > 2）
- [ ] overdue 只来自 attentionRows（submitted 旧 DDL 不再误算逾期）

## 涉及文件

- [ ] 新增 lib/courses/courseLibraryView.ts —— attention projection 纯函数
- [ ] 新增 tests/courseLibraryView.test.ts —— Gate A
- [ ] components/course/CoursesWorkspace.tsx —— grid items-stretch + 单次派生 attention view（删 overdueCountByCourse 独立循环）
- [ ] components/course/CourseLibraryCard.tsx —— V5 卡片（header tint/rail/compact upload/待处理/全部 N 项/删 footer/稳定 preview slots）
- [ ] 新增 tests/courseLibraryCardV5.test.tsx —— Gate B（jsdom 组件测试）
- [ ] 新增 tests/e2e/course-library-v5.spec.ts —— Gate C（几何 + 长标题 + 390 + actions smoke）
- [ ] tests/e2e/course-detail-v2.spec.ts —— O 测试更新为 V5 same-row 等高契约

不修改：CourseDetailDrawer / Course Floating Hub / Assignment·Schedule Domain / Material Blob pipeline / Popover infrastructure（CourseCardOverflowPopover 内容保持「任务/资料」完整列表语义）/ Analytics / Kiro / Settings。

## 实现

### Gate A — Attention projection（先做）

lib/courses/courseLibraryView.ts：

- `isCourseAttentionTask(status)`: todo/doing → true；submitted/completed → false
- `buildCourseLibraryTaskView(rows: CourseTaskRowView[])` → `{ attentionRows, attentionCount, overdueCount, totalCount }`
  - attentionRows = rows.filter(isCourseAttentionTask)
  - overdueCount = attentionRows.filter(row.overdue).length（同源投影，submitted 旧 DDL 不误算）
  - totalCount = rows.length（Popover 完整列表用）

Gate A 测试（tests/courseLibraryView.test.ts）：

- [ ] todo → attention；doing → attention
- [ ] submitted → not attention；completed → not attention
- [ ] overdue submitted 不计入 overdueCount
- [ ] overdue todo/doing 计入
- [ ] 混合 fixture 计数正确（total 含全部状态）
- [ ] 空数组 → 全 0

### Gate B — Card redesign（Gate A green 后）

CourseLibraryCard：

- [ ] article：`flex flex-col h-full border border-line rounded-xl hover:border-line-strong`（去 hover bg tint）
- [ ] header：`bgHex` 背景 + 左侧 `borderHex` accent rail（3.5px × 32px rounded-full，aria-hidden）+ 标题 button（title 完整名，onOpenCourse）+ meta（code · teacher · classroom，filter(Boolean).join(" · ")）+ compact upload（28px ghost，aria-label `上传《{name}》的课程资料`，uploading → spinner 上传中…）
- [ ] context row：`shrink-0 min-h-9 px-4 flex items-center`；next 有值 → 「下节课」+ 值；null → 只显示 muted nextCellText
- [ ] tasks section：无 border-top；header「待处理 N」+ overdue badge + 右侧「+ 添加」（aria-label `为《{name}》添加任务`）+「全部 N 项 →」（totalCount > 2 时）
- [ ] task preview：attentionRows.slice(0,2)，行 title charcoal semibold + deadline（overdue → danger；未来 → sandrift；无 ddl → muted）；body `xl:min-h-14`
- [ ] attentionRows 空 → 「暂无待处理任务」muted；若 totalCount > 0 仍显示「全部 N 项 →」
- [ ] materials section：仅 `border-t border-line-soft`；标题「课程资料 N」（charcoal/85，视觉低于待处理）；「全部 N 项 →」仅 materials.length > 2
- [ ] material preview ≤2 行，MaterialTypeIcon 保留；空 → 「暂无课程资料」（不塞上传 action）
- [ ] 删除 footer（+任务 / 课程详情 全部移除）
- [ ] `data-testid={\`course-library-card-${course.id}\`}`
- [ ] 全程禁 `h-[320px]` / `min-h-[320px]` / fixed card height；不引入 JS 测高

CoursesWorkspace：

- [ ] grid：`grid grid-cols-1 gap-4 xl:grid-cols-2 items-stretch`（删除 xl:items-center）
- [ ] 单次循环：`buildCourseLibraryTaskView(buildCourseTaskRow(sortCourseAssignments(...)))`，删除独立 overdueCountByCourse
- [ ] 传入 attentionRows / attentionCount / overdueCount / totalCount

Gate B 组件测试（tests/courseLibraryCardV5.test.tsx，createRoot + act）：

- [ ] 4 total（2 active / 1 submitted / 1 completed）→ 「待处理 2」非「任务 · 4」；「全部 4 项」非「查看全部 +2」
- [ ] 5 completed → 「待处理 0」+「暂无待处理任务」+「全部 5 项」
- [ ] 3 materials → 「课程资料 3」+「全部 3 项」非「查看全部 +1」
- [ ] footer 不存在（无「+ 任务」「课程详情」按钮）
- [ ] color：fixture bgHex/borderHex → header style 背景 + rail 颜色正确（style/data-attribute 断言）
- [ ] 上传按钮 aria-label 含课程名
- [ ] 2 条以内 tasks/materials 不显示「全部」

### Gate C — Geometry E2E（Gate B green 后）

tests/e2e/course-library-v5.spec.ts（1440×900，独立 seed 4 课程）：

- [ ] Row1：A=2 tasks+2 mats、B=0/0 → abs(A.y-B.y)≤2、abs(A.height-B.height)≤2、abs(bottomA-bottomB)≤2
- [ ] Row2：C、D 各自等高；不要求 row1==row2（检查无 fixed 320：class 不含 h-[320px]/min-h-[320px]）
- [ ] 长课程名 → 标题单行 truncate（scrollWidth ≤ clientWidth）+ title attr
- [ ] 390×844：无横向 overflow；header/上传/待处理/资料可见；无 footer
- [ ] actions smoke：title → Course Hub；task row → Assignment Detail；「全部 N 项」→ popover；「+ 添加」→ Assignment Editor courseId 正确

tests/e2e/course-detail-v2.spec.ts O 测试更新：content-fit 不等高断言 → same-row 等高断言（不再中心对齐）。

## 验证

- Gate A：`npx vitest run tests/courseLibraryView.test.ts`
- Gate B：`npx vitest run tests/courseLibraryCardV5.test.tsx`
- Gate C：`npx playwright test tests/e2e/course-library-v5.spec.ts` + `npx playwright test tests/e2e/course-detail-v2.spec.ts`（回归）
- `npx tsc --noEmit`
- 人工 smoke：1920 / 1440 / 1024 / 390 课程资料页（dev server 保持）

## Git

单个 feature commit：`feat(courses): refocus course library cards` → push origin/main
