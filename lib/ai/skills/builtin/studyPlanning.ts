/**
 * Builtin Workflow Skill：study-planning（S2）。
 *
 * 定位（§13）：不是「怎么看课表」，也不是「怎么调用 get_available_time」，
 * 而是把 Assignments / DDL / Deadline Health / Calendar / Available Time /
 * Learning Outlook / 已有 StudyBlock / 用户约束综合成现实可执行的学习安排。
 * 简单事实查询（周三有什么课 / 今晚多少空闲 / 某作业何时截止）不需要本 Skill。
 */
import { createBuiltinWorkflowSkill } from "@/lib/ai/skills/builtin/helper";

const DESCRIPTION =
  "综合任务、DDL、截止健康度、课表、空闲时间与已有学习计划，生成或重平衡现实可执行的学习安排。适用于跨多个任务或考试的排期、考前复习、追赶进度、多项 DDL 冲突，以及调整已有学习计划的请求。";

const INSTRUCTIONS = `\
# Study Planning

复杂学习排期的方法论。简单事实查询（"周三有什么课""今晚还有多少空闲""这个作业什么时候截止"）直接用对应读取工具回答，不要套用本流程。

## 1. 先框定规划问题

先确认：规划范围（今天 / 本周 / 到某个 DDL 之前）、涉及的任务或考试、硬约束（考试与固定日程）、用户明确说出的偏好（每天可投入时长、不排的时段）。
不要默认读取全部课程或全部任务；只纳入当前问题真正涉及的对象。

## 2. 先取组合事实，再深入单个任务

- 多任务 / 整周规划：优先 get_learning_outlook（确定性前瞻：两层容量、按 DDL 的累计容量缺口、缺估时任务）。
- 只对确实需要判断的少数任务调用 get_assignment_health；不要 N 个任务就 N 次 Health。
- 需要完整任务信息（描述、子任务、已排分钟）时才 get_assignment；已排计划用 query_study_blocks 盘点。
- 用户只问空闲时段：get_available_time 一步即可，不要手工用课表推算。

## 3. 区分三种请求

A. 只看空闲 → get_available_time。
B. 生成新计划 → propose_study_plan（确定性排程 Proposal）。
C. 调整已有 Kiro 计划 → 先 propose_study_rebalance；若重排后仍有容量缺口（summary.shortfallAfter > 0），再 propose_study_plan 补齐。

## 4. 尊重共享容量

同一个空闲时段只能分配给一个任务。判断是否来得及、是否排得过满，必须使用 get_learning_outlook 的组合结果（summary.workload.*），绝不能把每个任务的可用分钟数独立相加或逐任务孤立判断。

## 5. 缺失估时不得假设

有任务缺少 estimatedMinutes 时必须显式指出（"另有 N 个任务缺少预计耗时，不在容量判断中"），不得假设耗时、也不得让 Health 把估计值当作已知事实。
需要估时建议时：get_assignment → propose_task_breakdown 给出标注为估计的建议；用户确认前不得当作已知事实。

## 6. Proposal 不是已执行

propose_study_plan / propose_study_rebalance 只生成建议，不创建或移动任何 StudyBlock。
在用户于 Proposal 卡片确认「应用」之前，一律说"建议安排为……"，禁止说"已经安排好了"。
正式写入继续走现有用户确认链；课程重叠等方案 Apply 时仍走既有 Approval Gate。

## 7. 调整优先重排，不要推倒重来

用户要求"调整已有学习计划 / 重排学习时段"时：优先移动已有 Kiro-generated StudyBlock，不要默认全部删除后重建。
manual（用户手工安排）的 StudyBlock 不会被自动移动——如实说明即可。
具体移动时间必须来自 propose_study_rebalance 的 moves，不要在文本里自拟时间。`;

export const STUDY_PLANNING_SKILL = createBuiltinWorkflowSkill({
  name: "study-planning",
  description: DESCRIPTION,
  instructions: INSTRUCTIONS,
  requiredTools: [
    "get_learning_outlook",
    "get_assignment_health",
    "get_available_time",
    "propose_study_plan",
    "propose_study_rebalance",
  ],
});
