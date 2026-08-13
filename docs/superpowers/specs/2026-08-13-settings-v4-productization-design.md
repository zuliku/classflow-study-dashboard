# ClassFlow Settings V4 Productization Design

**Date:** 2026-08-13  
**Status:** Awaiting user review  
**Scope:** Settings V4 — 正式产品 IA + Presentation Preferences Foundation  
**Repository:** `zuliku/classflow-study-dashboard`

## 1. Goal

把当前 Settings 从“功能逐步堆叠后的配置集合”整理为可长期扩展的正式产品设置中心，并在本阶段真正加入三套全局展示能力：

1. Theme：跟随系统 / 浅色 / 深色；
2. i18n：跟随系统 / 简体中文 / English；
3. 日期与时间格式：系统 / ISO、MDY、DMY；系统 / 24h、12h。

Settings V4 必须满足两个约束：

- **Zero fake settings**：生产环境只展示已经真实生效的设置；
- **Presentation ≠ Domain**：主题、语言、日期/时间格式只改变呈现，不改变课程、任务、DDL、Reminder、StudyBlock 等业务数据语义。

账户与云同步已经进入近期产品路线，但本阶段只预留架构，不展示未实现的登录、同步或设备 UI。

## 2. Product Decisions Already Locked

本规格基于以下已确认产品决策：

- 近期会加入账户与云同步；
- 登录后默认自动同步，不增加“登录后是否同步”的总开关；
- 未登录时继续 Local-first；
- 登录后的离线状态继续本地工作，恢复网络后自动补同步；
- 退出登录不自动删除本地学习数据；
- `个人资料` 与 `账户与同步` 完全分离；
- `任务与提醒` 拆成 `任务` + `通知与提醒`；
- 删除当前没有真实 preference 的 `专注与学习` 一级设置；
- 新增 `外观与显示` 一级设置；
- 语言第一版：系统 / 简体中文 / English；
- 日期格式：系统 / `2026-08-13` / `08/13/2026` / `13/08/2026`；
- 时间格式：系统 / 24 小时 / 12 小时；
- 当前阶段不加入用户可切换时区；
- `完整演示数据` 入口继续保留，但必须严格 development-only；
- `账户与同步` 本阶段只做架构预留，不展示未实现的控制项。

## 3. Chosen Product Architecture

采用 **User-intent Settings IA + Presentation Preferences Layer**。

```text
Settings UI
   │
   ├── Domain settings
   │    ├── Semester
   │    ├── Tasks
   │    ├── Notifications
   │    ├── Kiro
   │    └── Agent permissions
   │
   └── Presentation preferences
        ├── Theme preference
        ├── Language preference
        ├── Date format preference
        └── Time format preference
                 │
                 ▼
        Runtime resolution layer
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
     Theme     i18n     Formatter
```

`AppPreferences` 保存用户选择的 preference；运行时解析 system preference。**不把 effective theme / locale / hour cycle 持久化。**

## 4. Final Settings IA

桌面 Settings 左侧一级导航按弱分组组织：

```text
设置

常规
├─ 通用
├─ 外观与显示
└─ 个人资料

学习
├─ 学期与课表
├─ 任务
├─ 通知与提醒
└─ 交互与快捷键

Kiro
├─ Kiro 与 AI
└─ Kiro Agent

数据与系统
├─ 账户与同步        [reserved, hidden in this phase]
├─ 数据与存储
└─ 关于
```

分组标题只用于桌面导航的视觉组织，不引入新的二级路由层。移动端保持当前横向 section tabs / 紧凑导航策略，不强行显示分组标题。

### 4.1 通用

只承载全局产品行为和 locale presentation：

- 默认打开位置：总览 / 课表 / 任务 / 上次使用位置；
- 语言：跟随系统 / 简体中文 / English；
- 日期格式：跟随语言与系统 / ISO / MDY / DMY；
- 时间格式：跟随系统 / 24h / 12h。

本阶段不加入：

- 时区选择；
- 一周起始日自定义；
- 任何尚未真正消费的“地区”占位项。

### 4.2 外观与显示

承载视觉与动效偏好：

