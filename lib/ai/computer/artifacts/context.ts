/**
 * Kiro Computer V2 Part 3 — Artifact → Context 纯数据转换（共享）。
 *
 * 唯一目的：让「Ask Kiro」入口（Recent Files Popover / Inspector Outputs）使用同一份
 * canonical KiroContextRef 构造逻辑，绝不出现第二份 key / artifact whitelist 定义。
 */
import type { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import type { KiroContextRef } from "@/lib/ai/context/types";

/** artifact → manual context ref（session-ephemeral；只含逻辑 metadata，不含 bytes / adapterRef） */
export function artifactToContextRef(artifact: KiroArtifact): KiroContextRef {
  return {
    key: `manual-artifact-${artifact.id}`,
    kind: "artifact",
    entityId: artifact.id,
    label: `文件 · ${artifact.displayName}`,
    source: "manual",
    artifact: {
      artifactId: artifact.id,
      workspaceId: artifact.workspaceId,
      rootId: artifact.rootId,
      relativePath: artifact.relativePath,
      type: artifact.type,
      revision: artifact.revision,
    },
  };
}
