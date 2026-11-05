# Motion System V4 · 动画与磨砂遮罩统一审计

> **已被 `docs/motion-system-v5-easing.md` / `docs/motion-system-v6.md` 取代。**
> 本文件保留为 V4 历史审计记录；当前 easing 以 lib/motion.ts / app/globals.css 的 V5/V6 token 为准。
> **V6 更新：全站 scrim 已从深色 dim 改为浅色暖纸磨砂。**

> 目标：参考 ChatGPT / Apple 的克制、连续、可预期动效语言，收敛 ClassFlow 中
> 弹窗、抽屉、浮层、列表与背景磨砂的冲突项。
> 唯一时间/缓动真值仍是 `lib/motion.ts` ↔ `app/globals.css`，本文件只记录语法。

## 1. Motion Grammar（语义 → 档位）

| 语义 | Enter | Exit | Easing | 说明 |
| --- | --- | --- | --- | --- |
| Press / instant | 90ms | — | standard | `.ux-press` 轻缩放；空间稳定控件不缩放 |
| Popover / tooltip / toast | 140ms | 110ms | standard / exit | `.ux-inline` / `ux-toast-enter` |
| Disclosure / list enter | 180ms | 150ms | standard / exit | `DisclosureRegion` / `animate-enter` |
| Modal / Dialog / Command | 220ms | 150ms | standard / exit | opacity + scale .985 + 4px y |
| Drawer (edge / floating) | 220ms | 160ms | emphasized / exit | 右侧位移 + fade，无 Modal 向心缩放 |
| Page tab | 180ms | — | standard | opacity（方向变体 ±4px） |
| Data / settle | 200ms | — | standard | 进度、落位、图表 |

- 所有退出都比进入快；退出统一 `--ease-exit`（加速离场）。
- `prefers-reduced-motion` / 应用内 reduced：全局 CSS 将 duration 降到 0.01ms；
  组件 presence / Framer Motion 走即时最终态。
- 禁止 `transition-all`、裸 `duration-[Nms]`、bounce/ping（`npm run lint:motion` 硬门禁）。

## 2. 背景磨砂（统一 scrim）

`.ux-scrim*` 是唯一全屏背景视觉：

| 档位 | 背景（V6 浅色） | 模糊 | 使用场景 |
| --- | --- | --- | --- |
| `.ux-scrim` | `rgba(240,235,225,0.62)` | 14px / saturate 1.05 | Dialog / Drawer / CommandCenter / 导入预览 |
| `.ux-scrim-soft` | `rgba(240,235,225,0.42)` | 8px / saturate 1.02 | ReminderCenter / Kiro 侧 sheet |
| `.ux-scrim-strong` | `rgba(247,245,245,0.78)` | 22px / saturate 1.08 | 图片灯箱 / Markdown lightbox |

无 `backdrop-filter` 回退：0.90 / 0.78 / 0.94 不透明度浅色纸面。
全站统一浅色磨砂，不再使用深色 charcoal dim。

原则：

- **模糊静态、透明度动画**：scrim 挂载时即带 `backdrop-filter`，只随 root opacity
  淡入淡出；不在进退场逐帧改变 blur 半径（Apple 式做法，避免全屏重模糊卡顿）。
- 面板是 scrim 的子元素，不受自身 `backdrop-filter` 影响，文字/图标保持锐利。
- `@supports not (backdrop-filter)` 时仅保留更深的 dim 背景。
- 退出时 scrim 的 `transition-duration` 由 `OverlayLayer` 用 `exitMs` 内联对齐面板，
  避免「面板已卸载、背景还在淡出」的截断。

## 3. 浮层 / 菜单滚动

- 列表滚动容器：`min-h-0 flex-1 overflow-y-auto`，面板固定 head/search，列表独立滚动。
- **鼠标 hover 只换高亮，不自动滚动/移焦**（`UISelect` / `KiroModelSelector`）。
  自动滚动仅由键盘 ↑/↓ / Home / End 触发，避免下方半可见选项 hover 时硬跳。
- `CommandCenter` 同样只在键盘高亮时 `scrollIntoView`；鼠标 hover 不抢键盘高亮
  （`pointerActiveRef` 模式）。

## 4. 已收敛的冲突项

- Dialog：scale .99/2px → 统一 .985/4px，220/150；scrim 不再单独 `bg-black/40`。
- Drawer：floating/edge 去掉 `bg-black/20` / `bg-black/30` 分叉，统一 `ux-scrim`。
- CommandCenter：scrim 统一 + 面板 enter 220ms（原 180ms）。
- TimetableImportPreview：scrim/面板 220/150（原 180ms）。
- Kiro Markdown lightbox：强磨砂 + 220/150；面板 scale .985/4px。
- Kiro 图片灯箱：强磨砂（原纯 dim）。
- Kiro ContextPicker / History：soft scrim + 220/160。
- ReminderCenter：补 soft scrim；面板 220/160。
- UISelect / KiroModelSelector / CommandCenter：hover 半可见行不再滚动硬跳。
- 模型选择器：仅面板自身玻璃，不触发全局磨砂（产品反馈）。
- Settings Ctrl+F：桌面/移动双搜索框逐个尝试聚焦（ref 可能指向隐藏输入），
  避免快捷键在部分窗口尺寸下失效。

## 5. 验收

- `npm run typecheck`
- `npm run lint:motion`（无 FAIL；已有 WARN 保留）
- `npx vitest run tests/motionContract.test.tsx tests/uiMotionLifecycle.test.tsx tests/drawerPresentation.test.ts tests/hardCutSweep.test.tsx`
- `npx playwright test tests/e2e/settings.spec.ts tests/e2e/settings-select.spec.ts tests/e2e/model-selector-glass.spec.ts tests/e2e/kiro-sidecar-reasoning.spec.ts`
- `npm run build`
