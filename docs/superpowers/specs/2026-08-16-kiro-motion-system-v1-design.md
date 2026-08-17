# Kiro Motion System V1 — Advanced Product Motion（Design Spec）

日期：2026-08-16
基础提交：92d4a0f（等待并行 Kiro V1.5 提交后开始实现）

## 最高优先级契约

- Motion follows state. Motion never creates state. Motion never delays state. Motion never remounts streaming content.
- 禁止：live User/Assistant Message entrance、token fade、word-by-word、Markdown paragraph entrance、streaming opacity、Pending→Assistant shell remount、第二套 streaming scroll scheduler、motion 前等待业务状态、新动画 dependency。

## 四层 Motion Grammar（Kiro scoped CSS variables）

- Control（L1）：状态微反馈 —— 120ms（workspace）/ 100ms（sidecar）
- Structure（L2）：完整结构 settle —— 150ms / 130ms
- Spatial（L3）：面板/浮层/形态变化 —— 220ms / 180ms
- Intro（L4）：新空白会话一次性 choreography —— 320ms / 250ms
- Popover enter/exit、offset（3px / 2px）

实现于 app/globals.css：`--kiro-motion-*` 变量 + `.kiro-motion-workspace` / `.kiro-motion-sidecar` scope（KiroChatSurface root class）。Kiro-only utility classes：`.kiro-control-motion` `.kiro-structure-settle` `.kiro-popover-motion` `.kiro-check-settle` `.kiro-empty-*-intro` `.kiro-empty-exit` `.kiro-composer-intro` `.kiro-scroll-control-enter`。

## 组件方案

1. **Empty Intro Generation**：Provider 持 `emptyIntroGeneration`（`transition.type === "new"` 完成后 +1，含 project new chat；load history 不 +1）+ `claimEmptyIntro(surface, generation)`（workspace/sidecar 各自 per-generation 一次）。不持久化。
2. **KiroEmptyExperience**（新组件）：open=!hasMessages；claim intro；usePresence Contextual Handoff exit（suggestions 0–110ms、title 20–130ms、logo 40–150ms opacity/translateY(-4px)/scale .96）；semantic close 立即 aria-hidden + inert + pointer-events-none；不含 streaming 逻辑。
3. **KiroChatSurface 重构**：relative main content stage；Empty 为 absolute inset-0 presence overlay（exit 不占 flex 布局），Conversation 第一条消息立即 mount；Composer 常驻 stage 之外；不给 Conversation 加 key / animate-enter。
4. **Composer**：focus-within `translateY(-1px)`（禁 -2/-3/-4、不 scale；send 后不双跳）；可选 `introActive`（workspace ~220ms / sidecar ~130ms，opacity + translateY 6/4px，不禁 pointer）；Attachment shelf 用 DisclosureRegion 结构生长（opacity + translateY 2–3px，无 scale/JS 测量/setTimeout）。
5. **KiroSendControl**（新组件）：36×36 单一 button DOM（inFlight→stop Square / preparing→Loader / canSend→Arrow / else disabled Arrow），icon 层 absolute center 60–80ms exit / 90–110ms enter crossfade；aria-label 同步；canSend false→true 激活 120ms（opacity .4→1 + scale .96→1，只响应 boolean）；Enter 不人工 press。
6. **Popover primitive**：新增 `placement="top-start"`（left-0 bottom-full mb-1.5，enter +3px）；可选 `motionProfile="default" | "kiro"`（kiro：ancestor CSS 变量 + scale .985→1 + 正确 transform-origin）；默认全站行为不变；exit 不提前 unmount。
7. **DropdownMenu**：`DropdownMenuPanel` 接受 motionProfile；仅 Kiro consumer 显式 `motionProfile="kiro"`。
8. **KiroMenuPanel**：统一 motionProfile="kiro"（Message More / Thread Rail More / 其它）。
9. **Composer inline selectors**（Attachment/Material/Model）：改用 PopoverPanel motionProfile="kiro"（Attachment/Material top-start；Model top-end）；open owner 仍 Composer；mutual exclusion 保持。
10. **Model trigger / AgentMode / Reasoning / WorkspacePicker / ContextPicker**：open active plate、Chevron rotate-180（control motion）、selected check settle；ContextPicker desktop 统一 kiro structure/popover timing（2–3px、scale .985→1），mobile bottom sheet 保持（L3 220/180ms）。
11. **Chips**：新增 opacity .9→1 + translateY 2px（120–150ms）；删除快速 exit 不延迟 remove。
12. **Thread Rail anchored morph**：ONE persistent shell（52 ↔ 216/232px，left/top anchor 不变）；expand 55–70ms header、75–90ms controls、90–110ms history（~220ms，无逐 row stagger）；collapse 先 inert 再 fade（0–80ms）+ width 30ms 后收；用 CSS transition-delay / data-state / usePresence，无 setTimeout choreography；数据行为（lazy list、refresh、快捷键、guard）全部不变。
13. **Project Panel**：同 grammar（anchored right，width spatial，expanded content delayed fade，collapse 立即释放 pointer；无逐 row stagger）。
14. **Structure settle**：KiroActionCard / StudyPlan / Rebalance / Breakdown / Visual Proposal / AgentTaskCard 仅 live 首次 committed render `kiro-structure-settle`（opacity .88→1 + translateY 3px，无 scale）；history static；useEnterOnAdd 继续作为事实源；Worklog live 行无 entrance。
15. **Message actions**：常驻保留；actions block first available 轻 opacity settle；More → source-aware KiroMenuPanel。
16. **Scroll-to-bottom**：showScrollBtn 用 usePresence（enter 140ms / exit 100ms；hidden 立即 pointer-events-none）；滚动阈值与 auto-scroll 不变。
17. **Sidecar compressed**：CSS variables 自动压缩（不逐组件 if compact）；Empty suggestions 不 stagger（compact branching 仅结构差异时）。
18. **Sidecar geometry**：`geometryInteracting` state → `data-geometry-interacting`（beginMove/beginResize true；commit/cancel false）；期间 kiro intro/settle/popover transforms 近瞬时，hover/streaming/scroll 正常；shell entrance 保留并对齐 spatial token。
19. **Reduced Motion**：data-motion-effective contract + 必要 `html[data-motion-effective="reduced"]` 补丁；最终无 translate/scale/stagger，功能完整。

## 拒绝项

- 不重做聊天 UI 布局 / 不重写 Streaming Runtime / 不加新 Agent 功能 / 不改权限模型 / 不改其它 Workspace Motion。
