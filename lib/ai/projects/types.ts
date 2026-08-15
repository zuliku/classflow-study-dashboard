/**
 * Kiro Project（V1 + V1.2）模型。
 * Kiro Project ≠ ClassFlow group-project（课程小组项目）：这里是
 * 「对 Kiro Conversations 进行组织的容器」。
 */
export interface KiroProjectRecord {
  id: string;
  name: string;
  /** 给用户看的项目说明/摘要（不自动进入模型 Prompt） */
  description?: string;
  /** 用户配置的项目级工作指令（V1.2：自动进入 Project Conversation 模型上下文；
   *  唯一事实来源 = Project Record，不复制进 Conversation） */
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export const KIRO_PROJECT_NAME_MAX = 50;
export const KIRO_PROJECT_DESCRIPTION_MAX = 200;
export const KIRO_PROJECT_INSTRUCTIONS_MAX = 4000;

/** 项目名称归一（required / trim / max）——返回 null 表示非法 */
export function normalizeProjectName(name: string): string | null {
  const v = name.trim();
  if (!v || v.length > KIRO_PROJECT_NAME_MAX) return null;
  return v;
}

/** 项目描述归一（optional / trim / max）——空 → undefined */
export function normalizeProjectDescription(description: string | undefined): string | undefined {
  const v = (description ?? "").trim();
  if (!v) return undefined;
  if (v.length > KIRO_PROJECT_DESCRIPTION_MAX) return undefined;
  return v;
}

/**
 * 项目指令归一（V1.2）：
 * - undefined / ""（trim 后）→ undefined（空值）
 * - 合法 → string（trim 后，<= KIRO_PROJECT_INSTRUCTIONS_MAX）
 * - 超限 → null（非法）
 * 返回三态，UI 必须能区分「清空指令」与「输入超限」。
 */
export function normalizeProjectInstructions(instructions: string | undefined): string | undefined | null {
  const v = (instructions ?? "").trim();
  if (!v) return undefined;
  if (v.length > KIRO_PROJECT_INSTRUCTIONS_MAX) return null;
  return v;
}

export function createProjectId(): string {
  return `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
