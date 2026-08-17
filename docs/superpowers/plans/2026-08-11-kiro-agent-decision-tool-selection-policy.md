# Kiro Agent Decision + Tool Selection Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit minimum-fact, reuse, stop, and intent-to-tool guidance to Kiro Prompt V2 so common academic-management requests use fewer redundant reads without weakening factual correctness or safety.

**Architecture:** Extend the existing static `KIRO_SYSTEM_PROMPT` with two new top-level sections: `# Agent Decision Policy` and `# Tool Selection Policy`, placed after `# Truth & Safety Invariants` and before `# Domain Semantics`. Keep all runtime tool registries, schemas, executors, limits, response preferences, route plumbing, and domain semantics unchanged; this task changes model guidance only and locks it with focused prompt-contract tests.

**Tech Stack:** TypeScript, Next.js 14, AI SDK, Vitest.

## Global Constraints

- Task 2 is already implemented on main (`ad46ed106fe4aad31e4881d6897d63ef2f9eaeda`).
- Response preference remains presentation-only; `dense | balanced | deep` must not change necessary Tool selection or fact gathering.
- Do not add aggregate Tools, change Tool registry/schema/executor behavior, or change Read/Write runtime limits.
- Preserve all existing Task / Deadline / StudyBlock / Health / Breakdown / Materials / Reminder / Focus / Change Set / Memory / Attachment / Citation semantics.
- No hard numeric Tool-call cap is introduced in the prompt; accuracy and required facts remain authoritative.
- Prefer focused Vitest plus `npm run typecheck`; do not run build / Playwright / full Vitest by default.

---

### Task 1: Add minimum-fact decision policy and intent-to-tool routing

**Files:**
- Modify: `lib/ai/prompts/kiroSystemPrompt.ts`
- Modify: `tests/kiroPromptV2.test.ts`

**Interfaces:**
- Consumes: Task 2 `KIRO_SYSTEM_PROMPT` five-layer core and the existing Read Tool surface (`search_assignments`, `get_assignment`, `get_assignment_health`, `get_available_time`, `propose_study_plan`, `get_upcoming_assignments`, `get_week_schedule`, `read_material`, `list_reminders`, `get_focus_status`, etc.).
- Produces: two new static Prompt V2 policy sections that guide model behavior without modifying runtime tools.

- [ ] **Step 1: Rewrite the old Task-2 negative test into positive Task-3 section tests**

In `tests/kiroPromptV2.test.ts`, replace the old assertion that these sections are absent with assertions that both are present:

```ts
it("includes Task 3 agent decision and tool selection policy", () => {
  expect(KIRO_SYSTEM_PROMPT).toContain("# Agent Decision Policy");
  expect(KIRO_SYSTEM_PROMPT).toContain("# Tool Selection Policy");
});
```

Add policy-marker tests:

```ts
it("defines minimum-fact reuse and stopping behavior", () => {
  expect(KIRO_SYSTEM_PROMPT).toContain("最小必要事实集");
  expect(KIRO_SYSTEM_PROMPT).toContain("复用本 Turn 已返回的有效 Tool Result");
  expect(KIRO_SYSTEM_PROMPT).toContain("不要为了“再确认一下”重复读取");
  expect(KIRO_SYSTEM_PROMPT).toContain("所需事实已经足够时，停止调用工具");
  expect(KIRO_SYSTEM_PROMPT).toContain("不要把 get_current_context 当作固定开场");
  expect(KIRO_SYSTEM_PROMPT).toContain("不依赖当前 ClassFlow 状态时，可以直接回答");
});
```

Add direct-tool authority/routing markers:

```ts
it("routes deterministic intents to authoritative tools without redundant reconstruction", () => {
  expect(KIRO_SYSTEM_PROMPT).toContain("get_assignment_health 已经返回截止前可用分钟数");
  expect(KIRO_SYSTEM_PROMPT).toContain("除非用户需要具体空闲时段，否则不要再调用 get_available_time");
  expect(KIRO_SYSTEM_PROMPT).toContain("get_available_time");
  expect(KIRO_SYSTEM_PROMPT).toContain("不要通过 get_week_schedule 手工重建空闲时间");
  expect(KIRO_SYSTEM_PROMPT).toContain("propose_study_plan");
  expect(KIRO_SYSTEM_PROMPT).toContain("不要先用 get_week_schedule + get_available_time 手工拼排程");
  expect(KIRO_SYSTEM_PROMPT).toContain("get_upcoming_assignments");
});
```

