/**
 * Kiro Project（V1）模型。
 * Kiro Project ≠ ClassFlow group-project（课程小组项目）：这里是
 * 「对 Kiro Conversations 进行组织的容器」。
 */
export interface KiroProjectRecord {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export const KIRO_PROJECT_NAME_MAX = 50;
export const KIRO_PROJECT_DESCRIPTION_MAX = 200;

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

export function createProjectId(): string {
  return `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
