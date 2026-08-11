/**
 * Kiro Document Evidence（Task 11）：
 * 来源注册表（Turn 级）+ Citation 解析 / 校验 / 展示文本。
 * 原则：模型只能引用本 Turn 实际提供给它的 sourceId 与 page；
 * UI 渲染前必须经过 Source Registry 校验，无效引用不显示可信 Citation。
 */

/** 本 Turn 文档来源元数据（UI 展示与校验用；不保存正文） */
export interface KiroSourceMeta {
  sourceId: string;
  /** 文件显示名（如 第三章讲义.pdf / 网页标题） */
  name: string;
  source: "chat" | "course-material" | "web";
  courseName?: string;
  /** 本 Turn 实际发送给模型的页码（预算截断后） */
  availablePages?: number[];
  /** Task 14：Web Source（Kiro Search）——只存 metadata，不存 snippet / 网页正文 / Provider 原始 response */
  url?: string;
  domain?: string;
  publishedAt?: string;
}

/** History 持久化版本：只存展示所需最小元数据（正文永不落库） */
export type PersistedSourceMeta = KiroSourceMeta;

/** 解析后的引用（页码存在才设置） */
export interface KiroCitation {
  sourceId: string;
  pageStart?: number;
  pageEnd?: number;
}
