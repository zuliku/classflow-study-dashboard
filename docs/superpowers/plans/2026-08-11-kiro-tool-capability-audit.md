# Kiro Tool Capability Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the current Kiro Read / Write / Memory tool surface against the 15 typed Eval scenarios, record evidence-backed capability gaps, and make a concrete decision on whether Task 5 should skip, refine existing tools, or add a minimal new tool.

**Architecture:** Keep runtime behavior unchanged. Add a typed audit artifact under `lib/ai/eval` that references real `KIRO_TOOLS` names and real `KIRO_EVAL_SCENARIOS` ids, plus focused tests that guarantee every Eval scenario has an audit result and every finding points to an existing tool. Add a concise human-readable audit report that mirrors the typed conclusions. The expected overall decision, if current code matches inspected main, is `refine-existing-tools`, not a new aggregate tool.

**Tech Stack:** TypeScript, Vitest, existing Kiro tool registries/executors.

## Global Constraints

- Task 4B is audit-only: do not change Prompt, tool descriptions, schemas, executors, runtime limits, routing, settings, stores, streaming, or UI.
- Audit conclusions must come from current code, not remembered behavior.
- Tool names must derive from `keyof typeof KIRO_TOOLS`; scenario ids must derive from `KIRO_EVAL_SCENARIOS`.
- Do not call a real LLM or `/api/ai/chat`.
- A new aggregate tool is recommended only if multiple common scenarios repeatedly require the same 4+ tool composition and current prompt/selection policy cannot reduce it reliably.
- Prefer focused Vitest plus `npm run typecheck`; do not run full build / Playwright by default.

---

### Task 1: Typed capability audit + report

**Files:**
- Create: `lib/ai/eval/kiroToolAudit.ts`
- Create: `tests/kiroToolAudit.test.ts`
- Create: `docs/kiro/kiro-tool-capability-audit.md`

**Interfaces:**
- Consumes: `KIRO_TOOLS`, `KIRO_EVAL_SCENARIOS`, `KiroEvalToolName`.
- Produces: `KIRO_TOOL_CAPABILITY_AUDIT`, a typed, code-reviewable audit result used to decide Task 5.

- [ ] **Step 1: Inspect only the evidence-bearing files**

Read the current relevant sections of:

```text
lib/ai/eval/kiroScenarios.ts
lib/ai/tools/read/registry.ts
lib/ai/tools/read/schemas.ts
lib/ai/tools/read/executor.ts
lib/ai/tools/write/registry.ts
lib/ai/tools/write/schemas.ts
lib/ai/tools/write/executor.ts
lib/ai/memory/tools.ts
```

Do not modify them. Verify actual names, schemas, returned fields, and runtime guards before recording findings.

- [ ] **Step 2: Write the failing audit tests**

Create `tests/kiroToolAudit.test.ts` that expects these exports from `@/lib/ai/eval/kiroToolAudit`:

```ts
KIRO_TOOL_CAPABILITY_AUDIT
KiroToolAuditDecision
```

The tests must verify:

```ts
import { describe, expect, it } from "vitest";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";
import { KIRO_TOOL_CAPABILITY_AUDIT } from "@/lib/ai/eval/kiroToolAudit";

describe("Kiro Tool Capability Audit", () => {
  it("audits every typed Eval scenario exactly once", () => {
    const scenarioIds = KIRO_EVAL_SCENARIOS.map((s) => s.id).sort();
    const auditedIds = KIRO_TOOL_CAPABILITY_AUDIT.scenarios.map((s) => s.scenarioId).sort();
    expect(auditedIds).toEqual(scenarioIds);
  });

  it("references only real tools", () => {
    const names = new Set(Object.keys(KIRO_TOOLS));
    for (const finding of KIRO_TOOL_CAPABILITY_AUDIT.toolFindings) {
      expect(names.has(finding.tool)).toBe(true);
    }
  });

  it("makes one explicit Task 5 decision", () => {
    expect(["skip", "refine-existing-tools", "add-minimal-tool"]).toContain(
      KIRO_TOOL_CAPABILITY_AUDIT.task5Decision
    );
  });

  it("does not recommend an aggregate tool without repeated evidence", () => {
    if (KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool.recommended) {
      expect(KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool.supportingScenarioIds.length).toBeGreaterThanOrEqual(3);
      expect(KIRO_TOOL_CAPABILITY_AUDIT.aggregateTool.repeatedToolPattern.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("records evidence for every non-keep finding", () => {
    for (const finding of KIRO_TOOL_CAPABILITY_AUDIT.toolFindings) {
      if (finding.disposition !== "keep") {
        expect(finding.evidence.length).toBeGreaterThan(0);
        expect(finding.recommendation.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
```

