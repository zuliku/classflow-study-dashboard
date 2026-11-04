# Motion System V5 · 非线性缓动设计

> 状态：**已全量上线（V5 默认）**。
> `app/globals.css` / `lib/motion.ts` 直接输出 V5；不再有 dev 灰度开关。
> legacy alias（standard / emphasized / enter / exit / spring）长期保留为兼容名称。
> 目标：在不改变现有 duration / presence / 交互语义的前提下，把全站 easing 从
> “少量 cubic-bezier + 一个伪 spring”升级为按交互语义分层的非线性速度曲线。

## 1. 现状与问题

当前 V3/V4 只有 5 个 easing token：

| token | 当前值 | 问题 |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 被全站绝大多数 hover / enter 复用，缺少层级 |
| `--ease-emphasized` | `cubic-bezier(0.22, 1, 0.36, 1)` | 与 standard 的感知差异小，品牌/空间 morph 不够“物理” |
| `--ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | 与 standard 并存，语义重叠 |
| `--ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` | 所有退出共用，缺少“快速离场 + 不生硬”的细分 |
| `--ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | **不是 spring**，只是较慢的 cubic-bezier |

结果：

- 菜单 / 弹窗 / 页面切换 / 空间 morph 使用同一类速度曲线，动画语言扁平。
- 空间 morph（Sidebar、Navigator、Sidecar）没有“质量感”，快速中断时容易显得硬。
- 选中指示器（SegmentedControl / Kiro Mode Capsule）只有线性位移感，缺少轻微 settle。
- 退出曲线没有明确“先有意向、再加速离场”的速度结构。

## 2. 设计目标

1. **非线性速度分层**：micro / surface / overlay / spatial / selection / exit 各自有独立曲线。
2. **不改变时长契约**：`MOTION_MS`、`MOTION_EXIT_MS`、`usePresence`、CSS duration 全部保持，
   先只换曲线，便于灰度与回滚。
3. **CSS-only**：不在每帧跑 JS；使用 Chromium 原生 `linear()` 采样曲线。
4. **可控的物理感**：除选中指示器 ≤1.1% 微回弹外，所有文字、图标、弹窗、页面、空间 morph
   零 overshoot。
5. **可直接回滚**：legacy token 保留为 alias，分阶段迁移。

## 3. 技术前提（已在本机 Chromium 验证）

- Electron 43 / Chromium 153：
  - `CSS.supports('transition-timing-function', 'linear(0, 0.5, 1)')` → **true**
  - `CSS.supports('transition-timing-function', 'spring(...)')` → **false**
- 因此 V5 不使用 CSS `spring()`，而是把阻尼弹簧采样为 `linear()` 多点曲线：
  - 浏览器原生插值，可走 compositor；
  - 无 JS 定时器 / 无每帧计算；
  - 21 个采样点在 90–320ms 动画下约 4.5–16ms 一个点，足够 60/120Hz 平滑。

> 备选：未来 Chromium 支持 `spring()` 后可保持语义 token 不变，替换底层值即可。

## 4. V5 曲线族

所有曲线均为 `linear()`，输入/输出归一化到 0→1。除 `spring-snappy` 外峰值 ≤1。

### 4.1 `--ease-out-soft`（easeOutQuart）

```css
--ease-out-soft: linear(
  0, 0.1855, 0.3439, 0.478, 0.5904, 0.6836, 0.7599, 0.8215, 0.8704,
  0.9085, 0.9375, 0.959, 0.9744, 0.985, 0.9919, 0.9961, 0.9984,
  0.9995, 0.9999, 1, 1
);
```

- 速度结构：起步快、尾部轻、无明显“刹车点头”。
- 25% / 50% / 75% 进度：**68.4% / 93.8% / 99.6%**。
- 用途：press、hover 颜色、图标、微小状态、页面 fade、数据条、`--ease-data`。

### 4.2 `--ease-out-strong`（easeOutQuint）

```css
--ease-out-strong: linear(
  0, 0.2262, 0.4095, 0.5563, 0.6723, 0.7627, 0.8319, 0.884, 0.9222,
  0.9497, 0.9688, 0.9815, 0.9898, 0.9947, 0.9976, 0.999, 0.9997,
  0.9999, 1, 1, 1
);
```

- 25% / 50% / 75%：**76.3% / 96.9% / 99.9%**。
- 用途：Popover、菜单、Toast、Disclosure 进入、通用 surface；
  作为 `--ease-standard` 的默认新值。