- 主题：跟随系统 / 浅色 / 深色；
- 界面密度：舒适 / 紧凑；
- 动效：跟随系统 / 完整 / 减少。

当前 `GeneralSettings` 中的 density / motion 迁移至本 section；不复制状态，不新建第二套 preference。

### 4.3 个人资料

定义为 **学习档案**，不是 Account Profile。

保留：

- 头像；
- 姓名；
- 学号；
- 学院 / 专业；
- 年级；
- 已完成学分；
- 总学分。

未来登录邮箱、认证方式、密码/Passkey、设备列表等绝不进入此页面。

### 4.4 学期与课表

保留现有真实能力：

- 当前学期概览；
- 学期名称；
- 第一周日期；
- 教学周数；
- 显示周末。

不在 Settings V4 顺带改造 semester / timetable domain model。

### 4.5 任务

从当前 `TaskSettings` 中拆出任务默认行为：

- 临近截止范围；
- 默认截止时间；
- 默认优先级；
- 默认状态；
- 默认任务视图。

### 4.6 通知与提醒

新建独立一级 section，承载通知 channel 与 missed-reminder policy：

**通知渠道**

- 应用内提醒状态说明；
- 浏览器 / 系统通知；
- 浏览器 Notification permission 状态。

**提醒行为**

- 错过提醒处理；
- 补发时间范围（仅在对应策略下显示）。

未来允许自然扩展：

- 任务提醒；
- 专注结束；
- Kiro 后台任务；
- 云同步异常。

但未实现前不显示这些类型控制。

### 4.7 删除“专注与学习” Settings section

当前该页面只有功能状态说明，没有用户可修改 preference，因此从 Settings IA 删除。

未来只有在出现真实可配置项（如默认专注时长、自动休息、提示音等）时，才重新评估是否需要独立一级页面。

删除 Settings section 不代表删除 Focus runtime / Focus Session 功能。

### 4.8 交互与快捷键

继续承载：

- 课表直接操作；
- DDL 直接操作；
- 单键快捷键。

本阶段不做全局快捷键编辑器。

### 4.9 Kiro 与 AI

一级入口保留，内部按四组整理：

```text
模型与服务
回答与个性化
联网与工具
记忆
```

继续承载已有真实能力，例如 Provider、模型、Reasoning、回答偏好、输出字号、Auto Context、Web Search、PDF Vision、Memory。

不为了缩短页面继续增加一级导航。

### 4.10 Kiro Agent

继续独立，因为这里属于权限与执行安全域，而不是模型偏好域。

保留真实能力：

- Computer Agent；
- 默认权限模式；
- Workspace；
- 授权位置 / Sandbox；
- 当前能力边界与安全说明。

删除 roadmap 式 UI，例如“桌面版后续支持”“未来 Full Access”等开发路线描述。Settings 只说明当前 capability boundary。

### 4.11 账户与同步

预留稳定 section id：

```text
account-sync
```

本阶段要求：

- 可进入 `SettingsSection` / section registry 的架构定义；
- production 导航不显示；
- 不挂载假的登录页面；
- 不提供 Coming Soon；
- 不提供假设备、假同步状态或 disabled 登录按钮。

下一阶段 Account & Cloud Sync V1 启用后，目标语义为：

```text
未登录 → Local-first
登录   → 自动云同步
离线   → 本地继续工作，恢复网络后补同步
退出   → 不自动删除本地数据
```

### 4.12 数据与存储

保留：

- 数据概览；
- 数据健康检查；
- 完整 ZIP 备份；
- JSON 数据备份；
- Restore；
- Danger Zone。

`完整演示数据` 保留为开发预览能力，但必须继续严格由 `process.env.NODE_ENV === "development"` 或等价 build-time dev gate 控制，production 永不显示。

### 4.13 关于

保持极简：

- ClassFlow；
- 版本；
- 当前数据模式；
- 附件存储。

账户/同步未实现前，不伪造“云端模式”。

## 5. “已修改”视图与 modified dot

Settings V4 移除当前全局“已修改 N”视图和基于 `AppPreferences` 的导航 modified dot。