Add response-preference invariance marker:

```ts
it("keeps tool selection independent of response preference", () => {
  expect(KIRO_SYSTEM_PROMPT).toContain("responsePreference 不参与 Tool Selection");
});
```

Keep all existing Task 2 domain/safety invariant tests.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/kiroPromptV2.test.ts tests/kiroResponsePreference.test.ts
```

Expected: the new Task 3 policy assertions fail because the sections do not yet exist. Fix only test syntax/import errors before implementation.

- [ ] **Step 3: Insert `# Agent Decision Policy` after Truth & Safety**

In `lib/ai/prompts/kiroSystemPrompt.ts`, place the new section after `# Truth & Safety Invariants` and before `# Domain Semantics`.

Use these semantics:

```text
# Agent Decision Policy

- 先判断当前请求是否依赖当前 ClassFlow 状态或要求修改 ClassFlow。若不依赖当前 ClassFlow 状态，也没有写操作需求，可以直接回答，不要为了“像 Agent”而调用工具。
- 需要 ClassFlow 数据时，只获取回答或执行当前请求所需的最小必要事实集；不要为了“更完整”扩展到无关课程、任务、资料或日期范围。
- 复用本 Turn 已返回的有效 Tool Result。除非后续写入/Tool Result 已使旧结果可能过期，或已有结果缺少完成当前请求所需字段，否则不要为了“再确认一下”重复读取同一事实。
- 搜索结果只有一个明确匹配时直接继续；有多个合理候选时询问用户；没有匹配时明确说明，不猜 ID。
- 所需事实已经足够时，停止调用工具并回答/执行；不要继续做与当前意图无关的探索性读取。
- Tool 失败时，只补充解决该失败所必需的事实；如果继续读取也无法解决，应直接说明失败原因或需要用户补充什么。
- 成功 Write Tool 已明确返回操作成功时，不要仅为了“验证成功”再读一次；只有用户还要求新的当前状态、或写结果不足以回答依赖后的状态时才读取。
- 当可以直接 Tool Call 时，不要先输出“我先查一下 / 我再确认一下 / 我来看看”等过程旁白；直接调用工具。
- 不要把 get_current_context 当作固定开场。只有请求确实依赖当前页面/选中对象/当前上下文，而 System 提供的 baseContext/contextRefs 不足以确定所需身份时，才调用它。
- responsePreference 不参与 Tool Selection：dense / balanced / deep 的必要事实集、工具选择、安全规则和写入授权完全一致。
```

Do not add a hard 1/2/3-call budget. The runtime 12-read / 8-write limits remain unchanged and are not restated as optimization targets.

- [ ] **Step 4: Add `# Tool Selection Policy` with intent-driven routing**

Place immediately after `# Agent Decision Policy` and before `# Domain Semantics`.

Use the following rules.

**General selection rule**

```text
# Tool Selection Policy

选择能直接回答当前意图的最高层、确定性工具；不要固定按 get_current_context → 全量课表 → 全量任务 的仪式化链路读取。
```

**Task listing / today / upcoming**

```text
- “今天要做什么 / 今天还有哪些任务 / 今晚要做什么” → 先用 search_assignments(scope=today)。如果用户只要列表，不要自动为每个任务继续查询 Health、完整详情或空闲时间。
- “未来 N 天有哪些截止任务 / 最近 DDL” → 优先 get_upcoming_assignments；只有用户还要求复杂关键词、课程、状态或 action scope 过滤时才用 search_assignments。
- search_assignments 的结果已经包含回答所需字段时，不要机械追加 get_assignment；只有需要完整描述、linkedMaterials、subtasks、estimatedMinutes、已有 StudyBlock 等完整字段时才 get_assignment。
```

**Priority / deadline health**

```text
- “哪个最优先 / 今天最该做什么” → 先做范围明确的 assignment 查询，只对真正竞争优先级且需要 Deadline 风险判断的少数候选调用 get_assignment_health；不要无差别给所有任务逐个查 Health。
- “这个作业来得及吗” → 解析真实 assignmentId 后直接 get_assignment_health。get_assignment_health 已经返回截止前已安排分钟数、缺口分钟数和截止前可用分钟数；除非用户需要具体空闲时段，否则不要再调用 get_available_time 来重复确认“来不来得及”。
```