### 4.3 `--ease-out-expo`（easeOutExpo）

```css
--ease-out-expo: linear(
  0, 0.2932, 0.5005, 0.6471, 0.7507, 0.824, 0.8759, 0.9125, 0.9384,
  0.9567, 0.9697, 0.9789, 0.9853, 0.9899, 0.9932, 0.9954, 0.9971,
  0.9982, 0.999, 0.9996, 1
);
```

- 25% / 50% / 75%：**82.4% / 97.0% / 99.5%**。
- 速度结构：前段极快响应，末端长而轻的落位；适合大表面“打开”而不是“弹开”。
- 用途：Dialog / Drawer / CommandCenter / 导入预览进入；Empty Intro 的视觉进入；
  `--ease-overlay`。

### 4.4 `--ease-in-exit`（自定义加速离场）

```css
--ease-in-exit: linear(
  0, 0.0225, 0.0478, 0.0761, 0.1072, 0.1412, 0.1782, 0.218, 0.2608,
  0.3065, 0.355, 0.4065, 0.4608, 0.5181, 0.5782, 0.6412, 0.7072,
  0.776, 0.8478, 0.9224, 1
);
```

- 25% / 50% / 75%：**14.1% / 35.5% / 64.1%**。
- 速度结构：`0.42t + 0.58t²`，起始仍有明确意向（不是先“停顿”再猛冲），
  随后持续加速离场；与现有 exit 的感知位置接近，但无突然截断。
- 用途：所有 exit（Popover / Dialog / Drawer / Disclosure / Toast / list collapse）。
  替换 `--ease-exit`。

### 4.5 `--ease-spring-soft`（临界阻尼弹簧，零 overshoot）

```css
--ease-spring-soft: linear(
  0, 0.0754, 0.2275, 0.3908, 0.5372, 0.6575, 0.7513, 0.8222, 0.8743,
  0.912, 0.9389, 0.9579, 0.9711, 0.9803, 0.9866, 0.9909, 0.9939,
  0.9959, 0.9972, 0.9982, 1
);
```

- 25% / 50% / 75%：**65.8% / 93.9% / 99.1%**。
- 临界阻尼 ω=9 的阶跃响应采样；起步比 expo 柔和，中段速度高，尾部自然 settle。
- 用途：宽度 / 高度 / 位置的空间 morph：
  Sidebar shell、Kiro Navigator、Kiro Sidecar、Group Kiro Dock、Drawer width。
  新 token `--ease-spatial`。

### 4.6 `--ease-spring-snappy`（欠阻尼选中指示器，微回弹）

```css
--ease-spring-snappy: linear(
  0, 0.1477, 0.4125, 0.6511, 0.8209, 0.9243, 0.9789, 1.003, 1.0106,
  1.0105, 1.0079, 1.005, 1.0027, 1.0013, 1.0005, 1.0001, 0.9999,
  0.9999, 0.9999, 0.9999, 1
);
```

- 25% / 50% / 75%：**92.4% / 100.8% / 100.01%**；峰值 **1.0106**（1.06% overshoot）。
- 欠阻尼 ζ=0.82、ω=13；只允许用于“选中面在移动”的空间反馈，不用于文字/图标/弹窗。
- 用途：SegmentedControl active plate、Kiro Mode Capsule 指示条、Sidebar active plate
  （若后续从 opacity 迁移为位移）。新 token `--ease-selection`。

### 4.7 曲线采样来源（便于复现与测试）

采样点均为 `t = i / 20, i = 0..20`，统一把首点归零、末点归一：

| 曲线 | 数学形式 |
| --- | --- |
| `out-soft` | `1 - (1 - t)^4` |
| `out-strong` | `1 - (1 - t)^5` |
| `out-expo` | `(1 - 2^(-10t)) / (1 - 2^-10)` |
| `in-exit` | `0.42t + 0.58t²` |
| `spring-soft` | 临界阻尼阶跃：`1 - (1 + 9t)e^(-9t)` |
| `spring-snappy` | 欠阻尼阶跃：`1 - e^(-ζωt)(cos(ω_d t) + ζω/ω_d · sin(ω_d t))`，ζ=0.82、ω=13 |

> 生成脚本在实施阶段应落在 `scripts/` 或测试辅助中，避免手改曲线点导致 CSS/JS 漂移。

## 5. Legacy alias 与语义 token

