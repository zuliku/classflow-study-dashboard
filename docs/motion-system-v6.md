# Motion System V6 · 空间弹簧与编排

> 状态：**已实现（V6 默认）**。
> V5 的 `linear()` 曲线族继续作为底层 easing；V6 在其上补齐
> **时长阶梯、空间 spring、锚定浮层、按压回弹、菜单编排**。
> 单一真值仍为 `lib/motion.ts` ↔ `app/globals.css`。

## 1. 参考与目标

参考 Apple HIG（空间关系、可中断、spring settle）、Material 3（emphasized /
asymmetric transition）、Linear / Raycast（micro 快速、浮层从触发点生长、克制不弹跳）。

目标：

1. **流畅**：微交互快，过渡不拖；大表面用长尾 spring 落位，不“急停”。
2. **灵动**：浮层从触发点长出；菜单项 18ms 级联；按压有 3% 回弹。
3. **高级**：文字/图标零 overshoot；仅 selection / press 允许 ≤1.1% 微回弹。
4. **统一**：所有时长/曲线引用 token；退出统一加速；reduced-motion 全静态。

## 2. 时长阶梯（V6）

| token | 值 | 语义 |
| --- | --- | --- |
| `snap` | 100ms | press / instant feedback |
| `fast` | 160ms | popover / tooltip / toast / icon |
| `base` | 200ms | disclosure / list enter / content |
| `page` | 220ms | workspace page direction |
| `data` | 220ms | progress / chart / number |
| `overlay` | 250ms | Dialog / Command / import preview |
| `panel` | 260ms | Drawer / Sidebar / Sidecar spatial morph |
| `exit-fast` | 120ms | popover / select / toast |
| `exit-base` | 160ms | disclosure / dialog / content swap |
| `exit-panel` | 190ms | drawer / list collapse / spatial |

规则：

- 退出 ≈ 进入的 70–80%，并使用 `--ease-exit`（加速离场）。
- 微交互（press/hover）不超过 160ms；大表面（overlay/panel）可达 250–260ms。
- 不在业务组件写裸 `duration-[Nms]`；lint 硬门禁。

## 3. 语义角色

`lib/motion.ts` 的 `MOTION_ROLE` 是测试/文档用的角色表；CSS 仍是执行真值。

| role | enter | exit | easing | 用途 |
| --- | --- | --- | --- | --- |
| press | 100ms | — | `spring-snappy` | 按钮按压缩放 0.97 → 回弹 |
| popover | 160ms | 120ms | `out-strong` | 菜单 / Tooltip / 下拉；origin + scale .985 |
| overlay | 250ms | 160ms | `spring-soft` | Dialog / Command；scale .98 + 4px |
| drawer | 260ms | 190ms | `spring-soft` | Drawer / Sidebar / Sidecar |
| page | 220ms | — | `out-soft` | Tab 方向切换 ±6px |
| list | 200ms | 160ms | `out-strong` | 列表新增 / Disclosure |
| toast | 160ms | 120ms | `out-strong` | Toast 6px 上浮 |

约束：

- `spring-snappy` 只允许 selection（`--ease-selection`）与 press；不可用于文字/弹窗。
- `spring-soft` 零 overshoot；用于宽高/位置 morph 与大表面落位。
- Popover 必须设置 `transform-origin`（top/bottom 的 start/end/center、right 的 left），
  从触发点生长，不再只有 3px 平移。

## 4. 编排（Choreography）

- **菜单级联**：`DropdownMenuPanel` / Mini 会话菜单加 `.ux-menu-stagger`。
  `role=menuitem` 以 `--motion-stagger-step: 18ms` 依次上浮 2px + 淡入；第 6 项起同延迟。
  reduced-motion 下 `animation: none`（不保留 delay，避免隐身后瞬显）。
