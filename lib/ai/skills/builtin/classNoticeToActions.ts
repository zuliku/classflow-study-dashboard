/**
 * Builtin Workflow Skill：class-notice-to-actions（S2 新增，ClassFlow-native）。
 *
 * 核心价值（§28）：不是 OCR，而是
 * Unstructured Notice → Fact Extraction → Entity Resolution → Change Classification
 * → Conflict / Ambiguity Handling → Proposal / Mutation。
 */
import { createBuiltinWorkflowSkill } from "@/lib/ai/skills/builtin/helper";

const DESCRIPTION =
  "把课程群或老师通知转成经过核实的 ClassFlow 操作：识别作业、DDL 变更、停课/调课/补课、考试与多项混合事项，并与现有数据核对后再执行。适用于消息、截图或复制的通知包含需要落库的课程变更时。";

const INSTRUCTIONS = `\
# Class Notice → Actions

把非结构化通知转成经过核实的 ClassFlow 操作。纯聊天讨论、或通知里只有无需落库的信息时，不需要本流程。

## 1. 拆出可执行事实

把通知拆成独立事项：新作业、DDL 变更、课表变更（停课/调课/补课/换教室）、考试或活动、以及用户明确提出的提醒请求。
注意：通知里写"作业周五截止"只是事实，**不等于**用户要求创建 Reminder；Reminder 必须来自用户明确的提醒意图。

## 2. 先解析真实实体

课程简称、作业简称先 search_courses / search_assignments 匹配：
- 唯一匹配 → 继续；
- 多个候选 → 询问用户；
- 没有匹配 → 不要猜、不要自行创建陌生课程或任务，询问用户。

## 3. 区分一次性变更与长期变更

- 一次性（"本周三停课""明天补课""第 8 周调整"）→ occurrence 级变更；
- 长期（"以后都在新教室""从下周起改时间"）→ 排课级变更。
两者不能混用；日期一律解析为绝对本地时间，基准不明确时先询问。

## 4. 区分新任务与已有任务更新

先检查是否已存在对应任务：已有 → 更新 DDL / 详情；没有且通知明确是新任务 → 创建。
禁止重复生成同一任务。

## 5. 混合通知：不阻塞明确事项

通知里有 A（明确）、B（明确）、C（歧义）时，不要因为 C 不清楚而阻塞 A/B。
但若某个可执行事项依赖一个歧义事实，该事项同样保持 pending，整个依赖链不得拆开执行。

## 6. 截图路径

当前回合包含截图时，继续遵守现有 Visual Action Intake：使用 propose_visual_actions 生成可预览方案，不要绕过截图写入安全链，也不要在本轮直接调用写工具。

## 7. 纯文本路径

先解析实体 → 读取真实状态 → 两个及以上相互关联的修改优先用 apply_change_set 一次完成整体校验 → 单一明确修改走对应写工具。
写权限、风险分级、确认与事务语义完全由现有 Proposal / Approval / Change Set contract 决定，本流程不重新定义。

## 8. 汇报

最终只报告：已确认的事实、已完成的操作、需要用户澄清的事项。
不要复述内部工具调用流程。`;

export const CLASS_NOTICE_TO_ACTIONS_SKILL = createBuiltinWorkflowSkill({
  name: "class-notice-to-actions",
  description: DESCRIPTION,
  instructions: INSTRUCTIONS,
  requiredTools: [
    "search_courses",
    "search_assignments",
    "get_week_schedule",
    "propose_visual_actions",
    "apply_change_set",
  ],
});