第一轮不改组件，只让旧 token 指向新曲线：

```css
:root {
  /* V5 curve primitives */
  --ease-out-soft: linear(...);
  --ease-out-strong: linear(...);
  --ease-out-expo: linear(...);
  --ease-in-exit: linear(...);
  --ease-spring-soft: linear(...);
  --ease-spring-snappy: linear(...);

  /* legacy compatibility aliases（长期保留，值指向 V5） */
  --ease-standard: var(--ease-out-strong);
  --ease-emphasized: var(--ease-out-expo);
  --ease-enter: var(--ease-out-strong);
  --ease-exit: var(--ease-in-exit);
  --ease-spring: var(--ease-spring-soft);

  /* V5 semantic tokens */
  --ease-overlay: var(--ease-out-expo);
  --ease-spatial: var(--ease-spring-soft);
  --ease-selection: var(--ease-spring-snappy);
  --ease-data: var(--ease-out-soft);
}
```

说明：

- `--ease-standard` 仍是全站最常用入口；映射到 `out-strong` 后，25% 进度与旧值几乎一致，
  视觉风险最低。
- `--ease-spring` 保持“无 bounce”承诺，不再使用伪 spring cubic-bezier。
- `--ease-selection` 是唯一允许 overshoot 的语义 token，且上限 1.1%。

## 6. 语义 → 曲线映射

| 语义 | Enter | Exit | Enter easing | Exit easing |
| --- | --- | --- | --- | --- |
| Press / instant | 90ms | — | `out-soft` | — |
| Hover / color / icon | 90–140ms | 110ms | `out-soft` | `in-exit` |
| Popover / menu / toast | 140ms | 110ms | `out-strong` | `in-exit` |
| Disclosure / list | 180ms | 150ms | `out-strong` | `in-exit` |
| Modal / Dialog | 220ms | 150ms | `out-expo` | `in-exit` |
| Drawer / sheet | 220ms | 160ms | `out-expo` | `in-exit` |
| Page tab | 180ms | — | `out-soft` | — |
| Data / progress | 200ms | — | `out-soft` | — |
| Spatial morph | 220–230ms | 160ms | `spring-soft` | `in-exit` |
| Selection indicator | 180–230ms | 150ms | `spring-snappy` | `in-exit` |
| Empty intro | 250–320ms | 160ms | `out-expo` | `in-exit` |

### 属性级编排（V5 推荐）

大表面不要“所有属性同一条曲线同时结束”：

- **Dialog / Drawer / Command**：
  - opacity：`out-soft`（快淡入）
  - transform / scale：`out-expo`（略慢落位）
  - 退出：两者统一 `in-exit`，保证离场干净。
- **Spatial shell**：
  - width / height：`spring-soft`
  - 内部 opacity：`out-soft`（先显内容，壳体继续 settle）
  - 退出：`in-exit`，不做 spring 回弹。
- **Selection plate**：
  - transform / width：`spring-snappy`
  - 文字颜色：`out-soft`（不与位移共享回弹）。

## 7. JS 镜像

`lib/motion.ts` 中 `EASE` 升级为：

```ts
export const EASE = {
  outSoft: "linear(0, 0.1855, ...)",
  outStrong: "linear(0, 0.2262, ...)",
  outExpo: "linear(0, 0.2932, ...)",
  inExit: "linear(0, 0.0225, ...)",
  springSoft: "linear(0, 0.0754, ...)",
  springSnappy: "linear(0, 0.1477, ...)",
  // compatibility aliases
  standard: "linear(0, 0.2262, ...)", // = outStrong
  emphasized: "linear(0, 0.2932, ...)", // = outExpo
  enter: "linear(0, 0.2262, ...)", // = outStrong
  exit: "linear(0, 0.0225, ...)", // = inExit
  spring: "linear(0, 0.0754, ...)", // = springSoft
} as const;
```

`EASE_BEZIER` 继续保留，作为 Framer Motion / 不支持 `linear()` 的运行时降级：

| key | 近似 cubic-bezier |
| --- | --- |
| `outSoft` | `[0.25, 1, 0.5, 1]` |
| `outStrong` | `[0.22, 1, 0.36, 1]` |
| `outExpo` | `[0.16, 1, 0.3, 1]` |
| `inExit` | `[0.3, 0, 1, 1]` |
| `springSoft` | `[0.22, 1, 0.36, 1]` |
| `springSnappy` | `[0.34, 1.06, 0.64, 1]` |

