/**
 * Turn Source Registry 构建（Task 11）：纯函数，可在 Node 测试。
 * 输入：已提取的文档 Context（含 pages）→ 分配本 Turn 稳定 sourceId（doc-1…）+ Source Meta。
 * read_material 返回的资料单独注册（material-<id>，见 useKiroChat）。
 */

import { KiroSourceMeta } from "@/lib/ai/citations/types";

export interface SourceableDocument {
  name: string;
  source?: string;
  courseName?: string;
  pages?: { page: number; text: string }[];
}

export interface SourceRegistryBuildResult {
  /** 与输入同序，附 sourceId（不含正文） */
  sources: KiroSourceMeta[];
  /** sourceId 分配（name → sourceId；顺序从 1 开始） */
  sourceIdOf: (name: string) => string;
}

/** 为每份文档分配 doc-N 并生成 Source Meta（availablePages 取预算后实际提供的页码） */
export function buildTurnSourceRegistry(documents: SourceableDocument[]): SourceRegistryBuildResult {
  const sources: KiroSourceMeta[] = [];
  const map = new Map<string, string>();
  documents.forEach((d, i) => {
    const sourceId = `doc-${i + 1}`;
    map.set(d.name, sourceId);
    sources.push({
      sourceId,
      name: d.name,
      source: d.source === "course-material" ? "course-material" : "chat",
      courseName: d.courseName,
      availablePages: d.pages && d.pages.length > 0 ? d.pages.map((p) => p.page) : undefined,
    });
  });
  return {
    sources,
    sourceIdOf: (name) => map.get(name) ?? "",
  };
}

/** read_material sourceId：基于 materialId 的稳定短 id（绝不使用 storageKey） */
export function materialSourceId(materialId: string): string {
  const safe = materialId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `material-${safe || "file"}`;
}
