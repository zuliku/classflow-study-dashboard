import { SETTINGS_REGISTRY, SettingDefinition } from "@/lib/settingsRegistry";

/**
 * Settings Registry ↔ DOM 自动校验（开发期可靠性机制）：
 * 验证每个非 conditional 的 Registry entry 在真实 DOM 中存在对应的
 * `data-setting-id` 目标，防止 Registry ID 与组件渲染漂移。
 *
 * - Development：console.warn 输出全部漂移；Production：完全不执行。
 * - 不把合法条件渲染（conditional: true）误判为错误。
 */

function collectDomIds(root: ParentNode): Set<string> {
  const ids = new Set<string>();
  if (typeof root.querySelectorAll !== "function") return ids;
  root.querySelectorAll("[data-setting-id]").forEach((el) => {
    const id = el.getAttribute("data-setting-id");
    if (id) ids.add(id);
  });
  return ids;
}

/** 校验 root 内所有非 conditional Registry entry 是否都有 DOM 目标；返回缺失列表 */
export function findMissingDomTargets(
  root: ParentNode,
  registry: SettingDefinition[] = SETTINGS_REGISTRY
): SettingDefinition[] {
  const domIds = collectDomIds(root);
  return registry.filter((entry) => !entry.conditional && !domIds.has(entry.id));
}

/** 校验 DOM 中是否存在 Registry 未声明的 data-setting-id（防止组件新增未入 Registry） */
export function findUndeclaredDomIds(
  root: ParentNode,
  registry: SettingDefinition[] = SETTINGS_REGISTRY
): string[] {
  const declared = new Set(registry.map((entry) => entry.id));
  const domIds = collectDomIds(root);
  return Array.from(domIds).filter((id) => !declared.has(id));
}

/** 开发期自动校验：Settings Modal 挂载后调用一次（全部 section 常驻挂载，无需切换即可全量校验） */
export function runRegistryDomValidation(root: ParentNode): void {
  if (process.env.NODE_ENV !== "development") return;
  const missing = findMissingDomTargets(root);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[SettingsRegistry] DOM validation: registry entries without matching DOM target:",
      missing.map((m) => `${m.id} (${m.section})`)
    );
  }
  const undeclared = findUndeclaredDomIds(root);
  if (undeclared.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[SettingsRegistry] DOM validation: data-setting-id without registry entry:",
      undeclared
    );
  }
}
