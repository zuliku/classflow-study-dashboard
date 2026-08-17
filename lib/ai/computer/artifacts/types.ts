/**
 * Kiro Computer Agent V2 — Artifact Metadata（logical-only）。
 * Artifact 是 metadata system：绝不含 adapterRef / native path / handle / bytes / token；
 * 文件系统仍是事实来源。Artifact 永远不能绕过 permission / sandbox。
 */
import { KiroDocument } from "@/lib/ai/computer/documents/types";

export type KiroArtifactType = "text" | "markdown" | "docx";

export type KiroArtifactSource = "kiro-created" | "workspace-existing";

export interface KiroArtifact {
  /** 长期身份：rename / move 不变；路径变化不增加 revision */
  id: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title: string;
  displayName: string;
  source: KiroArtifactSource;
  sourceConversationId?: string;
  sourceTaskId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Source Store：只保存 Kiro 通过 create_document 生成的 KiroDocument IR（markdown/docx）。 */
export interface KiroArtifactSourceRecord {
  artifactId: string;
  revision: number;
  document: KiroDocument;
  updatedAt: string;
  /** V2.5：生成该 Source IR 的 DOCX renderer 版本（旧记录无字段 = legacy/unknown；
   *  migration 判断以 legacy structural detector 为最高优先，不依赖该字段） */
  rendererVersion?: number;
  }