- **Analytics 页面 stage**：`.ux-analytics-enter` 一次进入（opacity .72→1 + 4px，200ms），
  不再让 Summary / Momentum / Trend 按 40ms 阶梯分批出现；coverage notice 首帧直接占最终高度，
  不做 0fr→1fr 高度展开（否则会把 top grid 向下推 190ms）。
- **页面方向**：`ux-page-in-forward/backward` 位移 6px + opacity 0.92→1；220ms out-soft。
- **Toast**：6px 上浮 + 淡入 160ms；退出 120ms 加速。
- **按压**：`.ux-press:active` scale 0.97；`ux-press-transition` 中 transform 使用
  100ms `spring-snappy`，颜色仍走 160ms standard。
- **Toast 栈**：opacity/translate 120ms exit + 外层 `ExitCollapse` 190ms 高度折叠；
  关闭/挤出时其余 Toast 随高度连续上移，不再硬跳。
- **默认 transition**：`tailwind.config.cjs` 将 `transitionDuration.DEFAULT` /
  `transitionTimingFunction.DEFAULT` 映射到 `--motion-fast` / `--ease-standard`；
  未显式写时长的 `transition-colors` / `transition-transform` 不再落 Tailwind 默认曲线。
- **大表面**：Dialog scale .98 + 4px；Drawer 12px 位移；均使用 spatial spring 落位。

## 5. 性能规则

- 只动画 `transform` / `opacity`；布局尺寸动画必须有明确理由（lint WARN 可见）。
- 禁止 `transition-all`、`animate-bounce/ping`、裸 `duration-[Nms]`。
- `will-change` 只挂在真实动画期表面（modal/drawer/popover），不常驻扩散。
- 进度条等 data-tier 现有 width 过渡保留 WARN；新增代码优先 transform。
- scrim 的 blur 静态，只过渡 opacity，避免逐帧重算 backdrop-filter。

### 5.1 浅色磨砂 scrim（V6）

全站统一浅色暖纸磨砂，不再使用深色 charcoal dim：

| tone | tint | blur |
| --- | --- | --- |
| standard | `rgba(240,235,225,0.20)` | 10px saturate 1.03 |
| soft | `rgba(240,235,225,0.10)` | 4px saturate 1.02 |
| strong | `rgba(247,245,245,0.35)` | 14px saturate 1.05 |

- 面板本身仍是 `bg-surface` + border/shadow；scrim 只负责“把背景洗成浅色磨砂”，不承担面板对比。
- tint 必须足够低：只柔化背景，不把底层内容完全洗平；当前标准档 0.20，强档 0.35。
- 无 backdrop-filter 时回退到 0.55/0.40/0.75 浅色纸面（保留可读的背景轮廓）。

## 6. Reduced Motion

- `prefers-reduced-motion` 或应用内 reduced：所有 animation/transition 压到 0.01ms；
  presence 直接落最终态。
- V6 额外处理：`.ux-menu-stagger` 直接 `animation: none`；`.ux-press:active` 不缩放
  （不用位移/缩放制造“反馈”）。
- 不因 reduced 隐藏状态变化：只去掉运动，保留最终视觉与语义。

## 7. 验收

```sh
npm run lint:motion
npm run typecheck
npx vitest run tests/motionContract.test.tsx tests/uiMotionLifecycle.test.tsx \
  tests/drawerPresentation.test.ts tests/detailMotionContinuity.test.tsx \
  tests/hardCutSweep.test.tsx tests/sidebarChrome.test.ts
npx playwright test tests/e2e/motion-easing-v5.spec.ts
npm run build
```

## 8. 迁移注意

- 旧 `--ease-standard` / `--ease-emphasized` / `--ease-enter` / `--ease-exit` 仍保留。
- 新组件优先使用语义类（`ux-inline` / `ux-modal-panel` / `ux-drawer-panel` /
  `ux-menu-stagger` / `ux-press-transition`），而不是自写 duration/easing。
- 改动 `lib/motion.ts` 数值时必须同步 `app/globals.css`；`motionContract` 会双重校验。
