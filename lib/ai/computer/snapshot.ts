import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroAgentMode } from "@/lib/ai/computer/types";

const AGENT_MODES: readonly string[] = ["plan", "guided", "workspace-auto"];
const MAX_ROOTS = 32;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 128;

/** 校验 Computer Turn Snapshot（server 信任边界）：只当 context/tool-selection metadata。
 *  拒绝 malformed id、absolute-looking 值、超大 roots 数组。非法 → null（忽略快照，不报错）。 */
export function validateComputerTurnSnapshot(value: unknown): KiroComputerTurnSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (typeof v.enabled !== "boolean") return null;
  if (typeof v.agentMode !== "string" || !AGENT_MODES.includes(v.agentMode)) return null;
  if (v.workspaceId !== null && typeof v.workspaceId !== "string") return null;
  if (typeof v.workspaceId === "string" && v.workspaceId.length > MAX_ID_LENGTH) return null;
  // workspaceId 必须像逻辑 id，拒绝绝对路径 / 盘符 / UNC
  if (typeof v.workspaceId === "string" && looksAbsolute(v.workspaceId)) return null;

  if (!Array.isArray(v.roots)) return null;
  if (v.roots.length > MAX_ROOTS) return null;

  // V2.3：Document Authoring Protocol Version（1 | 2 合法；缺失 = legacy V1；其它值拒绝快照）
  if (
    v.documentAuthoringVersion !== undefined &&
    v.documentAuthoringVersion !== 1 &&
    v.documentAuthoringVersion !== 2
  ) {
    return null;
  }

  const roots: KiroComputerTurnSnapshot["roots"] = [];
  for (const r of v.roots) {
    if (typeof r !== "object" || r === null) return null;
    const root = r as Record<string, unknown>;
    if (typeof root.id !== "string" || root.id.length === 0 || root.id.length > MAX_ID_LENGTH) return null;
    if (looksAbsolute(root.id)) return null;
    if (typeof root.label !== "string" || root.label.length > MAX_LABEL_LENGTH) return null;
    if (root.access !== "read-only" && root.access !== "read-write") return null;
    roots.push({ id: root.id, label: root.label, access: root.access });
  }

  return {
    enabled: v.enabled,
    workspaceId: typeof v.workspaceId === "string" ? v.workspaceId : null,
    agentMode: v.agentMode as KiroAgentMode,
    roots,
    ...(v.documentAuthoringVersion === 1 || v.documentAuthoringVersion === 2
      ? { documentAuthoringVersion: v.documentAuthoringVersion }
      : {}),
  };
}

function looksAbsolute(s: string): boolean {
  return s.startsWith("/") || s.startsWith("\\") || /^[a-zA-Z]:/.test(s) || s.startsWith("\\\\");
}
