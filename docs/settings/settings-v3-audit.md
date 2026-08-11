# Settings V3 — Task 0：Settings Audit & Migration Plan

审计日期：2026-08-11。基于当前 main（`docs(kiro): close tool capability audit` 之后）实际代码检查，未修改任何生产代码。

相关文件：`components/settings/*`（22 个组件）、`lib/settingsRegistry.ts`、`lib/preferences.ts`、`store/useAppStore.ts`（preferences）、`store/useReminderPreferencesStore.ts`、`store/useKiroPreferencesStore.ts`、`store/useAISettingsStore.ts`、`types/index.ts`（AppPreferences / SettingsSection）。

---

## 1. Current Problems

1. **「通用」页混入三类非设置内容**：`GeneralSettings` 包含「学习工作区」dashboard（当前学期已设置 / N 门课程 / 配置摘要 checklist）、「常用入口」导航按钮组。属于 dashboard information + navigation shortcut，不是 setting（Settings V3 原则：设置中心管"如何工作"，不管"有哪些数据"）。
2. **Data 页同样混入 dashboard 内容**：`DataOverview`（课程/排课/任务/项目/资料计数 grid）、`DataHealth`（数据状态检查）都是 health/status 信息；真正的 setting 只有 Backup 导出、Restore、DangerZone 三个动作。
3. **三套持久化偏好互不统一**：`AppPreferences`（useAppStore，key `classflow-storage-v2`）、Reminder preferences（`useReminderPreferencesStore`，独立 key）、Kiro preferences（`useKiroPreferencesStore`，key `classflow-kiro-preferences-v1`）、AI settings（`useAISettingsStore`，key `classflow-ai-settings-v1`）+ sessionStorage API Key。`modified`/reset 语义只覆盖 AppPreferences（`lib/preferences.ts`），其余 store 没有"已修改/恢复默认"视图。
4. **搜索/已修改只覆盖部分设置**：`settingsRegistry` 覆盖 UI 可见设置，但「已修改」视图与 modified dot 只针对 `AppPreferences` 四个 section（general/semester/tasks/interaction）；Kiro / AI / Reminder 偏好不参与已修改视图。
5. **Primitive 不一致**：`SettingsRow`（label 左、控件右，py-3 + border-b）与 `DangerZone`/`BackupSection`/`DataHealth`/`RestoreSection`/`GeneralSettings` 里的自定义 row（p-3 + 独立 card 边框）并存；`inputCls` 在 `KiroAISettings` 内局部定义，`ProfileSettings`/`SemesterSettings` 又各自有输入样式；按钮高度/圆角/padding 存在多套（h-7/h-8/h-9、rounded-lg/rounded-xl）。
6. **无 SettingsButton / SettingsDangerRow 抽象**：动作型设置（导出备份、重新检查、危险操作）全部是就地 button，危险样式在 DangerZone 内复制。
7. **Profile/Semester 是"表单 + 保存"模式**，其余是"即时生效"模式，两种交互并存且无统一说明；`SettingsSaveBar` 只服务前两者。
8. **设置入口分散**：`settingsTargetSection` 被 Kiro 与 Timeline 使用做深链跳转，但跳转后没有统一"定位到具体 row"的一致性（搜索跳转有 highlight，深链跳转只有 section）。
9. **dev 演示数据重载入口**（`NODE_ENV === "development"`）出现在 Data 页正文，属于 dev tooling，不应作为设置项。
10. **Focus 没有独立设置区**：专注相关只有 Kiro 侧（start/pause/finish 工具），无用户偏好设置（如专注默认时长等）——当前无真实内容，V3 建议不单独拆页（见 IA）。

---

## 2. Settings Inventory

图例：UI = toggle/select/segmented/input/action/text；SoT = source of truth；持久 = 是否持久化；影响 = 是否真实影响产品行为。

### 2.1 AppPreferences（useAppStore，`classflow-storage-v2`，全部持久化且真实生效）

