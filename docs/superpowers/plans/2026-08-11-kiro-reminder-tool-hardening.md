# Kiro Reminder Tool Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the two evidence-backed `delete_reminder` gaps found by the Kiro Tool Capability Audit: remove the unconditional `list_reminders` requirement when a unique `reminderId` is already known, and enforce the declared scheduled-only deletion rule at runtime.

**Architecture:** Keep the existing Reminder schema, risk/confirmation, Undo, Store actions, and Prompt behavior unchanged. Align the write-tool description with Task 3's conditional disambiguation policy, then add one executor guard before mutation so fired/skipped historical reminders cannot be deleted. Reuse the existing real-Store Reminder Vitest fixture.

**Tech Stack:** TypeScript, Zustand, Zod, AI SDK tool registry, Vitest.

## Global Constraints

- This is an existing-tool hardening task; do not add a new Tool.
- Do not change Reminder schema, Reminder timing semantics, risk classification, confirmation, Undo architecture, Prompt V2, Tool Selection Policy, or client/server chat plumbing.
- A known real `reminderId` may be deleted directly; `list_reminders` is only required when the current message does not uniquely identify the reminder.
- Only `scheduled` reminders may be deleted. `fired` and `skipped` reminders are historical records and must remain unchanged.
- Failed historical deletion must return `INVALID_INPUT`, perform no mutation, and register no Undo.
- Preserve successful scheduled deletion with exact-snapshot Undo.
- Prefer focused Vitest plus `npm run typecheck`; do not run full build / Playwright by default.

---

### Task 1: Harden `delete_reminder` description and runtime contract

**Files:**
- Modify: `lib/ai/tools/write/registry.ts`
- Modify: `lib/ai/tools/write/executor.ts`
- Modify: `tests/kiroReminderTools.test.ts`

**Interfaces:**
- Consumes: existing `KIRO_WRITE_TOOLS.delete_reminder`, `deleteReminderSchema`, `executeKiroWriteTool()`, `invalidInput()`, and real Store Reminder fixture in `tests/kiroReminderTools.test.ts`.
- Produces: `delete_reminder` description consistent with Task 3 conditional disambiguation; runtime scheduled-only deletion; preserved scheduled deletion Undo.

- [ ] **Step 1: Add failing description and runtime tests**

In `tests/kiroReminderTools.test.ts`, add a registry import:

```ts
import { KIRO_WRITE_TOOLS } from "@/lib/ai/tools/write/registry";
```

Add a focused description test:

```ts
describe("delete_reminder contract", () => {
  it("description only requires list_reminders when reminderId is not uniquely known", () => {
    const description = String(KIRO_WRITE_TOOLS.delete_reminder.description ?? "");
    expect(description).toContain("没有唯一 reminderId");
    expect(description).toContain("list_reminders");
    expect(description).not.toContain("删除前必须用 list_reminders");
  });
});
```

Update the current delete + Undo test so it seeds a `scheduled` reminder rather than a `fired` reminder. Keep exact-snapshot assertions for `id`, `triggerAt`, `targetId`, `status`, and `readAt` where meaningful.

Add a new runtime test covering both historical states:

```ts
it("fired / skipped reminder cannot be deleted and no Undo is registered", async () => {
  seedState({
    reminders: [
      seedReminder({ id: "r-fired", status: "fired", firedAt: "2026-08-10T12:00:00" }),
      seedReminder({ id: "r-skipped", status: "skipped" }),
    ],
  });
  const { store, write } = await freshModules();
  const undos = new Map<string, () => void>();
  const api = buildApi(store, undos);
  const before = store.getState().reminders.map((x: Reminder) => ({ ...x }));

  const fired = write.executeKiroWriteTool(
    "delete_reminder",
    { reminderId: "r-fired" },
    api,
    "delete-fired"
  ) as { ok: false; code: string; message: string };

  const skipped = write.executeKiroWriteTool(
    "delete_reminder",
    { reminderId: "r-skipped" },
    api,
    "delete-skipped"
  ) as { ok: false; code: string; message: string };

  expect(fired.ok).toBe(false);
  expect(fired.code).toBe("INVALID_INPUT");
  expect(skipped.ok).toBe(false);
  expect(skipped.code).toBe("INVALID_INPUT");
  expect(store.getState().reminders).toEqual(before);
  expect(undos.has("delete-fired")).toBe(false);
  expect(undos.has("delete-skipped")).toBe(false);
});
```

Do not weaken the existing update-reminder fired guard test.

- [ ] **Step 2: Run focused RED verification**

Run:

```bash
npx vitest run tests/kiroReminderTools.test.ts
```

Expected: the new description test fails against the unconditional current text, and the fired/skipped deletion test fails because the executor currently deletes historical reminders.

- [ ] **Step 3: Make the registry description conditional**

In `lib/ai/tools/write/registry.ts`, replace only the `delete_reminder` description with wording equivalent to:

```ts
delete_reminder: tool({
  description:
    "删除 / 取消提醒（仅 scheduled 状态；删除有 Undo 可恢复原记录）。" +
    "若当前消息没有唯一 reminderId，先 list_reminders 定位；已有真实唯一 reminderId 时可直接删除。" +
    "多个候选必须询问用户，不得猜 ID。",
  inputSchema: KIRO_WRITE_TOOL_SCHEMAS.delete_reminder,
}),
```

Do not change `deleteReminderSchema`.

- [ ] **Step 4: Add the scheduled-only runtime guard before mutation**

In `lib/ai/tools/write/executor.ts`, update `deleteReminder()` immediately after the existing not-found check:

```ts
const target = api.getState().reminders.find((r) => r.id === parsed.data.reminderId);
if (!target) return notFound("未找到对应提醒。");
if (target.status !== "scheduled") return invalidInput("历史提醒不能删除。");
```

Only after this guard should the function snapshot, delete, and register Undo.

Do not change successful action-card metadata, risk, Undo snapshot shape, or Store action behavior.

- [ ] **Step 5: Run focused GREEN verification**

Run:

```bash
npx vitest run tests/kiroReminderTools.test.ts
npm run typecheck
```

Expected: PASS.

Do not run full Vitest, `npm run build`, Playwright, or E2E unless these focused checks expose a real cross-module failure.

- [ ] **Step 6: Self-review contract boundaries**

Confirm all of the following:

```text
scheduled + unique reminderId -> direct delete succeeds
scheduled delete -> existing exact-snapshot Undo still restores the same reminder
fired -> INVALID_INPUT, no mutation, no Undo
skipped -> INVALID_INPUT, no mutation, no Undo
missing reminderId / ambiguous reminder -> still resolved through list_reminders at Agent policy level
known unique reminderId -> description no longer forces redundant list_reminders
create_reminder / update_reminder semantics unchanged
Reminder schema unchanged
Prompt unchanged
Tool names unchanged
```

- [ ] **Step 7: Commit**

```bash
git add \
  lib/ai/tools/write/registry.ts \
  lib/ai/tools/write/executor.ts \
  tests/kiroReminderTools.test.ts

git commit -m "fix(kiro): harden reminder deletion contract"
```
