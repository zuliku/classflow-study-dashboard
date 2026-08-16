/**
 * Kiro Visual Intake V1.5：Live Image Source Registry（runtime-only）。
 *
 * 目的：为「截图预览 / Proposal Source Strip」提供 Runtime Source Resolver——
 * 原始 File 只存在于当前 Conversation runtime，绝不进入：
 * - KiroAttachmentView persistence
 * - Conversation History（IndexedDB）
 * - localStorage / Store（任何持久层）
 *
 * 生命周期（由 Attachment owner 负责调用）：
 * - 图片 ready 时 registerLiveImageSource（owner = useKiroAttachments.addFiles）
 * - 移除附件时 unregisterLiveImageSource（owner = useKiroAttachments.remove）
 * - 切换/新建/清空对话时 clearLiveImageSources（owner = useKiroChat.newChat/loadConversation，
 *   与 visualProposalRuntime.clear() 同一 Conversation boundary）
 *
 * 历史恢复（刷新 / loadConversation）后注册表为空 → 所有 preview 入口自然降级
 * （tempNotRetained 语义；绝不伪造 Preview）。
 * 本模块不缓存 object URL（Preview Dialog 自行 create/revoke）。
 */
export interface LiveImageSource {
  id: string;
  file: File;
  name: string;
  /** data URL 缩略图（与附件 view 同源；仅展示） */
  thumbnail?: string;
}

const sources = new Map<string, LiveImageSource>();

export function registerLiveImageSource(source: LiveImageSource): void {
  if (!source || !source.id || !(source.file instanceof File)) return;
  sources.set(source.id, {
    id: source.id,
    file: source.file,
    name: source.name ?? source.file.name ?? "",
    thumbnail: typeof source.thumbnail === "string" ? source.thumbnail : undefined,
  });
}

/**
 * V1.5.1：只更新「已经存在」的 entry（async thumbnail 完成时调用）。
 * entry 不存在（已被 remove 移除 / 已被 conversation clear 清空）→ no-op，
 * 绝对不重新创建 entry —— 这是 ghost source 竞态的硬保证。
 */
export function updateLiveImageSourceThumbnail(id: string, thumbnail: string | undefined): void {
  const entry = sources.get(id);
  if (!entry) return;
  entry.thumbnail = typeof thumbnail === "string" ? thumbnail : undefined;
}

export function unregisterLiveImageSource(id: string): void {
  sources.delete(id);
}

/** Conversation boundary：new / load / delete / clear 时清空（与 visualProposalRuntime.clear() 同点） */
export function clearLiveImageSources(): void {
  sources.clear();
}

/** 解析当前 live 本地图片（未注册 → undefined；历史恢复后自然不可预览） */
export function resolveLiveImageSource(id: string): LiveImageSource | undefined {
  return sources.get(id);
}

/** 按 sourceAttachmentIds 顺序解析（去重保序；只返回仍存在的 live 来源） */
export function resolveLiveImageSources(ids: readonly string[]): LiveImageSource[] {
  const seen = new Set<string>();
  const out: LiveImageSource[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const hit = sources.get(id);
    if (hit) out.push(hit);
  }
  return out;
}
