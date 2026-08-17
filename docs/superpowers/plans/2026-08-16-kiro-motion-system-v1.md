# Kiro Motion System V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

Goal:
建立统一 Workspace / Sidecar Kiro Motion Grammar，同时严格保持 Streaming Runtime 稳定。

Architecture:
CSS variables + existing usePresence + existing Popover/Disclosure primitives。不引入 animation library。Motion 只消费已有 UI/domain state，不创建新的业务状态。

Tech:
React / TypeScript / Tailwind / CSS / Vitest / Playwright

协调约束：本计划对应的核心文件（KiroSessionProvider / KiroComposer / KiroConversation / KiroMessage / KiroAttachmentChip）被并行 Kiro V1.5 占用——**等待并行提交落地后才修改这些文件**；先用只读审计 + 文档 + 不重叠模块（globals.css / Popover / DropdownMenu / KiroEmptyExperience / Thread Rail / Project Panel / Sidecar）。

## Commit 1 — feat(kiro): establish motion grammar and empty-state handoff

- [ ] app/globals.css：Kiro scoped `--kiro-motion-*` 变量（workspace/sidecar 两组）+ `.kiro-motion-workspace` / `.kiro-motion-sidecar` scope + Kiro utility classes（control/structure/popover/check/empty-intro/empty-exit/composer-intro/scroll-control-enter）
- [ ] KiroChatSurface：root 加 `kiro-motion-workspace` / `kiro-motion-sidecar`
- [ ] KiroSessionProvider：`emptyIntroGeneration` state + `claimEmptyIntro(surface, generation)`（ref per-surface）；`transition.type === "new"` 完成后 +1（含 project new chat）；load history 不 +1；不持久化
- [ ] 新 `components/kiro/motion/KiroEmptyExperience.tsx`：open/compact/playIntro/onSuggestion/contextSuggestions；usePresence exit；semantic close 立即 inert/aria-hidden/pointer-events-none
- [ ] KiroEmptyState：加 `data-kiro-empty-{logo,title,subtitle,suggestions,suggestion}` markers + `--kiro-stagger-index`；文案/数据语义不变
- [ ] KiroChatSurface：Empty/Conversation → relative stage + Empty absolute presence overlay；Conversation 无 key / 无 animate-enter；Composer 常驻
- [ ] 测试：motion scope class（workspace/sidecar）；empty intro claim（initial once / 同 generation 不重播 / new chat 新 generation / load history 不变 / workspace+sidecar 各自 once / project new chat 新 generation）
- [ ] Gate：`npx vitest run <exact kiro motion tests>` green；typecheck

## Commit 2 — feat(kiro): morph composer controls and selectors

- [ ] KiroComposer：focus-within translateY(-1px)（禁 -2/-3/-4、不 scale、send 后无双跳）
- [ ] KiroComposer：可选 `introActive` prop；workspace ~220ms / sidecar ~130ms；opacity + translateY（6/4px）；不禁 pointer
- [ ] Attachment shelf：DisclosureRegion 结构生长（opacity + translateY 2–3px；无 scale/JS 测量/setTimeout；删除最后一个附件 structure exit）
- [ ] 新 `components/kiro/KiroSendControl.tsx`：单一 button DOM（stop/preparing/ready/idle-disabled），icon absolute center crossfade（exit 60–80ms / enter 90–110ms），aria-label 同步，激活 120ms（opacity .4→1 + scale .96→1，仅 boolean 变化），Enter 不人工 press
- [ ] KiroComposer 接入 KiroSendControl（替换三分支）
- [ ] Popover primitive：`placement="top-start"` + `motionProfile="default" | "kiro"`（kiro：ancestor CSS 变量 + scale .985→1 + transform-origin；默认行为不变；exit 不提前 unmount）
- [ ] DropdownMenuPanel：接受 motionProfile（默认不变）
- [ ] KiroMenuPanel：统一 motionProfile="kiro"
- [ ] Composer inline selectors（Attachment/Material/Model）：改用 PopoverPanel kiro（top-start / top-start / top-end）；open owner 仍 Composer；mutual exclusion 不变
- [ ] Model trigger：open active plate + Chevron rotate-180（control motion）+ selected check settle
- [ ] KiroAgentModeMenu / KiroReasoningMenu：open active plate + kiro panel（top-end）+ check settle；Domain 不变
- [ ] KiroWorkspacePicker：保持 placement；open active plate；source-aware 向量一致；semantics 不变
- [ ] KiroContextPicker：desktop 统一 kiro timing（2–3px + scale .985→1）；mobile bottom sheet 保持（L3 220/180ms）；业务不变
- [ ] KiroContextBar / KiroAttachmentChip：chip 新增 120–150ms（opacity .9→1 + translateY 2px）；删除快速 exit 不延迟 remove
- [ ] 测试：KiroSendControl（4 态 + DOM identity + aria）；popover top-start/kiro profile（semantic class/data 断言）；model selector 生命周期；Agent/Reasoning active trigger smoke
- [ ] Gate：focused vitest + composer/sidecar 相关 focused E2E green；typecheck