Also assert that, if current code still matches the inspected main, the audit contains finding ids:

```text
available-time-total-minutes
delete-reminder-listing-description
delete-reminder-scheduled-guard
```

- [ ] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/kiroToolAudit.test.ts
```

Expected: FAIL because the audit module does not yet exist.

- [ ] **Step 4: Implement the typed audit model**

Create `lib/ai/eval/kiroToolAudit.ts` with types equivalent to:

```ts
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";

export type KiroAuditedToolName = keyof typeof KIRO_TOOLS;
export type KiroEvalScenarioId = (typeof KIRO_EVAL_SCENARIOS)[number]["id"];

export type KiroToolAuditDecision =
  | "skip"
  | "refine-existing-tools"
  | "add-minimal-tool";

export type KiroToolFindingDisposition =
  | "keep"
  | "refine-description"
  | "refine-output"
  | "refine-runtime"
  | "candidate-new-tool";

export interface KiroScenarioCapabilityAudit {
  scenarioId: KiroEvalScenarioId;
  coverage: "direct" | "composed" | "transactional";
  gap: "none" | "low" | "medium" | "high";
  evidence: string[];
  conclusion: string;
}

export interface KiroToolCapabilityFinding {
  id: string;
  tool: KiroAuditedToolName;
  disposition: KiroToolFindingDisposition;
  severity: "info" | "low" | "medium" | "high";
  evidence: string[];
  recommendation: string;
}
```

Then export:

```ts
export const KIRO_TOOL_CAPABILITY_AUDIT = {
  task5Decision: "refine-existing-tools",
  aggregateTool: {
    recommended: false,
    proposedName: null,
    supportingScenarioIds: ["weekly-pressure"],
    repeatedToolPattern: [],
    reason: "Only weekly-pressure currently needs broad composition; the Eval matrix does not show the same 4+ Tool pattern across 3+ common scenarios.",
  },
  scenarios: [...],
  toolFindings: [...],
} as const;
```

If current evidence materially differs, adjust the decision, but document the changed evidence explicitly and keep the same decision enum.

- [ ] **Step 5: Audit all 15 scenarios**

Create exactly one scenario audit entry per `KIRO_EVAL_SCENARIOS` item.

Use these coverage rules:

```text
direct        = one dedicated Tool or a short direct path already covers the request
composed      = multiple existing Tools are legitimately needed
transactional = a transaction/write Tool owns correctness semantics
```

Expected current conclusions if code still matches main:

```text
today-task-list                  direct / none
today-top-priority               composed / low
today-study-plan                 composed / none
assignment-health                direct / none
weekly-pressure                  composed / medium
tonight-free-time                direct / low
pdf-task-breakdown               composed / none
multi-assignment-week-plan       direct-or-composed / none
batch-ddl-change                 transactional / none
create-reminder                  direct / none
cancel-reminder                  composed / medium
a start-focus scenario           direct / none
course-material-list             direct / none
material-requirements-summary    direct / none
save-study-preference-memory     direct / none
```

Do not invent a new Tool merely because `weekly-pressure` is composed.

- [ ] **Step 6: Record intentional overlaps as keep findings or scenario evidence**

Explicitly record that these overlaps are currently intentional and do not justify new APIs:

```text
get_assignment vs get_assignment_schedule
- get_assignment = full task detail
- get_assignment_schedule = direct deterministic schedule view

get_course vs get_material_metadata
- get_course = broad course detail
- get_material_metadata = dedicated metadata lookup / listing

search_assignments vs get_upcoming_assignments
- search_assignments = flexible scoped/filter search
- get_upcoming_assignments = direct upcoming-DDL view
```

No refactor is required in Task 4B.

- [ ] **Step 7: Record the existing strong composite tools**

The audit must explicitly note that current code already has strong deterministic/composite tools and therefore does not need a new dashboard-style aggregate yet:

```text
get_assignment_health
- already computes health and availableMinutesBeforeDeadline internally
- `assignment-health` should not require `get_available_time`

propose_study_plan
- already consumes schedules, calendar marks and StudyBlocks internally
- planning scenarios should not reconstruct a schedule through week_schedule + available_time

