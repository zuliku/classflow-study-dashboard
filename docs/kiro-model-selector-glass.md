# Kiro 模型选择器 · 玻璃动态模糊（开发设计 / 计划）

> 目标：在 ClassFlow Kiro Composer 中落地 ChatGPT 式模型选择器。
> 保留现有模型切换链路与测试契约，只替换“触发按钮 + 浮层 + 动效”的表面层。

## 1. 产品与视觉定位

- **场景**：Kiro 聊天框底部的模型入口（`KiroComposerModelControl`），桌面优先、390px 可用。
- **气质**：轻盈玻璃、克制环境模糊、短促无回弹的进出场；不引入霓虹、强渐变、夸张弹跳。
- **现有设计语言适配**：
  - ClassFlow 目前是 Light-only 暖纸色（`#F7F5F5` / `#F4F2EF`）。玻璃面板采用
    `rgba(244,242,239,0.92)` 暖纸面 + 暖色边框；不做冷白浮层。
  - **不触发全局背景磨砂**：没有 full-screen scrim / backdrop-filter；只有面板自身
    18px 玻璃模糊。全局磨砂保留给未来其他 Dialog/Drawer 复用。
  - Dark Mode 以 `data-appearance="dark"` 作用域实现（面板自包含），并为未来全局暗色预留；
    演示页提供 Light/Dark 切换，生产默认跟随浅色。
  - 动效比参考规格略快：180ms 进入 / 110ms 退出；仍复用 Motion Contract token
    （`MOTION_MS.base` / `MOTION_EXIT_MS.fast` / `EASE_BEZIER.standard` / `EASE_BEZIER.exit`）。

## 2. 组件边界

新增：

- `components/kiro/composer/KiroModelSelector.tsx`
  - 受控/非受控两用；生产由 Composer 的单一 `openMenu` ownership 控制。
  - 负责 Trigger、Portal、玻璃面板、搜索、键盘、焦点恢复、主题作用域（无全局背景遮罩）。
- `components/motion/ModelSelectorDemo.tsx`
  - dev-only（`?model-selector-demo=1`）独立演示页；不读写业务 Store，不触碰 activeTab。
  - 提供 Light/Dark 切换、示例对话背景、模型选择状态展示。
- `app/globals.css` 增加 `.kiro-model-glass` 材质与降级规则。
- `docs/kiro-model-selector-glass.md`（本文件）。

改造：

- `components/kiro/composer/KiroComposerModelControl.tsx` → 薄包装，保留原 props、
  `data-testid="kiro-composer-model"` 与 `data-testid="kiro-composer-model-menu"`，
  内部委托 `KiroModelSelector`。现有 Composer / 测试无需改调用点。
- `app/page.tsx` → 挂载 dev-only Demo（与 MotionGallery 同级，production 返回 null）。

依赖：

- 新增 `framer-motion`（React 18 兼容版本）。仅本组件使用 `motion` / `AnimatePresence`；
  不替换全站现有的 `usePresence` Motion Contract。

## 3. 状态机

```
Closed ── click trigger ──▶ Opening ── 180ms ──▶ Open
   ▲                                               │
   │                                               ├─ hover option（视觉 active）
   │                                               ├─ ArrowUp/Down（active 位移）
   │                                               ├─ input（过滤）
   │                                               ├─ Enter / click（选择 → Closing）
   └──────────── Closing (110ms) ◀── Esc / outside click / select
```

- `open` 是语义状态；`AnimatePresence` 管理 mount/unmount。
- 关闭期间保留面板 DOM 播放退出；指针事件禁用，避免二次触发。
- 选择模型后立即回调 `onSelectModel`，再关闭面板；触发按钮文案同步更新。

## 4. 动效规格

| 元素 | 进入 | 退出 |
| --- | --- | --- |
| 玻璃面板 | opacity 0→1；180ms（模糊由 CSS 静态提供，不逐帧动画） | opacity →0；110ms |
| 全局背景 | **不做**全屏模糊/遮罩（产品反馈：不适合模型选择器） | — |
| 选项 hover | 背景 120ms；文字/图标不位移 | — |
| Active 指示 | 键盘/鼠标 active 行使用暖色背景（不引入 layoutId，避免退出 presence 卡住） | — |
| 列表进入 | 首屏轻微 fade（≤80ms），不做逐项大幅 stagger | — |