| setting | section | UI | SoT | 持久 | 影响 | 消费位置 | 保留 | V3 归属 |
|---|---|---|---|---|---|---|---|---|
| 默认打开位置 startupView | general | segmented | AppPreferences | ✓ | ✓ | 启动路由（startup view 逻辑） | ✓ | 通用 |
| 显示周末 showWeekends | semester | toggle | AppPreferences | ✓ | ✓ | 课表渲染 | ✓ | 学期与课表 |
| 临近截止提醒 ddlWarningDays | tasks | segmented (1/3/7) | AppPreferences | ✓ | ✓ | 任务列表 DDL 高亮/徽标 | ✓ | 任务与提醒 |
| 默认截止时间 defaultDDLTime | tasks | time input | AppPreferences | ✓ | ✓ | 新建任务预填 | ✓ | 任务与提醒 |
| 默认优先级 defaultTaskPriority | tasks | select | AppPreferences | ✓ | ✓ | 新建任务预填 | ✓ | 任务与提醒 |
| 默认状态 defaultTaskStatus | tasks | select | AppPreferences | ✓ | ✓ | 新建任务预填 | ✓ | 任务与提醒 |
| 课表直接操作 schedule-direct-manipulation | interaction | toggle | AppPreferences | ✓ | ✓ | 课表拖拽/编辑 | ✓ | 交互与快捷键 |
| DDL 直接操作 ddl-direct-manipulation | interaction | toggle | AppPreferences | ✓ | ✓ | 日历 DDL 编辑 | ✓ | 交互与快捷键 |
| 单键快捷键 single-key-shortcuts | interaction | toggle | AppPreferences | ✓ | ✓ | GlobalShortcutController / CommandCenter | ✓ | 交互与快捷键 |
| 界面密度 content-density | interaction | segmented | AppPreferences | ✓ | ✓ | 任务工作区/课程列表/命令中心 | ✓ | 交互与快捷键 |
| 动效偏好 motion-preference | interaction | segmented | AppPreferences | ✓ | ✓ | 全局 motion 数据集 | ✓ | 交互与快捷键 |

### 2.2 业务数据型（表单 + 保存，非"偏好"）

| setting | section | UI | SoT | 持久 | 影响 | 保留 | V3 归属 |
|---|---|---|---|---|---|---|---|
| 基本资料（姓名/头像/学院/年级/学号） | profile | inputs + SaveBar | useAppStore.userProfile | ✓ | ✓ | ✓ | 个人资料 |
| 学业信息（已修/总学分） | profile | inputs + SaveBar | useAppStore.userProfile | ✓ | ✓ | ✓ | 个人资料 |
| 当前学期（名称/开学日期/周数） | semester | inputs + preview + SaveBar | useAppStore.semester | ✓ | ✓ | ✓ | 学期与课表 |
| 编辑学期（替换学期） | semester | action → dialog | useAppStore | ✓ | ✓ | ✓ | 学期与课表 |

### 2.3 Reminder preferences（useReminderPreferencesStore，独立 key）

| setting | section | UI | SoT | 持久 | 影响 | 消费位置 | 保留 | V3 归属 |
|---|---|---|---|---|---|---|---|---|
| 浏览器系统通知 browser-notifications | tasks | toggle | ReminderPrefs | ✓ | ✓ | reminder runtime 通知 | ✓ | 任务与提醒 |
| 错过提醒处理 missed-reminder-policy | tasks | select | ReminderPrefs | ✓ | ✓ | missed reminder 决策 | ✓ | 任务与提醒 |
| 补发时间范围 missed-reminder-window | tasks | segmented (1/6/24) | ReminderPrefs | ✓ | ✓ | missed reminder 补发窗口 | ✓ | 任务与提醒 |

### 2.4 Kiro preferences（useKiroPreferencesStore，`classflow-kiro-preferences-v1`）

| setting | section | UI | SoT | 持久 | 影响 | 消费位置 | 保留 | V3 归属 |
|---|---|---|---|---|---|---|---|---|
| 输出字号 kiro-output-text-size | kiro | segmented | KiroPrefs | ✓ | ✓ | KiroMarkdown / chat 渲染 | ✓ | Kiro 与 AI |
| 回答偏好 kiro-response-preference | kiro | segmented | KiroPrefs | ✓ | ✓ | chat route trusted context | ✓ | Kiro 与 AI |
| 自动环境上下文 kiro-auto-context | kiro | toggle | KiroPrefs | ✓ | ✓ | context auto refs 构建 | ✓ | Kiro 与 AI |
| 启用 Kiro 记忆 kiro-memory-enabled | kiro | toggle | AISettings（memoryEnabled） | ✓ | ✓ | memory index / 工具启用 | ✓ | Kiro 与 AI |
| 记忆条目 kiro-memory-manager | kiro | action → manager | IndexedDB | ✓ | 展示+管理 | 记忆管理页 | ✓ | Kiro 与 AI |