get_available_time
- already excludes courses, calendar marks and StudyBlocks through deterministic free-time logic
```

- [ ] **Step 8: Evidence-backed finding — `get_available_time` lacks aggregate total**

If current executor still returns:

```ts
{ startDate, endDate, slots: ... }
```

without `totalMinutes`, record:

```text
id: available-time-total-minutes
tool: get_available_time
disposition: refine-output
severity: low
```

Evidence:

```text
`tonight-free-time` requires an overall free-time amount.
The Tool returns deterministic slots but not a deterministic aggregate total, so the model must sum slot minutes itself.
```

Task 5 recommendation:

```text
Add `totalMinutes` to the existing Tool result; do not create a new Tool.
```

Do not implement it in Task 4B.

- [ ] **Step 9: Evidence-backed finding — `delete_reminder` listing description conflicts with Task 3 policy**

If current registry still says, effectively:

```text
删除前必须用 list_reminders 拿到真实 reminderId
```

while schema/executor only require `reminderId`, record:

```text
id: delete-reminder-listing-description
tool: delete_reminder
disposition: refine-description
severity: medium
```

Evidence:

```text
The Prompt policy says list_reminders is only needed when the current turn does not already have a unique reminderId.
The delete schema accepts a real reminderId directly.
The registry wording currently encourages a redundant Read even when the id is already known.
```

Task 5 recommendation:

```text
Align delete_reminder description with update_reminder: list only when there is no unique reminderId.
```

Do not change the registry in Task 4B.

- [ ] **Step 10: Evidence-backed finding — `delete_reminder` scheduled-only guard is not enforced**

If current write registry says deletion is only for `scheduled` reminders but the current `deleteReminder` executor only checks that the id exists and then deletes it, record:

```text
id: delete-reminder-scheduled-guard
tool: delete_reminder
disposition: refine-runtime
severity: high
```

Evidence must mention both sides:

```text
registry contract: only scheduled reminders may be deleted/cancelled
runtime executor: finds by id and deletes without checking `target.status === "scheduled"`
```

Task 5 recommendation:

```text
Before delete, reject fired/skipped reminders with INVALID_INPUT, matching update_reminder's scheduled-only guard.
```

Do not implement the guard in Task 4B.

- [ ] **Step 11: Decide aggregate Tool status**

Use this rule:

```text
Recommend a new aggregate Tool only when >= 3 common Eval scenarios show the same >= 4 Tool composition after Task 3 selection policy is applied.
```

With the current 15-scenario matrix, expected result is:

```text
aggregateTool.recommended = false
```

`weekly-pressure` alone is insufficient evidence for `get_today_study_brief`, `get_weekly_study_brief`, or similar.

Do not invent a candidate name unless the threshold is actually met.

- [ ] **Step 12: Record Eval coverage limits**

Add an audit note that the 15-scenario matrix is intentionally centered on core learning-management flows and does not yet provide enough evidence to refactor unrepresented tool families such as broad group-project CRUD or schedule CRUD.

Conclusion:

```text
No API changes to unrepresented tool families based only on this audit.
```

- [ ] **Step 13: Write the human-readable audit report**

Create `docs/kiro/kiro-tool-capability-audit.md` with these sections:

```text
# Kiro Tool Capability Audit

## Decision
refine-existing-tools

## What already works well
- deterministic Health
- deterministic Available Time
- deterministic Study Plan Proposal
- Task/Material/Reminder/Focus direct paths

## Findings
1. get_available_time: add totalMinutes to existing output
2. delete_reminder: description should not force list_reminders when id is already unique
3. delete_reminder: runtime must enforce scheduled-only deletion

## Aggregate Tool Decision
Do not add a new aggregate Tool yet.

## Evidence threshold for future aggregate Tool
>= 3 common scenarios + same >= 4 Tool pattern after Prompt V2 / Task 3 policy.

## Eval Coverage Limits
Note unrepresented tool families; do not change them without additional scenarios/evidence.

## Task 5 Scope
Only evidence-backed refinements above.
```

Keep the report concise; do not paste registry or executor source.

- [ ] **Step 14: Run GREEN verification**

Run:

```bash
npx vitest run \
  tests/kiroToolAudit.test.ts \
  tests/kiroEvalScenarios.test.ts \
  tests/kiroPromptV2.test.ts \
  tests/kiroResponsePreference.test.ts
npm run typecheck
```

Expected: PASS.

Do not run full Vitest, build, or Playwright unless a focused failure proves escalation is needed.

- [ ] **Step 15: Self-review**

Confirm:

```text
- exactly 15 current Eval scenarios are audited
- no Tool/runtime file changed
- every Tool finding references a real KIRO_TOOLS name
- every non-keep finding has concrete code evidence
- aggregate Tool is not recommended from one broad scenario alone
- Task 5 decision is explicit
- high-severity delete_reminder runtime mismatch is not silently fixed in this task
- audit report and typed artifact agree
```

- [ ] **Step 16: Commit**

```bash
git add \
  lib/ai/eval/kiroToolAudit.ts \
  tests/kiroToolAudit.test.ts \
  docs/kiro/kiro-tool-capability-audit.md

git commit -m "docs(kiro): audit agent tool capabilities"
```