- 缓动：进入 `cubic-bezier(0.2, 0.8, 0.2, 1)`；退出 `cubic-bezier(0.3, 0, 1, 1)`。
- **不逐帧动画 backdrop-filter / transform**：任何 blur radius、scale 或 translate 变化都会让
  面板背后与面板内文字/图标在 Windows Chromium 上重新采样，产生抖动。玻璃模糊只声明一次
  （CSS `.kiro-model-glass`），进出场仅过渡 opacity。
- `prefers-reduced-motion` / 应用内 reduced：opacity 过渡时长归零，直接落最终态。
- 玻璃模糊只作用于面板背后（`backdrop-filter`）；内部文字/图标保持锐利。
- `@supports not (backdrop-filter)` 时面板回退为不透明暖白/深灰。
- **滚动**：面板为 flex column，列表 `min-h-0 flex-1 overflow-y-auto`，支持鼠标滚轮 /
  触控板。active 自动滚动只在键盘导航时发生；鼠标 hover 半可见选项不滚列表，
  避免下方选项 hover 时出现硬切跳动。

## 5. 布局与定位

- 面板 Portal 到 `document.body`，`position: fixed`，避免 Composer / Sidecar 的
  `overflow` / stacking context 裁切。
- 触发器 `getBoundingClientRect()`：
  - 宽度 256px（与既有菜单 `w-64` 一致），viewport 不足时收缩并 clamp 到 12px inset；
  - 优先向上展开（Composer 在底部）：`bottom = viewportHeight - trigger.top + 6`；
  - 上方空间不足则向下；左右 clamp 到 12px viewport inset。
- 面板最大高度 `min(360px, 视口可用空间)`；搜索栏固定，只有选项列表滚动。
- 在 resize 时重新测量；点击面板外关闭（fixed 面板不随页面滚动移动，无需滚动关闭）。
- z-index：面板 110（高于 Sidecar / titlebar），无全局遮罩。

## 6. 交互与可访问性

- Trigger：`aria-haspopup="menu"`、`aria-expanded`、`aria-controls`；
  open 时 Chevron 旋转 180°，背景/边框提亮，按压 `scale(.99)`。
- 面板：`role="menu"` + `aria-label="选择模型"`；搜索框为带 `aria-label` 的文本框；
  选项 `role="menuitemradio"` + `aria-checked`（沿用既有菜单语义）。
- 键盘：↑/↓ / Home / End 移动 active；Enter 选择；Esc 关闭。
- 打开后焦点进入搜索框；关闭后焦点回到 Trigger（`useRestoreFocus`）。
- 外部点击关闭；面板内点击不关闭；`data-kiro-composer-menu` 标记保证 Composer 既有
  outside-click 逻辑识别为“菜单内部”。
- 选项点击高度约 36px；hover 与 focus-visible 都有可见反馈；对比度满足 WCAG AA。

## 7. 数据与兼容

- 选项数据结构沿用 `{ value, label, vendor }`，不改变 `modelOptions` 来源。
- `modelUnavailable` 继续显示 warning；空列表继续提供“去设置填写模型”。
- 搜索只过滤 label；清空恢复完整列表；过滤后 active 自动 clamp。
- 现有 `KiroComposerModelControl` 调用点、`onOpenSettings`、`onSelectModel` 行为不变。

## 8. 验证计划（精简）

1. `npm run typecheck`
2. 新增 `tests/kiroModelSelector.test.tsx`：
   - 打开/搜索/键盘选择/外部关闭；
   - 面板含玻璃材质 class、无原生 title；
   - reduced motion 下不挂载动画位移（或直接可见）。
3. 新增 `tests/e2e/model-selector-glass.spec.ts`（原生 Playwright，走 dev demo）：
   - 打开后只有面板自身玻璃模糊，无全局 scrim；
   - 鼠标滚轮可滚动列表；
   - 选择模型 → trigger 文案更新、面板关闭；
   - Esc 关闭；Light/Dark 切换；reduced motion 可用。
4. 新增 `tests/e2e/kiro-sidecar-reasoning.spec.ts`：Sidecar compact 思考程度弹窗
   Portal + viewport clamp，不被 overflow-hidden 裁切。
5. 受影响既有测试：`tests/kiroComposerControls.test.tsx`、`tests/e2e/kiro-composer-preferences.spec.ts`。
6. `npm run build`。