> `EASE` 是 CSS/WAAPI 的唯一真值；`EASE_BEZIER` 只服务不支持 `linear()` 字符串的
> 第三方动画库（当前为 KiroModelSelector 的 Framer Motion）。
> 两处必须由 `motionContract` 测试保证“语义 alias 相等 + 采样端点 0/1 + snappy 峰值 ≤1.02”。

## 8. 分阶段落地

### Phase 0 · Tokens only（零组件改动）

- 在 `app/globals.css` 增加 6 条曲线 + 语义 token。
- `lib/motion.ts` 增加 `EASE` 新 key 与 `EASE_BEZIER` 镜像。
- 6 条曲线 + 4 个语义 token 直接进入 :root；legacy alias 指向 V5。

> 当前状态：已实现并全量上线。`lib/motion.ts` 的 `EASE_V5` 是曲线真值，
> `EASE.standard` 等 legacy key 全部指向 V5。

### Phase 1 · Legacy alias 切换（已全量上线）

- `--ease-standard/emphasized/enter/exit/spring` 指向 V5。
- 跑全量动效相关单测 + 目标 E2E + 人工抽检。
- 保留 alias 名称，便于旧组件与外部文档继续引用。

> 当前状态：已全量上线，无灰度开关。

### Phase 2 · Spatial

- `--ease-spatial` 接入：`Sidebar.tsx`、`KiroNavigator.tsx`、`KiroSidecarShell.tsx`、
  `GroupKiroPanel.tsx`；Sidebar profile padding 同步。
- 保持所有 duration 不变，只替换 easing。

> 当前状态：已接入，空间壳统一 `spring-soft`。

### Phase 3 · Selection

- `--ease-selection` 接入：`SegmentedControl.tsx`、`KiroModeCapsule.tsx`。
- 选中 plate 允许 ≤1.1% overshoot；文字/图标仍用 `out-soft`。

> 当前状态：已接入，选中面使用 `spring-snappy`（1.06% 微回弹）。

### Phase 4 · Overlay / Page / Data

- Dialog / Drawer / CommandCenter / 导入预览：`--ease-overlay`。
- Page tab / `ux-fade`：`--ease-out-soft`。
- 进度条 / 图表：`--ease-data`。
- 退出全部统一 `--ease-in-exit`。

> 当前状态：Overlay / Page / Empty Intro 已接入；`--ease-data` 已预留，
> 数据条的逐组件迁移留到下一轮，避免一次改动过大。

### Phase 5 · 清理

- 保留 legacy alias（已确认长期兼容），只清理无引用的临时开关/文档；
- 更新 `docs/motion-system-v4.md` → V5 语义表；
- `motionContract` 增加曲线字符串/峰值断言。

## 9. 验收标准

### 自动化

- `npm run typecheck`
- `npx vitest run tests/motionContract.test.tsx tests/uiMotionLifecycle.test.tsx tests/hardCutSweep.test.tsx`
- `npx playwright test tests/e2e/kiro-motion-v1.spec.ts tests/e2e/kiro-composer-motion.spec.ts tests/e2e/kiro-visual-intake-v15.spec.ts`
- `npm run lint:motion`
- `npm run build`
- 新增契约：
  - 每条曲线首尾为 0/1；
  - `spring-snappy` 峰值 ≤1.02；
  - `EASE.standard === EASE.outStrong` 等 alias 同值；
  - `EASE_BEZIER` 与 CSS 曲线语义对应。

### 人工

1. 菜单打开“快而柔”，关闭“有加速度但不生硬”。
2. Dialog 的 opacity 与 transform 感知上同时落位，不出现“壳到了、字还在飘”。
3. Sidebar / Navigator / Sidecar 的宽高 morph 有质量感，松手即停，不回弹。
4. SegmentedControl 选中面移动时只有轻微 settle，文字不缩放、不抖动。
5. 页面切换不因曲线变慢而显得拖沓（180ms 内完成 99%）。
6. Reduced Motion 仍即时落位。
7. 连续快速开合（中断动画）无跳变、无 1px 抖动、无滚动条闪烁。

## 10. 已确认决策

1. 选中指示器接受 **1.06%** 微回弹。
2. Empty Intro 文字/logo 使用 `out-expo`；只有空间壳使用 `spring-soft`。
3. 已全量上线，不再保留 dev 灰度开关。
4. `--ease-standard` 等 legacy alias 长期保留为兼容名称。