注：`kiro-memory-enabled` 的 SoT 在 `useAISettingsStore`（`classflow-ai-settings-v1`），与其余 Kiro 偏好分属两个 store——V3 应统一到同一 store 或至少统一 modified/reset 语义。

### 2.5 AI settings（useAISettingsStore，`classflow-ai-settings-v1`；API Key 在 sessionStorage）

| setting | section | UI | SoT | 持久 | 影响 | 保留 | V3 归属 |
|---|---|---|---|---|---|---|---|
| 启用 Kiro ai-enabled | kiro | toggle | AISettings | ✓ | ✓ | chat 可用性 | ✓ | Kiro 与 AI |
| AI 服务 ai-provider | kiro | select | AISettings | ✓ | ✓ | resolver | ✓ | Kiro 与 AI |
| 模型 ai-model | kiro | select | AISettings | ✓ | ✓ | resolver | ✓ | Kiro 与 AI |
| 自定义服务名称/地址/模型 | kiro | inputs | AISettings.custom | ✓ | ✓ | resolver（custom） | ✓ | Kiro 与 AI |
| 自定义能力声明（vision/fileParts） | kiro | segmented | AISettings.custom | ✓ | ✓ | capabilities | ✓ | Kiro 与 AI |
| API Key ai-api-key | kiro | password input + test | sessionStorage | 会话级 | ✓ | resolver / test route | ✓ | Kiro 与 AI |
| 测试连接 | kiro | action | — | — | 诊断 | /api/ai/test | ✓ | Kiro 与 AI |

### 2.6 Data 页（动作/状态）

| 项目 | section | UI | SoT | 持久 | 影响 | 判定 | V3 建议 |
|---|---|---|---|---|---|---|---|
| 本地数据概览（计数 grid） | data | text/metrics | useAppStore 派生 | — | 仅展示 | dashboard information | 迁出设置中心（保留在数据页顶部为健康信息，或移动到 About/独立诊断区） |
| 数据状态检查 DataHealth | data | action + status | 派生计算 | — | 仅展示 | health information | 保留为诊断工具，不作为 setting |
| 导出 ZIP / JSON | data | action | BackupSection | — | 真实动作 | real action | ✓ 数据与存储 |
| 从备份恢复 | data | file + preview + commit | RestoreSection | — | 真实动作 | real action | ✓ 数据与存储 |
| 恢复默认设置 | data | danger action | DangerZone | — | 真实动作 | real action | ✓ 数据与存储（或通用） |
| 清空学习数据 | data | danger action | DangerZone | — | 真实动作 | real action | ✓ 数据与存储 |
| 清除所有本地数据 | data | danger action（两阶段确认） | DangerZone | — | 真实动作 | real action | ✓ 数据与存储 |
| 完整演示数据重载 | data | dev-only action | dev tooling | — | dev 行为 | dev tooling | 移出设置中心（或保留 dev gate 但标注明确） |

### 2.7 非 setting 内容

| 项目 | section | 类型 | V3 建议 |
|---|---|---|---|
| 学习工作区 checklist（学期已设置/N 门课程/配置摘要） | general | dashboard information | 删除或迁移到总览页；保留一个"还差 1 步"式的 onboarding 提示可放在空状态，不进设置中心 |
| 常用入口（4 个导航按钮） | general | navigation shortcut | 删除（左侧 SettingsNav 已承担导航） |
| 版本 / 数据模式 / 附件存储 | about | static info | 保留（About 天然是信息页） |

---

## 3. UI Primitive Audit

### 3.1 现状统计