原因：当前真实设置已经分布在 AppPreferences、Reminder preferences、Kiro / AI、Agent 等多个 domain/store，仅统计 AppPreferences 会产生“部分修改被统计、部分不统计”的错误产品语义。

替代策略：

- 设置即时保存；
- 有默认值的 preference row 可以保留单项“恢复默认”；
- 必要时 section 可提供“恢复本页默认”；
- 不提供一个不能覆盖全部 Settings domain 的全局 modified counter。

## 6. Presentation Preferences Domain

在现有 `AppPreferences` 中新增：

```ts
type ThemePreference = "system" | "light" | "dark";
type LanguagePreference = "system" | "zh-CN" | "en-US";
type DateFormatPreference = "system" | "iso" | "mdy" | "dmy";
type TimeFormatPreference = "system" | "24h" | "12h";
```

推荐默认值：

```ts
themePreference: "system",
languagePreference: "system",
dateFormatPreference: "system",
timeFormatPreference: "system",
```

继续使用现有 `DEFAULT_PREFERENCES + sanitizePreferences()` 模式：

- 历史数据缺字段 → 默认值；
- 单字段非法 → 仅该字段回退；
- 不因为新增 presentation preference 修改业务数组；
- backup / restore 应继续安全携带 preferences。

### 6.1 Persist preference, resolve effective state

Store 只保存：

```text
system / light / dark
system / zh-CN / en-US
system / iso / mdy / dmy
system / 24h / 12h
```

运行时解析：

```text
effectiveTheme
effectiveLocale
effectiveDateFormat
effectiveHourCycle
```

系统主题、系统语言或系统 12/24h 改变时，如果 preference 为 `system`，运行时结果可以跟随变化，但不回写 Store。

这也为后续云同步提供干净语义：同步用户 preference，而不是把某台设备解析出的 effective state 同步给其他设备。

## 7. Theme Architecture

### 7.1 Semantic color tokens first

当前应用存在大量固定浅色 HEX 和固定 Tailwind palette。Settings V4 的 Dark Theme 必须通过 semantic color system 实现，而不是全站堆 `.dark:` 补丁。

目标依赖关系：

```text
Component
   ↓
Semantic Tailwind token
   ↓
CSS custom property
   ↓
Light / Dark token value
```

核心 token 至少覆盖：

```text
background
surface
surface-soft
surface-muted
text-primary
text-secondary
text-muted
border
border-soft
border-strong
danger / danger-bg / danger-border
warning / warning-bg / warning-border
success / success-bg / success-border
```

### 7.2 Theme datasets

根节点使用：

```html
<html
  data-theme-preference="system"
  data-theme-effective="dark"
>
```

CSS：

```css
html[data-theme-effective="light"] { ... }
html[data-theme-effective="dark"] { ... }
```

并设置：

```css
color-scheme: light;
color-scheme: dark;
```

### 7.3 Visual direction

Dark Theme 不是浅色 palette 的数学反色。

继续保持 ClassFlow 当前 warm / low-saturation brand：

- warm charcoal / dark paper；
- muted stone border；
- restrained sage accent；
- danger / warning / success 继续低饱和；
- 不使用大面积纯黑；
- 不使用刺眼纯白正文；
- surface 层级主要通过 brightness / border 区分，不用过重阴影。

浅色主题必须基本保持现有视觉，不把 Theme Foundation 变成 Light UI redesign。

### 7.4 Pre-paint bootstrap

不能等 React `useEffect()` 才应用主题，否则深色用户首次加载会看到 light flash。

沿用当前 Motion 的 pre-hydration bootstrap 模式，新建独立 appearance/theme bootstrap：

```text
localStorage AppPreferences
        ↓
themePreference
        ↓
matchMedia(prefers-color-scheme)
        ↓
<html data-theme-*>
```

本阶段不为了 DRY 重写已经稳定的 `MOTION_BOOTSTRAP_SCRIPT`。Theme bootstrap 可独立存在，以减小回归风险。

### 7.5 Runtime theme changes

React runtime 负责：

- preference 改变后即时更新 root dataset；
- `system` 模式监听 `prefers-color-scheme`；
- 显式 light/dark 时不受系统主题变化影响。

