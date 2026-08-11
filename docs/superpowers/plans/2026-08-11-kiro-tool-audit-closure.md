# Kiro Tool Audit Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Kiro Intelligence V2 Task 5 by updating the typed Tool Capability Audit and its human-readable report to reflect that all three evidence-backed existing-tool findings are now resolved, while preserving the evidence threshold that blocks premature aggregate tools.

**Architecture:** Treat `KIRO_TOOL_CAPABILITY_AUDIT.toolFindings` as the set of currently open actionable findings. Move the three resolved Task 4B findings into a typed `resolvedFindings` history, set `task5Decision` to `skip`, and update only the two affected scenario audits (`tonight-free-time`, `cancel-reminder`). Do not touch Tool runtime, Prompt, settings, or Agent execution code.

**Tech Stack:** TypeScript, Vitest, existing `KIRO_TOOLS` registry-derived tool names, existing Kiro Eval scenario matrix.

## Global Constraints

- This task is audit closure only; do not modify any Tool registry/schema/executor.
- Do not add an aggregate Tool.
- Keep `weekly-pressure` as a composed/medium scenario because the aggregate-tool evidence threshold is still not met.
- `task5Decision: "skip"` means no further evidence-backed Task 5 Tool change is currently required; it does not mean every scenario has zero architectural tradeoffs.
- Preserve the threshold: aggregate Tool requires >= 3 common scenarios + same 4+ Tool pattern + Task 3 cannot reliably remove it.
- Run focused Vitest + `npm run typecheck`; do not run build/Playwright/full Vitest by default.

---

### Task 1: Close the Capability Audit

**Files:**
- Modify: `lib/ai/eval/kiroToolAudit.ts`
- Modify: `tests/kiroToolAudit.test.ts`
- Modify: `docs/kiro/kiro-tool-capability-audit.md`

**Interfaces:**
- Consumes: `KIRO_TOOL_CAPABILITY_AUDIT`, `KIRO_EVAL_SCENARIOS`, `KiroAuditedToolName`, and the already-implemented Task 5A/5B behavior.
- Produces: current-state audit with `task5Decision: "skip"`, no open `toolFindings`, and typed `resolvedFindings` containing the three historical finding IDs.

- [ ] **Step 1: Update the audit tests first**

Replace the old tests that expect the three IDs inside `toolFindings` with current-state closure assertions:

```ts
it("has no open evidence-backed tool findings after Task 5", () => {
  expect(KIRO_TOOL_CAPABILITY_AUDIT.task5Decision).toBe("skip");
  expect(KIRO_TOOL_CAPABILITY_AUDIT.toolFindings).toEqual([]);
});

it("preserves the three resolved Task 5 findings as audit history", () => {
  const ids = KIRO_TOOL_CAPABILITY_AUDIT.resolvedFindings.map((x) => x.id).sort();
  expect(ids).toEqual([
    "available-time-total-minutes",
    "delete-reminder-listing-description",
    "delete-reminder-scheduled-guard",
  ].sort());
});

it("marks the directly repaired scenarios as closed", () => {
  const byId = new Map(
    KIRO_TOOL_CAPABILITY_AUDIT.scenarios.map((x) => [x.scenarioId, x])
  );
  expect(byId.get("tonight-free-time")?.gap).toBe("none");
  expect(byId.get("cancel-reminder")?.gap).toBe("none");
});

it("still does not recommend an aggregate tool", () => {
  expect(KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool.recommended).toBe(false);
  expect(KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool.supportingScenarioIds).toEqual([
    "weekly-pressure",
  ]);
});
```

Keep the existing checks that:
- every Eval scenario is audited exactly once;
- all referenced tool names exist in `KIRO_TOOLS`;
- aggregate recommendation must satisfy the evidence threshold when enabled.

- [ ] **Step 2: Run the audit test and verify RED**

Run:

```bash
npx vitest run tests/kiroToolAudit.test.ts
```

Expected: FAIL because current audit still has `task5Decision: "refine-existing-tools"`, three open findings, and no `resolvedFindings` field.

- [ ] **Step 3: Add a typed resolved-finding shape**

In `lib/ai/eval/kiroToolAudit.ts`, add:

```ts
export interface KiroResolvedToolCapabilityFinding {
  id: string;
  tool: KiroAuditedToolName;
  resolution: string;
  evidence: string[];
}
```

Do not rename existing `toolFindings`; it now means currently open/actionable findings.

- [ ] **Step 4: Change the current Task 5 decision to skip**

Change:

```ts
task5Decision: "refine-existing-tools" as const,
```

to:

```ts
task5Decision: "skip" as const,
```

Interpretation: the current audited code needs no additional evidence-backed Task 5 Tool changes.

- [ ] **Step 5: Close `tonight-free-time`**

Update that scenario to:

```ts
{
  scenarioId: "tonight-free-time",
  coverage: "direct" as const,
  gap: "none" as const,
  evidence: [
    "get_available_time 通过确定性 free-time domain 排除课程/Calendar Marks/StudyBlocks",
    "Tool 现在直接返回基于完整未截断 slots 求和的 totalMinutes，同时 slots 详情仍最多 20 条",
  ],
  conclusion: "直接覆盖：Kiro 可使用确定性 totalMinutes 回答总空闲时间，不再需要自行求和。",
},
```

Do not change the scenario matrix itself.