- **已有收敛组件**：`SettingsSection`（标题+描述容器）、`SettingsRow`（label+desc+右侧控件+modified/reset+highlight）、`SettingsToggle` / `SettingsSelect` / `SettingsSegmentedControl`（`SettingsControls.tsx` 统一 h-9 / rounded-xl / focus border / disabled）、`SettingsNav`、`SettingsSaveBar`。
- **未收敛**：
  - 输入类：`KiroAISettings.inputCls`（局部）、`ProfileSettings` / `SemesterSettings` 各自 input 样式 → 缺 `SettingsInput`（text / time / number / password 变体）。
  - 动作按钮：导出/重新检查/危险操作全部就地 button；`DangerZone` 有完整"危险 row + 危险按钮"样式但未抽象 → 缺 `SettingsButton`（primary/secondary/ghost）+ `SettingsDangerRow`。
  - 卡片式 row：`GeneralSettings`（工作区卡片）、`DangerZone`（p-3 card row）、`BackupSection`（导出行）、`DataHealth`、`RestoreSection` 与 `SettingsRow`（py-3 + border-b 列表式）两套布局并存。
  - 分组标题：Data 页手写 `uppercase tracking-wider` 小标题（"本地数据/数据状态/备份/恢复/危险操作"）→ 缺 `SettingsGroup`（含 title）。