### 7.6 Fixed color migration rules

固定颜色按语义分类迁移，禁止全仓库机械替换：

**A. UI semantic colors**  
背景、surface、text、border → semantic tokens。

**B. Product status colors**  
danger / warning / success → theme-aware semantic tokens。

**C. User/data colors**  
课程色、用户自定义颜色、图表数据色等不因 Theme 切换而写回 Store。必要时只在 render 层做对比度适配。

## 8. i18n Architecture

### 8.1 No locale URL routing in V4

ClassFlow 当前是工作台型应用，本阶段不增加：

```text
/zh-CN/*
/en-US/*
```

避免为了双语引入路由重构。

### 8.2 Lightweight typed dictionary

建议结构：

```text
lib/i18n/
├── types.ts
├── resolveLocale.ts
├── messages/
│   ├── zh-CN.ts
│   └── en-US.ts
├── translator.ts
└── I18nProvider.tsx
```

使用稳定 message key：

```ts
t("settings.title")
t("settings.general.language")
t("tasks.empty.title")
```

不使用中文原文作为 key。

中文作为 source dictionary；English dictionary 必须通过 TypeScript 对 key completeness 做约束，防止漏翻译。

### 8.3 Locale resolution

```text
languagePreference = zh-CN → zh-CN
languagePreference = en-US → en-US
languagePreference = system → navigator.languages
```

第一版 system mapping：

```text
zh / zh-CN / zh-TW / zh-HK → zh-CN
en / en-*                  → en-US
其他                         → zh-CN fallback
```

当前只支持两个正式 UI locale，不把 unsupported locale 伪装成已支持。

### 8.4 `<html lang>`

Root `<html lang>` 不再永久写死 `zh-CN`。

Locale bootstrap / runtime 在有效语言切换时同步更新：

```html
<html lang="zh-CN">
<html lang="en-US">
```

### 8.5 Translation boundary

只翻译 **product-owned UI copy**：

- 导航；
- Settings；
- 按钮；
- Dialog；
- Toast；
- 空状态；
- 表头；
- 产品错误提示；
- Kiro UI chrome。

绝不自动翻译：

- 课程名；
- Assignment title / description；
- 教师名；
- 文件名；
- Group project 内容；
- 用户输入；
- Kiro / AI 返回正文；
- 任何用户生成数据。

### 8.6 Migration strategy

i18n 采用 vertical slices，不做一个巨大“全仓库中文替换”commit。

顺序：

1. App Shell + Settings + navigation + global primitives；
2. Overview / Timetable / Courses / Assignments / Calendar / Group / Analytics；
3. Kiro UI chrome / Kiro Settings / Agent / 复杂错误提示。

阶段性允许尚未迁移 workspace 保持中文，但最终 Settings V4 i18n 完成验收要求：`en-US` 下核心产品 UI 不应残留 product-owned 中文文案。

## 9. Date / Time Presentation Architecture

### 9.1 Central formatter facade

新增统一 presentation API，例如：

```text
lib/format/
├── dateTime.ts
├── relative.ts
└── types.ts
```

业务组件不再自行决定 human-readable format string。

统一入口至少包括：

```ts
formatAppDate(...)
formatAppTime(...)
formatAppDateTime(...)
formatWeekday(...)
formatRelativeDate(...)
```

内部优先使用 `Intl.DateTimeFormat`；已有 `date-fns` 继续服务日期计算/domain helper，不要求全部移除。

### 9.2 Date format semantics

```text
system → 跟随 effective/system locale
iso    → 2026-08-13
mdy    → 08/13/2026
dmy    → 13/08/2026
```

语言与日期格式是独立 preference：

```text
English UI + ISO date + 24h
```

必须是合法组合。

### 9.3 Time format semantics

```text
system → browser / OS convention
24h    → 14:30
12h    → 2:30 PM
```

使用 `Intl.DateTimeFormat` 的 `hour12` / `hourCycle` 能力，不在组件手写 AM/PM 拼接逻辑。

### 9.4 Format does not mutate domain values

所有现有 domain storage semantics 保持不变，例如：

