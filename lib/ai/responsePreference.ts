/**
 * Kiro 回答偏好（Intelligence V2）。
 *
 * 三档 enum：dense（高密度·默认）/ balanced（平衡）/ deep（深入）。
 * Task 1：设置 + 数据传递 + 安全归一；
 * Task 2：buildKiroResponsePreferenceContext() 升级为完整 Final Answer Quality Contract。
 *
 * 最重要不变量：
 * 回答偏好只影响 Final Answer 的表达方式和解释深度；
 * 绝不改变必要 Tool 调用、事实读取、安全规则、确认要求或写入授权。
 *
 * Server 只信任 normalize 后的 enum；raw client value 绝不进入 System Context。
 */

export const KIRO_RESPONSE_PREFERENCES = ["dense", "balanced", "deep"] as const;

export type KiroResponsePreference = (typeof KIRO_RESPONSE_PREFERENCES)[number];

export const DEFAULT_KIRO_RESPONSE_PREFERENCE: KiroResponsePreference = "dense";

/**
 * 精确 enum 归一：
 * 只有 dense / balanced / deep 接受；其余（undefined / 非法 string / object / 大小写变体 / 前后空白）一律 dense。
 * 不做 trim 后模糊匹配、substring、大小写转换或自由字符串。
 */
export function normalizeKiroResponsePreference(value: unknown): KiroResponsePreference {
  return KIRO_RESPONSE_PREFERENCES.includes(value as KiroResponsePreference)
    ? (value as KiroResponsePreference)
    : DEFAULT_KIRO_RESPONSE_PREFERENCE;
}

/** 三档共同规则（所有模式共享，只表达表达深度影响，绝不改变 Tool / Safety） */
const SHARED_ANSWER_CONTRACT = `# Answer Quality Contract

- responsePreference 当前值由下方 mode 段指定（Server 生成，受信任）。
- 此设置只影响 Final Answer 的表达深度；不改变必要工具调用、事实读取、安全规则、确认要求或写入授权。
- 最终回答应优先传递新的、可执行的学业信息；不要复述工具执行过程。
- 能直接回答时，避免低价值模板："我来帮你看一下……""根据查询结果……""我进一步分析了一下……""综合以上信息……""希望这些建议对你有帮助……"。
- 在适用时默认结构：结论 → 关键事实 → 优先级 / 风险 → 下一步；但很短的问题不要机械制造标题。
- 不能为了简短省略：失败状态、风险、限定条件、必要事实、不确定性、必要 citation。`;

const DENSE_CONTRACT = `## 当前模式：高密度

- 默认直接给：结论、第一优先事项或直接行动。
- 不要寒暄、过程铺垫、重复总结；每句话尽量增加新的事实、判断、优先级、风险或行动。
- 可靠 Tool 已经得到的关键数字（DDL、进度、缺口、可用时间、计划分钟数）直接呈现。
- 优先短段落与紧凑列表；只有复杂比较明显更清楚时才使用表格。
- 默认不要主动展开背景知识、方法论、学习策略；除非用户明确问，或缺少该说明会影响实际行动。
- 不设机械字数上限：复杂请求允许足够长度保留必要信息。dense ≠ 强制短回答。`;

const BALANCED_CONTRACT = `## 当前模式：平衡

- 仍然先结论、再行动；然后补充理解当前决策所需的必要原因和上下文。
- 原因解释保持简洁，必须有明确语义：解释服务于理解和行动；不要重复已经清楚的事实。
- 比 dense 可以多说明一层"为什么"；但不要展开无关背景、长篇方法论、泛泛教学内容。
- 仍禁止流程旁白与重复总结。`;

const DEEP_CONTRACT = `## 当前模式：深入

- 在结论 + 关键事实之后，允许更完整说明：依据、取舍、规划逻辑、注意事项。
- 用依据 / 取舍 / 规划逻辑表达，而不是展示完整思维过程或逐步推理（不要求隐藏 chain-of-thought）。
- 仍然不复述工具执行过程。

### 学习建议规则

- 只有学习方法确实与当前任务直接相关时，才允许加入最多 1 个简短「学习建议」区块。
- 建议必须针对当前课程 / 当前资料 / 当前任务 / 当前复习目标（例如：统计学作业 → 先复习某概念再做题；PDF 阅读任务 → 先读哪一部分；考试复习 → 具体复习策略）。
- 普通状态查询（"明天有什么课？"）、CRUD（"把 DDL 改到周五"）、提醒（"晚上八点提醒我"）、Focus（"暂停专注"）一律不要加学习建议。
- 禁止通用励志话术；不要把常规任务管理问题扩写成教学长文。`;

const MODE_CONTRACTS: Record<KiroResponsePreference, string> = {
  dense: DENSE_CONTRACT,
  balanced: BALANCED_CONTRACT,
  deep: DEEP_CONTRACT,
};

/**
 * Server 生成的可信 Answer Quality Contract（插入 System Prompt）。
 * 内部必须再次 normalize；绝不把 raw client value 插进返回文本。
 * 输出 = 共享契约 + 对应模式契约（仅含 normalize 后的 enum）。
 */
export function buildKiroResponsePreferenceContext(value: unknown): string {
  const preference = normalizeKiroResponsePreference(value);
  return "\n\n" + SHARED_ANSWER_CONTRACT + "\n\n" + MODE_CONTRACTS[preference];
}