- **不一致点**：row 高度（py-3 vs p-3 vs h-7/h-8/h-9）、圆角（rounded-lg vs rounded-xl）、背景（bg-[#F7F5F5] vs bg-alabaster vs bg-surface，且 `#F7F5F5` 硬编码多处）、focus/hover/disabled 状态无统一 token 化；`#F7F5F5`/`#A48F82` 等硬编码色应收敛为现有语义 token。

### 3.2 目标 primitive（不过度抽象）

| primitive | 用途 | 对应现状 |
|---|---|---|
| `SettingsSection` | 页级容器（保留） | 已存在 |
| `SettingsGroup`（新） | 组标题 + 组内内容（替代手写 uppercase 标题） | Data 页手写标题 |
| `SettingRow`（保留/微调） | 即时生效偏好行（label/desc/控件/reset/highlight） | 已存在 |
| `SettingsToggle` / `SettingsSelect` / `SettingsSegmentedControl`（保留） | 控件 | 已存在 |
| `SettingsInput`（新） | text/time/number/password 输入（含 focus/disabled 统一） | inputCls 散落 |
| `SettingsButton`（新） | primary/secondary/ghost 动作按钮（统一 h-8、rounded-lg、disabled） | 就地 button 多套 |
| `SettingsDangerRow`（新） | 危险动作行（danger 语义 + 确认交互） | DangerZone 内实现 |
| `SettingsSaveBar`（保留） | 表单型保存 | 已存在 |
| `SettingsNav`（保留） | 导航（V3 按新 IA 调整条目） | 已存在 |

原则：只收敛"设置页内被重复使用"的形态；`SettingsRow`（列表式）与危险/动作 row（卡片式）可并存为两个明确 primitive，不强行统一成一种。

---

## 4. Proposed IA（Settings V3 信息架构）

| V3 section | 内容 | 来源 | 说明 |
|---|---|---|---|
| 通用 | 默认打开位置 | general.startup-view | 其余 dashboard 内容迁出 |
| 个人资料 | 基本资料、学业信息 | profile | 保持（表单+SaveBar） |
| 学期与课表 | 当前学期、编辑学期、显示周末 | semester | 保持 |
| 任务与提醒 | 临近截止提醒、默认截止时间、默认优先级、默认状态、浏览器系统通知、错过提醒处理、补发时间范围 | tasks（AppPreferences + ReminderPrefs） | 合并两 store 的 UI 表达 |
| 专注与学习 | （暂缓单独拆页） | — | 当前无真实用户偏好（Focus 只有 Kiro 工具侧）；不单独拆 |
| 交互与快捷键 | 课表/DDL 直接操作、单键快捷键、界面密度、动效偏好 | interaction | 保持 |
| Kiro 与 AI | 启用、服务/模型/自定义、API Key、测试连接、输出字号、回答偏好、自动环境上下文、记忆开关/条目 | kiro（AISettings + KiroPrefs + Memory） | 保持，但统一 modified/reset 语义 |
| 数据与存储 | 导出备份、恢复、危险操作 | data | 移除计数概览/健康检查到"信息"性质或保留为诊断区块（明确非 setting） |
| 关于 | 版本/数据模式/附件存储 | about | 保持 |

明确：**不新增「专注与学习」页**（无真实内容，YAGNI）；**不新增「通用」dashboard**（设置中心不承担数据展示）。

---

## 5. Functional Gaps

### A. 已有产品能力，只缺设置入口
- **无**（当前设置入口覆盖度与产品能力基本对齐；Kiro 记忆管理入口已存在）。

### B. 已有 setting，但 UI 表达不好
- 「已修改/恢复默认」只覆盖 AppPreferences，Reminder / Kiro / AI 偏好无"已修改"标记与单项恢复（V3 统一 reset 语义）。
- 搜索命中不覆盖 Kiro Memory 条目、About 等非 row 内容（可接受，但应明确搜索边界）。
- `browser-notifications` 与 `missed-reminder-*` 在 tasks 页，但数据源在独立 store——UI 无感知，V3 至少统一 row 的 modified 语义。

### C. 很容易增加且有明确产品价值
- 专注偏好：`focus` 默认时长（如 25/45/60）与默认关联课程——但 Task 0 结论为**暂缓**（需要 Focus 产品侧确认，避免为设置而设置）。
- Kiro「回答偏好」当前模式说明已存在；可考虑在 Composer 提供临时切换（属于 Chat UI，不在本任务范围）。
- 任务默认提醒意图（新建任务是否自动带提醒）——需 Domain 侧定义，暂缓。

### D. 暂时不应该做
- Theme Studio / 自定义 accent 色
- 复杂自动化（规则引擎）
- 云同步 / 多设备
- 自定义 Prompt / persona 文本框（Kiro 已明确禁止自由 prompt）
- Focus 独立设置页（无内容）
- 通用页 dashboard 化（反方向）

---

## 6. Migration Order

1. **Primitive 收敛（基础设施）**：新增 `SettingsInput` / `SettingsButton` / `SettingsDangerRow` / `SettingsGroup`；替换 `inputCls` 散落与 DangerZone/BackupSection 就地样式；统一硬编码色为语义 token。无行为变化。
2. **通用页瘦身**：移除「学习工作区」dashboard 与「常用入口」；保留 startup-view 为通用页唯一内容；onboarding 缺口提示（如"尚未添加课程"）移到对应功能空状态。同时把 Data 页概览/健康检查明确标注为"数据状态"（信息性质），与真实设置动作分区。
3. **已修改/恢复语义统一**：把 `modified`/`reset` 概念扩展到 Reminder / Kiro / AI 偏好（各自 store 提供 default 对照）；「已修改」视图按新 IA 分组。
4. **搜索与深链对齐**：registry 条目与新 IA 同步；深链跳转复用搜索跳转的 highlight 机制。
5. **数据与存储重组**：Backup/Restore/DangerZone 收敛到 `SettingsDangerRow`/`SettingsButton`；dev demo 重载移出或明确 dev-gate。
6. **IA 落地**：SettingsNav 按 V3 section 更新（确认是否新增「专注与学习」——默认不加）。

每步独立可提交、可回滚；1 是无行为变化的纯 UI 收敛，风险最低，优先做。

---

## 7. Risks

- **行为回归**：primitive 收敛会触碰 Backup/Restore/DangerZone 交互，E2E（`tests/e2e`）覆盖的 `data-testid` 若被改需同步更新；危险操作两阶段确认逻辑不可在样式收敛中丢失。
- **已修改语义扩展**：Reminder/Kiro/AI store 增加 default 对照需要每 store 提供稳定默认值；若某字段默认值后续变化，会误标"已修改"（建议 default 只读常量 + sanitize 对齐）。
- **搜索边界**：registry 与新 IA 不同步会导致跳转落空；建议 registry 条目与 `data-setting-id` 保持一一对应（现有机制），新增组标题类条目不进搜索。
- **暂缓项被提前做**：「专注与学习」页与任务自动提醒可能被当作"很容易加"而提前实现——本任务结论为暂缓，需产品确认。
- **表单/即时生效双模式**：Profile/Semester 的 SaveBar 与其余即时生效并存是既有设计；V3 不要统一成一种（破坏现有 UX 与 dirty-state 测试）。
- **设置页性能**：常驻挂载所有 section（SettingsView 现状）在设置项增加后可能变重；V3 若新增设置项较多，需评估懒渲染（本审计未发现当前瓶颈，风险低）。
