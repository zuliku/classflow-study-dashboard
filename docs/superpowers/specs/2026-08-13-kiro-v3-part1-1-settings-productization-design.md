# Kiro V3 Part 1.1 — Settings Productization Closeout

## Goal
Refine **授权位置** and **工作区知识** from nested demo-style cards into compact production-grade system settings. Presentation only: Workspace authorization, Knowledge indexing, KIRO.md, permissions, tools, and persistence remain unchanged.

## Scope
Primary files:
- `components/settings/KiroAgentSettings.tsx`
- `components/settings/KiroWorkspaceKnowledgePanel.tsx`
- focused existing tests

Do not redesign global Settings or start V3 Part 2.

## 授权位置
Use a flat Workspace list inside the existing Settings group. Each Workspace is one compact row (~56–64 px): icon + name + concise metadata on the left, current/select and remove actions on the right.

Sandbox metadata: `当前浏览器 · 读写`.
Browser-folder metadata: `本地文件夹 · 已授权 · 读写`.

Requirements:
- remove the large inner enclosing card;
- remove large filled per-Workspace cards;
- remove duplicated labels such as repeated `Sandbox`;
- preserve visible `当前`, set-current, and remove actions;
- preserve existing Workspace test ids where practical;
- truncate long names safely;
- use soft separators for multiple Workspaces.

Add-location controls sit directly below the list as a compact footer. Keep current canonical-Sandbox visibility logic. Empty state stays concise and text-only.

## 工作区知识
Keep `SettingsRow` as the only primary shell. Remove the embedded bordered status card in the control area.

No-index example:
`未建立索引                         [建立索引]`

Indexed example:
`已就绪 · 326 文件 · 1,284 片段     [更新] [清除]`

Secondary metadata:
`上次更新 22:31 · KIRO.md 已启用`

Requirements:
- status/count/time/KIRO.md render as inline metadata;
- no-index state has one clear build action;
- indexed state has update plus low-weight clear action;
- force-refresh, busy, error, and Knowledge-only clear behavior remain unchanged;
- preserve `data-testid="kiro-workspace-knowledge-panel"`;
- KIRO.md visibility keeps current exact-root + current fs.read allow + accessible-file rule.

## Visual hierarchy
Use existing Settings tokens, Button/IconButton, typography, and separators. Do not add a new card system or arbitrary colors.

Target roughly 35–45% less vertical space than the current one-Sandbox/no-index screenshot. This is a design-density target, not a pixel-perfect test.

## Responsive behavior
At narrow widths, text remains flexible with `min-w-0`; controls remain reachable and may wrap below/right; no overlap or horizontal overflow; avoid large fixed control widths.

## Accessibility
Preserve accessible names for icon-only actions. `当前` remains visible text. Busy Knowledge controls stay disabled and show visible progress wording.

## Behavioral invariants
Do not change:
- explicit Browser-folder authorization;
- canonical Sandbox reuse;
- active Workspace selection;
- Workspace cleanup semantics;
- real Browser-folder files staying untouched when the Workspace is forgotten;
- Knowledge build/update bounded force refresh;
- Knowledge clear affecting Knowledge records only;
- KIRO.md detection behavior;
- Settings actions not consuming Computer model-tool quota.

## Testing
Prefer focused existing Settings / V3 Knowledge tests.
Protect:
1. active/inactive Workspace actions;
2. canonical Sandbox action visibility;
3. no-index versus indexed Knowledge controls;
4. busy state;
5. KIRO.md metadata visibility;
6. narrow viewport usability.

Prefer extending existing E2E coverage; do not add a new visual snapshot framework.

## Acceptance
- 授权位置 is a compact flat list rather than nested cards.
- Workspace metadata is concise and non-duplicated.
- Current/select/remove behavior remains intact.
- Add-location controls are compact and subordinate.
- 工作区知识 uses inline status rather than an embedded card.
- Counts, time, and KIRO.md state are concise secondary metadata.
- Knowledge runtime and permission semantics remain unchanged.
- Narrow layouts remain usable.
- Targeted tests and typecheck must be freshly verified before completion is claimed.

## Stop Boundary
Stop after these two Kiro Settings surfaces are productized and focused regressions are verified. Do not broaden this task into a full Settings redesign or V3 Part 2.