**Available time / calendar**

```text
- “今晚/这周还有多少空闲时间 / 哪些时段可学习” → 直接 get_available_time；不要通过 get_week_schedule 或 get_calendar_range 手工重建空闲时间。
- “这周上什么课 / 某课程本周什么时候上” → get_week_schedule。只有需要课程基本信息、教师、资料 metadata 等课程详情时再 get_course。
- “某日期范围有哪些课程/DDL/考试/活动标记” → get_calendar_range；不要用它代替 get_available_time。
```

**Planning**

```text
- 用户要求“安排/规划这些任务的学习时间” → 先解析需要安排的真实 assignmentIds，然后调用 propose_study_plan。不要先用 get_week_schedule + get_available_time 手工拼排程；propose_study_plan 本身是确定性排程事实来源。
- 如果用户只问“我有哪些空档”，不要调用 propose_study_plan；它是排程 Proposal，不是空闲时间查询。
```

**Breakdown / materials**

```text
- 任务拆解继续遵守 Domain 规则：get_assignment →（只有明确需要资料正文时）read_material → propose_task_breakdown。
- 用户只问“课程有哪些资料”时优先使用 get_course / get_material_metadata 获取 metadata；只有请求需要正文内容时才 read_material。
```

**Reminder / Focus / writes**

```text
- 创建明确 Reminder 时，不要为了确认 Reminder 列表而先 list_reminders；修改/删除且当前消息没有唯一 reminderId 时才 list_reminders 定位。
- 明确“暂停/继续/结束专注”按现有 Domain 规则直接调用对应 Focus Write Tool，不要先 get_focus_status 作为仪式化确认；只有用户询问当前专注状态/剩余时间，或失败原因确实需要状态时才 get_focus_status。
- 相互关联的多项写操作继续使用 apply_change_set；成功后不要无意义全量重读，除非用户要求新的派生状态或后续结果需要确定性读取。
```

- [ ] **Step 5: Guard against policy conflicts with existing Domain Semantics**

Read the resulting prompt once and verify:

```text
- Tool Selection Policy does not say Health can be model-computed.
- It does not bypass get_available_time / propose_study_plan / propose_task_breakdown.
- It does not relax ambiguity, write success, Reminder explicit-intent, Focus duration, Change Set, Memory, or attachment rules.
- It does not make contextRefs complete entity data.
- It does not alter responsePreference contracts.
- It does not create a numeric low Tool-call cap that could suppress necessary facts.
```

If a new routing bullet conflicts with a Domain rule, the Domain/safety invariant wins; rewrite the routing bullet rather than weakening the invariant.

- [ ] **Step 6: Run focused GREEN verification**

Run:

```bash
npx vitest run tests/kiroPromptV2.test.ts tests/kiroResponsePreference.test.ts
npm run typecheck
```

Expected: all focused tests PASS and typecheck PASS.

Do not run full Vitest, build, or Playwright unless these focused checks expose a real cross-module failure requiring the closest additional test.

- [ ] **Step 7: Scope self-review**

Final diff should normally contain only:

```text
lib/ai/prompts/kiroSystemPrompt.ts
tests/kiroPromptV2.test.ts
```

No changes should appear under `lib/ai/tools/**`, `hooks/useKiroChat.ts`, `app/api/ai/chat/route.ts`, stores, settings UI, streaming, Worklog, or history.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/prompts/kiroSystemPrompt.ts tests/kiroPromptV2.test.ts
git commit -m "feat(kiro): add agent tool selection policy"
```

## Success Criteria

1. Kiro no longer treats Tool use as a ritual: no current-state dependency means no Tool needed.
2. Same-Turn valid results are reused; duplicate “double-check” reads are explicitly discouraged.
3. Kiro stops reading when the current request has enough facts.
4. Direct deterministic tools are preferred over manual reconstruction.
5. `get_assignment_health` is not redundantly followed by `get_available_time` unless actual slots are requested.
6. `get_available_time` is not reconstructed from schedules; `propose_study_plan` is not manually reconstructed from schedule + free-time tools.
7. Simple list requests do not fan out into per-item detail/health reads.
8. Reminder/Focus direct writes do not gain unnecessary pre-read rituals.
9. `responsePreference` remains completely independent of Tool selection.
10. No Tool API/runtime behavior changes in this task.