## Commit 3 — feat(kiro): unify workspace rail morphs

- [ ] KiroThreadRail：ONE persistent shell（52 ↔ 216/232px；left/top anchor 不变）；expand/collapse CSS transition-delay + data-state + usePresence choreography（无 setTimeout）；collapsed 不读 DB / lazy 首次 expanded / 全部数据行为不变；chat geometry 不动
- [ ] KiroProjectPanel：同 grammar（anchored right；width spatial；expanded fade；collapse 立即释放 pointer；无逐 row stagger）；业务不变
- [ ] 测试（先写 E2E regression）：rail collapsed 52 → expand 同一 shell testid / final width 216-232 / chat main X 与 Composer center X 前后差 ≤2px / collapse 回 52 / Esc 与 outside 仍工作；project panel right edge 前后差 ≤2px / chat 不移动
- [ ] Gate：`npx playwright test <rail/project focused spec>` green；typecheck

## Commit 4 — feat(kiro): polish structured conversation motion

- [ ] KiroActionCard / StudyPlan / Rebalance / Breakdown / Visual Proposal / KiroAgentTaskCard：live 首次 committed render `kiro-structure-settle`（opacity .88→1 + translateY 3px）；history static；useEnterOnAdd 继续为事实源（旧 animate-enter 映射/替换）
- [ ] KiroWorklog：Disclosure/Chevron timing 统一（现有 DisclosureRegion + kiro class override）；live 行无 entrance
- [ ] DisclosureRegion：可选 motionClassName（默认 180ms 不变）
- [ ] KiroMessage：actions block first available 轻 opacity settle；buttons control motion；More → kiro menu；streaming 隐藏语义不变
- [ ] KiroConversation scroll-to-bottom：usePresence（enter 140ms / exit 100ms；hidden 立即 pointer-events-none）；阈值与 auto-scroll 不变
- [ ] KiroSidecarShell：`geometryInteracting` + `data-geometry-interacting`（move/resize 期间 kiro intro/settle/popover transforms 近瞬时；hover/streaming/scroll 正常）；shell entrance 对齐 spatial token
- [ ] Reduced Motion：data-motion-effective contract + 必要补丁（empty/popover/rail/composer/send/structure/scroll 全降级，功能完整）
- [ ] 测试：structure settle（live vs history）、scroll presence、sidecar data-geometry-interacting 生命周期、reduced motion 最终态
- [ ] Gate：focused vitest + streaming/sidecar/rail/composer regression + `npx playwright test tests/e2e/kiro-motion-v1.spec.ts` green；typecheck

## 最终验证

- `npx vitest run <exact kiro motion affected tests>`
- `npx playwright test tests/e2e/kiro-motion-v1.spec.ts`
- 现有 Streaming UX / Sidecar geometry / Thread Rail / Composer preferences focused specs
- `npm run typecheck`
- dev server 保持；viewport smoke（1920/1440/1024/390）
- 搜索确认：无 animate-enter 回归（KiroConversation/KiroMessage/KiroStreamingMarkdown）、无新增 setTimeout（motion）、无 transition-all（Kiro 新增区）、无 framer-motion/motion/react

## Git

- 4 个 phase commit（见上）；只显式 add 本任务文件；最终 push origin/main