```text
Assignment DDL     YYYY-MM-DDTHH:mm[:ss]
Reminder trigger   local wall-clock datetime
StudyBlock date    YYYY-MM-DD
StudyBlock time    HH:mm
Semester date      YYYY-MM-DD
```

用户切换到 12h 后，Store 中的 `14:30` 仍然是 `14:30`，只有 UI 输出变成 `2:30 PM`。

**禁止把展示格式写回业务字段。**

### 9.5 Native input exception

本阶段不开发自定义 DatePicker / TimePicker。

原生：

```html
<input type="date">
<input type="time">
```

视觉格式仍由浏览器 / OS 决定。用户的 date/time preference 控制 ClassFlow 自己绘制的文本展示、label、tooltip、cards、calendar/DDL/reminder 文案等。

## 10. Account / Cloud Sync Forward Compatibility

Settings V4 的 preference schema 必须考虑下一阶段同步：

- Theme / language / date / time 保存 preference；
- `system` 在每台设备本地重新 resolve；
- 不同步 effective dark/light；
- 不同步某台设备当前解析出来的系统语言；
- future cloud conflict resolution 不应需要理解 presentation preference 的 UI 实现细节。

账户同步本阶段不实现 auth、remote store、conflict merge、device identity 或 encryption。

## 11. Search Registry and Settings Metadata

Settings Registry 继续作为 Settings Search metadata 的唯一来源，不通过 DOM 抓取文案。

V4 调整要求：

- 新增 `appearance`、`notifications`、reserved `account-sync` section id；
- 删除 `focus` section；
- 原 tasks reminder metadata 移至 notifications；
- density / motion metadata 移至 appearance；
- 新增 theme / language / date format / time format search definitions；
- i18n 完成后 registry title / description / keyword 必须支持当前 locale，而不是继续永久写死中文。

`account-sync` hidden 时其未实现 setting definitions 不进入用户可搜索结果，避免搜索暴露假功能。

## 12. Error Handling and Fallbacks

Settings V4 的 presentation foundation 必须 fail-safe：

### Preference corruption

非法持久化值通过 `sanitizePreferences()` 单字段回退默认值，不抛异常。

### localStorage unavailable

Bootstrap 读取失败时：

- Theme → system；
- Language → system / zh-CN fallback；
- Date / time → system；
- 应用继续启动。

### Unsupported system language

回退 `zh-CN`。

### `matchMedia` unavailable / failure

Theme 回退 light-safe path；Motion 继续沿用现有行为。

### Missing translation key

开发环境应该尽早暴露问题；生产环境不能因为单个 key 崩溃。推荐 translator 返回 source-locale / key fallback，并通过 typecheck 保证主要 completeness。

### Formatter invalid input

Formatter facade 必须明确处理 null / invalid date，不让 `Invalid Date` 在核心 UI 大面积泄漏；具体 fallback 文案由调用场景决定。

## 13. Accessibility

Theme / i18n 改造不得降低现有 accessibility：

- Light / Dark 都保持文本和交互状态可读性；
- `focus-visible` 在两套主题中都清晰；
- `<html lang>` 与 effective locale 一致；
- icon-only controls 继续有 accessible name；
- reduced motion 逻辑保持独立且可与 dark/system 组合；
- 不依赖颜色单独表达 danger / success / selected 状态。

## 14. Explicit Non-goals

Settings V4 不包含：

- Account backend；
- 登录 / 注册；
- Cloud sync engine；
- 多设备管理；
- Sync conflict merge；
- 用户可切换时区；
- locale URL routing；
- 繁体中文正式 UI locale；
- 自定义 DatePicker / TimePicker；
- 全局快捷键编辑器；
- Focus domain redesign；
- Semester / Reminder / Task domain 时间语义重写；
- Light Theme 全面视觉重设计；
- 为了 Theme 顺手修改用户课程色数据；
- 通过 disabled / Coming Soon control 暴露未实现功能。

## 15. Implementation Decomposition Boundary

本设计应拆成多个独立 implementation plans / commits，不允许一个 Agent 回合全做：

### V4-P1 — Settings IA + Presentation Preferences Domain

