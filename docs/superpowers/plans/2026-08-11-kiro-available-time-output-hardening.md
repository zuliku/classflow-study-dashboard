# Kiro Available Time Output Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `get_available_time` return a deterministic `totalMinutes` for the full queried free-time result while preserving the existing 20-slot display cap and all current planning semantics.

**Architecture:** Keep the existing `findFreeTime()` domain engine and `get_available_time` schema unchanged. Compute `totalMinutes` from the full `slots` array before `slots.slice(0, 20)`, then expose `{ startDate, endDate, totalMinutes, slots }`; verify both ordinary queries and the truncation boundary with focused tests.

**Tech Stack:** TypeScript, Vitest, existing ClassFlow read-tool executor and free-time engine.

## Global Constraints

- Task 4B decision is `refine-existing-tools`; do not add any new Tool.
- Only change existing `get_available_time` output; do not change its input schema, date limits, free-time semantics, Tool selection policy, Prompt V2, or runtime Tool-call limits.
- `totalMinutes` must represent the full deterministic free-time result, not merely the first 20 returned slots.
- Keep `slots.slice(0, 20)` unchanged as the detail payload cap.
- No dependency upgrades, build, Playwright, E2E, or full Vitest by default.

---

### Task 1: Add deterministic `totalMinutes` to `get_available_time`

**Files:**
- Modify: `lib/ai/tools/read/executor.ts` in `getAvailableTime()`
- Modify: `tests/kiroPlanning.test.ts` in the `get_available_time` describe block

**Interfaces:**
- Consumes: `findFreeTime(query): FreeTimeSlot[]`, where each slot contains `minutes: number`.
- Produces: successful `get_available_time` data shaped as `{ startDate: string; endDate: string; totalMinutes: number; slots: FreeTimeSlot[] }`; `slots` remains capped at 20 while `totalMinutes` sums the uncapped array.

- [ ] **Step 1: Write the failing ordinary-result test**

Extend the existing first `get_available_time` test to type and assert `totalMinutes`:

```ts
const r = read.executeKiroReadTool(
  "get_available_time",
  { startDate: dayStr(0), endDate: dayStr(1) },
  store.getState()
) as {
  ok: true;
  data: {
    totalMinutes: number;
    slots: { date: string; startTime: string; endTime: string; minutes: number }[];
  };
};

expect(typeof r.data.totalMinutes).toBe("number");
expect(r.data.totalMinutes).toBe(
  r.data.slots.reduce((sum, slot) => sum + slot.minutes, 0)
);
```

This short range should remain under the 20-slot cap, so equality verifies the basic deterministic sum.

- [ ] **Step 2: Write the failing truncation-boundary test**

Add a new test proving the total is computed before the existing `slice(0, 20)` cap:

```ts
it("totalMinutes 汇总完整空闲结果，而 slots 详情仍最多返回 20 条", async () => {
  seedState();
  const { store, read } = await freshRead();

  const r = read.executeKiroReadTool(
    "get_available_time",
    { startDate: dayStr(0), endDate: dayStr(30) },
    store.getState()
  ) as {
    ok: true;
    data: {
      totalMinutes: number;
      slots: { minutes: number }[];
    };
  };

  const returnedMinutes = r.data.slots.reduce(
    (sum, slot) => sum + slot.minutes,
    0
  );

  expect(r.data.slots).toHaveLength(20);
  expect(r.data.totalMinutes).toBeGreaterThan(returnedMinutes);
});
```

The 30-day inclusive query is within the executor's existing `differenceInDays <= 30` limit and deterministically creates more than 20 free-time slots with the current fixture.

- [ ] **Step 3: Run focused RED test**

Run:

```bash
npx vitest run tests/kiroPlanning.test.ts
```

Expected: FAIL because `totalMinutes` is currently missing.

- [ ] **Step 4: Implement the minimal executor change**

In `getAvailableTime()` keep the existing `findFreeTime(...)` call unchanged, then compute from the full array before truncating:

```ts
const totalMinutes = slots.reduce(
  (sum, slot) => sum + slot.minutes,
  0
);

return {
  ok: true,
  data: {
    startDate,
    endDate,
    totalMinutes,
    slots: slots.slice(0, 20),
  },
};
```

Do not derive the total from `slots.slice(0, 20)`.

- [ ] **Step 5: Re-run focused tests**

Run:

```bash
npx vitest run tests/kiroPlanning.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run Intelligence V2 focused regression tests**

Run:

```bash
npx vitest run \
  tests/kiroToolAudit.test.ts \
  tests/kiroEvalScenarios.test.ts \
  tests/kiroPromptV2.test.ts \
  tests/kiroResponsePreference.test.ts
npm run typecheck
```

Expected: all PASS. The audit may still describe the finding until Task 5C Audit Closure; do not edit audit files in this task.

- [ ] **Step 7: Self-review scope**

Confirm:

```text
- no new Tool
- no schema change
- no Prompt change
- no registry change required
- no freeTime domain change
- totalMinutes sums uncapped slots
- detail slots remain capped at 20
- beforeDeadlineOfAssignmentId behavior remains unchanged
- minimumMinutes filtering remains unchanged
- date-range validation remains unchanged
```

- [ ] **Step 8: Commit**

```bash
git add \
  lib/ai/tools/read/executor.ts \
  tests/kiroPlanning.test.ts

git commit -m "feat(kiro): expose available time total minutes"
```

## Self-Review

- **Spec coverage:** Implements the single remaining low-severity Task 4B output finding without adding a Tool or changing Tool-selection behavior.
- **Placeholder scan:** No TBD/TODO/implicit implementation steps remain.
- **Type consistency:** `totalMinutes` is consistently defined as `number`; existing `slots` payload and input schema are unchanged.