- [ ] **Step 6: Close `cancel-reminder`**

Update that scenario to keep `coverage: "composed"` but set `gap: "none"`:

```ts
{
  scenarioId: "cancel-reminder",
  coverage: "composed" as const,
  gap: "none" as const,
  evidence: [
    "没有唯一 reminderId 时仍使用 list_reminders 定位；已有真实唯一 ID 时 delete_reminder 可直接调用",
    "delete_reminder runtime 现在只允许 scheduled，fired/skipped 返回 INVALID_INPUT 且不 mutation/不注册 Undo",
    "scheduled Reminder 删除后仍保留 exact-snapshot Undo",
  ],
  conclusion: "定位 + 删除路径与 Task 3 Policy、Tool description、runtime guard 已一致。",
},
```

- [ ] **Step 7: Move the three old findings out of the open list**

Set:

```ts
toolFindings: [],
```

Then add:

```ts
resolvedFindings: [
  {
    id: "available-time-total-minutes",
    tool: "get_available_time",
    resolution: "现有 Tool 输出已增加 totalMinutes；基于完整未截断 slots 求和，slots 详情仍最多 20 条。",
    evidence: [
      "getAvailableTime 在 slice(0, 20) 前 reduce 完整 slots 得到 totalMinutes",
      "kiroPlanning focused test 覆盖短窗口相等与 >20 slots 时 totalMinutes 大于返回详情分钟和",
    ],
  },
  {
    id: "delete-reminder-listing-description",
    tool: "delete_reminder",
    resolution: "description 已改为条件式：只有没有唯一 reminderId 时才要求 list_reminders。",
    evidence: [
      "已有真实唯一 reminderId 时 description 明确允许直接删除",
      "多个候选仍要求询问用户，不得猜 ID",
    ],
  },
  {
    id: "delete-reminder-scheduled-guard",
    tool: "delete_reminder",
    resolution: "executor 已增加 scheduled-only runtime guard。",
    evidence: [
      "fired/skipped 删除返回 INVALID_INPUT",
      "失败路径不 mutation、不注册 Undo；scheduled 删除与 Undo 保持原行为",
    ],
  },
] satisfies readonly KiroResolvedToolCapabilityFinding[],
```

If `satisfies readonly ...[]` conflicts with the file's current `as const` style, use the simplest type-safe equivalent without casts that hide errors.

- [ ] **Step 8: Keep `weekly-pressure` intentionally open as a non-actionable composed gap**

Do not change its `gap: "medium"` solely to make the audit look green. Its current evidence still says the scenario may require a composed combination, but one scenario is insufficient to justify an aggregate Tool.

The aggregate section must remain:

```ts
aggregateTool: {
  recommended: false,
  proposedName: null,
  supportingScenarioIds: ["weekly-pressure"],
  repeatedToolPattern: [],
  // existing threshold rationale
}
```

- [ ] **Step 9: Update the Markdown audit report to current state**

In `docs/kiro/kiro-tool-capability-audit.md`:

1. Change `## Decision` from `refine-existing-tools` to **`skip`**.
2. State that the three Task 4B evidence-backed findings are resolved.
3. Replace `## Findings` with `## Resolved Findings` and summarize:
   - `get_available_time.totalMinutes` resolved;
   - `delete_reminder` conditional-list description resolved;
   - `delete_reminder` scheduled-only runtime guard resolved.
4. Keep `## Aggregate Tool Decision` as **not recommended**.
5. Keep the evidence threshold unchanged.
6. Keep Eval coverage limits unchanged.
7. Replace the old `## Task 5 Scope` section with:

```md
## Current Next Step

没有新的 evidence-backed Tool hardening 任务。下一阶段若继续提升 Kiro，应扩展 Eval 覆盖（尤其 Group Project / Course / Schedule）或运行真实 Agent Eval；不要在缺少重复场景证据时新增 aggregate Tool。
```

Do not paste implementation diffs or long code snippets into the report.

- [ ] **Step 10: Run focused GREEN verification**

Run:

```bash
npx vitest run \
  tests/kiroToolAudit.test.ts \
  tests/kiroEvalScenarios.test.ts \
  tests/kiroPlanning.test.ts \
  tests/kiroReminderTools.test.ts \
  tests/kiroPromptV2.test.ts \
  tests/kiroResponsePreference.test.ts

npm run typecheck
```

Expected: all PASS.

Do not run full Vitest/build/Playwright unless a focused failure demonstrates a real cross-module issue.

- [ ] **Step 11: Self-review**

Confirm all of the following:

- `task5Decision === "skip"`.
- `toolFindings` contains no open actionable findings.
- `resolvedFindings` contains exactly the three Task 4B IDs.
- `tonight-free-time.gap === "none"`.
- `cancel-reminder.gap === "none"`.
- `weekly-pressure.gap === "medium"` remains unchanged.
- aggregate Tool remains not recommended.
- no files under `lib/ai/tools/**` changed.
- no Prompt, route, hooks, store, or UI files changed.
- typed audit and Markdown report communicate the same current-state conclusion.

- [ ] **Step 12: Commit**

```bash
git add \
  lib/ai/eval/kiroToolAudit.ts \
  tests/kiroToolAudit.test.ts \
  docs/kiro/kiro-tool-capability-audit.md

git commit -m "docs(kiro): close tool capability audit"
```