目标：先把结构和 schema 定稳。

包括：

- Settings section 重组；
- Tasks / Notifications 拆分；
- 删除 Focus Settings section；
- Appearance section；
- account-sync hidden architecture；
- new AppPreferences fields + sanitize/default；
- Registry 更新；
- 移除全局 modified view/dot；
- 不做全站 dark/i18n migration。

### V4-P2 — Theme Foundation

包括：

- Theme resolver；
- pre-paint bootstrap；
- root datasets；
- semantic CSS variables；
- Tailwind semantic token bridge；
- Dark palette；
- App Shell + Settings + representative surface migration；
- system theme runtime listener。

### V4-P3 — i18n Foundation + App Shell

包括：

- typed dictionaries；
- locale resolver；
- provider / translator；
- `<html lang>` runtime；
- Settings / navigation / App Shell / global primitive copy；
- system language preference。

### V4-P4 — Product i18n Migration

按 workspace vertical slice 分批：

- Overview / Timetable；
- Courses / Assignments；
- Calendar / Group / Analytics；
- Kiro / Agent / remaining product copy。

每个 slice 独立验证，避免一次修改大量无关页面。

### V4-P5 — Date / Time Presentation

包括：

- formatter facade；
- date/time preference runtime resolution；
- 替换 human-readable display formatting；
- locale-aware weekday / relative date；
- 不改 domain storage；
- 不开发 custom picker。

## 16. Testing Strategy

遵循仓库当前“targeted validation first”原则。

每个 implementation slice 只运行受影响的 unit/component tests；不默认跑完整 E2E / build。

必须有针对性覆盖：

### Preferences

- 新字段默认值；
- partial old state sanitize；
- invalid preference fallback；
- backup / restore compatibility。

### Theme

- system/light/dark resolver；
- pre-paint persisted preference parsing；
- system matchMedia change；
- root dataset application；
- representative Light / Dark UI smoke。

### i18n

- locale resolver；
- English dictionary completeness via typecheck；
- system locale fallback；
- representative Settings / App Shell switching。

### Date/time

- ISO / MDY / DMY；
- 12h / 24h；
- zh-CN / en-US；
- `system` resolver；
- domain values unchanged after preference changes。

如果 targeted validation 暴露小型既有 selector/copy/type/test setup 问题，可以顺手修复；不得通过 skip、弱化断言或关闭检查绕过。

## 17. Acceptance Criteria

Settings V4 完成后应满足：

1. Settings 一级 IA 与本规格一致；
2. `专注与学习` 不再作为空壳 settings section；
3. Tasks 与 Notifications 有清晰边界；
4. Appearance 独立；
5. Account & Sync 架构存在但 production 不展示假功能；
6. Theme system/light/dark 真实全局生效，首屏无明显 light flash；
7. Light Theme 保持现有 ClassFlow 品牌视觉；
8. Dark Theme 是完整可用的品牌主题，而不是零散 `.dark:` patch；
9. Language system/zh-CN/en-US 真实控制产品 UI chrome；
10. 用户内容与 AI 正文不被自动翻译；
11. Date/time preference 真实控制 ClassFlow 文本展示；
12. 业务日期时间存储结构完全不因 presentation preference 改变；
13. 原生 date/time input 不被强行重写；
14. Demo reload 仅 development 可见；
15. Settings Search 不暴露 hidden Account/Sync fake settings；
16. 不新增 disabled roadmap controls；
17. targeted tests 覆盖新增 preference resolver / formatter / i18n / theme foundation。

## 18. Design Invariants for Future Work

后续 Settings、Account、Sync、Desktop Agent 扩展继续遵守：

- Settings 以用户意图分类，不按代码模块机械分类；
- 只有真实可用能力进入 production Settings；
- 个人资料是学习档案，Account Identity 是账户域；
- Presentation preference 不修改 Domain data；
- `system` preference 在设备本地 resolve；
- Cloud Sync 同步 preference，不同步 effective environment state；
- 安全 / 权限能力与普通 AI 个性化保持边界；
- 开发工具必须 dev-only；
- 大型横切能力采用 foundation → vertical migration，不做全仓库大爆改。
